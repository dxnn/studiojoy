// The sizing call, and the words around a plan (spec.md §8, §14; the
// measurements are probes/probe-sizing.mjs, probes/probe-trace-handoff.mjs and
// probes/probe-extension*.mjs).
//
// One call ahead of a fire in the builder's room: the fire's own system prompt,
// no tools, thinking off, and a JSON answer — `small`, or `big` with the
// pieces. The rules stand in the preamble and the last user message carries a
// short trigger, after everything else on it, for two measured reasons: an
// attachment placed ahead of the ask swamps it, and ⚠️ a last user message
// over ~160 tokens leaves the request after it the system prompt less ~6,000
// tokens — the ~250-token ask that used to ride there cost every fire in the
// room half its prompt (§14). The fire is then the sizing's transcript plus
// one turn, and reuses the whole system prompt.

export const MAX_PIECES = 6;
const MAX_FILES_PER_PIECE = 8;
const MAX_TITLE = 60;
const MAX_WHAT = 400;
// Plans ran to 800 tokens of JSON once in five at the measured size; this is
// the room a six-piece plan with two sentences each needs, with a margin.
export const SIZING_MAX_TOKENS = 1200;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// The standing rules, in the builder's preamble: cached with the rest and
// byte-identical for the fire that follows.
export function sizingRules() {
  return [
    'SIZING',
    'When a [studio] message asks you to size the request, answer with JSON only — no prose, no code fence:',
    '{"size":"reply"} when it is a question or a remark, which wants an answer rather than work.',
    // ⚠️ Without this line a bug report sized as a *reply* two times in three
    // — a child saying the game is broken was answered with words instead of
    // a fix (§14, probes/probe-v41-clear.mjs). "a bug" was already named as
    // one-piece work below; the reply rule was catching it first.
    'Something being broken is not a remark: a report that the game does the wrong thing is work, even',
    'when it names no file and asks for nothing.',
    '{"size":"pieces","pieces":[{"title":"…","files":["…"],"what":"…"}]} when it changes the game. One',
    'piece when it is one change a helper can make in one go — a value, a line, a bug, one file. Two to',
    `${MAX_PIECES} when it is more than that: each a job one helper can finish in one sitting — a few files at`,
    'most — and each leaving the game runnable. "title" under 8 words; "what" is one or two sentences for',
    'the helper who will do that piece, saying what it makes and what it must not touch. Order the pieces',
    'so each builds on the last. Never name a file under studio/: that is the studio\'s and cannot be written.',
    // ⚠️ No line about language here, on purpose. A plan comes back with its
    // titles in Chinese now and then (§14, 2026-09-15: 1 in 35 on these
    // rules), and a line saying to write in the person's language was tried
    // and measured: 4 in 42 *with* it. Naming the language primes the switch
    // rather than preventing it. The fix, if one is wanted, is a check on the
    // answer's script and one re-ask (TODO.md), not words in here.
    'Every piece that brings numbers or words into the game names the config/ file they go in among its',
    'files — config/play.js, look.js, words.js or world.js — so no constant is ever written into js/.',
    'With two or more pieces add "summary": one paragraph in the person\'s own words saying what the game',
    'or the change is, and "assumptions": a short list of one-sentence decisions you made where the request',
    'left things open. The person reads and changes both before the plan is built, so write them for them.',
    'If the message says a plan was paused for it and lists the pieces still to do: a remark or a question',
    'that changes nothing is {"size":"reply","resume":true}, and the plan carries on after your reply; one',
    'that says to stop is {"size":"reply","resume":false}; one that changes the plan or asks for more is',
    'pieces, with every piece still to do, changed as the message asks, the message\'s own work first when',
    'it is separate.',
    'If it says a helper has already begun — its notes are above — size what is left, not the whole: one',
    'piece if one more go finishes it, more otherwise.',
    // ⚠️ Last, and byte-for-byte where probes/probe-v41-clear.mjs measured it.
    // Moving it changes what was measured (§14).
    'On a one-piece answer add "clear": true when the request says what to change — a value, a thing, a',
    'name, or a symptom somebody can point at. "clear": false when it says only how the game should feel',
    'or how it should turn out, and what to change still has to be worked out. Leave it off a reply and',
    'off a plan of two or more.',
  ].join('\n');
}

// The last user message's part: short on purpose (§14). A paused plan's
// pieces still to do ride here because they change; a begun note or a capped
// trace rides ahead of it, long, and costs the 6 K once.
export function sizingTrigger({ paused = null, begun = false } = {}) {
  const lines = ['[studio] Size this request.'];
  if (paused) {
    const left = paused.pieces.filter((p) => p.status !== 'done');
    lines.push(
      'A plan was under way and was paused for this message. Its pieces still to do:',
      ...left.map((p, i) => `${i + 1}. ${p.title} — ${p.files.join(', ')}: ${p.what}`),
    );
  }
  if (begun) {
    lines.push('A helper has already begun on this — its notes are above. Size what is left, not the whole.');
  }
  return lines.join('\n');
}

// Defensive on purpose: response_format is a belt, and a fence, a sentence
// first, or a shape with the wrong keys all still arrive. Null is "could not
// size it", which the caller treats as a reply — the plain fire, the cap
// behind it. `small` and `big` are the words the rules used until 2026-09-06
// and a model may still reach for them.
// The first complete JSON object in a text, by counting braces outside
// strings: where it ends, or -1 when it never closes.
function objectEnd(raw) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ⚠️ Measured 2026-09-15 (§14, probes/probe-v41-language.mjs): about one
// sizing in eight of a whole-game ask closes its object right after the
// pieces and then carries on — `…}]},"summary":"…","assumptions":[…]}` —
// which JSON.parse refuses whole, and an unparseable sizing is a plain fire
// at the builder's level on the one ask where that runs away. Two repairs,
// in order: take the early `}` out and read the whole thing, which keeps the
// summary and the assumptions; failing that, read the first object alone.
function salvage(raw) {
  const end = objectEnd(raw);
  if (end < 0 || end === raw.length - 1) return null;
  const rest = raw.slice(end + 1).trim();
  if (rest.startsWith(',')) {
    try { return JSON.parse(raw.slice(0, end) + rest); } catch { /* the first object alone, below */ }
  }
  try { return JSON.parse(raw.slice(0, end + 1)); } catch { return null; }
}

export function parseSizing(text) {
  const raw = String(text ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    obj = salvage(raw);
    if (obj === null) return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const size = { small: 'reply', big: 'pieces' }[obj.size] ?? obj.size;
  if (size === 'reply') return { size: 'reply', resume: obj.resume !== false };
  const list = obj.pieces ?? obj.steps;
  if (size !== 'pieces' || !Array.isArray(list)) return null;
  const pieces = cleanPieces(list);
  // One piece is a plan of one — the common case. None is a remark.
  if (pieces.length === 0) return { size: 'reply', resume: true };
  return {
    size: 'pieces',
    pieces,
    // Whether the request said what to change. Only a one-piece answer
    // carries it, and it is `null` when the answer left it off — which it
    // does on about three one-piece answers in ten (§14). Null means "not
    // said", and every reader falls back to what it did before rather than
    // guessing, so the key is never load-bearing.
    clear: typeof obj.clear === 'boolean' ? obj.clear : null,
    summary: clip(String(obj.summary ?? '').trim(), MAX_SUMMARY),
    assumptions: cleanAssumptions(obj.assumptions),
  };
}

// The shapes a plan's words are held to, whoever wrote them — the planner or
// a person editing the card. Every string clipped, every list capped, and
// studio/ never a file to write.
const MAX_SUMMARY = 600;
const MAX_ASSUMPTION = 200;
const MAX_ASSUMPTIONS = 8;
export function cleanPieces(list) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      title: clip(String(p.title ?? '').trim(), MAX_TITLE) || 'A piece of the game',
      files: (Array.isArray(p.files) ? p.files : [])
        .filter((f) => typeof f === 'string' && f.trim() && !/^studio\//.test(f.trim()))
        .map((f) => f.trim())
        .slice(0, MAX_FILES_PER_PIECE),
      what: clip(String(p.what ?? '').trim(), MAX_WHAT),
    }))
    .slice(0, MAX_PIECES);
}
export function cleanAssumptions(list) {
  return (Array.isArray(list) ? list : [])
    .map((a) => clip(String(a ?? '').trim(), MAX_ASSUMPTION))
    .filter(Boolean)
    .slice(0, MAX_ASSUMPTIONS);
}
export const cleanSummary = (text) => clip(String(text ?? '').trim(), MAX_SUMMARY);

// ⚠️ A plan comes back with its words in Chinese now and then — files and
// shape right, titles a kid cannot read — and the obvious fix, a line in the
// rules naming the language, was measured and made it worse (§14,
// 2026-09-15: 1 in 35 without it, 4 in 42 with). So the check is on the
// answer rather than in the rules: any of a plan's words in a script the
// request has none of, and one re-ask on the same transcript. The scripts
// are the ones probes/probe-v41-language.mjs counted as "not English"; a
// request written in one of them is answered in it, unchecked.
const OTHER_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}]/u;
export function inOtherScript(sized, request) {
  if (sized?.size !== 'pieces' || OTHER_SCRIPT.test(request)) return false;
  return [
    ...sized.pieces.flatMap((p) => [p.title, p.what]),
    sized.summary, ...sized.assumptions,
  ].some((w) => OTHER_SCRIPT.test(w));
}
export const SCRIPT_TRIGGER = [
  '[studio] That answer is written in a different script from the person\'s message. Answer again —',
  'the same JSON, the same pieces — with every title, what, summary and assumption written the way',
  'the person writes.',
].join('\n');

// The one user turn a piece's fire gets: the request, the plan, what the
// earlier pieces left, and this piece alone. Measured (§14): at this scope a
// fire thinks in proportion to the piece and writes only its files.
export function pieceTurn({
  request, pieces, index, summary = '', assumptions = [],
}) {
  const n = pieces.length;
  const piece = pieces[index];
  const lines = [`[studio] The request: "${request}"`];
  // The plan's words as the person approved them — the summary and the
  // decisions — are what a piece builds to; its file list is advisory.
  if (summary) lines.push('', `What it is: ${summary}`);
  if (assumptions.length) lines.push('', 'Decided:', ...assumptions.map((a) => `- ${a}`));
  lines.push(
    '',
    n === 1 ? 'It is one piece:' : `It was split into ${n} pieces:`,
    ...pieces.map((p, i) => `${i + 1}. ${p.title} — ${p.files.join(', ')}`),
  );
  const done = pieces.filter((p, i) => i < index && p.status === 'done' && p.note);
  if (done.length) lines.push('', 'Done so far:', ...done.map((p) => `- ${p.title}: ${p.note}`));
  lines.push(
    '',
    `This reply is piece ${index + 1} of ${n}: ${piece.title} (${piece.files.join(', ')}). ${piece.what}`,
    'Do only this piece, then stop with one short paragraph saying what you made and what to try — that',
    'paragraph is what the person reads. The other pieces are later replies.',
    'Numbers and words this piece brings in go in config/ with a comment, never in js/: a piece is not done',
    'while a constant sits in game code.',
  );
  return lines.join('\n');
}

// A piece's headline: the closing paragraph of its reply, which is what the
// card shows for it and what history replays (spec.md §8). Clipped so a wall
// cannot become a card.
const MAX_HEADLINE = 400;
export function headline(text) {
  const whole = String(text ?? '').trim();
  if (!whole) return '';
  const cut = whole.lastIndexOf('\n\n');
  return clip(cut >= 0 ? whole.slice(cut + 2).trim() : whole, MAX_HEADLINE);
}

// The plan card's text: what the thread shows and a later fire reads as the
// builder's own words, rewritten as the plan moves — its head by status, the
// summary and the assumptions as the person approved them, then each piece's
// title, the files it changed (until then, the files it was to touch) and its
// headline. `begun` is a plan for the rest of something a fire started on and
// could not finish in one go.
export function planBody(pieces, {
  begun = false, status = 'running', summary = '', assumptions = [],
} = {}) {
  const n = pieces.length;
  const done = pieces.filter((p) => p.status === 'done').length;
  const rest = `${n} piece${n === 1 ? '' : 's'}`;
  const head = {
    draft: begun
      ? `That's more than one go — here's the rest in ${rest}. Change anything, then press Build it.`
      : `That's a big one — here's my plan in ${rest}. Change anything, then press Build it.`,
    queued: 'Building…',
    running: begun
      ? `That's more than one go — here's the rest in ${rest}:`
      : (n === 1 ? 'One piece:' : `That's a big one — I'll do it in ${n} pieces:`),
    done: n === 1 ? 'Done:' : `Done, in ${n} pieces:`,
    paused: `Paused after ${done} of ${n}:`,
    dropped: `Set aside after ${done} of ${n}:`,
  }[status] ?? `${rest}:`;
  return [
    head,
    summary || null,
    assumptions.length ? ['Assuming:', ...assumptions.map((a) => `- ${a}`)].join('\n') : null,
    ...pieces.map((p, i) => {
      const files = p.writes?.length ? p.writes : p.files;
      return `${i + 1}. ${p.title} — ${files.join(', ')}${p.note ? `\n   ${p.note}` : ''}`;
    }),
  ].filter(Boolean).join('\n');
}

// The Build press, as the request the pieces then extend (spec.md §8, §14):
// a plan built as written gets a short confirmation — the plan is the card
// above, in the transcript already — and one the person changed is sized
// again over their words, which the answer is told to keep.
export const CONFIRM_TRIGGER = '[studio] Build the plan above as written. Answer {"ok":true}.';
export function resizeTrigger({ summary, assumptions, pieces }) {
  return [
    '[studio] The person changed the plan. Here it is now:',
    summary ? `What it is: ${summary}` : null,
    assumptions.length ? ['Decided:', ...assumptions.map((a) => `- ${a}`)].join('\n') : null,
    ...pieces.map((p, i) => `${i + 1}. ${p.title}${p.files.length ? ` — ${p.files.join(', ')}` : ''}: ${p.what}`),
    '',
    'Answer with JSON only: {"size":"pieces","pieces":[{"title":"…","files":["…"],"what":"…"}]} — these',
    'pieces in this order with their words kept as written, each with the files it will touch filled in.',
    'Split a piece only when it is too big for one sitting.',
  ].filter((l) => l !== null).join('\n');
}

// SPEC.md as the plan's words, written once on a game's first Build (spec.md
// §8): the decisions a person approved, in the file every later fire reads.
export function specText({ name, request, summary, assumptions, pieces }) {
  return [
    `# ${name}`,
    '',
    summary || request,
    '',
    ...(assumptions.length ? ['## Decisions', '', ...assumptions.map((a) => `- ${a}`), ''] : []),
    '## Plan',
    '',
    ...pieces.map((p, i) => `${i + 1}. ${p.title}${p.files.length ? ` — ${p.files.join(', ')}` : ''}: ${p.what}`),
    '',
  ].join('\n');
}

// A capped trace handed to the retry of the same turn. Measured (§14): the
// retry without it under-delivers, the retry with it follows the design.
export function handoffNote(trace) {
  return [
    '[studio] You were stopped after thinking for a long time with nothing written yet. Below is what',
    'you had worked out before you were stopped. Do not start over and do not repeat it back: pick up',
    'from where it ends and write the files.',
    '',
    '--- your notes so far ---',
    trace,
    '--- end of notes ---',
  ].join('\n');
}

// What a small ask did before it ran out of turns, handed to the sizing call
// the same way — ahead of the ask — so what is left is planned from where it
// stopped. The planner's file block is the fire's, from before the fire wrote
// (the cache prefix), so the files that changed are named here rather than
// shown.
export function begunNote({ changed, said }) {
  const lines = [
    '[studio] A helper already began on this and used up its turns before finishing. What it changed',
    'is on disk now, so do not plan that again — plan the rest.',
    changed.length ? `Files it changed: ${changed.join(', ')}` : 'It changed no files.',
  ];
  if (said) lines.push('', '--- what it said while working ---', said, '--- end ---');
  return lines.join('\n');
}

// The same trace handed to the sizing call instead, ahead of its ask.
export function notesForPlanner(trace) {
  return [
    '[studio] A helper already thought about this for a while before being stopped. Its notes are',
    'below; use them to shape the pieces, and keep the decisions it had reached.',
    '',
    '--- notes ---',
    trace,
    '--- end of notes ---',
  ].join('\n');
}
