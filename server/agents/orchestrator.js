import path from 'node:path';
import { tx } from '../db.js';
import { listTree, readFileAt } from '../files/tree.js';
import { LIBRARY_DIR, LIBRARY_MANIFEST } from '../files/paths.js';
import { commitPaths, currentSha } from '../files/git.js';
import { hasErrors, listErrors } from '../runtime.js';
import { tokensCharged, tokensForChars, DEFAULT_MAX_TOKENS } from '../llm/deepseek.js';
import {
  hasBudget, consumeBudget, DEFAULT_DAILY_TOKEN_BUDGET,
  studioLimit, userHasBudget, chargeUser,
} from '../budget.js';
import { messagePublic, agentAuthorFor } from '../routes/helpers.js';
import { parseMentions, agentEligible } from '../mentions.js';
import { createToolset } from './tools.js';

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
// (spec.md §8, tmp/probe-order.mjs).
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
// one at full price (the branch point moves), while carrying charges a tenth
// of the pile on every request. The floor keeps short fires from shedding.
const SHED_HORIZON_ROUNDS = 4;
const SHED_FLOOR_TOKENS = 8000;

const BRIEF_FILE = 'BRIEF.md';
const MAX_COMMIT_SUBJECT = 72;

function firstLine(text) {
  const line = String(text ?? '').trim().split('\n')[0] ?? '';
  return line.length > MAX_COMMIT_SUBJECT
    ? `${line.slice(0, MAX_COMMIT_SUBJECT - 1)}…`
    : line;
}

// Games only. A chat gets no preamble at all: every sentence here is about a
// working tree it does not have, and an agent in a chat is whatever its
// description says it is, with nothing from the studio layered on top.
function studioPreamble({
  project, canEdit, maxAssistantTurns, maxToolCalls, libraryNotes = [],
}) {
  const lines = [
    `You are an agent in Unbridled Joy, a game studio, working with people on the browser game "${project.name}".`,
    'The project is a working tree of files. Every change is committed to git, so nothing is unrecoverable.',
    '',
    'Paths are project-relative and / separated: no leading slash, no "..", no ".git", at most 8 segments.',
  ];
  if (canEdit) {
    lines.push(
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
      'config/ is the part a person tunes without reading code, so it has rules of its own:',
      '- One batch per file: config/play.js (movement, timings), config/world.js (levels or board data),',
      '  config/look.js (colours, sizes), config/words.js (every string the player sees),',
      '  config/controls.js (which button does what), config/achievements.js (what a player can earn).',
      '- Plain values only, written as `const NAME = value;` — numbers, strings, true/false, and lists or',
      '  groups of those. No logic, no maths, no function calls: the studio shows these files as a form of',
      '  labelled fields, and it can only do that while every value is a plain one.',
      '- A comment on every value, in words a ten-year-old can read. That comment is the point of the file.',
      '- Change them whenever the game needs it — a new level, a new line, a rebalance — and keep the',
      '  comments when you do. Use patch_file for a single value so the rest of the file stays untouched.',
      '- ⚠️ Three of them open as an editor for the whole game rather than a list of fields, and only while',
      '  they keep their exact shape: config/questions.js as the "quiz editor", config/story.js as the',
      '  "story editor", and config/achievements.js as the "achievements editor", the Achievements tab in',
      '  the rail (each entry is id, name, how, icon, when). Adding a key those do not know — a weight on an',
      '  answer, a field on a scene, a second test on a rule — costs the person the editor and drops them',
      '  back to a form or to the code.',
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
    );
    // The engine's contract, never its source: each held library documents
    // itself with the note at the top of its file, read from the game's own
    // copy so it matches the version this game actually holds. Adding a
    // library to the studio teaches every helper about it with no edit here.
    for (const { file, note } of libraryNotes) {
      lines.push('', `How to use ${file} — the note from the top of the file:`, note);
    }
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
      `This reply gets at most ${maxAssistantTurns} turns and ${maxToolCalls} tool calls, then it is cut off`,
      'wherever it happens to be. Several tool calls in one turn cost one turn, so send them together:',
      'a turn spent on a single read is a turn you do not get back. If you can see you will not finish,',
      'stop and say what is left rather than being cut off mid-file.',
    );
  } else {
    lines.push(
      '',
      'You have no file tools. You can read and discuss the project but not change it.',
    );
  }
  // What this game is, when the studio knows (projects.type). A type brings
  // an editor the person works in, and a helper that has not been told sees
  // the story as a file to rewrite from the wrong end. Named by the words on
  // the tab, like every other button; orchestrator.test.js asserts them.
  if (project.type === 'visual-novel') {
    lines.push(
      '',
      'This game is a visual novel. The whole story is config/story.js — CAST, who speaks and their moods,',
      'and SCENES, each a picture, music, lines read from the top, then choices, a go, or the end — and',
      'the person writes it in the "story editor", the Story tab beside this chat, which shows it as scenes',
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
  lines.push(
    '',
    'The game is served from a different origin than the studio, so absolute URLs back to the studio',
    'will not resolve. Use relative paths inside the game.',
    '',
    'Keep your reply short — a note on what you did or think. The files carry the detail.',
  );
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
// buttons shape and toggles, which were worth the bytes. Exported because a
// note that outgrows it is cut in silence: the suite holds every library's
// header against this number.
export const NOTE_BYTES = 3072;

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
  for (const file of ordered) {
    if (!included.has(file.path)) {
      omitted.push(file.path);
      continue;
    }
    const buffer = await readFileAt(path.join(dir, file.path));
    if (buffer === null) continue;
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
  };
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
      `SELECT * FROM (
         SELECT * FROM messages WHERE chat_id = ? AND id > ? ORDER BY id DESC LIMIT ?
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

async function buildContext({
  db, project, chat, dir, agent, lastFiredMaxId = 0,
  maxAssistantTurns = MAX_ASSISTANT_TURNS, maxToolCalls = MAX_TOOL_CALLS,
  historyFloor = new Map(),
}) {
  const { turns, trimmed } = historyTurns(db, chat, agent, lastFiredMaxId, historyFloor);
  // The model needs something to answer. If the newest turn is this agent's
  // own reply there is nothing to respond to.
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') return null;

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
    canEdit: agent.file_tools,
    maxAssistantTurns,
    maxToolCalls,
    libraryNotes: await buildLibraryNotes(dir),
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

  return { system, messages, trimmed, breakdown };
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
      parts.push(`[tool result ${m.tool_call_id}]\n${m.content}`);
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
  gamesDir = 'games',
  dailyTokenBudget = DEFAULT_DAILY_TOKEN_BUDGET,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  maxAssistantTurns = MAX_ASSISTANT_TURNS,
  maxToolCalls = MAX_TOOL_CALLS,
  maxContinuations = MAX_CONTINUATIONS,
}) {
  if (!llm) throw new Error('createOrchestrator requires an llm');

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

  async function fireAgent(chatAgentId) {
    const row = db
      .prepare(
        `SELECT ca.id, ca.chat_id, ca.agent_id, ca.response_pending,
                c.project_id, c.name AS chat_name,
                a.name AS agent_name, a.description, a.model, a.thinking,
                a.file_tools, a.deleted,
                p.slug, p.name AS project_name, p.kind, p.type, p.archived, p.scores_on
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
      type: row.type, scores_on: row.scores_on,
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
    // live entry the client will never clear (spec.md §9).
    let live = false;

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
        model: row.model,
        thinking: row.thinking,
        file_tools: row.file_tools === 1,
      };
      // Snapshot before streaming: anything with a higher id arrived while
      // this reply was being written and was therefore unseen by it.
      const snapshot = db
        .prepare('SELECT COALESCE(MAX(id), 0) AS n FROM messages WHERE chat_id = ?')
        .get(chat.id).n;
      const context = await buildContext({
        db, project, chat, dir, agent, lastFiredMaxId: lastFired.get(row.id) ?? 0,
        maxAssistantTurns, maxToolCalls, historyFloor,
      });
      if (!context) return;

      const toolset = agent.file_tools && dir !== null
        ? createToolset({ dir, mutex, slug: row.slug })
        : null;

      emit('agent.stream.start');
      live = true;

      const messages = [...context.messages];
      // Everything the loop appends is counted, so a fire cannot grow past
      // LOOP_GROWTH_BYTES however many files it reads or writes.
      let grown = 0;
      const append = (message) => {
        messages.push(message);
        grown += JSON.stringify(message).length;
      };
      let replyText = '';
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
      // Set once a turn's trace ran past the cap with nothing else produced.
      // Sticky for the rest of the fire: thinking goes off and stays off, so
      // the cap cannot trip twice and the retry cannot loop.
      let thinkingOff = false;
      let cappedThinking = false;

      for (let turn = 0; turn < maxAssistantTurns; turn += 1) {
        let text = '';
        const calls = [];
        let cutCalls = 0;
        turnsUsed = turn + 1;
        sentPrompt = promptText(context.system, messages);
        try {
          const stream = llm.stream({
            model: agent.model,
            system: context.system,
            messages,
            tools: toolset ? toolset.definitions : null,
            thinking: thinkingOff ? 'none' : agent.thinking,
            maxTokens: DEFAULT_MAX_TOKENS,
          });
          for await (const event of stream) {
            if (event.type === 'reasoning') {
              // Streamed for the UI, never persisted and never replayed.
              emit('agent.stream.reasoning', { delta: event.text });
            } else if (event.type === 'delta') {
              text += event.text;
              emit('agent.stream.chunk', { delta: event.text });
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
          // — the same turn is asked again with thinking off, which is the
          // one setting measured to get files out of it. This attempt does
          // not count as a turn.
          //
          // ⚠️ It is charged, though, from an estimate: no usage frame
          // arrives for a stream nobody let finish, but the trace was
          // generated and the key is paying for it. Only the trace — the
          // prompt behind it was billed too and there is no count to put on
          // it, so this still undercounts, just by less.
          if (err.code === 'thinking_cap' && !thinkingOff) {
            charged += tokensForChars(err.reasoningChars);
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
          if (text) replyText += replyText ? `\n\n${text}` : text;
          break;
        }

        if (text) replyText += replyText ? `\n\n${text}` : text;
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
            if (toolCallCount >= maxToolCalls) {
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
        if (turn === maxAssistantTurns - 1 && !hitLimit) hitLimit = 'turn';
        if (hitLimit) break;

        // Another round is coming: shed the reasoning pile if carrying it is
        // now dearer than re-paying the visible tail once (spec.md §8, §14).
        const shedCost = (grown - shedBase) / 4;
        if (pile >= SHED_FLOOR_TOKENS
          && (pile / 10) * SHED_HORIZON_ROUNDS > shedCost) {
          append({ role: 'user', content: SHED_NOTICE });
          pile = 0;
          shedBase = grown;
          sheds += 1;
        }
      }

      consumeBudget(db, charged);
      chargeUser(db, asker?.id, charged);

      const changed = toolset ? toolset.changedPaths() : [];
      if (streamFailed && !replyText && changed.length === 0) {
        // Nothing said and nothing written: an error end and no message row,
        // same as before there was anything to salvage.
        emit('agent.stream.end', { error: true });
        live = false;
        return;
      }

      // The reply is written; from here on, anything newer than the snapshot
      // is something this agent has not seen.
      lastFired.set(row.id, snapshot);
      let commitSha = null;
      if (changed.length > 0) {
        const subject = firstLine(replyText) || 'update files';
        commitSha = await mutex.run(row.slug, () => commitPaths(
          dir, changed, `${row.agent_name}: ${subject}`, agentAuthorFor(agent, row.slug),
        ));
      }

      if (!replyText && changed.length === 0) {
        // Neither prose nor files: nothing worth a message row.
        emit('agent.stream.end');
        live = false;
      } else {
        const now = new Date().toISOString();
        const messageId = tx(db, () => {
          const info = db
            .prepare(
              `INSERT INTO messages (project_id, chat_id, agent_id, body, created_at, tokens, trimmed)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            // Null rather than 0 when nothing was trimmed: the column is a
            // report of something having happened, not a running total.
            .run(project.id, chat.id, agent.id, replyText, now, charged, context.trimmed || null);
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
              turns: turnsUsed, tool_calls: toolCallCount, appended_bytes: grown, sheds,
            },
            requests,
          }), sentPrompt);
          return id;
        });

        const stored = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
        broker.broadcast('message.new', messagePublic(db, stored, row.slug));
        emit('agent.stream.end', { message_id: messageId });
        live = false;
        if (commitSha) {
          broker.broadcast('files.changed', { project_slug: row.slug, paths: changed });
        }
      }

      // Said on its own rather than as another branch of the chain below:
      // this is about how the reply was produced, not about how the loop
      // stopped, and it reads correctly next to whichever of those follows.
      if (cappedThinking) {
        postSystemMessage(db, broker, {
          project,
          chat,
          agentId: agent.id,
          body: `${row.agent_name} was thinking for a very long time, so the studio asked them to stop planning and start working. Ask for one piece at a time if you want them to think it through properly.`,
        });
      }

      // Explain a missing file rather than leaving it looking like a backend
      // fault (spec.md §8). Only the final turn's cut matters: an earlier one
      // the model was told about and rewrote is not a missing file.
      if (streamFailed) {
        // First, not another else-if: the limit banners describe how the loop
        // chose to stop, and this loop did not choose. No continuation either
        // — a dead upstream retried automatically could loop on the failure.
        postSystemMessage(db, broker, {
          project,
          chat,
          agentId: agent.id,
          body: `${row.agent_name} was cut off mid-reply; everything it said and saved up to then is kept.`,
        });
      } else if (hitLength && !replyText && changed.length === 0
          && lastReasoning > 0 && lastReasoning >= lastOut * 0.9) {
        // It never got past thinking. Nothing was cut in half, because
        // nothing was started: the trace filled the whole output allowance.
        // Naming that is the difference between "the studio is broken" and
        // "ask for less at once", and the second one is both true and
        // something a person can act on.
        postSystemMessage(db, broker, {
          project,
          chat,
          agentId: agent.id,
          body: `${row.agent_name} spent the whole reply thinking and never got as far as writing anything. Ask for one piece at a time — one screen, one rule, one file.`,
        });
      } else if (pendingCut || (hitLength && changed.length === 0)) {
        postSystemMessage(db, broker, {
          project,
          chat,
          agentId: agent.id,
          body: `${row.agent_name} ran out of output budget mid-reply; a file may be missing or incomplete.`,
        });
      } else if (hitLimit === 'tool') {
        postSystemMessage(db, broker, {
          project,
          chat,
          agentId: agent.id,
          body: `${row.agent_name} stopped after ${maxToolCalls} tool calls in one turn.`,
        });
      } else if (hitLimit === 'turn' || hitLimit === 'context') {
        // Out of room mid-build: out of turns, or the loop grew past what one
        // request may carry. Rather than making a human type "keep going",
        // re-arm the agent and let it pick up where it stopped — a fresh fire
        // rebuilds its context from disk, which is what clears the weight.
        // The system message is not decoration: a 'system' row enters the
        // transcript as a user turn, which is what gives the next fire
        // something to answer — without it the agent's own reply would be
        // newest and the fire would no-op.
        const used = continued.get(row.id) ?? 0;
        if (used < maxContinuations
            && hasBudget(db, studioLimit(db, dailyTokenBudget))
            && userHasBudget(db, asker)) {
          continued.set(row.id, used + 1);
          postSystemMessage(db, broker, {
            project,
            chat,
            agentId: agent.id,
            body: `${row.agent_name} is not finished yet — carrying on from where they stopped.`,
          });
          db.prepare('UPDATE chat_agents SET response_pending = 1 WHERE id = ?')
            .run(row.id);
        } else {
          postSystemMessage(db, broker, {
            project,
            chat,
            agentId: agent.id,
            body: hitLimit === 'context'
              ? `${row.agent_name} had too much to hold in one reply and stopped. Ask them to keep going if you want more.`
              : `${row.agent_name} stopped after ${maxAssistantTurns} turns without finishing. Ask them to keep going if you want more.`,
          });
        }
      } else if (!replyText && changed.length === 0) {
        // Ended cleanly and produced nothing at all: no prose, no files, no
        // limit reached. The end event has already taken the live entry away,
        // so without this the row just vanishes and the person is left
        // wondering whether they were heard.
        postSystemMessage(db, broker, {
          project,
          chat,
          agentId: agent.id,
          body: `${row.agent_name} finished without saying anything. Ask again if you were expecting a reply.`,
        });
      }
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
      if (live) {
        emit('agent.stream.end', { error: true });
        live = false;
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
    // Test seams.
    _fireAgent: fireAgent,
    _buildContext: buildContext,
    _isFiring: (id) => firing.has(id),
    _pendingTimers: () => timers.size,
  };
}
