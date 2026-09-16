import path from 'node:path';
import { createHash } from 'node:crypto';
import { tx } from '../db.js';
import { listTree, readFileAt, writeFileAt } from '../files/tree.js';
import { LIBRARY_DIR, LIBRARY_MANIFEST } from '../files/paths.js';
import { commitPaths, currentSha } from '../files/git.js';
import { versionNew } from '../files/pending.js';
import { hasErrors, listErrors } from '../runtime.js';
import { latestShot } from '../shots.js';
import {
  tokensCharged, tokensForChars, DEFAULT_MAX_TOKENS, HIT_DIVISOR, OUTPUT_WEIGHT,
} from '../llm/deepseek.js';
import {
  hasBudget, consumeBudget, DEFAULT_DAILY_TOKEN_BUDGET,
  studioLimit, userHasBudget, chargeUser,
} from '../budget.js';
import { messagePublic, agentAuthorFor } from '../routes/helpers.js';
import { parseMentions, agentEligible } from '../mentions.js';
import { createToolset } from './tools.js';
import {
  pausedPlan, draftPlan, queuedPlan, createPlan, planFor, setPiece, setPlanStatus, settlePieces,
  queuePlan, announcePlan as announcePlanRow,
} from '../plans.js';
import {
  sizingRules, sizingTrigger, parseSizing, pieceTurn, planBody, headline, handoffNote,
  notesForPlanner, begunNote, SIZING_MAX_TOKENS, CONFIRM_TRIGGER, resizeTrigger, specText,
  inOtherScript, SCRIPT_TRIGGER,
} from './sizing.js';
import { arcFor } from '../../public/arc.js';

// Context budgets (spec.md §8). DeepSeek's window is 1,048,576 tokens, so
// these caps are about cost and latency rather than capability — roughly
// 200K tokens against a 1M ceiling.
//
// Measured against the live API, not assumed. Prompt caching hits ~99% between
// the turns of one fire, and ~100% between two fires as long as no file
// changed — but only because the file block is in the system prompt, ahead of
// the transcript. On the last user message, where it used to be, the history
// arriving in front of it moved it and every fire was charged as a full miss:
// 0%, not even the preamble. Inside the block, everything is ordered most
// stable first for the same reason: contents least-recently-modified first,
// the tree (which changes size on every edit) last, and nothing per-turn —
// pins ride the last user message. The cache only serves a prefix back to a
// depth where some earlier request already diverged (spec.md §14), so the
// first fire after an edit still pays in full; the point of this order is
// that a session editing the same files keeps the divergence depth still,
// and those fires measured 94% cached against 0% with the tree in front
// (spec.md §8, probes/probe-order.mjs).
const AMBIENT_BYTES = 400 * 1024;
const HISTORY_BYTES = 200 * 1024;
const MAX_HISTORY_MESSAGES = 200;
// The brief is the one project file that goes into the system prompt whole, so
// it is the one an agent can grow until it crowds out everything else.
const BRIEF_BYTES = 32 * 1024;
// Bytes the tool loop may add to a request before the fire has to stop.
// Everything else here is capped once per fire; the loop is the part that
// grows as it runs — 40 reads at 128 KB each, plus every file it writes echoed
// back in the assistant turn that wrote it.
const LOOP_GROWTH_BYTES = 512 * 1024;

// How many recent human turns' context_paths count as pinned.
const PINNED_TURNS = 3;

const DEFAULT_COOLDOWN_MS = 5_000;
// A whole small game is index.html, a stylesheet and four or five scripts,
// and the model reads a file or two before it patches. At 8 turns it ran out
// mid-build routinely, because DeepSeek usually emits one or two calls per
// turn — so turns bound first and 12 tool calls were never reached. These are
// runaway guards, not a work allowance; the daily token budget is what caps
// cost.
const MAX_ASSISTANT_TURNS = 24;
const MAX_TOOL_CALLS = 40;
// Times an agent may pick up where it left off after exhausting its turns,
// counted from the last human message. Without this a stall needs a human to
// type "keep going", which is the whole complaint.
const MAX_CONTINUATIONS = 3;
// The budget of a *small* ask in the builder's room (spec.md §8): sized as
// one job, so it gets the room for one. The whole tree is already in its
// prompt, so a change is a patch, a read-back and a note — three turns — and
// six is twice that path. Past it the fire stops, what it did is kept, and
// what is left goes back to the sizing as a plan. The 24 above is for a room
// with no sizing in front of it; a real receipt showed a "small" ask running
// to 24 turns and carrying on, which is what the plan was for.
const SMALL_TURNS = 6;
const SMALL_TOOL_CALLS = 12;

// A tool call cut off mid-arguments wrote nothing at all — the JSON never
// parsed, so there was no path and no content. The model does not know that
// and its reply says the file was written, so it has to be told, or a game
// gets committed with a hole in it.
const CUT_NOTICE = '[studio] Your last reply was cut off before a tool call'
  + ' finished, so that file was NOT written and nothing was saved for it.'
  + ' Write it again, smaller: one file per call, and split a long file into'
  + ' several shorter ones.';

// DeepSeek re-attaches everything it has said in the current tool-call chain
// — reasoning included — to every continuation, and bills it as cached input,
// accumulating until a user-role message closes the chain (spec.md §14).
// This note is that message: pure housekeeping, appended mid-loop when
// carrying the pile costs more than shedding it. Loop messages are never
// persisted, so it exists only inside the fire that wrote it.
const SHED_NOTICE = '[studio] Housekeeping note; nothing is needed from you'
  + ' here — carry on with the task above.';
// Shed when carrying the pile for a conservative few more rounds costs more
// than the shed does: a shed re-pays the visible loop content since the last
// one at full price (the branch point moves), while carrying charges the hit
// price on the pile every request. The floor keeps short fires from shedding.
const SHED_HORIZON_ROUNDS = 4;
const SHED_FLOOR_TOKENS = 8000;

// The one user turn a small ask's fire adds on top of the sizing exchange in
// the builder's room (spec.md §8): short, since the conversation must end on a
// user turn for the model to answer, and everything it needs is above.
const GO_AHEAD = '[studio] Go ahead.';

const BRIEF_FILE = 'BRIEF.md';
const MAX_COMMIT_SUBJECT = 72;

function firstLine(text) {
  const line = String(text ?? '').trim().split('\n')[0] ?? '';
  return line.length > MAX_COMMIT_SUBJECT
    ? `${line.slice(0, MAX_COMMIT_SUBJECT - 1)}…`
    : line;
}

// The shape a game takes when it holds the libraries for it: the studio's own
// answer to each problem every game has.
//
// The API notes this follows say what each call does. They never say that a
// game is expected to make those calls, so an agent reading six notes reads
// six optional conveniences — and hand-rolls a title screen, a game-over
// banner and a controls hint onto its canvas, which is how the two games in
// TODO.md ended up with their own menus sitting under the drawn touch
// controls. The note is the contract; this is the shape.
//
// Gated on the manifest, one line at a time: a game that does not hold
// screens.js must not be told to call Screens.
function shapeLines(held) {
  const out = [];
  if (held.size === 0) return out;
  out.push(
    '',
    "How a game is shaped. Each line below is the studio's answer to something every game needs, and",
    'each is already in this game\'s tree. Answering one again in the game\'s own code is the most common',
    'way a game ends up as something nobody else can pick up and change:',
  );
  if (held.has('screens')) out.push(
    '- It opens on a title screen rather than already running: Screens.title({ onStart: start }) puts up',
    '  the name, the tagline, one Start button and the how-to-play line, and calls start when pressed. A',
    '  tap on it reaches Input as one frame of "start", so a touchscreen needs nothing extra. A score is',
    '  what makes the same screen the game-over screen, so a run ends on Screens.title({ score, post: true,',
    '  board: true, onStart: start }). It returns { close } for taking it away yourself — there is no',
    '  Screens.close. Do not draw a title, a game-over banner or a play-again prompt of your own: those',
    '  three are the ones most often rebuilt by hand, and a hand-rolled one sits under the drawn touch',
    '  controls instead of stepping aside for them.',
    '- How big the game is on the screen is Screens.fit(el), called once at boot with the canvas or the',
    '  box holding it — not width css of your own, which is the thing fit overrules. A game sized on the',
    '  window\'s width alone comes off the bottom of a phone held sideways, and every game here that was',
    '  written that way did.',
    '- The numbers on screen while it runs are Screens.chips({ Score: 12, Lives: 3 }), a whole strip per',
    '  call and cheap to call every frame — not text the game draws for itself. A bar is a chip too:',
    '  { Risk: { value: 43, max: 100, text: "43/100" } } draws a meter beside the number, and a node of',
    '  your own as a value puts anything else in the row, so there is no reason to build a HUD by hand.',
  );
  if (held.has('input')) out.push(
    '- Every frame begins with Input.update(), before anything reads it, and the game asks Input.held,',
    '  Input.pressed and Input.axis rather than listening for keys itself. config/controls.js is where the',
    '  bindings live and where SCHEME says what a touchscreen gets. Read that word before writing any input',
    '  code: it was picked when the game was made and a person can change it in Controls whenever they',
    '  like, so it is a decision rather than a default — and the notes above it may still describe the',
    '  shape the game started as. Change it only if you are asked to, and then make the bindings match it.',
  );
  if (held.has('moments')) out.push(
    '- Moments.say goes on the line where the thing happens, not in a batch at the end.',
  );
  if (held.has('sprites')) out.push(
    '- A picture is Sprites.draw, by plain name, and it stays quiet about a file nobody has made yet — so',
    '  the call goes in before the art does, in the same reply that asks for it.',
  );
  if (held.has('sound')) out.push(
    '- A noise is Sound.play, the same way and for the same reason.',
  );
  return out;
}

// Games only. A chat gets no preamble at all: every sentence here is about a
// working tree it does not have, and an agent in a chat is whatever its
// description says it is, with nothing from the studio layered on top.
function studioPreamble({
  project, maxAssistantTurns, maxToolCalls, libraryNotes = [], sizing = false,
}) {
  // Every helper that reads this can edit: a game's rooms are all the
  // builder's (spec.md §3), and a chat project's helper gets no preamble.
  const lines = [
    `You are an agent in Unbridled Joy, a game studio, working with people on the browser game "${project.name}".`,
    'The project is a working tree of files. Every change is committed to git, so nothing is unrecoverable.',
    '',
    'Paths are project-relative and / separated: no leading slash, no "..", no ".git", at most 8 segments.',
    '',
    'You have file tools. Prefer patch_file over write_file when changing a file that already exists —',
    'it is cheaper and cannot silently lose the parts you did not mean to touch.',
    '',
    'Build a game as many small files rather than one big page. index.html holds the markup and nothing',
    'else; css/ holds the styles; js/ holds one file per part of the game — input, drawing, levels, sound,',
    'state; config/ holds the numbers and the words. A few hundred lines each. One enormous index.html',
    'cannot be patched cheaply and is the thing most likely to be cut off half-written.',
    '',
    'assets/ holds the pictures and sounds, in four folders: assets/sounds/ for short noises,',
    'assets/music/ for whole tracks, assets/sprites/ for pictures that move — a film strip of square',
    'frames — and assets/images/ for the ones that do not.',
    'The sound and sprites libraries look up a plain name in assets/sounds/ and assets/sprites/, so',
    'Sound.play("laser") plays assets/sounds/laser.wav and Sprites.draw(ctx, "hero", x, y) draws',
    'assets/sprites/hero.png; anything in assets/images/ or assets/music/ is named by its whole path,',
    'and Sound.loop("assets/music/theme.mp3", 0.4) is how a track plays behind a game — quieter than a',
    'noise, because it is under everything else. write_file takes text, so you can neither make nor',
    'change one of these files, but a person can, from the "Add a file" button above the file list. Ask',
    'for what you need by name and say what it is for — "assets/sounds/laser.wav, the shooting noise" —',
    'and say which of its choices makes it:',
    '- "+ Draw a picture" draws a sprite or a backdrop square by square and saves a .png, up to 1024 a side.',
    '- "+ Make a sound" makes a .wav from a row of sliders, and opens any sound made that way again.',
    '- "+ Upload" puts any file from their own device into the game.',
    'Writing the game to use a file that is not there yet is fine as long as you have asked for it in the',
    'same reply. Pointing at one nobody has heard of is not: it just fails to load while the game runs.',
    '',
    'Three picture names at the root are the studio\'s own dressing rather than the game\'s: chat.png',
    'tiles behind the conversation, hero.png backs the bar over it and the game\'s card on the public',
    'front page, and icon.png marks the game in the sidebar. Person-made pictures like any other — ask',
    'for them by those exact names at the root, never under assets/.',
    '',
    'One kind of picture you can make on your own: an .svg is text, so write_file and patch_file both work',
    'on it. Worth it for a plain shape, an icon or a background; a sprite someone should be proud of is',
    'still a person job.',
    '',
    'You can see. look_at shows you any .png, .jpg, .gif or .webp in the game — read_file cannot, and the',
    'file list only names them. Look before you judge a picture: whether a sprite reads at the size it is',
    'drawn, which way it faces, what its colours are, whether two of them belong in the same game. Do not',
    'look at one whose contents do not matter to what you are doing; every look costs, and the name is',
    'usually enough. An .svg is text — read_file it instead, and you get the shapes rather than a picture',
    'of them.',
    '',
    'look_at_game shows you the game itself: the last frame the person you are talking to was watching,',
    'taken when they sent their message. Use it the moment somebody says something looks wrong — "the',
    'ship is stuck", "it\'s all black", "the score is off the edge" — because what they can see and what',
    'the code says are different things, and this is the only way to have both. Worth looking again after',
    'a change to how the game looks, once they have played it. Two things it cannot do: a game drawn with',
    'HTML instead of a canvas has no picture to take, and there is none at all unless somebody has the',
    'preview open — it says so plainly either way, and neither is a fault to fix.',
    '',
    'config/ is the part a person tunes without reading code, so it has rules of its own:',
    '- ⚠️ Every number and every word the game uses lives here and nowhere else — speeds, sizes, counts,',
    '  colours, timings, lives, scores, level data, every string the player sees. A js/ file reads them',
    '  and never holds one: a constant in game code is a value nobody but you can change. Before a reply',
    '  ends, anything typed as a literal into js/ has moved into config/ with its comment, and a new',
    '  game gets its config files in its first piece, not later.',
    '- One batch per file: config/play.js (movement, timings), config/world.js (levels or board data),',
    '  config/look.js (colours, sizes), config/words.js (every string the player sees),',
    '  config/controls.js (which button does what), config/achievements.js (what a player can earn).',
    '- Plain values only, written as `const NAME = value;` — numbers, strings, true/false, and lists or',
    '  groups of those. No logic, no maths, no function calls: the studio shows these files as a form of',
    '  labelled fields, and it can only do that while every value is a plain one.',
    '- A comment on every value, in words a ten-year-old can read. That comment is the point of the file.',
    '- Change them whenever the game needs it — a new level, a new line, a rebalance — and keep the',
    '  comments when you do. Use patch_file for a single value so the rest of the file stays untouched.',
    '- ⚠️ Four of them open as an editor for the whole game rather than a list of fields, and only while',
    '  they keep their exact shape: config/questions.js as the "quiz editor", config/story.js as the',
    '  "story editor", config/achievements.js as the "achievements editor", the Achievements part of',
    '  Share (each entry is id, name, how, icon, when), and config/controls.js as "Controls", where a',
    '  person picks how the game is held and what each button does. Adding a key those do not know — a',
    '  weight on an answer, a field on a scene, a second test on a rule, a list of bindings where a line',
    '  of them belongs — costs the person the editor and drops them back to a form or to the code.',
    '  Do not reshape one to add a feature unless you have been asked for that feature and told the trade;',
    '  changing the words, adding questions, scenes or achievements, and everything else inside the shape',
    '  is free.',
    '',
    'Say what happens as it happens: Moments.say("name", value) on the line where the game gains a level,',
    'ends a run, settles a score or reaches an ending. A moment is just "this happened"; the studio watches',
    'them while a game is played, and config/achievements.js is where moments become what a player earns —',
    'each achievement a rule over one moment. Slug-shaped names, and a number, a short word or nothing for',
    'the value.',
    '',
    `${LIBRARY_DIR}/ is the studio's library, copied into this game so it runs anywhere, and it is the one`,
    'part of the tree you cannot write: your file tools refuse it. Read it, call it, and say so if it needs',
    `to change. ${LIBRARY_MANIFEST} says which libraries this game has and at what version.`,
    `Each one is a plain script and needs its tag in index.html — <script src="${LIBRARY_DIR}/input.js"></script>`,
    "and so on for the others — before the game's own scripts, or its calls run against nothing. If you write",
    'index.html, that is yours to get right.',
  ];
  // The engine's contract, never its source: each held library documents
  // itself with the note at the top of its file, read from the game's own
  // copy so it matches the version this game actually holds. Adding a
  // library to the studio teaches every helper about it with no edit here.
  const held = new Set();
  for (const { file, note } of libraryNotes) {
    lines.push('', `How to use ${file} — the note from the top of the file:`, note);
    held.add(file.slice(LIBRARY_DIR.length + 1, -3));
  }
  // After the notes, because the shape is what to do with them.
  lines.push(...shapeLines(held));
  lines.push(
    '',
    'A game can see its own assets/ folder live: GET _assets, relative to the game\'s page, answers',
    '{"files": [{"path": "assets/sprites/hero.png", "size": 1234, "mime": "image/png"}, …]} — every file',
    'under assets/, read from disk on each request — so a game can find all its pictures or sounds without',
    'a hand-kept list. Sprites and Sound still draw and play by name; this is for finding the names.',
  );
  // Only while the switch is on: a helper told about routes that answer 404
  // would happily build a broken board (spec.md §6).
  if (project.scores_on !== 0) lines.push(
    '',
    'Every game also has a scoreboard, kept by the studio rather than in the files, and a score only',
    'counts for a signed-in player: people sign in on the games site\'s front page, and the name on the',
    'board is their account\'s — never typed into the game, never in the body. From the game\'s own page:',
    'GET /_me answers {"user": {"name": "Pat"}} or {"user": null}; when it is null, offer a plain link',
    'to / saying to sign in to get on the board, and skip the post. POST /_scores/<slug> with JSON',
    '{"score": 120} saves one entry and answers {"rank": 3} — a null rank missed the board, a 401 means',
    'nobody is signed in — and GET /_scores/<slug> returns the best first as',
    '{"scores": [{"name": …, "score": …}, …]}, ten of them unless ?limit= asks for up to 100. The slug',
    'is the first piece of the page\'s address: location.pathname.split("/")[1]. Scores are whole',
    'numbers and bigger is better, so post a time as its negative and flip it back to show it. The',
    'board keeps the best 100. Show names with textContent, never innerHTML.',
  );
  lines.push(
    '',
    'Keep the project documents at the root, next to the code. They are notes for the people and agents',
    'working on the game, and never part of the game itself:',
    'BRIEF.md — the file map: what each file is for, how the pieces fit together, what someone needs to',
    '  know before touching them. This is the one file always in front of you, so keep it short, and',
    '  update it whenever you add, move, or repurpose a file.',
    'SPEC.md — what the game is and how it is meant to work: rules, controls, screens, and the decisions',
    '  already settled. Update it when a decision changes, not on every turn.',
    'TODO.md — one task per line, and only when the list is long enough to be worth staging. Delete a',
    '  line when it is done. For a small job, skip the file and do the work.',
    '',
    'The game runs in a preview beside the chat, and what it throws while somebody plays — a script that',
    'errored, a file that would not load — comes back to you on your next turn, against the version it',
    'happened on. Until somebody presses play, nothing you wrote has been tested, so ask them to.',
    '',
    'Settle the design before you write, then write each file once. Rewriting a file you wrote a moment',
    'ago, over and over, is how a reply runs out of turns with the game half-built — and the version that',
    'ships is then the one nobody has read. When you have finished changing a file, read it back.',
    '',
    `This reply gets at most ${maxAssistantTurns} turns and ${maxToolCalls} tool calls, then it is cut off`,
    'wherever it happens to be. Several tool calls in one turn cost one turn, so send them together:',
    'a turn spent on a single read is a turn you do not get back. If you can see you will not finish,',
    'stop and say what is left rather than being cut off mid-file.',
  );
  // What this game is, when the studio knows (projects.type). A type brings
  // an editor the person works in, and a helper that has not been told sees
  // the story as a file to rewrite from the wrong end. Named by the words on
  // the pill, like every other button; orchestrator.test.js asserts them.
  if (project.type === 'visual-novel') {
    lines.push(
      '',
      'This game is a visual novel. The whole story is config/story.js — CAST, who speaks and their moods,',
      'and SCENES, each a picture, music, lines read from the top, then choices, a go, or the end — and',
      'the person writes it in the "story editor" — Write, in the row of modes over this chat — which shows it as scenes',
      'and lines rather than as code. So the story is changed by changing that file inside its shape,',
      'and a picture is asked for by the name the story gives it: a scene\'s is its picture path under',
      'assets/images/, a face is assets/sprites/<who>-<mood>.png. js/story.js is how the story is played',
      'and css/style.css how it looks; a request about what happens is config/story.js alone.',
      'A scene\'s "music" is a whole path under assets/music/; it loops behind the scene and keeps playing',
      'into the next scene naming the same track. A noise is a step among the lines instead —',
      '{ sound: "page" } between two spoken lines plays assets/sounds/page.wav and carries straight on —',
      'so "play the door slam after she knocks" is a line in the list, not a key on the scene. ⚠️ A',
      'scene-level "sound" is the older shape: still played, but the editor moves it into the lines the',
      'next time somebody saves, so write new ones as steps.',
      'The editor walks the person through the story a question at a time, and each question offers',
      '"Fill it in for me", which writes the lines of a scene from a sentence about what happens, and',
      '"Make one for me", which draws a simple picture at the name the story expects. So somebody stuck',
      'for words or for art has a button for it, and neither one needs you.',
    );
  }
  if (project.type === 'adventure') {
    lines.push(
      '',
      'This game is a point-and-click adventure. The whole adventure is config/scenes.js — SCENES, each a',
      'picture and its spots: a box on the picture, at: [x, y, width, height] in the picture\'s own pixels,',
      'doing one thing when clicked (go to a scene, say a line or a list of lines, or take a thing the',
      'player then carries), with need and set for switches and sound for a noise — and the person makes it',
      'in the "adventure editor" — Scenes, in the row of modes over this chat — which draws every spot as a',
      'box on the picture. ⚠️ Never write or change an "at": you can look at a picture but you cannot',
      'measure it, and a box guessed from a look is confidently wrong. Add a spot with any other change to',
      'it and ask the person to drag its box into place in the studio; leave the boxes they drew alone.',
      'A scene\'s picture is its path under assets/images/; a thing\'s picture is assets/sprites/<thing>.png,',
      'shown among what the player carries, and the word until there is one. A scene with no spots is the',
      'end. js/adventure.js is how the adventure is played and css/style.css how it looks; a request about',
      'what happens is config/scenes.js alone.',
    );
  }
  if (project.type === 'racing') {
    lines.push(
      '',
      'This game is a racing game: laps around a closed track against rivals. The track is config/track.js',
      '— TRACK, the points the road passes through in the game\'s own 960 by 600 world, how wide it is and',
      'where the start line sits, and THINGS, the rocks, boost pads and puddles on it — and the person draws',
      'it in the "track editor" — Track, in the row of modes over this chat — by dragging its points. ⚠️ Never',
      'type or change the points: a track is drawn, and one you wrote from numbers is a track nobody drove.',
      'Tune how it drives in config/play.js — turn, thrust, drag, top speed, the rivals, laps, the countdown,',
      'what scores — which is where a request about the feel of the race goes. js/race.js is the race itself:',
      'the road measured once, the car, the rivals, the things, laps and the finish; a car drawn at',
      'assets/sprites/car.png replaces the triangle.',
    );
  }
  // Where the game is on its arc (public/arc.js, spec.md §6), so a helper's
  // suggestions fit the stamp the person is working towards and it can say
  // when a request belongs to a later one. One line, changing only when a
  // stamp is pressed — the person's judgement, which a helper reads and never
  // moves.
  {
    const arc = arcFor(project.type);
    const stage = Math.min(project.stage ?? 0, arc.length);
    const next = arc[stage];
    lines.push('', next
      ? `This game holds ${stage} of ${arc.length} stamps on its arc and is working towards "${next.name}": `
        + `${next.principle} Suggest what belongs to this stamp, and say so when a request belongs to a later one.`
      : `This game holds every one of the ${arc.length} stamps on its arc: it is done unless somebody wants more.`);
  }
  lines.push(
    '',
    'The game is served from a different origin than the studio, so absolute URLs back to the studio',
    'will not resolve. Use relative paths inside the game.',
    '',
    'Keep your reply short — a note on what you did or think. The files carry the detail.',
  );
  // The builder's room only: the sizing rules stand here, cached with the rest,
  // so the last user message can carry a short trigger (agents/sizing.js, §14).
  if (sizing) lines.push('', sizingRules());
  return lines.join('\n');
}

// The brief, cut to its budget and told where it was cut. Truncating in
// silence would read as the whole file, which is how a brief with the
// important part at the bottom becomes a mystery.
function briefText(buffer) {
  if (buffer.length <= BRIEF_BYTES) return buffer.toString('utf8');
  return `${buffer.subarray(0, BRIEF_BYTES).toString('utf8')}\n\n`
    + `(cut here: ${BRIEF_FILE} is ${buffer.length} bytes and only the first`
    + ` ${BRIEF_BYTES} are shown. Shorten it, or read the rest with read_file.)`;
}

// Paths the humans pointed at recently. Pins decide selection priority in the
// file block; the emphasis itself rides on the last user message, next to the
// runtime errors, because pins change turn to turn and a label inside the
// block re-billed everything behind it as a cache miss.
function pinnedPaths(db, chatId) {
  const recentTurns = db
    .prepare(
      `SELECT id FROM messages
        WHERE chat_id = ? AND user_id IS NOT NULL
        ORDER BY id DESC LIMIT ?`,
    )
    .all(chatId, PINNED_TURNS)
    .map((r) => r.id);
  if (recentTurns.length === 0) return new Set();
  const placeholders = recentTurns.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT DISTINCT path FROM message_context WHERE message_id IN (${placeholders})`)
    .all(...recentTurns);
  return new Set(rows.map((r) => r.path));
}

// A library's API note: the comment block at the top of its file, reproduced
// in the preamble so a helper learns the engine's contract without its
// source. Read from the game's own copy under studio/, not from the studio's
// current one, so the note always matches the version this game holds. Capped
// so a note stays a note — raised from 2 KB when the input header grew the
// buttons shape and toggles, and from 3 KB when screens grew fit(), the meter
// and a chip a game fills itself. Both times the alternative was deleting a
// documented call to make room for a new one, which buys nothing: the note is
// the only place a helper learns the call exists. Exported because a note that
// outgrows it is cut in silence: the suite holds every library's header
// against this number.
export const NOTE_BYTES = 4096;

function libraryNote(buffer) {
  const lines = [];
  for (const line of buffer.toString('utf8').split('\n')) {
    if (!line.startsWith('//')) break;
    lines.push(line);
  }
  const note = lines.join('\n');
  if (!note) return null;
  return note.length > NOTE_BYTES ? `${note.slice(0, NOTE_BYTES)}\n// (cut)` : note;
}

// One note per library the game holds, from its manifest. The main file is
// studio/<name>.js by convention. Names come from a file a human can edit,
// so anything that is not a plain name is skipped rather than pathed.
async function buildLibraryNotes(dir) {
  const manifest = await readFileAt(path.join(dir, LIBRARY_MANIFEST));
  if (manifest === null) return [];
  let held;
  try {
    held = JSON.parse(manifest.toString('utf8'));
  } catch {
    return [];
  }
  if (!held || typeof held !== 'object') return [];
  const notes = [];
  for (const name of Object.keys(held).sort()) {
    if (!/^[a-z0-9-]+$/.test(name)) continue;
    const file = `${LIBRARY_DIR}/${name}.js`;
    const buffer = await readFileAt(path.join(dir, file));
    if (buffer === null) continue;
    const note = libraryNote(buffer);
    if (note) notes.push({ file, note });
  }
  return notes;
}

// A library is named and its size given, never sent. That is the whole reason
// the studio directory is reserved: an engine an agent cannot edit is also an
// engine it does not need in front of it, and sending one would eat the ambient
// budget that the game's own code is competing for. read_file still reaches it
// for the rare case of actually needing to look.
function libraryLines(files) {
  const library = files.filter((f) => f.library && !f.unreachable);
  if (library.length === 0) return null;
  const bytes = library.reduce((n, f) => n + f.size, 0);
  return `STUDIO LIBRARY (${library.length} files, ${bytes} bytes) — yours to call, not to change:\n`
    + `${library.map((f) => f.path).join('\n')}\n`
    + `Read ${LIBRARY_MANIFEST} for what each one is and which version this game has. `
    + 'Use read_file if you need to see inside one.';
}

const hashOf = (buffer) => createHash('sha1').update(buffer).digest('hex');

// The whole tree under the cap (§8). Every fire gets this shape, a piece's
// included: a piece runs on the sizing's own block rather than a narrowed one
// (measured, §14 — a narrowed block diverges inside the system prompt on every
// piece and misses whole), and learns what changed since from fresh copies
// on its turn, which is what the hashes are for.
async function buildFileBlock(db, chat, dir) {
  const { files } = await listTree(dir);
  // Pins are per conversation: what somebody pointed at in one chat is not
  // what the helper in another one should be looking at.
  const pinned = pinnedPaths(db, chat.id);
  // A file already on disk that path validation refuses is listed but never
  // opened: no tool can act on it and the games origin will not serve it, so
  // an agent needs to know it is there to explain why it 404s at runtime.
  // Library files are listed on their own, above, and never opened.
  const texts = files.filter((f) => f.text && !f.unreachable && !f.library);
  const binaries = files.filter((f) => !f.text && !f.unreachable && !f.library);

  // Pinned files first, then the rest, each group smallest-first so the largest
  // are what the cap drops. Pinning is priority, not exemption: it used to
  // bypass the cap outright, which let 50 paths a turn across three turns
  // through at up to 10 MB each. The cap now bounds the whole block.
  const bySize = (a, b) => a.size - b.size;
  const byPriority = [
    ...texts.filter((f) => pinned.has(f.path)).sort(bySize),
    ...texts.filter((f) => !pinned.has(f.path)).sort(bySize),
  ];
  const included = new Set();
  let used = 0;
  for (const file of byPriority) {
    if (used + file.size > AMBIENT_BYTES) continue;
    included.add(file.path);
    used += file.size;
  }

  // Emission is least-recently-modified first, contents before trailers, so
  // the files being worked on sit at the tail and the divergence depth stops
  // moving after the first edit — which is when DeepSeek starts serving the
  // prefix ahead of it (spec.md §14). The tree carries every file's size, so
  // it changes on every edit — which is why it trails the contents instead
  // of leading them.
  const ordered = [...texts].sort((a, b) => {
    if (a.modified_at !== b.modified_at) return a.modified_at < b.modified_at ? -1 : 1;
    return a.path < b.path ? -1 : 1;
  });

  const parts = [];
  const omitted = [];
  const hashes = new Map();
  for (const file of ordered) {
    if (!included.has(file.path)) {
      omitted.push(file.path);
      continue;
    }
    const buffer = await readFileAt(path.join(dir, file.path));
    if (buffer === null) continue;
    hashes.set(file.path, hashOf(buffer));
    parts.push(
      `--- FILE: ${file.path} (${file.size} bytes) ---\n`
      + `${buffer.toString('utf8')}\n--- END FILE ---`,
    );
  }
  for (const file of binaries) {
    parts.push(`[binary: ${file.path}, ${file.size} bytes]`);
  }
  if (omitted.length > 0) {
    omitted.sort();
    parts.push(`(left out for size — call read_file if you need them: ${omitted.join(', ')})`);
  }
  const library = libraryLines(files);
  if (library) parts.push(library);
  parts.push(
    'PROJECT FILES\n'
    + (files.length
      ? files
        .filter((f) => !f.library)
        .map((f) => `${f.path} (${f.size} bytes)`
          + (f.unreachable ? ' [cannot be opened: the name is not a valid project path]' : ''))
        .join('\n')
      : '(the project has no files yet)'),
  );

  // The pins the last user message should name: files that exist, whether or
  // not they fit the cap — a pin that was dropped is still what the human is
  // pointing at, and the left-out note already says how to reach it.
  const pinnedShown = files
    .filter((f) => pinned.has(f.path) && !f.unreachable)
    .map((f) => f.path)
    .sort();
  return {
    block: parts.join('\n\n'),
    pinnedShown,
    // For the receipt: how many files were sent whole and how many the cap
    // left out. The block's own byte count is taken where it is used.
    stats: { shown: included.size, omitted: omitted.length },
    // For a piece's fresh copies: what each file said when the block was
    // read, and which the cap never showed.
    hashes,
    omitted: new Set(omitted),
  };
}

// A fresh copy on a piece turn is the whole current file; past this it is
// named instead, and the piece reads it with read_file like anything else.
const FRESH_COPY_BYTES = 128 * 1024;

// What changed since the file block was read, for a piece that runs on the
// sizing's own system prompt (spec.md §8, §14): the current whole text of the
// files this piece names, and the names of the rest. Copies, never diffs —
// patch_file's old_text must match the file as it is now, and a model applying
// a diff in its head gets that wrong. A file the block left out for size is
// not "changed": it was never shown, and the block already says how to read it.
async function freshCopies(dir, { fileHashes, omitted }, pieceFiles) {
  const { files } = await listTree(dir);
  const shown = [];
  const named = [];
  const seen = new Set();
  for (const file of files) {
    if (!file.text || file.unreachable || file.library || omitted.has(file.path)) continue;
    seen.add(file.path);
    const buffer = await readFileAt(path.join(dir, file.path));
    if (buffer === null || fileHashes.get(file.path) === hashOf(buffer)) continue;
    if (pieceFiles.includes(file.path) && buffer.length <= FRESH_COPY_BYTES) {
      shown.push(
        `--- FILE: ${file.path} (${buffer.length} bytes) ---\n`
        + `${buffer.toString('utf8')}\n--- END FILE ---`,
      );
    } else {
      named.push(file.path);
    }
  }
  for (const p of fileHashes.keys()) if (!seen.has(p)) named.push(`${p} (deleted)`);
  if (shown.length === 0 && named.length === 0) return '';
  const rest = named.length
    ? `Also changed, not shown — read_file if you need one: ${named.sort().join(', ')}`
    : null;
  if (shown.length === 0) {
    return `[studio] Some files have changed since the copies above were read — read_file if you need one: ${named.sort().join(', ')}`;
  }
  return [
    '[studio] Some files have changed since the copies above were read. These are current and replace them:',
    ...shown,
    rest,
  ].filter(Boolean).join('\n\n');
}

// What the game said when someone played it. Only the current version's
// problems: a row is stamped with the commit it happened on, so a fix retires
// it rather than leaving the agent chasing something it already repaired.
async function buildErrorBlock(db, project, dir) {
  if (!hasErrors(db, project.id)) return null;
  const rows = listErrors(db, project.id, await currentSha(dir));
  if (rows.length === 0) return null;
  const lines = rows.map((row) => {
    const where = row.location ? `${row.location} — ` : '';
    const repeats = row.times > 1 ? ` (${row.times} times)` : '';
    return `- ${where}${row.message}${repeats}`;
  });
  return 'PROBLEMS THE RUNNING GAME REPORTED\n'
    + '(from this version of the files, while someone was playing it in the studio)\n'
    + lines.join('\n');
}

function historyTurns(db, chat, agent, lastFiredMaxId = 0, historyFloor = new Map()) {
  // The floor is where the transcript starts once it has ever been trimmed.
  // Trimming exactly to the cap moved the seam one message per fire, and the
  // seam line at the transcript's front re-billed the whole transcript as a
  // cache miss every time — so instead the floor holds still, and when the
  // kept suffix outgrows a cap it jumps, cutting back to half so it can hold
  // still again. In memory only; a restart re-derives it, which costs one
  // fire of misses (same trade as lastFired).
  const floor = historyFloor.get(chat.id) ?? 0;
  const rows = db
    .prepare(
      // A piece's row is behind its card, and the card's body carries what
      // history should see of it: its headline and the files it changed (§8).
      `SELECT * FROM (
         SELECT * FROM messages
          WHERE chat_id = ? AND id > ? AND plan_message_id IS NULL
          ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`,
    )
    .all(chat.id, floor, MAX_HISTORY_MESSAGES);

  const userNames = new Map(
    db.prepare('SELECT id, display_name FROM users').all().map((u) => [u.id, u.display_name]),
  );
  const agentNames = new Map(
    db.prepare('SELECT id, name FROM agents').all().map((a) => [a.id, a.name]),
  );

  const mapped = [];
  for (const row of rows) {
    if (!row.body) continue;
    if (row.kind === 'system') {
      mapped.push({ id: row.id, role: 'user', text: `[studio] ${row.body}` });
    } else if (row.agent_id === agent.id) {
      // Only this agent's own messages are assistant turns; another agent's
      // reply is context, not something this one said.
      mapped.push({ id: row.id, role: 'assistant', text: row.body });
    } else if (row.agent_id !== null) {
      mapped.push({
        id: row.id, role: 'user', text: `[${agentNames.get(row.agent_id) ?? 'agent'}] ${row.body}`,
      });
    } else {
      mapped.push({
        id: row.id, role: 'user', text: `[${userNames.get(row.user_id) ?? 'someone'}] ${row.body}`,
      });
    }
  }

  // A message posted while this agent was streaming has a lower id than the
  // reply it never saw. Left in id order the transcript would end with the
  // agent's own turn, so the next fire would find nothing to answer and the
  // dirty bit would produce a no-op. Float this agent's own post-snapshot
  // replies ahead of everyone else's, so the sequence still ends with a human.
  let turns = mapped;
  if (lastFiredMaxId > 0) {
    const before = mapped.filter((m) => m.id <= lastFiredMaxId);
    const after = mapped.filter((m) => m.id > lastFiredMaxId);
    const mine = after.filter((m) => m.role === 'assistant');
    const theirs = after.filter((m) => m.role !== 'assistant');
    turns = [...before, ...mine, ...theirs];
  }

  // Trim from the front, always keeping the newest turn — but only when a cap
  // is breached, and then past the cap to half, advancing the floor so the
  // boundary stays put for the fires in between.
  let total = turns.reduce((sum, t) => sum + t.text.length, 0);
  const overflow = rows.length === MAX_HISTORY_MESSAGES;
  if (total > HISTORY_BYTES || overflow) {
    const byteTarget = total > HISTORY_BYTES ? HISTORY_BYTES / 2 : HISTORY_BYTES;
    const turnTarget = overflow ? Math.floor(MAX_HISTORY_MESSAGES / 2) : turns.length;
    while (turns.length > 1 && (total > byteTarget || turns.length > turnTarget)) {
      total -= turns[0].text.length;
      historyFloor.set(
        chat.id,
        Math.max(historyFloor.get(chat.id) ?? 0, turns[0].id),
      );
      turns.shift();
    }
  }

  // Mark the seam, for the agent here and for the human on the reply itself
  // (`messages.trimmed`). A file the cap leaves out is named in the prompt, but
  // history used to be trimmed silently — by the byte cap here or by the row
  // limit in the query above — so a conversation simply began later than it
  // used to with nothing saying where the join was.
  const oldest = turns[0]?.id ?? 0;
  const older = oldest > 0
    ? db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND id < ?')
      .get(chat.id, oldest).n
    : 0;
  if (older > 0) {
    turns.unshift({
      id: 0,
      role: 'user',
      text: `[studio] Earlier messages are not shown (${older} trimmed to fit).`,
    });
  }

  // Collapse consecutive same-role turns; past tool calls are never replayed,
  // so no stale tool_call_id can dangle.
  const collapsed = [];
  for (const turn of turns) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.role === turn.role) last.text += `\n\n${turn.text}`;
    else collapsed.push({ ...turn });
  }
  return { turns: collapsed, trimmed: older };
}

// `sizing` is the builder's room: the sizing rules stand in its preamble, so
// the sizing call and every fire after it share one system prompt (spec.md
// §8, §14). A piece builds no context of its own — it runs on this one.
// `lastMayBeOwn` is Build it: the newest turn is then the builder's own card,
// and the turn the fire adds on top is what there is to answer.
async function buildContext({
  db, project, chat, dir, agent, lastFiredMaxId = 0,
  maxAssistantTurns = MAX_ASSISTANT_TURNS, maxToolCalls = MAX_TOOL_CALLS,
  historyFloor = new Map(), sizing = false, lastMayBeOwn = false,
}) {
  const { turns, trimmed } = historyTurns(db, chat, agent, lastFiredMaxId, historyFloor);
  // The model needs something to answer. If the newest turn is this agent's
  // own reply there is nothing to respond to.
  if (turns.length === 0) return null;
  if (!lastMayBeOwn && turns[turns.length - 1].role !== 'user') return null;

  // In a chat there is no directory, so no brief and no files — and no
  // preamble either. The system prompt is the agent's description and
  // nothing else; empty is allowed, and sends no system message at all.
  const isChat = project.kind === 'chat';
  const brief = isChat ? null : await readFileAt(path.join(dir, BRIEF_FILE));
  // Ahead of the transcript, most stable part first: the preamble never
  // changes, the brief and the description rarely do, the files often. Putting
  // the files here rather than on the last message is what turns a 0% cache
  // hit between fires into a 100% one whenever no file changed (spec.md §8).
  const fileBlock = isChat ? null : await buildFileBlock(db, chat, dir);
  const preamble = isChat ? null : studioPreamble({
    project,
    maxAssistantTurns,
    maxToolCalls,
    libraryNotes: await buildLibraryNotes(dir),
    sizing,
  });
  const briefPart = brief ? `Project brief (${BRIEF_FILE}):\n${briefText(brief)}` : null;
  const system = [
    preamble,
    briefPart,
    agent.description || null,
    fileBlock ? fileBlock.block : null,
  ].filter(Boolean).join('\n\n');

  const messages = turns.map((t) => ({ role: t.role, content: t.text }));
  const transcriptBytes = turns
    .reduce((n, t) => n + Buffer.byteLength(t.text, 'utf8'), 0);
  // Errors and pins stay next to the human's message: both change turn to
  // turn, so in the system prompt they would invalidate the files behind them.
  const errorBlock = isChat ? null : await buildErrorBlock(db, project, dir);
  const pinNote = fileBlock && fileBlock.pinnedShown.length > 0
    ? `(the user pinned these files: ${fileBlock.pinnedShown.join(', ')})`
    : null;
  if (errorBlock || pinNote) {
    const last = messages[messages.length - 1];
    last.content = [errorBlock, pinNote, last.content].filter(Boolean).join('\n\n');
  }

  // The context half of the receipt, in bytes because that is what the caps
  // above trade in. Captured here or never: files change and the trim
  // boundary moves, so none of this can be recomputed for an old reply.
  const bytes = (s) => (s ? Buffer.byteLength(s, 'utf8') : 0);
  const breakdown = {
    system: {
      preamble: bytes(preamble),
      brief: bytes(briefPart),
      brief_cut: brief !== null && brief.length > BRIEF_BYTES,
      description: bytes(agent.description || null),
      files: fileBlock ? { bytes: bytes(fileBlock.block), ...fileBlock.stats } : null,
    },
    transcript: { messages: turns.length, bytes: transcriptBytes, trimmed },
    last_message: { errors: bytes(errorBlock), pins: bytes(pinNote) },
  };

  return {
    system,
    messages,
    trimmed,
    breakdown,
    fileHashes: fileBlock?.hashes ?? new Map(),
    omitted: fileBlock?.omitted ?? new Set(),
  };
}

// ⚠️ A picture weighs what it costs, not what it measures. `look_at` hands
// back a data URI that is hundreds of kilobytes of base64 and at most 1,024
// prompt tokens (§14), so counting its bytes against LOOP_GROWTH_BYTES would
// stop a fire on its second look. The growth limit stands for context, and
// this is what the picture takes of it.
const PICTURE_WEIGHT_BYTES = 4 * 1024;

export function weigh(message) {
  if (!Array.isArray(message.content)) return JSON.stringify(message).length;
  const { content, ...rest } = message;
  return JSON.stringify(rest).length + content.reduce(
    (n, part) => n + (part.type === 'image_url'
      ? PICTURE_WEIGHT_BYTES
      : JSON.stringify(part).length),
    0,
  );
}

// A picture as the receipt should keep it: the label it came with and a note
// of what was there. ⚠️ Never the data URI — a receipt is a row in SQLite that
// `npm run backup` copies, and the picture is already on disk under the name
// printed right here.
function picturePlaceholder(parts) {
  return parts
    .map((part) => (part.type === 'image_url'
      ? `[picture: ${Math.round((part.image_url?.url?.length ?? 0) / 1024)} KB, not kept]`
      : part.text ?? ''))
    .join('\n');
}

// The prompt as readable text, one labelled part per message, verbatim
// content. Rendered rather than dumped as the JSON body so the person
// debugging reads what the model read; a tool call keeps its raw argument
// string, which is the exact thing that was sent.
function promptText(system, messages) {
  const parts = [];
  if (system) parts.push(`[system]\n${system}`);
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      const calls = m.tool_calls
        .map((c) => `[tool call ${c.id}: ${c.function.name}]\n${c.function.arguments}`);
      parts.push([`[assistant]${m.content ? `\n${m.content}` : ''}`, ...calls].join('\n\n'));
    } else if (m.role === 'tool') {
      const body = Array.isArray(m.content) ? picturePlaceholder(m.content) : m.content;
      parts.push(`[tool result ${m.tool_call_id}]\n${body}`);
    } else {
      parts.push(`[${m.role}]\n${m.content}`);
    }
  }
  return parts.join('\n\n');
}

function postSystemMessage(db, broker, { project, chat, agentId, body }) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO messages (project_id, chat_id, agent_id, kind, body, created_at)
       VALUES (?, ?, ?, 'system', ?, ?)`,
    )
    .run(project.id, chat.id, agentId, body, now);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid));
  broker.broadcast('message.new', messagePublic(db, row, project.slug));
}

export function createOrchestrator({
  db,
  broker,
  mutex,
  llm,
  pending = null,
  gamesDir = 'games',
  dailyTokenBudget = DEFAULT_DAILY_TOKEN_BUDGET,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  maxAssistantTurns = MAX_ASSISTANT_TURNS,
  maxToolCalls = MAX_TOOL_CALLS,
  maxContinuations = MAX_CONTINUATIONS,
  smallTurns = SMALL_TURNS,
  smallToolCalls = SMALL_TOOL_CALLS,
}) {
  if (!llm) throw new Error('createOrchestrator requires an llm');
  // The loop's guards, as one value: a room's by default, a small ask's in
  // the builder's room. The preamble names them, so a context is built with
  // the pair its fire will run under.
  const roomLimits = { turns: maxAssistantTurns, tools: maxToolCalls };
  const smallLimits = { turns: smallTurns, tools: smallToolCalls };

  const timers = new Map();
  // Agents mid-fire. A message arriving now sets the dirty bit; the running
  // fire picks it up when it finishes.
  const firing = new Set();
  // chat_agents.id -> MAX(messages.id) when that agent last fired
  // successfully. Used to reorder context so a message that arrived
  // mid-stream is presented after the reply that never saw it. Lost on
  // restart, which only costs one turn of ordering.
  const lastFired = new Map();
  // chat_agents.id -> continuations spent since the last human message.
  // A fresh human turn is a fresh allowance, so this is cleared there.
  const continued = new Map();
  // chats.id -> the message id the transcript starts after, once it has
  // ever been trimmed (historyTurns). Holding the boundary still between
  // fires is what keeps the transcript prefix cacheable; in memory only,
  // like lastFired.
  const historyFloor = new Map();

  function schedule(projectAgentId, readyAtMs) {
    const now = Date.now();
    if (readyAtMs <= now) {
      fireAgent(projectAgentId).catch((err) => console.error('fireAgent failed', err));
      return;
    }
    if (timers.has(projectAgentId)) return;
    const timer = setTimeout(() => {
      timers.delete(projectAgentId);
      fireAgent(projectAgentId).catch((err) => console.error('fireAgent failed', err));
    }, readyAtMs - now);
    timer.unref?.();
    timers.set(projectAgentId, timer);
  }

  // Only human messages make agents eligible — bot-to-bot dampening. Agents
  // still see each other's replies as context.
  //
  // Only the helpers in *this chat* are woken. A helper in another one is not
  // listening here, and the human-only chat has none by construction: it can
  // hold no chat_agents rows at all (assertBotsAllowed), so this loop is empty
  // there rather than filtered there.
  function onHumanMessage(project, message, chat) {
    if (project.archived) return;
    const chatId = chat?.id ?? message.chat_id;
    if (!chatId) return;
    const mentions = parseMentions(message.body);
    const attached = db
      .prepare(
        `SELECT ca.id, ca.chatty, ca.cooldown_until, a.name
           FROM chat_agents ca
           JOIN agents a ON a.id = ca.agent_id
          WHERE ca.chat_id = ? AND a.deleted = 0`,
      )
      .all(chatId);

    for (const row of attached) {
      if (!agentEligible({ name: row.name, chatty: row.chatty === 1 }, mentions)) continue;
      continued.delete(row.id);
      db.prepare('UPDATE chat_agents SET response_pending = 1 WHERE id = ?').run(row.id);
      if (firing.has(row.id)) continue;
      const readyAt = row.cooldown_until ? new Date(row.cooldown_until).getTime() : 0;
      schedule(row.id, readyAt);
    }
  }

  // A `[studio]` note onto the messages a loop is carrying: into the last
  // message when that is a user turn, as a user turn of its own after a tool
  // result — the shape the cut and shed notices already take.
  function noteOnto(messages, note) {
    const last = messages[messages.length - 1];
    if (last?.role === 'user' && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${note}`;
    } else {
      messages.push({ role: 'user', content: note });
    }
  }

  // One tool loop: the requests, the streaming, the tools, the cap and the
  // shed. Everything it leaves behind comes back as one outcome, and what to
  // keep of it is persistReply's — the ordinary fire and a piece's run this
  // same loop over different prompts.
  //
  // `capMode` says what a thinking cap on the *first* turn does. 'retry' asks
  // the same turn again with thinking off and the trace handed on as notes —
  // measured (§14): dropped, the retry under-delivers; handed, it follows the
  // design. 'return' hands the trace back to the caller instead: the builder's
  // room, where a first turn that thought too long is a request that wanted
  // sizing. On any later turn the cap always retries. `handoff` starts a loop
  // already carrying a trace, thinking off — the retry a caller runs itself.
  async function runLoop({
    agent, system, messages: initial, toolset, thinking, emit, capMode = 'retry', handoff = null,
    limits = roomLimits, masked = [],
  }) {
    const messages = initial.map((m) => ({ ...m }));
    // Everything the loop appends is counted, so a fire cannot grow past
    // LOOP_GROWTH_BYTES however many files it reads or writes.
    let grown = 0;
    const append = (message) => {
      messages.push(message);
      grown += weigh(message);
    };
    // ⚠️ The one place a trace enters a request: this fire, once, as text.
    // It never reaches the receipt — the prompt kept there carries a
    // placeholder for it — and never a later fire (spec.md §8, §12).
    let handed = null;
    const hand = (trace) => {
      handed = handoffNote(trace);
      noteOnto(messages, handed);
      grown += handed.length;
    };
    // Set once a turn's trace ran past the cap with nothing else produced.
    // Sticky for the rest of the fire: thinking goes off and stays off, so
    // the cap cannot trip twice and the retry cannot loop.
    let thinkingOff = false;
    let cappedThinking = false;
    if (handoff !== null) {
      hand(handoff);
      thinkingOff = true;
      cappedThinking = true;
    }
    // What each turn said, in order. The last of them is the **reply** — the
    // note a helper leaves once it stops calling tools — and everything
    // before it is its **working**: said on the way, kept on the row, never
    // shown as the reply and never replayed into a later fire (spec.md §8).
    // Joined into one body, twenty-four turns of "now I'll write…" were the
    // wall of text a real receipt traced to here.
    const said = [];
    let charged = 0;
    let toolCallCount = 0;
    let turnsUsed = 0;
    // One entry per request the fire made: what the cache remembered, what
    // was new, what came out. The other half of the receipt.
    const requests = [];
    // The reasoning DeepSeek is carrying for this chain, and where the
    // appended bytes stood at the last shed — the two sides of the rule.
    let pile = 0;
    let shedBase = 0;
    let sheds = 0;
    // What the last request actually carried, captured at the moment of
    // sending: the loop appends tool results it may never send.
    let sentPrompt = '';
    // Whether the turn that ended the loop left a cut-off call unanswered.
    // A cut that a later turn rewrote successfully is not worth reporting.
    let pendingCut = false;
    let hitLength = false;
    let hitLimit = null;
    let streamFailed = false;
    // The last turn's split between thinking and everything else. Measured
    // as this model's ordinary answer to an ambitious open request: the
    // whole allowance goes to the trace and no tool call is ever reached
    // (spec.md §14), which is a different failure from a file cut in half
    // and reads nothing like it.
    let lastReasoning = 0;
    let lastOut = 0;
    const outcome = (extra = {}) => ({
      reply: said[said.length - 1] ?? '',
      working: said.slice(0, -1).join('\n\n'),
      charged, requests, turnsUsed, toolCallCount, grown, sheds, sentPrompt,
      pendingCut, hitLength, hitLimit, streamFailed, lastReasoning, lastOut, cappedThinking,
      capped: null, ...extra,
    });

    for (let turn = 0; turn < limits.turns; turn += 1) {
      let text = '';
      const calls = [];
      let cutCalls = 0;
      // This turn's trace, held only until the turn ends: what a cap hands on.
      let trace = '';
      turnsUsed = turn + 1;
      sentPrompt = promptText(system, messages);
      // A trace is never kept (spec.md §8, §12): the one this fire hands on,
      // and one the sizing exchange this fire extends carried as notes.
      for (const text of handed !== null ? [handed, ...masked] : masked) {
        sentPrompt = sentPrompt.replace(
          text, `[studio] (a capped trace was handed on here: ${text.length} characters, not kept)`,
        );
      }
      try {
        const stream = llm.stream({
          system,
          messages,
          tools: toolset ? toolset.definitions : null,
          thinking: thinkingOff ? 'none' : thinking,
          maxTokens: DEFAULT_MAX_TOKENS,
        });
        for await (const event of stream) {
          if (event.type === 'reasoning') {
            // Streamed for the UI, never persisted and never replayed.
            trace += event.text;
            emit('agent.stream.reasoning', { delta: event.text });
          } else if (event.type === 'delta') {
            text += event.text;
            emit('agent.stream.chunk', { delta: event.text });
          } else if (event.type === 'tool_start' || event.type === 'tool_progress') {
            // A call still arriving (spec.md §9): the line under the name says
            // which file and how much of it has come, while it is being
            // written rather than once it has been. The same event again
            // when the call runs, below.
            emit('agent.tool', { tool: event.name, path: event.path, bytes: event.bytes ?? null });
          } else if (event.type === 'tool_use') {
            calls.push(event);
          } else if (event.type === 'tool_use_failed') {
            cutCalls += 1;
          } else if (event.type === 'end') {
            if (event.finish_reason === 'length') hitLength = true;
            charged += tokensCharged(event.usage);
            if (event.usage) {
              requests.push({
                hit: event.usage.prompt_cache_hit_tokens ?? 0,
                miss: event.usage.prompt_cache_miss_tokens
                  ?? event.usage.prompt_tokens ?? 0,
                out: event.usage.completion_tokens ?? 0,
              });
              lastReasoning = event.usage.completion_tokens_details?.reasoning_tokens ?? 0;
              lastOut = event.usage.completion_tokens ?? 0;
              pile += lastReasoning;
            }
          }
        }
      } catch (err) {
        // Thinking ran away with the turn: nothing was produced and the
        // trace passed its ceiling, which left to itself ends in an empty
        // reply nine minutes later (spec.md §14). Not a failure to salvage
        // — the same turn is asked again with thinking off and the trace in
        // hand, or handed back to a caller that wanted to size the request.
        // The abandoned attempt does not count as a turn.
        //
        // ⚠️ It is charged, though, from an estimate: no usage frame
        // arrives for a stream nobody let finish, but the trace was
        // generated and the key is paying for it. Only the trace — the
        // prompt behind it was billed too and there is no count to put on
        // it, so this still undercounts, just by less.
        if (err.code === 'thinking_cap' && !thinkingOff) {
          charged += tokensForChars(err.reasoningChars) * OUTPUT_WEIGHT;
          if (capMode === 'return' && turn === 0) {
            cappedThinking = true;
            return outcome({ capped: trace, turnsUsed: 0 });
          }
          hand(trace);
          thinkingOff = true;
          cappedThinking = true;
          turn -= 1;
          continue;
        }
        // Salvage rather than discard. Earlier turns' prose and any files
        // already on disk are finished work; returning here threw them all
        // away, which is how a ten-minute reply used to vanish without a
        // trace when the stream died on its last turn.
        console.error('agent stream failed', err);
        streamFailed = true;
        if (text) said.push(text);
        break;
      }

      if (text) said.push(text);
      pendingCut = cutCalls > 0;

      // Nothing to run and nothing cut off: a plain reply, so the turn is
      // done. A cut call is not "done" — it is a file that never landed,
      // and the loop keeps going so the model can write it again.
      if (calls.length === 0 && cutCalls === 0) break;

      if (calls.length > 0) {
        append({
          role: 'assistant',
          content: text || null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.input) },
          })),
        });

        for (const call of calls) {
          if (toolCallCount >= limits.tools) {
            hitLimit = 'tool';
            append({
              role: 'tool',
              tool_call_id: call.id,
              content: 'refused: this turn has reached its tool call limit',
            });
            continue;
          }
          emit('agent.tool', { tool: call.name, path: call.input?.path ?? null });
          const result = await toolset.run(call.name, call.input);
          append({ role: 'tool', tool_call_id: call.id, content: result });
          toolCallCount += 1;
        }
        if (hitLimit) break;
      } else if (text) {
        // No valid call to answer, so this turn's prose stands on its own.
        append({ role: 'assistant', content: text });
      }

      if (cutCalls > 0) append({ role: 'user', content: CUT_NOTICE });
      // Stop rather than truncate: dropping an earlier message would orphan
      // a tool_call_id, and a continuation resumes from a context built
      // fresh from disk, which is the recovery anyway.
      if (grown > LOOP_GROWTH_BYTES) hitLimit = 'context';
      if (turn === limits.turns - 1 && !hitLimit) hitLimit = 'turn';
      if (hitLimit) break;

      // Another round is coming: shed the reasoning pile if carrying it is
      // now dearer than re-paying the visible tail once (spec.md §8, §14).
      const shedCost = (grown - shedBase) / 4;
      if (pile >= SHED_FLOOR_TOKENS
        && (pile / HIT_DIVISOR) * SHED_HORIZON_ROUNDS > shedCost) {
        append({ role: 'user', content: SHED_NOTICE });
        pile = 0;
        shedBase = grown;
        sheds += 1;
      }
    }
    return outcome();
  }

  // What a loop left — prose, files, cost — kept as one message row, one
  // commit and one receipt, with the events that say so. `body` is the row's
  // text when it is not the reply itself: a piece with nothing to say still
  // gets its row. The working rides beside it in its own column, so the body
  // — what the thread shows and a later fire replays — is the reply alone.
  // `subject` heads the commit. Answers the row's id — null when nothing was
  // worth a row — and `nothing` when the loop died with nothing to show,
  // which is the one end that leaves no word behind.
  async function persistReply({
    row, project, chat, agent, dir, asker, context, emit, state, snapshot, toolset, outcome,
    subject, body = outcome.reply, kind = null, planMessageId = null,
  }) {
    consumeBudget(db, outcome.charged);
    chargeUser(db, asker?.id, outcome.charged);

    const changed = toolset ? toolset.changedPaths() : [];
    if (outcome.streamFailed && !body && changed.length === 0) {
      // Nothing said and nothing written: an error end and no message row,
      // same as before there was anything to salvage.
      emit('agent.stream.end', { error: true });
      state.live = false;
      return { messageId: null, commitSha: null, changed, nothing: true };
    }

    // The reply is written; from here on, anything newer than the snapshot
    // is something this agent has not seen.
    lastFired.set(row.id, snapshot);
    let commitSha = null;
    let commitFailed = false;
    if (changed.length > 0) {
      try {
        commitSha = await mutex.run(row.slug, async () => {
          // Anything a person saved while this fire ran is theirs first.
          if (pending) await pending.settleLocked(row.slug);
          return commitPaths(
            dir, changed, `${row.agent_name}: ${subject}`, agentAuthorFor(agent, row.slug),
          );
        });
      } catch (err) {
        // ⚠️ The files are already on disk; it is only history that failed.
        // Letting this throw carried the whole turn to the outer catch, which
        // wrote no message row at all — so the work was in the tree with
        // nothing naming it and nothing that would ever commit it. Reported
        // and carried on instead: the reply is still worth keeping, and the
        // person is told plainly which half succeeded.
        commitFailed = true;
        console.error(
          `commit for ${row.slug} failed; ${changed.length} file(s) left uncommitted`, err,
        );
      }
    }

    if (!body && changed.length === 0) {
      // Neither prose nor files: nothing worth a message row.
      emit('agent.stream.end');
      state.live = false;
      return { messageId: null, commitSha, changed, nothing: false };
    }

    const now = new Date().toISOString();
    const messageId = tx(db, () => {
      const info = db
        .prepare(
          `INSERT INTO messages
             (project_id, chat_id, agent_id, kind, body, working, created_at, tokens, trimmed,
              plan_message_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        // Null rather than 0 when nothing was trimmed: the column is a
        // report of something having happened, not a running total. Null
        // likewise for a reply said in one breath. A piece's row names its
        // card, which is what the thread shows in its place (spec.md §8).
        .run(
          project.id, chat.id, agent.id, kind, body, outcome.working || null, now,
          outcome.charged, context.trimmed || null, planMessageId,
        );
      const id = Number(info.lastInsertRowid);
      // A write of identical bytes produces no commit, so there is
      // nothing to record and nothing changed to report.
      if (commitSha) {
        for (const [filePath, change] of toolset.changes) {
          db.prepare(
            `INSERT INTO message_writes (message_id, path, action, bytes, commit_sha)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(id, filePath, change.action, change.bytes, commitSha);
        }
      }
      // The receipt. The prompt is a debugging aid, not a record: this
      // fire's takes the place of whichever reply in the project held it.
      db.prepare(
        'UPDATE message_receipts SET prompt = NULL WHERE project_id = ? AND prompt IS NOT NULL',
      ).run(project.id);
      db.prepare(
        `INSERT INTO message_receipts (message_id, project_id, breakdown, prompt)
         VALUES (?, ?, ?, ?)`,
      ).run(id, project.id, JSON.stringify({
        ...context.breakdown,
        loop: {
          turns: outcome.turnsUsed,
          tool_calls: outcome.toolCallCount,
          appended_bytes: outcome.grown,
          sheds: outcome.sheds,
        },
        requests: outcome.requests,
      }), outcome.sentPrompt);
      return id;
    });

    const stored = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    broker.broadcast('message.new', messagePublic(db, stored, row.slug));
    emit('agent.stream.end', { message_id: messageId });
    state.live = false;
    if (commitSha) {
      broker.broadcast('files.changed', { project_slug: row.slug, paths: changed });
      versionNew(broker, row.slug, commitSha, changed);
    }
    if (commitFailed) {
      // Said in the room rather than only to the log, because the difference
      // matters to the person: the game really did change, and Versions is
      // the part that is missing.
      broker.broadcast('files.changed', { project_slug: row.slug, paths: changed });
      postSystemMessage(db, broker, {
        project,
        chat,
        agentId: row.agent_id,
        body: `${row.agent_name}'s changes are saved and the game is running them, `
          + 'but the studio could not add them to Versions. Nothing is lost.',
      });
    }
    return { messageId, commitSha, changed, nothing: false };
  }

  // Re-arm the agent to pick up where it stopped, if it still may: a fresh
  // fire rebuilds its context from disk, which is what clears the weight.
  // The 'system' row is not decoration: it enters the transcript as a user
  // turn, which is what gives the next fire something to answer — without it
  // the agent's own reply would be newest and the fire would no-op. Answers
  // whether it did; the caller says what happens when it may not.
  function carryOn({ row, project, chat, agent, asker }) {
    const used = continued.get(row.id) ?? 0;
    if (used >= maxContinuations
        || !hasBudget(db, studioLimit(db, dailyTokenBudget))
        || !userHasBudget(db, asker)) return false;
    continued.set(row.id, used + 1);
    postSystemMessage(db, broker, {
      project, chat, agentId: agent.id,
      body: `${row.agent_name} is not finished yet — carrying on from where they stopped.`,
    });
    db.prepare('UPDATE chat_agents SET response_pending = 1 WHERE id = ?').run(row.id);
    return true;
  }

  // Out of room and not carrying on: said with the number the fire ran under.
  function stopBanner({ row, project, chat, agent }, hitLimit, limits) {
    const why = {
      context: 'had too much to hold in one reply and stopped',
      tool: `stopped after ${limits.tools} tool calls in one turn`,
      turn: `stopped after ${limits.turns} turns without finishing`,
    }[hitLimit];
    postSystemMessage(db, broker, {
      project, chat, agentId: agent.id,
      body: `${row.agent_name} ${why}. Ask them to keep going if you want more.`,
    });
  }

  // The banners: how the reply was produced and how the loop stopped, said
  // in words a person can act on. `onLimit` is what running out of room
  // means here: 'continue' may re-arm the agent, 'stop' never does — a piece's
  // plan carries on by itself — and 'plan' is the builder's small ask, whose
  // caller sizes what is left (spec.md §8).
  function reportOutcome({
    row, project, chat, agent, asker, outcome, changed, onLimit = 'continue', limits = roomLimits,
  }) {
    const {
      cappedThinking, streamFailed, hitLength, reply, lastReasoning, lastOut,
      pendingCut, hitLimit,
    } = outcome;
    const banner = (body) => postSystemMessage(db, broker, {
      project, chat, agentId: agent.id, body,
    });

    // Said on its own rather than as another branch of the chain below:
    // this is about how the reply was produced, not about how the loop
    // stopped, and it reads correctly next to whichever of those follows.
    if (cappedThinking) {
      banner(`${row.agent_name} was thinking for a very long time, so the studio asked them to stop planning and start working. Ask for one piece at a time if you want them to think it through properly.`);
    }

    // Explain a missing file rather than leaving it looking like a backend
    // fault (spec.md §8). Only the final turn's cut matters: an earlier one
    // the model was told about and rewrote is not a missing file.
    if (streamFailed) {
      // First, not another else-if: the limit banners describe how the loop
      // chose to stop, and this loop did not choose. No continuation either
      // — a dead upstream retried automatically could loop on the failure.
      banner(`${row.agent_name} was cut off mid-reply; everything it said and saved up to then is kept.`);
    } else if (hitLength && !reply && changed.length === 0
        && lastReasoning > 0 && lastReasoning >= lastOut * 0.9) {
      // It never got past thinking. Nothing was cut in half, because
      // nothing was started: the trace filled the whole output allowance.
      // Naming that is the difference between "the studio is broken" and
      // "ask for less at once", and the second one is both true and
      // something a person can act on.
      banner(`${row.agent_name} spent the whole reply thinking and never got as far as writing anything. Ask for one piece at a time — one screen, one rule, one file.`);
    } else if (pendingCut || (hitLength && changed.length === 0)) {
      banner(`${row.agent_name} ran out of output budget mid-reply; a file may be missing or incomplete.`);
    } else if (hitLimit !== null && onLimit === 'plan') {
      // A small ask that used up a small budget was not small. What it did
      // is kept and committed; the caller hands what is left to the sizing.
      banner(`${row.agent_name} got this far, and it turned out bigger than one go. Working out what is left…`);
    } else if (hitLimit === 'tool') {
      banner(`${row.agent_name} stopped after ${limits.tools} tool calls in one turn.`);
    } else if (hitLimit === 'turn' || hitLimit === 'context') {
      // Out of room mid-build: out of turns, or the loop grew past what one
      // request may carry. Rather than making a human type "keep going",
      // re-arm the agent and let it pick up where it stopped.
      if (!(onLimit === 'continue' && carryOn({ row, project, chat, agent, asker }))) {
        stopBanner({ row, project, chat, agent }, hitLimit, limits);
      }
    } else if (!reply && changed.length === 0) {
      // Ended cleanly and produced nothing at all: no prose, no files, no
      // limit reached. The end event has already taken the live entry away,
      // so without this the row just vanishes and the person is left
      // wondering whether they were heard.
      banner(`${row.agent_name} finished without saying anything. Ask again if you were expecting a reply.`);
    }
  }

  // The words of the last thing a person said, whatever else rode with it: a
  // picture makes `content` an array of parts (§14), and only the text of it
  // is any use to a judge that is only reading the wording.
  function lastAsk(messages) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role !== 'user') continue;
      const text = Array.isArray(m.content)
        ? m.content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n')
        : String(m.content ?? '');
      if (text.trim()) return text.trim();
    }
    return '';
  }

  // The fire a chat project's helper gets: one loop, one reply, no tools —
  // there is no tree, and the helper is whatever its description says, at the
  // thinking level it was given. The thinking judge that used to go ahead of
  // this fire (§14, "the tiny judge") went with the open room it was for: a
  // game's rooms are all the builder's since 2026-09-15, and the cliff it
  // guarded against is thinking against tools.
  async function openFire(fire) {
    const { agent, context, emit } = fire;
    const outcome = await runLoop({
      agent, system: context.system, messages: context.messages, toolset: null,
      thinking: agent.thinking, emit,
    });
    const kept = await persistReply({
      ...fire, toolset: null, outcome, subject: firstLine(outcome.reply) || 'update files',
    });
    if (kept.nothing) return;
    reportOutcome({ ...fire, outcome, changed: kept.changed });
  }

  // The sizing call (spec.md §8, §14; agents/sizing.js): one whole answer,
  // thinking off, no tools, the fire's own system prompt — small, or big with
  // the pieces. Fails open to small — today's fire, the cap behind it — on an
  // answer that will not parse or an upstream that will not answer. Charged to
  // the asker like the fire it goes ahead of.
  async function sizeRequest(fire, {
    paused = null, notes = null, begun = null, trigger = null,
  } = {}) {
    const { agent, context, asker, emit } = fire;
    // One whole answer streams nothing, so the line under the name says what
    // is happening itself (spec.md §9): not a tool, but the one word for it.
    emit('agent.tool', { tool: 'size', path: null });
    let messages = context.messages.map((m) => ({ ...m }));
    // Build it adds its own turn: the newest message is the card, the
    // builder's own, and the trigger goes on as a user turn after it.
    if (messages[messages.length - 1]?.role !== 'user') messages.push({ role: 'user', content: '' });
    const last = messages[messages.length - 1];
    // Notes ahead of the trigger, never after: a long attachment behind the
    // ask swamps it (§14). `begun` is what a small ask did before it ran out
    // of room, handed on the same way. The trigger itself is short on
    // purpose — the rules are in the preamble — because ⚠️ a last user
    // message over ~160 tokens costs the fire after it ~6,000 tokens of
    // prefix (§14); a note here still does, once.
    const noted = notes ? notesForPlanner(notes) : null;
    last.content = [
      last.content,
      noted,
      begun ? begunNote(begun) : null,
      trigger ?? sizingTrigger({ paused, begun: begun !== null }),
    ].filter(Boolean).join('\n\n');
    fire.exchange = null;
    try {
      const opts = {
        system: context.system, thinking: 'none', maxTokens: SIZING_MAX_TOKENS, responseFormat: 'json_object',
      };
      let answer = await llm.complete({ ...opts, messages });
      let charged = tokensCharged(answer.usage);
      let sized = parseSizing(answer.text);
      // ⚠️ A plan in a script the person did not write in is asked for once
      // more, on the same transcript with the first answer left in it — the
      // prefix is cached, so it costs the answer and little else. The rules
      // cannot fix it (§14). Once: a second slip is shown, not looped on, and
      // a re-ask that will not parse leaves the first answer standing.
      if (inOtherScript(sized, lastAsk(context.messages))) {
        const asked = [
          ...messages,
          { role: 'assistant', content: answer.text },
          { role: 'user', content: SCRIPT_TRIGGER },
        ];
        const again = await llm.complete({ ...opts, messages: asked }).catch(() => null);
        if (again) charged += tokensCharged(again.usage);
        const resized = again ? parseSizing(again.text) : null;
        if (resized) { messages = asked; answer = again; sized = resized; }
      }
      consumeBudget(db, charged);
      chargeUser(db, asker?.id, charged);
      // Kept for the fire that follows: it extends this exchange (below). The
      // notes are a trace, so the receipt masks them like a handed one.
      fire.exchange = {
        messages, answer: answer.text || '{"size":"small"}', masked: noted ? [noted] : [],
      };
      return sized ?? { size: 'small', resume: true };
    } catch (err) {
      console.error('sizing failed', err);
      return { size: 'small', resume: true };
    }
  }

  // The fire's transcript in this room: the sizing's own messages, its answer
  // as the assistant turn, and one more user turn on top. Measured (§14): the
  // fire then reuses everything to the end of the system prompt, where a fire
  // that drops the trigger from the last message diverges at the tail of it
  // and reuses half. No exchange — the sizing failed — and the turn goes on
  // as a user message of its own.
  const extended = (fire, turn) => (fire.exchange
    ? [
      ...fire.exchange.messages,
      { role: 'assistant', content: fire.exchange.answer },
      { role: 'user', content: turn },
    ]
    : [...fire.context.messages, { role: 'user', content: turn }]);

  // The receipt's transcript half, recounted over what the fire really sent:
  // the exchange and the turn on top are not in the history's count.
  const receiptContext = (context, messages) => ({
    ...context,
    breakdown: {
      ...context.breakdown,
      transcript: {
        ...context.breakdown.transcript,
        messages: messages.length,
        bytes: messages.reduce((n, m) => n + Buffer.byteLength(m.content ?? '', 'utf8'), 0),
      },
    },
  });

  // The card moving along (plans.js): the checklist to every tab and the
  // card's own body rewritten from the same shape.
  const announcePlan = (fire, plan) => announcePlanRow(db, broker, fire.row.slug, plan);

  function pausePlan(fire, plan, body) {
    announcePlan(fire, setPlanStatus(db, plan.message_id, 'paused'));
    postSystemMessage(db, broker, {
      project: fire.project, chat: fire.chat, agentId: fire.agent.id, body,
    });
  }

  function dropPlan(fire, plan, body = null) {
    announcePlan(fire, setPlanStatus(db, plan.message_id, 'dropped'));
    if (body) {
      postSystemMessage(db, broker, {
        project: fire.project, chat: fire.chat, agentId: fire.agent.id, body,
      });
    }
  }

  // The builder's room (spec.md §8; ideas/planner.md): size first, then a
  // small fire for a small ask or one fire per piece for a big one. A plan
  // an earlier message paused is the sizing's to carry on, set aside or
  // replace. On a small ask the cap, on a first turn, hands its trace to the
  // sizing call rather than to a retry — a request that thought that long
  // wanted splitting — and only if that still says small does the retry run,
  // with the trace in hand. A small ask runs under the small budget, and one
  // that uses it up was not small: what it did is kept, and what is left
  // goes back to the sizing as a plan (planRest) rather than carrying on.
  async function builderFire(fire) {
    const { row, chat, agent, dir, asker, context, emit } = fire;
    // Build it was pressed: the plan is the whole of this fire.
    const queued = queuedPlan(db, chat.id);
    if (queued) {
      await runQueued(fire, queued);
      return;
    }
    const paused = pausedPlan(db, chat.id);
    const draft = draftPlan(db, chat.id);
    const request = db
      .prepare(
        `SELECT body FROM messages
          WHERE chat_id = ? AND user_id IS NOT NULL ORDER BY id DESC LIMIT 1`,
      )
      .get(chat.id)?.body ?? '';

    // A new plan takes the place of one paused and of one still waiting to
    // be built; a reply leaves both where they are.
    const replacePlans = () => {
      if (paused) dropPlan(fire, paused);
      if (draft) dropPlan(fire, draft);
    };
    let sized = await sizeRequest(fire, { paused });
    if (sized.size === 'pieces') {
      replacePlans();
      await runPlan(fire, { request, ...sized });
      return;
    }

    const toolset = createToolset({
      dir, mutex, slug: row.slug, pending, shot: () => latestShot(db, row.project_id),
    });
    let messages = extended(fire, GO_AHEAD);
    let outcome = await runLoop({
      agent, system: context.system, messages, toolset, masked: fire.exchange?.masked,
      thinking: agent.thinking, emit, capMode: 'return', limits: smallLimits,
    });
    if (outcome.capped !== null) {
      const abandoned = outcome.charged;
      sized = await sizeRequest(fire, { paused, notes: outcome.capped });
      if (sized.size === 'pieces') {
        consumeBudget(db, abandoned);
        chargeUser(db, asker?.id, abandoned);
        replacePlans();
        await runPlan(fire, { request, ...sized });
        return;
      }
      messages = extended(fire, GO_AHEAD);
      outcome = await runLoop({
        agent, system: context.system, messages, toolset, masked: fire.exchange?.masked,
        thinking: agent.thinking, emit, handoff: outcome.capped, limits: smallLimits,
      });
      outcome.charged += abandoned;
    }
    const kept = await persistReply({
      ...fire, context: receiptContext(context, messages), toolset, outcome,
      subject: firstLine(outcome.reply) || 'update files',
    });
    if (kept.nothing) return;
    reportOutcome({
      ...fire, outcome, changed: kept.changed, onLimit: 'plan', limits: smallLimits,
    });
    if (outcome.hitLimit !== null) {
      await planRest(fire, { paused, request, changed: kept.changed, outcome });
      return;
    }

    if (!paused) return;
    if (sized.resume) await runPieces(fire, planFor(db, paused.message_id));
    else dropPlan(fire, paused, `${row.agent_name} set the plan aside.`);
  }

  // What is left of a small ask that outran its budget: sized again with what
  // was done as notes — the files it changed and what it said — and run as a
  // plan. The sizing's system prompt is the fire's, with the files as they
  // were before it wrote: that is the cache prefix, and the note names what
  // changed, so the planner is told rather than shown. Small again, or no
  // answer, and the builder carries on the way any room does, one more go at
  // a time and bounded by the same count; each go is sized again first, so
  // the next overrun gets another chance at a plan. A paused plan stays
  // paused through all of it; the next message decides its fate.
  async function planRest(fire, { paused, request, changed, outcome }) {
    const { emit, state } = fire;
    emit('agent.stream.start');
    state.live = true;
    const said = [outcome.working, outcome.reply].filter(Boolean).join('\n\n');
    const sized = await sizeRequest(fire, { paused, begun: { changed, said } });
    if (sized.size === 'pieces') {
      if (paused) dropPlan(fire, paused);
      await runPlan(fire, { request, ...sized, begun: true });
      return;
    }
    emit('agent.stream.end');
    state.live = false;
    if (!carryOn(fire)) stopBanner(fire, outcome.hitLimit, smallLimits);
  }

  // A plan: the card — a message of kind 'plan', the builder's own words in
  // the transcript and a checklist on screen — then the pieces. `begun` is a
  // plan for the rest of something a small fire started on.
  async function runPlan(fire, {
    request, pieces, summary = '', assumptions = [], begun = false, clear = null,
  }) {
    const { row, project, chat, agent, emit, state, snapshot } = fire;
    const now = new Date().toISOString();
    // A plan of two or more waits as a draft for Build it — nothing runs and
    // nothing is charged until the press; a plan of one runs at once.
    const status = pieces.length > 1 ? 'draft' : 'running';
    const messageId = tx(db, () => {
      const info = db
        .prepare(
          `INSERT INTO messages (project_id, chat_id, agent_id, kind, body, created_at)
           VALUES (?, ?, ?, 'plan', ?, ?)`,
        )
        .run(project.id, chat.id, agent.id, planBody(pieces, {
          begun, status, summary, assumptions,
        }), now);
      const id = Number(info.lastInsertRowid);
      createPlan(db, {
        messageId: id, projectId: project.id, chatId: chat.id, request, pieces, now,
        summary, assumptions, begun, status,
      });
      return id;
    });
    lastFired.set(row.id, snapshot);
    const stored = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    broker.broadcast('message.new', messagePublic(db, stored, row.slug));
    emit('agent.stream.end', { message_id: messageId });
    state.live = false;
    if (status === 'draft') return;
    // `clear` rides the call rather than the plan row: only a plan of one
    // runs straight away, and a draft's pieces are at `none` whatever the
    // sizing said. A resumed plan has no sizing of its own to carry, and
    // falls back to the level.
    await runPieces(fire, planFor(db, messageId), clear);
  }

  // Build it, pressed (spec.md §8): the plan is this fire, charged to whoever
  // pressed. A game with no SPEC.md gets one from the plan's words first — a
  // game's first Build is its spec moment — and the context is read again so
  // the block the pieces run on carries it. Then one request the pieces
  // extend (§14): a short confirmation for a plan built as written, the plan
  // being the card above in the transcript already; or, for a plan the person
  // changed, a sizing over their words, which may split a piece but is told
  // to keep the words, and whose answer becomes the pieces still to do.
  async function runQueued(fire, queued) {
    const { row, project, chat, agent, dir } = fire;
    if (queued.built_by) {
      fire.asker = db
        .prepare('SELECT id, display_name, daily_tokens FROM users WHERE id = ?')
        .get(queued.built_by) ?? fire.asker;
    }
    if (await writeSpecIfAbsent(fire, queued)) {
      fire.context = await buildContext({
        db, project, chat, dir, agent, lastFiredMaxId: lastFired.get(row.id) ?? 0,
        maxAssistantTurns: smallLimits.turns, maxToolCalls: smallLimits.tools, historyFloor,
        sizing: true, lastMayBeOwn: true,
      });
    }
    let plan = queued;
    if (queued.edited === 1) {
      const left = queued.pieces.filter((p) => p.status !== 'done');
      const sized = await sizeRequest(fire, {
        trigger: resizeTrigger({ summary: queued.summary, assumptions: queued.assumptions, pieces: left }),
      });
      plan = settlePieces(db, queued.message_id, sized.size === 'pieces' ? sized.pieces : left);
    } else {
      await sizeRequest(fire, { trigger: CONFIRM_TRIGGER });
    }
    await runPieces(fire, plan);
  }

  // SPEC.md from the plan's words, once, when the game has none (spec.md §8).
  // A template's spec stands; a later plan never touches it. Committed as
  // the builder's, under the mutex like any write of its own.
  async function writeSpecIfAbsent({ row, project, agent, dir }, plan) {
    const file = path.join(dir, 'SPEC.md');
    if (await readFileAt(file) !== null) return false;
    const text = specText({
      name: project.name, request: plan.request, summary: plan.summary,
      assumptions: plan.assumptions, pieces: plan.pieces,
    });
    const sha = await mutex.run(row.slug, async () => {
      if (pending) await pending.settleLocked(row.slug);
      await writeFileAt(file, Buffer.from(text, 'utf8'));
      return commitPaths(dir, ['SPEC.md'], `${row.agent_name}: SPEC.md from the plan`, agentAuthorFor(agent, row.slug));
    });
    broker.broadcast('files.changed', { project_slug: row.slug, paths: ['SPEC.md'] });
    if (sha) versionNew(broker, row.slug, sha, ['SPEC.md']);
    return true;
  }

  // Build it (routes/plans.js): the plan becomes the builder's next fire in
  // its room. Refused while the builder is mid-fire there, since the press
  // would otherwise land on a fire already running.
  function buildPlan(plan, user) {
    const row = db
      .prepare(
        `SELECT ca.id, ca.cooldown_until, p.slug
           FROM chat_agents ca
           JOIN agents a ON a.id = ca.agent_id
           JOIN chats c ON c.id = ca.chat_id
           JOIN projects p ON p.id = c.project_id
          WHERE ca.chat_id = ? AND a.builtin = 1`,
      )
      .get(plan.chat_id);
    if (!row) return { ok: false, reason: 'the builder is not in that room' };
    if (firing.has(row.id)) return { ok: false, reason: 'the builder is busy in that room — wait for it to finish' };
    announcePlanRow(db, broker, row.slug, queuePlan(db, plan.message_id, user.id));
    db.prepare('UPDATE chat_agents SET response_pending = 1 WHERE id = ?').run(row.id);
    schedule(row.id, row.cooldown_until ? new Date(row.cooldown_until).getTime() : 0);
    return { ok: true };
  }

  // The pieces of a plan, one fire each, in order, thinking off (§14), each on
  // the sizing's own system prompt and exchange — the files as they were when
  // the turn began — with its turn and what changed since on top, so every
  // piece after the first reuses the whole prefix (§8, §14). Stops — paused,
  // the plan kept — when a message arrives (the dirty bit; the finally
  // re-fires, and that message's sizing picks the rest up), when a day's
  // tokens run out, or when a piece's stream dies with nothing to show. A
  // piece that hit a limit still counts as done: what it wrote is on disk and
  // the next piece builds on it. The preamble names the small budget; a piece
  // runs under the room's, and stopping early on the smaller number is fine.
  async function runPieces(fire, plan, clear = null) {
    const {
      row, project, chat, agent, dir, asker, emit, state, context,
    } = fire;
    const n = plan.pieces.length;
    // A plan of one is the common case, and no plan thought for it: it runs
    // at the builder's own level. The pieces of a bigger plan run at `none`,
    // where the plan already did the thinking (§14).
    //
    // Unless the sizing called the request **clear** — it named a value, a
    // thing, a name or a symptom — in which case there is nothing to work out
    // and the thinking is measurably worth nothing: `none` and `low` changed
    // the same one file by the same amount, `low` spending 106 tokens to get
    // there (§14). `clear: false`, or a sizing that left the key off, keeps
    // the level, so this only ever turns thinking *down* and never up.
    const thinking = n === 1 && clear !== true ? agent.thinking : 'none';
    let current = setPlanStatus(db, plan.message_id, 'running');
    announcePlan(fire, current);
    for (let i = 0; i < n; i += 1) {
      if (current.pieces[i].status === 'done') continue;
      const interrupted = db
        .prepare('SELECT response_pending FROM chat_agents WHERE id = ?')
        .get(row.id)?.response_pending === 1;
      if (interrupted) {
        pausePlan(fire, current, `${row.agent_name} paused after piece ${i} of ${n} to read your message.`);
        return;
      }
      if (!hasBudget(db, studioLimit(db, dailyTokenBudget)) || !userHasBudget(db, asker)) {
        pausePlan(fire, current, `${row.agent_name} paused the plan: out of tokens for today. Ask them to carry on tomorrow.`);
        return;
      }
      const piece = current.pieces[i];
      // Marked running before the start event, so the card is showing this
      // line as the live reply's place by the time there is one: the other
      // way round it was born at the foot of the thread and jumped up.
      current = setPiece(db, plan.message_id, i, { status: 'running' });
      announcePlan(fire, current);
      emit('agent.stream.start');
      state.live = true;
      const toolset = createToolset({
        dir, mutex, slug: row.slug, pending, shot: () => latestShot(db, row.project_id),
      });
      const turn = pieceTurn({
        request: current.request, pieces: current.pieces, index: i,
        summary: current.summary, assumptions: current.assumptions,
      });
      const fresh = await freshCopies(dir, context, piece.files);
      const messages = extended(fire, fresh ? `${turn}\n\n${fresh}` : turn);
      const outcome = await runLoop({
        agent, system: context.system, messages, toolset, thinking, emit,
        masked: fire.exchange?.masked,
      });
      // The headline: the closing paragraph the piece was asked for, or the
      // piece's name when it said nothing. Its row goes behind the card.
      const note = headline(outcome.reply) || `Piece ${i + 1} of ${n}: ${piece.title}`;
      const kept = await persistReply({
        ...fire, context: receiptContext(context, messages), toolset, outcome,
        subject: `piece ${i + 1} of ${n} — ${piece.title}`,
        body: outcome.reply || note,
        planMessageId: plan.message_id,
      });
      if (kept.nothing) {
        pausePlan(fire, current, `${row.agent_name} was cut off during piece ${i + 1} of ${n}, so the plan is paused. Ask them to carry on.`);
        return;
      }
      reportOutcome({ ...fire, outcome, changed: kept.changed, onLimit: 'stop' });
      current = setPiece(db, plan.message_id, i, {
        status: 'done', message_id: kept.messageId, note,
      });
      announcePlan(fire, current);
    }
    announcePlan(fire, setPlanStatus(db, plan.message_id, 'done'));
  }

  async function fireAgent(chatAgentId) {
    const row = db
      .prepare(
        `SELECT ca.id, ca.chat_id, ca.agent_id, ca.response_pending,
                c.project_id, c.name AS chat_name,
                a.name AS agent_name, a.description, a.thinking,
                a.deleted, a.builtin,
                c.builder,
                p.slug, p.name AS project_name, p.kind, p.type, p.archived, p.scores_on, p.stage
           FROM chat_agents ca
           JOIN chats c ON c.id = ca.chat_id
           JOIN agents a ON a.id = ca.agent_id
           JOIN projects p ON p.id = c.project_id
          WHERE ca.id = ?`,
      )
      .get(chatAgentId);
    if (!row || row.response_pending !== 1 || row.deleted) return;

    const project = {
      id: row.project_id, slug: row.slug, name: row.project_name, kind: row.kind,
      type: row.type, scores_on: row.scores_on, stage: row.stage,
    };
    const chat = { id: row.chat_id, name: row.chat_name };
    const clearPending = () => db
      .prepare('UPDATE chat_agents SET response_pending = 0 WHERE id = ?')
      .run(row.id);

    if (row.archived) {
      clearPending();
      return;
    }

    // Claim the flag before any await, so a message arriving mid-fire sets it
    // again rather than being swallowed.
    clearPending();
    firing.add(row.id);

    // Every event says which conversation it is about: a reply streaming into
    // a chat nobody is looking at must not paint itself into the open one.
    const emit = (event, data = {}) => broker.broadcast(event, {
      project_slug: row.slug, chat_id: chat.id, agent_id: row.agent_id, ...data,
    });
    // Whether a browser is holding a live entry for this fire: set by the
    // start event, cleared by whichever end event answers it. ⚠️ The catch
    // below reads it, and an error end sent when nothing is live *creates* a
    // live entry the client will never clear (spec.md §9). An object, because
    // the loop and the persisting are functions of their own now and both
    // move it.
    const state = { live: false };

    try {
      // Billed to whoever asked: the newest human message in this chat is
      // whose turn this reply answers. A continuation has no new human turn,
      // so it goes on the same person's day — it is the rest of their answer.
      const asker = db
        .prepare(
          `SELECT u.id, u.display_name, u.daily_tokens
             FROM messages m JOIN users u ON u.id = m.user_id
            WHERE m.chat_id = ? AND m.user_id IS NOT NULL
            ORDER BY m.id DESC LIMIT 1`,
        )
        .get(chat.id) ?? null;

      if (!hasBudget(db, studioLimit(db, dailyTokenBudget))) {
        postSystemMessage(db, broker, {
          project,
          chat,
          agentId: row.agent_id,
          body: `${row.agent_name} could not reply: the studio is out of tokens for today.`,
        });
        return;
      }
      // One person's day running out stops their helpers and nobody else's.
      if (!userHasBudget(db, asker)) {
        postSystemMessage(db, broker, {
          project,
          chat,
          agentId: row.agent_id,
          body: `${row.agent_name} could not reply: ${asker.display_name} has used up today's tokens. It starts again tomorrow.`,
        });
        return;
      }

      // null for a chat: there is no such directory, and nothing may go
      // looking for one.
      const dir = row.kind === 'chat' ? null : path.join(path.resolve(gamesDir), row.slug);
      const agent = {
        id: row.agent_id,
        name: row.agent_name,
        description: row.description,
        thinking: row.thinking,
      };
      // Snapshot before streaming: anything with a higher id arrived while
      // this reply was being written and was therefore unseen by it.
      const snapshot = db
        .prepare('SELECT COALESCE(MAX(id), 0) AS n FROM messages WHERE chat_id = ?')
        .get(chat.id).n;
      // A person's saves still waiting for their commit land now, as theirs:
      // the helper reads a tree that is history, its own commit cannot
      // swallow them, and the problems the preview filed against those saves
      // are HEAD's by the time the context reads them (files/pending.js).
      if (dir !== null && pending) await pending.settle(row.slug);
      // A builder room sizes first (spec.md §8); a chat project's room is the
      // one fire it always was. Its context names the small budget, since
      // that is what a small ask there runs under and the sizing shares the
      // prefix; a piece builds its own.
      const builderRoom = row.builder === 1 && dir !== null;
      const limits = builderRoom ? smallLimits : roomLimits;
      // Build it pressed: the newest turn is the builder's own card, and the
      // fire adds the turn there is to answer (runQueued).
      const queued = builderRoom ? queuedPlan(db, chat.id) : null;
      const context = await buildContext({
        db, project, chat, dir, agent, lastFiredMaxId: lastFired.get(row.id) ?? 0,
        maxAssistantTurns: limits.turns, maxToolCalls: limits.tools, historyFloor,
        sizing: builderRoom, lastMayBeOwn: queued !== null,
      });
      if (!context) return;

      emit('agent.stream.start');
      state.live = true;

      const fire = {
        row, project, chat, agent, dir, asker, context, emit, state, snapshot,
      };
      if (builderRoom) await builderFire(fire);
      else await openFire(fire);
    } catch (err) {
      // ⚠️ Nothing above this catches. fireAgent is called from a timer, and
      // its caller can only print, so every unexpected fault used to end as a
      // console line and a browser left saying "Thinking…" for ever: the start
      // event had gone out and nothing was ever going to answer it. A git
      // commit that cannot take the lock, a database that will not write, a
      // full disk — none of them are the stream failing, so none of them
      // reached the salvage path.
      //
      // The end event goes first because it is the part that cannot fail:
      // broadcast swallows a dead socket, while the database is one of the
      // things that plausibly just broke.
      console.error('agent fire failed', err);
      if (state.live) {
        emit('agent.stream.end', { error: true });
        state.live = false;
      }
      try {
        postSystemMessage(db, broker, {
          project,
          chat,
          agentId: row.agent_id,
          body: `${row.agent_name} stopped: the studio ran into a problem. Anything already saved is kept.`,
        });
      } catch (second) {
        // Said as plainly as it can be: the database is a candidate for what
        // failed in the first place, and a throw here would be the fault
        // taking the report with it.
        console.error('could not report the failure', second);
      }
    } finally {
      firing.delete(row.id);
      try {
        // Cooldown runs from the end of the response, not its start.
        const readyAt = Date.now() + cooldownMs;
        db.prepare('UPDATE chat_agents SET cooldown_until = ? WHERE id = ?')
          .run(new Date(readyAt).toISOString(), row.id);
        const fresh = db
          .prepare('SELECT response_pending FROM chat_agents WHERE id = ?')
          .get(row.id);
        if (fresh?.response_pending === 1) schedule(row.id, readyAt);
      } catch (err) {
        // A fire can outlive the process it belongs to — a test closing its
        // fixture, or a shutdown mid-reply. There is nothing to record
        // against a closed database, and anything else here is worth seeing.
        if (err.code !== 'ERR_INVALID_STATE') throw err;
      }
    }
  }

  return {
    onHumanMessage,
    buildPlan,
    // Test seams.
    _fireAgent: fireAgent,
    _buildContext: buildContext,
    _isFiring: (id) => firing.has(id),
    _pendingTimers: () => timers.size,
  };
}
