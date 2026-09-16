// What the tiny judge says to a whole-game ask.
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-judge-whole.mjs > probes/probe-v41-judge-whole.out 2>&1
//
// Since 2026-09-13 every open room takes its thinking from the ask: one call
// on CLEAR_JUDGE (server/agents/sizing.js), and `clear: true` fires at `none`
// where anything else keeps the helper's level. It was measured on
// space-racer's small asks (probe-v41-symptom.mjs, 26 of 27) and never on the
// ask the cap is about: a whole game from an empty tree, where `low` runs
// away 15 times in 16 and costs ~43 s before the retry (probe-v41-rate.mjs).
// So: whole-game and other big open asks, several times each, the judge's
// shipped wording byte for byte. `true` on these means an open room never
// pays the detour for them; `false` means it does, and the TODO line about
// sizing an open request the way Building does stands.
//
// ⚠️ What it found (2026-09-15, `probe-v41-judge-whole.out`): `clear: true`
// 12 of 40, `false` 28, unsaid 0. The tank ask 1 of 5, "make a game",
// "make a racing game", the frog platformer and "something fun to play with
// my brother" 0 of 5 each; only the split-screen ask was `true` every time.
// So an open room fires a whole-game ask at `low` more often than not, and
// pays the detour. The judge is right by its own definition — a game from
// nothing is the ask where what to change has most to be worked out — which
// is why the fix is a decision (TODO.md) and not a wording change here.

import { complete, TASK, u, MODEL } from './probe-lib.mjs';
import { CLEAR_JUDGE, CLEAR_MAX_TOKENS, parseClear } from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 5);
const ASKS = [
  ['tank', TASK],
  ['frog', 'make me a platformer where a frog eats flies'],
  ['dragon', 'I want a game like flappy bird but with a dragon'],
  ['racing', 'make a racing game'],
  ['agame', 'make a game'],
  ['quiz', 'build a quiz about dinosaurs'],
  ['splitscreen', 'add a second player with split screen so two people can race each other'],
  ['brother', 'make me something fun to play with my brother'],
];

const mark = (c) => (c === null ? '·' : c ? 'Y' : 'n');
let yes = 0;
let no = 0;
let none = 0;
let prompt = 0;
let calls = 0;

console.log(`${MODEL}, CLEAR_JUDGE as shipped, max_tokens ${CLEAR_MAX_TOKENS}, ${REPS} a row\n`);
for (const [key, text] of ASKS) {
  const marks = [];
  for (let rep = 0; rep < REPS; rep += 1) {
    const r = await complete({
      system: CLEAR_JUDGE,
      messages: [u(text)],
      tools: null,
      effort: 'none',
      maxTokens: CLEAR_MAX_TOKENS,
      extra: { response_format: { type: 'json_object' } },
    });
    if (!r.ok) { marks.push('E'); continue; }
    calls += 1;
    prompt += r.total;
    const clear = parseClear(r.text);
    marks.push(mark(clear));
    if (clear === true) yes += 1;
    else if (clear === false) no += 1;
    else none += 1;
  }
  console.log(`${key.padEnd(12)} ${marks.join('')}   ${text}`);
}
console.log(`\nclear: true ${yes}, false ${no}, unsaid ${none}, of ${calls}`);
console.log(`prompt ${Math.round(prompt / Math.max(1, calls))} tokens a call`);
