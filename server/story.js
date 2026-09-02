// The story's two small asks: the **fill** — lines from a sentence about what
// happens — and the model-drawn **stand-in**, a flat SVG the studio turns into
// the PNG the story already expects.
//
// Neither is a fire. No helper row, no chat, no message, no receipt, no
// eligibility, no cooldown, no tools, no transcript and no file block: one
// request built from the story itself, one answer, nothing kept. Server-side
// because the key never reaches a browser, and through the same two walls
// every reply goes through — the studio's budget and the presser's own
// allowance — billed to whoever pressed the button (spec.md §6, §10).
//
// ⚠️ The story comes up from the browser rather than off the disk. The guide
// works on the unsaved model — the scene it is asking about is usually one
// the author made a moment ago and Save is a commit, so a disk read would be
// asking about a scene that is not there yet. It is the author's own words
// going into a prompt billed to them, so the trust is theirs either way; what
// matters is that it is bounded, and every field below is cut to a cap rather
// than refused.

import { HttpError } from './http/respond.js';
import { tokensCharged } from './llm/deepseek.js';
import {
  hasBudget, consumeBudget, studioLimit, userHasBudget, chargeUser,
  DEFAULT_DAILY_TOKEN_BUDGET,
} from './budget.js';

// What one ask may carry and what it may bring back. Small on purpose: this
// is a paragraph of a story and a few shapes, not a game.
export const SENTENCE_CHARS = 500;
export const ABOUT_CHARS = 200;
export const NAME_CHARS = 100;
export const SAY_CHARS = 500;
export const CAST_MAX = 20;
export const LINES_MAX = 40;
export const FILL_MAX = 12;
export const SVG_BYTES = 20 * 1024;

const FILL_TOKENS = 1024;
const PICTURE_TOKENS = 2048;

// Portraits and backdrops, at the sizes the guide's plain card already uses.
export const KINDS = {
  portrait: { width: 128, height: 128, what: 'a portrait of one person, head and shoulders, facing forward' },
  background: { width: 480, height: 270, what: 'a background: a place, with nobody in it' },
};

const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/* The walls ---------------------------------------------------------------- */

// One ask, through both walls and charged to the presser. The walls are
// checked before the request and the charge lands after it, exactly as a
// fire's do (spec.md §10) — an ask that fails upstream costs nothing because
// no usage ever arrives.
async function ask(ctx, user, request) {
  const { db, llm } = ctx;
  if (!llm?.complete) {
    throw new HttpError(503, 'the studio cannot ask for that just now');
  }
  if (!hasBudget(db, studioLimit(db, DEFAULT_DAILY_TOKEN_BUDGET))) {
    throw new HttpError(429, 'the studio is out of tokens for today. It starts again tomorrow');
  }
  if (!userHasBudget(db, user)) {
    throw new HttpError(429, "you have used up today's tokens. It starts again tomorrow");
  }

  let answer;
  try {
    answer = await llm.complete(request);
  } catch (err) {
    throw new HttpError(502, `the studio could not ask for that: ${err.message}`);
  }

  const charged = tokensCharged(answer.usage);
  consumeBudget(db, charged);
  chargeUser(db, user.id, charged);
  return { ...answer, charged };
}

// The answer as JSON, however it came back. A model asked for JSON often
// wraps it in a fence and sometimes says a sentence first, so the outermost
// braces are what count. Anything that will not parse is the caller's to
// report — both of these have a fallback that costs nothing.
function asJson(text) {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from === -1 || to <= from) return null;
  try {
    return JSON.parse(text.slice(from, to + 1));
  } catch {
    return null;
  }
}

/* The fill ----------------------------------------------------------------- */

// Who is in the story and what is known about them, as the prompt sees it.
// `about` is the one key the game never reads and this is what it is for.
function castBlock(cast) {
  if (!cast.length) return 'Nobody is in the story yet.';
  return cast
    .map((p) => `- ${p.key}${p.name && p.name !== p.key ? ` (${p.name})` : ''}`
      + (p.about ? `: ${p.about}` : ''))
    .join('\n');
}

const FILL_SYSTEM = `You write lines of dialogue for a short visual novel made by a child.

Answer with JSON and nothing else, in this shape:
{"lines": [{"who": "<a key from the cast, or \\"\\" for the story narrating>", "say": "<one line>"}]}

Rules:
- Between two and six lines. Short ones: a sentence each, the way people talk.
- "who" must be one of the cast keys given, exactly, or "" for narration.
- Plain, warm, everyday language. Nothing frightening, nothing romantic.
- No stage directions, no asterisks, no names prefixed to the words.`;

export async function fillLines(ctx, user, body) {
  const sentence = clip(body?.sentence, SENTENCE_CHARS);
  if (!sentence) throw new HttpError(400, 'say what happens first');

  const cast = (Array.isArray(body?.cast) ? body.cast : [])
    .slice(0, CAST_MAX)
    .filter((p) => typeof p?.key === 'string' && p.key)
    .map((p) => ({
      key: clip(p.key, NAME_CHARS),
      name: clip(p.name, NAME_CHARS),
      about: clip(p.about, ABOUT_CHARS),
    }));
  const said = (Array.isArray(body?.lines) ? body.lines : [])
    .slice(-LINES_MAX)
    .filter((l) => typeof l?.say === 'string')
    .map((l) => ({ who: clip(l.who, NAME_CHARS), say: clip(l.say, SAY_CHARS) }));
  const place = clip(body?.scene?.key, NAME_CHARS) || 'this scene';
  const about = clip(body?.scene?.about, ABOUT_CHARS);

  const prompt = [
    `The cast:\n${castBlock(cast)}`,
    `The scene is called ${place}.${about ? ` ${about}` : ''}`,
    said.length
      ? `Said in this scene already:\n${said.map((l) => `- ${l.who || 'the story'}: ${l.say}`).join('\n')}`
      : 'Nothing has been said in this scene yet.',
    `What happens: ${sentence}`,
  ].join('\n\n');

  const answer = await ask(ctx, user, {
    system: FILL_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: FILL_TOKENS,
  });

  // ⚠️ A `who` the cast does not hold would be a line said by nobody — a
  // check the story editor would flag and an author would have to chase. An
  // invented speaker becomes the story narrating instead, which is always a
  // valid line.
  const keys = new Set(cast.map((p) => p.key));
  const parsed = asJson(answer.text);
  const lines = (Array.isArray(parsed?.lines) ? parsed.lines : [])
    .filter((l) => typeof l?.say === 'string' && l.say.trim())
    .slice(0, FILL_MAX)
    .map((l) => ({
      who: keys.has(l.who) ? l.who : '',
      say: clip(l.say, SAY_CHARS),
    }));

  if (!lines.length) throw new HttpError(502, 'nothing usable came back — try saying it a different way');
  return { lines, tokens: answer.charged };
}

/* The stand-in ------------------------------------------------------------- */

const PICTURE_SYSTEM = `You draw simple flat SVG pictures for a child's game.

Answer with JSON and nothing else, in this shape:
{"svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 W H\\">…</svg>"}

Rules:
- The xmlns attribute and the viewBox are both required, at the size given.
- A dozen shapes at most: rect, circle, ellipse, path, polygon, line. Flat
  fills, no gradients, no filters, no images, no text, no script, no CSS.
- Use the colours given, and plain shades of them. Fill the whole viewBox.
- Simple and readable, not detailed. It is a stand-in until somebody draws
  the real one.`;

export async function drawPicture(ctx, user, body) {
  const kind = KINDS[body?.kind];
  if (!kind) throw new HttpError(400, 'kind must be portrait or background');
  const about = clip(body?.about, SENTENCE_CHARS);
  const name = clip(body?.name, NAME_CHARS);
  if (!about && !name) throw new HttpError(400, 'say what to draw');

  // The game's own four, when it has named them. A colour is checked here
  // rather than trusted: it goes into a prompt, but a prompt that carries
  // whatever a config file said is a prompt somebody else wrote.
  const colours = (Array.isArray(body?.colours) ? body.colours : [])
    .filter((c) => typeof c === 'string' && /^[#a-zA-Z0-9(),.%\s/-]{3,40}$/.test(c))
    .slice(0, 4);

  const prompt = [
    `Draw ${kind.what}.`,
    name ? `It is ${name}.` : null,
    about ? `What it looks like: ${about}` : null,
    `The viewBox is 0 0 ${kind.width} ${kind.height}.`,
    colours.length ? `The game's colours are ${colours.join(', ')}.` : null,
  ].filter(Boolean).join('\n');

  const answer = await ask(ctx, user, {
    system: PICTURE_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: PICTURE_TOKENS,
  });

  // What comes back is drawn in an <img>, where an SVG runs no scripts and
  // loads nothing — the same probe the .svg editor paints unsaved text with,
  // and what makes this safe to hand a browser at all (spec.md §7). This is
  // only the cheap refusal of an answer that plainly is not a picture; a
  // reply that will not draw falls back to the plain card either way.
  const parsed = asJson(answer.text);
  const svg = typeof parsed?.svg === 'string' ? parsed.svg.trim() : '';
  if (!svg.startsWith('<svg') || !svg.endsWith('</svg>')) {
    throw new HttpError(502, 'nothing that would draw came back');
  }
  if (Buffer.byteLength(svg) > SVG_BYTES) {
    throw new HttpError(502, 'what came back was too big to use');
  }

  return {
    svg, width: kind.width, height: kind.height, tokens: answer.charged,
  };
}
