// One-off, after probe-extension-5.mjs. Across five probes the extension
// after a first request hit 95–96% whenever that request's max_tokens was 600
// or less — 8, 16, 32, 48, 64, 128, 600 — whatever it said, however it
// stopped, json_object or not; and 48–52% whenever it was the sizing's 1,200,
// with the loss a constant ~6,000 tokens at every prompt size. So: does the
// first request's max_tokens decide how much of its input the next request
// can reuse?
//
//   I1  the sizing ask, plain, max_tokens 64 … 4800, then the extension.
//   I2  the paragraph ask at max_tokens 1200 and 2400, then the extension.
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-extension-6.mjs > tmp/probe-extension-6.out 2>&1

import { complete, preamble, fileBlock, TOOLS, u, a } from './probe-lib.mjs';
import { sizingAsk } from '../server/agents/sizing.js';

const SMALL = 'make the ship turn a bit faster';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const files = fileBlock('games/space-racer');
const system = (arm) => `Run ${STAMP} · Arm ${arm}.\n\n${preamble('Space Racer')}\n\n${files}`;
const row = (label, r) => console.log(`${label.padEnd(30)} ${r.ok
  ? `total ${String(r.total).padStart(6)}  hit ${String(r.hit).padStart(6)}  miss ${String(r.miss).padStart(6)}  ${String(r.pct).padStart(3)}%  out ${String(r.out).padStart(5)}  ${r.finish ?? ''}`
  : `HTTP ${r.status} ${r.error}`}`);
const ext = (sys, q, text) => complete({
  system: sys, messages: [q, a(text), u('[studio] Go ahead.')], tools: TOOLS, effort: 'none', maxTokens: 64,
});

console.log('I1 — the sizing ask at six max_tokens, then the extension');
const ask = u(`[Dann] ${SMALL}\n\n${sizingAsk()}`);
for (const max of [64, 300, 600, 900, 1200, 2400, 4800]) {
  const sys = system(`I1 ${max}`);
  const s = await complete({ system: sys, messages: [ask], tools: null, effort: 'none', maxTokens: max });
  row(`I1 max=${max} sizing`, s);
  row(`I1 max=${max} ext`, await ext(sys, ask, s.text));
}

console.log('\nI2 — the paragraph ask at a big max_tokens, then the extension');
const para = u(`[Dann] ${SMALL}\n\n[studio] Before doing anything, say in one short sentence how you would do it. No tools.`);
for (const max of [1200, 2400]) {
  const sys = system(`I2 ${max}`);
  const s = await complete({ system: sys, messages: [para], tools: null, effort: 'none', maxTokens: max });
  row(`I2 max=${max} first`, s);
  row(`I2 max=${max} ext`, await ext(sys, para, s.text));
}
