// The sizing's answer, read defensively: response_format is a belt, and what
// arrives still has fences, sentences and — measured 2026-09-15 — an object
// closed early with the rest of the keys trailing after it. Null is "could
// not size it", which the orchestrator treats as a plain fire; on a
// whole-game ask that is the runaway case (spec/ §14), so every shape that
// can be read has to be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseSizing, parseClear, sizingRules, inOtherScript,
} from '../server/agents/sizing.js';

const PLAN = {
  size: 'pieces',
  pieces: [
    { title: 'Game shell', files: ['index.html', 'js/main.js'], what: 'The page and the loop.' },
    { title: 'Tanks', files: ['js/tank.js'], what: 'Two tanks that drive.' },
  ],
  summary: 'A tank game.',
  assumptions: ['Two players on one keyboard.'],
};

test('a plain answer, a fenced one and a reply all read', () => {
  const plain = parseSizing(JSON.stringify(PLAN));
  assert.equal(plain.size, 'pieces');
  assert.equal(plain.pieces.length, 2);
  assert.equal(plain.summary, 'A tank game.');
  assert.deepEqual(plain.assumptions, ['Two players on one keyboard.']);
  const fenced = parseSizing(`\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\``);
  assert.deepEqual(fenced, plain);
  assert.deepEqual(parseSizing('{"size":"reply"}'), { size: 'reply', resume: true });
  assert.deepEqual(parseSizing('{"size":"reply","resume":false}'), { size: 'reply', resume: false });
  // The words the rules used until 2026-09-06 still land.
  assert.equal(parseSizing('{"size":"small"}').size, 'reply');
  assert.equal(parseSizing('{"size":"big","steps":[{"title":"a","files":[],"what":"b"}]}').size, 'pieces');
});

// ⚠️ The measured failure: the object closed after `pieces`, the summary and
// the assumptions written on after it as if it had not been.
test('an object closed early with its keys trailing is read whole', () => {
  const early = JSON.stringify(PLAN).replace('],"summary"', ']},"summary"');
  // Sanity: this really is what JSON.parse refuses.
  assert.throws(() => JSON.parse(early));
  const read = parseSizing(early);
  assert.ok(read, 'salvaged');
  assert.equal(read.size, 'pieces');
  assert.equal(read.pieces.length, 2);
  assert.equal(read.summary, 'A tank game.', 'the summary survives the repair');
  assert.deepEqual(read.assumptions, ['Two players on one keyboard.']);
});

test('the real one that would not parse reads, summary and all', () => {
  const kept = new URL('../probes/probe-v41-language-unparseable.json', import.meta.url);
  const raw = fs.readFileSync(kept, 'utf8');
  assert.throws(() => JSON.parse(raw));
  const read = parseSizing(raw);
  assert.equal(read.size, 'pieces');
  assert.ok(read.pieces.length >= 2);
  assert.match(read.summary, /two-player tank game/i);
  assert.ok(read.assumptions.length >= 2);
});

test('a first object followed by something that is not its own tail is read alone', () => {
  const twice = `${JSON.stringify(PLAN)} ${JSON.stringify({ size: 'reply' })}`;
  const read = parseSizing(twice);
  assert.equal(read.size, 'pieces');
  assert.equal(read.pieces.length, 2);
  // And prose is still prose.
  assert.equal(parseSizing('I would make this in three pieces.'), null);
  assert.equal(parseSizing('{"size":"pieces","pieces":[{"title":"a"'), null, 'never closed');
  assert.equal(parseSizing(''), null);
});

test('the clear key is read only when it is a boolean', () => {
  assert.equal(parseClear('{"clear": true}'), true);
  assert.equal(parseClear('{"clear": false}'), false);
  assert.equal(parseClear('{"clear": "yes"}'), null);
  assert.equal(parseClear('nope'), null);
});

// ⚠️ Measured and withdrawn (spec/ §14, 2026-09-15): a line telling the sizing
// to answer in the person's language went in, and plans came back in Chinese
// four times in 42 with it against once in 35 without. Naming the language
// primes the switch. This holds the door shut against the obvious fix.
test('the rules do not name a language', () => {
  assert.ok(!/language/i.test(sizingRules()));
});

// The check that replaces that line: a plan's words in a script the request
// has none of. The request's own script is never a slip.
test('a plan in a script the request has none of is caught; the request\'s own is not', () => {
  const chinese = {
    ...PLAN,
    pieces: [{ title: '游戏骨架与双人分屏', files: ['index.html'], what: '页面与分屏。' }],
  };
  assert.equal(inOtherScript(chinese, '[Dann] build me a tank game'), true);
  assert.equal(inOtherScript(chinese, '[Dann] 给我做一个坦克游戏'), false);
  assert.equal(inOtherScript(PLAN, '[Dann] build me a tank game'), false);
  // One word is enough, wherever it sits.
  assert.equal(inOtherScript({ ...PLAN, summary: '双人坦克游戏' }, 'tanks'), true);
  assert.equal(inOtherScript({ ...PLAN, assumptions: ['Один клавиатура.'] }, 'tanks'), true);
  // Accents, symbols and emoji are not another script.
  const accented = { ...PLAN, pieces: [{ title: 'Café ☕ und Straße — ¡olé!', files: [], what: 'ok' }] };
  assert.equal(inOtherScript(accented, 'tanks'), false);
  // Nothing but a plan is checked.
  assert.equal(inOtherScript({ size: 'reply', resume: true }, 'tanks'), false);
  assert.equal(inOtherScript(null, 'tanks'), false);
});
