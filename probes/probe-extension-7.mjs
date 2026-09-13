// One-off, after probe-extension-6.mjs. Six probes in, the one thing every
// 50% case shares is the last user message: the ~250-token sizing ask. Every
// 95% case had a short last message (~40–50 tokens), JSON braces or not, json
// mode or not, whatever max_tokens, however it stopped. So: does the length
// of the last user message decide how much of the prompt the next request can
// reuse — and is there a threshold?
//
//   J1  a prose last message of ~32, 64, 128, 192, 256, 384, 512, 1024 tokens,
//       then the extension.
//   J2  a short last message that is nothing but JSON shapes, then the extension.
//   J3  the sizing ask with its JSON shapes described in words, same length.
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-extension-7.mjs > tmp/probe-extension-7.out 2>&1

import { complete, preamble, fileBlock, TOOLS, u, a } from './probe-lib.mjs';
import { sizingAsk } from '../server/agents/sizing.js';

const SMALL = 'make the ship turn a bit faster';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const files = fileBlock('games/space-racer');
const system = (arm) => `Run ${STAMP} · Arm ${arm}.\n\n${preamble('Space Racer')}\n\n${files}`;
const row = (label, r) => console.log(`${label.padEnd(30)} ${r.ok
  ? `total ${String(r.total).padStart(6)}  hit ${String(r.hit).padStart(6)}  miss ${String(r.miss).padStart(6)}  ${String(r.pct).padStart(3)}%  out ${String(r.out).padStart(5)}  ${r.finish ?? ''}`
  : `HTTP ${r.status} ${r.error}`}`);
const first = (sys, q) => complete({ system: sys, messages: [q], tools: null, effort: 'none', maxTokens: 64 });
const ext = (sys, q, text) => complete({
  system: sys, messages: [q, a(text), u('[studio] Go ahead.')], tools: TOOLS, effort: 'none', maxTokens: 64,
});

const SENTENCE = 'The ship should turn a little faster than it does now, and the rest of the game should stay exactly as it is. ';
const prose = (tokens) => SENTENCE.repeat(Math.ceil((tokens * 3.5) / SENTENCE.length));

console.log('J1 — a prose last message of eight lengths, then the extension');
for (const tokens of [32, 64, 128, 192, 256, 384, 512, 1024]) {
  const sys = system(`J1 ${tokens}`);
  const q = u(`[Dann] ${SMALL}\n\n[studio] ${prose(tokens)}Say one short sentence about how you would do it. No tools.`);
  const f = await first(sys, q); row(`J1 ~${tokens} first`, f);
  row(`J1 ~${tokens} ext`, await ext(sys, q, f.text));
}

console.log('\nJ2 — a short last message that is only JSON shapes');
{
  const sys = system('J2');
  const q = u(`[Dann] ${SMALL}\n\n[studio] Answer with JSON only: {"size":"small"} or {"size":"big","pieces":[{"title":"…","files":["…"],"what":"…"}]}`);
  const f = await first(sys, q); row('J2 json shapes first', f);
  row('J2 json shapes ext', await ext(sys, q, f.text));
}

console.log('\nJ3 — the sizing ask with the shapes in words, same length');
{
  const sys = system('J3');
  const worded = sizingAsk()
    .replace('{"size":"small"}', 'the word small')
    .replace('{"size":"big","pieces":[{"title":"…","files":["…"],"what":"…"}]}', 'the word big and a list of pieces with a title, files and what');
  const q = u(`[Dann] ${SMALL}\n\n${worded}`);
  const f = await first(sys, q); row('J3 worded ask first', f);
  row('J3 worded ask ext', await ext(sys, q, f.text));
}
