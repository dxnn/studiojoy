// One-off, after probe-extension-2.mjs: an identical repeat of a 12.5 K
// prompt hits 99%; any request that extends it — the model's answer and one
// more user turn on top — hits about half (6,528 of 12,507), whether or not
// tools or json_object are involved and after a 20 s wait. So the request
// boundary is a unit only an identical request can use, and something else
// decides what an extension gets. Two questions:
//
//   F1  the chain: sizing → extension (about half) → a second extension on top
//       of the first. Does the second hit what the first established?
//   F2  the length scan: the same shape at ~3 K, 6 K, 12 K, 24 K and 48 K
//       tokens of system prompt. Is the extension's hit half the prompt, or a
//       fixed size?
//   F3  the first request's output: a request that answers with a paragraph
//       rather than five tokens, then the extension. Does output length move it?
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-extension-3.mjs > tmp/probe-extension-3.out 2>&1

import fs from 'node:fs';
import { complete, preamble, fileBlock, TOOLS, u, a } from './probe-lib.mjs';
import { sizingAsk, SIZING_MAX_TOKENS } from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 2);
const SMALL = 'make the ship turn a bit faster';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const salt = (arm) => `Run ${STAMP} · Arm ${arm}.`;
const row = (label, r) => console.log(`${label.padEnd(24)} ${r.ok
  ? `total ${String(r.total).padStart(6)}  hit ${String(r.hit).padStart(6)}  miss ${String(r.miss).padStart(6)}  ${String(r.pct).padStart(3)}%  out ${String(r.out).padStart(5)}  ${(r.ms / 1000).toFixed(1).padStart(5)}s`
  : `HTTP ${r.status} ${r.error}`}`);

const files = fileBlock('games/space-racer');
const ask = u(`[Dann] ${SMALL}\n\n${sizingAsk()}`);
const sizing = (system) => complete({
  system, messages: [ask], tools: null, effort: 'none', maxTokens: SIZING_MAX_TOKENS,
});
const extend = (system, messages) => complete({
  system, messages, tools: TOOLS, effort: 'none', maxTokens: 64,
});

// F1 — the chain.
console.log('F1 — sizing, extension, extension on the extension');
for (let rep = 1; rep <= REPS; rep += 1) {
  const system = `${salt(`F1 #${rep}`)}\n\n${preamble('Space Racer')}\n\n${files}`;
  const s = await sizing(system); row(`F1 sizing #${rep}`, s);
  const m1 = [ask, a(s.text), u('[studio] Go ahead.')];
  const e1 = await extend(system, m1); row(`F1 ext 1 #${rep}`, e1);
  const m2 = [...m1, a(e1.text || '(working)'), u('[studio] Now the next piece.')];
  const e2 = await extend(system, m2); row(`F1 ext 2 #${rep}`, e2);
  const m3 = [...m2, a(e2.text || '(working)'), u('[studio] And the one after.')];
  const e3 = await extend(system, m3); row(`F1 ext 3 #${rep}`, e3);
}

// F2 — the length scan. The block is real file text repeated under new
// names, so the tokens are prose-shaped rather than noise.
console.log('\nF2 — the extension against prompts of five sizes');
const game = fs.readFileSync('games/space-racer/js/game.js', 'utf8');
function padded(tokens) {
  const parts = [];
  let chars = 0;
  for (let k = 0; chars < tokens * 3.5; k += 1) {
    parts.push(`--- FILE: pad/part-${k}.js (${game.length} bytes) ---\n${game}\n--- END FILE ---`);
    chars += game.length + 60;
  }
  return parts.join('\n\n');
}
for (const tokens of [3000, 6000, 12000, 24000, 48000]) {
  const system = `${salt(`F2 ${tokens}`)}\n\n${preamble('Space Racer')}\n\n${padded(tokens - 700)}`;
  const s = await sizing(system); row(`F2 ~${tokens} sizing`, s);
  const e = await extend(system, [ask, a(s.text), u('[studio] Go ahead.')]); row(`F2 ~${tokens} ext`, e);
}

// F3 — a first request that says something.
console.log('\nF3 — the extension after a first request with a paragraph out');
for (let rep = 1; rep <= REPS; rep += 1) {
  const system = `${salt(`F3 #${rep}`)}\n\n${preamble('Space Racer')}\n\n${files}`;
  const q = u(`[Dann] ${SMALL}\n\n[studio] Before doing anything, say in one paragraph of about 150 words how you would do it. No tools.`);
  const first = await complete({ system, messages: [q], tools: null, effort: 'none', maxTokens: 600 });
  row(`F3 paragraph #${rep}`, first);
  const e = await extend(system, [q, a(first.text), u('[studio] Go ahead.')]); row(`F3 ext #${rep}`, e);
}
