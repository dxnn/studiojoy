// The sizing call, and the words around a plan (spec.md §8, §14; the
// measurements are tmp/probe-sizing.mjs and tmp/probe-trace-handoff.mjs).
//
// One call ahead of a fire in the builder's room: the fire's own system prompt,
// no tools, thinking off, and a JSON answer — `small`, or `big` with the
// pieces. The ask rides the last user message, after everything else on it,
// for two measured reasons: the system prompt stays byte-identical to the
// fire's and so shares its cache prefix, and a 35 K attachment placed ahead of
// the ask swamped it where the same ask placed after was answered every time.

export const MAX_PIECES = 6;
const MAX_FILES_PER_PIECE = 8;
const MAX_TITLE = 60;
const MAX_WHAT = 400;
// Plans ran to 800 tokens of JSON once in five at the measured size; this is
// the room a six-piece plan with two sentences each needs, with a margin.
export const SIZING_MAX_TOKENS = 1200;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function sizingAsk({ paused = null, begun = false } = {}) {
  const lines = [
    '[studio] Before anything is built, size this request. Answer with JSON only — no prose, no code fence:',
    '{"size":"small"} when it is one change a helper can make in one go — a value, a line, a bug, one',
    'file — or a question or a remark, which wants an answer rather than work.',
    '{"size":"big","pieces":[{"title":"…","files":["…"],"what":"…"}]} when it is more than that. Split it',
    `into 2 to ${MAX_PIECES} pieces, each a job one helper can finish in one sitting — a few files at most —`,
    'and each leaving the game runnable. "title" under 8 words; "what" is one or two sentences for the',
    'helper who will do that piece, saying what it makes and what it must not touch. Order the pieces so',
    'each builds on the last. Never name a file under studio/: that is the studio\'s and cannot be written.',
  ];
  if (paused) {
    const left = paused.pieces.filter((p) => p.status !== 'done');
    lines.push(
      '',
      'A plan was under way and was paused for this message. Its pieces still to do:',
      ...left.map((p, i) => `${i + 1}. ${p.title} — ${p.files.join(', ')}: ${p.what}`),
      'If the message is a remark or a question that changes nothing, answer {"size":"small","resume":true}',
      'and the plan carries on after your reply. If it says to stop, answer {"size":"small","resume":false}.',
      'If it changes the plan or asks for more, answer big with every piece still to do, changed as the',
      'message asks, the message\'s own work first when it is separate.',
    );
  }
  if (begun) {
    lines.push(
      '',
      'A helper has already begun on this — its notes are above. Size what is left, not the whole:',
      'small if one more go finishes it, big with the pieces still to do otherwise.',
    );
  }
  return lines.join('\n');
}

// Defensive on purpose: response_format is a belt, and a fence, a sentence
// first, or a shape with the wrong keys all still arrive. Null is "could not
// size it", which the caller treats as small — today's fire, the cap behind it.
export function parseSizing(text) {
  const raw = String(text ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  if (obj.size === 'small') return { size: 'small', resume: obj.resume !== false };
  const list = obj.pieces ?? obj.steps;
  if (obj.size !== 'big' || !Array.isArray(list)) return null;
  const pieces = list
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
  // One piece is a small ask that was written out longhand.
  if (pieces.length < 2) return { size: 'small', resume: true };
  return { size: 'big', pieces };
}

// The one user turn a piece's fire gets: the request, the plan, what the
// earlier pieces left, and this piece alone. Measured (§14): at this scope a
// fire thinks in proportion to the piece and writes only its files.
export function pieceTurn({ request, pieces, index }) {
  const n = pieces.length;
  const piece = pieces[index];
  const lines = [
    `[studio] The request: "${request}"`,
    '',
    `That was too big for one reply, so it was split into ${n} pieces:`,
    ...pieces.map((p, i) => `${i + 1}. ${p.title} — ${p.files.join(', ')}`),
  ];
  const done = pieces.filter((p, i) => i < index && p.status === 'done' && p.note);
  if (done.length) lines.push('', 'Done so far:', ...done.map((p) => `- ${p.title}: ${p.note}`));
  lines.push(
    '',
    `This reply is piece ${index + 1} of ${n}: ${piece.title} (${piece.files.join(', ')}). ${piece.what}`,
    'Do only this piece, then stop with a one-line note saying what you made. The other pieces are later',
    'replies.',
  );
  return lines.join('\n');
}

// The plan card's text: what the transcript keeps and a later fire reads as
// the builder's own words. `begun` is a plan for the rest of something a
// small fire started on and could not finish in one go.
export function planBody(pieces, { begun = false } = {}) {
  return [
    begun
      ? `That's more than one go — here's the rest in ${pieces.length} pieces:`
      : `That's a big one — I'll do it in ${pieces.length} pieces:`,
    ...pieces.map((p, i) => `${i + 1}. ${p.title} — ${p.files.join(', ')}`),
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
