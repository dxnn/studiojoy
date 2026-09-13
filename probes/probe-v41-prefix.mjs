// The 6 K prefix rule, re-taken on deepseek-flash (V4.1).
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-prefix.mjs > probes/probe-v41-prefix.out 2>&1
//
// §14's rule, measured 2026-09-06 on deepseek-v4-flash (retired 2026-09-10):
// when the last user message of a request is ≤ ~110 tokens the next request
// extending it reuses everything to the end of the system prompt (95–96%);
// at ≥ ~160 tokens it loses a constant ~6,000 tokens of the system prompt
// before it (48–50% on a 12.5 K prompt). The constant did not move between
// 6.5 K and 59 K prompts.
//
// The builder's second chapter is shaped entirely around this: the sizing
// rules live in the system prompt and the last message is a short trigger,
// because the ask itself was 250 tokens and cost the fire half its prompt.
//
//   L1  the length scan on space-racer's ~12.5 K prompt: 32, 86, 111, 128,
//       145, 161, 261, 512, 1024 tokens on the last user message, then the
//       request that extends it. Is there still a cliff, and where?
//   L2  the same short/long pair on a padded ~40 K prompt. If the loss is
//       still a constant it is ~6 K there too; if it is a fraction it is not.
//
// The old probes (probe-extension-*.mjs) cannot be re-run: they import
// sizingAsk, which the second chapter replaced with sizingRules and
// sizingTrigger. This one depends on nothing that moves.

import {
  complete, preamble, fileBlock, blockOf, TOOLS, u, a, MODEL,
} from './probe-lib.mjs';

const SMALL = 'make the ship turn a bit faster';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const files = fileBlock('games/space-racer');

const row = (label, r) => console.log(`${label.padEnd(26)} ${r.ok
  ? `total ${String(r.total).padStart(6)}  hit ${String(r.hit).padStart(6)}  `
    + `miss ${String(r.miss).padStart(6)}  ${String(r.pct).padStart(3)}%  `
    + `out ${String(r.out).padStart(4)}`
  : `HTTP ${r.status} ${r.error}`}`);

// A last user message of roughly n tokens, at ~3.5 characters a token.
const SENTENCE = 'The ship should turn a little faster than it does now, and the rest of the game should stay exactly as it is. ';
const prose = (tokens) => SENTENCE.repeat(Math.ceil((tokens * 3.5) / SENTENCE.length));

const first = (system, q) => complete({
  system, messages: [q], tools: null, effort: 'none', maxTokens: 64,
});
const extend = (system, q, text) => complete({
  system,
  messages: [q, a(text), u('[studio] Go ahead.')],
  tools: TOOLS,
  effort: 'none',
  maxTokens: 64,
});

// One arm: a fresh prefix (the salt), a first request whose last message is
// `tokens` long, then the request that extends it. The second number is the
// one that matters.
async function arm(system, label, tokens) {
  const q = u(`[Dann] ${SMALL}\n\n[studio] ${prose(tokens)}`
    + 'Say one short sentence about how you would do it. No tools.');
  const f = await first(system, q);
  row(`${label} first`, f);
  if (!f.ok) return null;
  const e = await extend(system, q, f.text);
  row(`${label} ext`, e);
  return e.ok ? { total: e.total, hit: e.hit, lost: e.total - e.hit } : null;
}

console.log(`${MODEL} — the 6 K prefix rule, re-taken\n`);

console.log(`L1 — space-racer's prompt, nine last-message lengths`);
const scan = [];
for (const tokens of [32, 86, 111, 128, 145, 161, 261, 512, 1024]) {
  const system = `Run ${STAMP} · Arm L1 ${tokens}.\n\n${preamble('Space Racer')}\n\n${files}`;
  const r = await arm(system, `L1 ~${String(tokens).padStart(4)}`, tokens);
  if (r) scan.push({ tokens, ...r });
}
console.log('\n  tokens on last message → tokens of prompt not reused by the extension');
for (const r of scan) {
  console.log(`  ~${String(r.tokens).padStart(4)}  prompt ${String(r.total).padStart(6)}  `
    + `not reused ${String(r.lost).padStart(6)}`);
}

// A padded prompt: the same preamble and tree, plus synthetic files, to about
// 40 K tokens. If the loss is a constant it is the same number of tokens here.
const filler = blockOf(Object.fromEntries(Array.from({ length: 24 }, (_, i) => [
  `js/filler-${i}.js`,
  `// Part ${i} of the game's drawing code.\n`
    + Array.from({ length: 90 }, (_, j) =>
      `const step${j} = (t) => Math.sin(t * ${j + 1}) * ${(i + 1) * 3} + ${j};`).join('\n'),
])));

console.log('\nL2 — the same pair on a padded prompt');
for (const tokens of [86, 512]) {
  const system = `Run ${STAMP} · Arm L2 ${tokens}.\n\n${preamble('Space Racer')}\n\n${files}\n\n${filler}`;
  const r = await arm(system, `L2 ~${String(tokens).padStart(4)}`, tokens);
  if (r) {
    console.log(`  ~${String(tokens).padStart(4)}  prompt ${String(r.total).padStart(6)}  `
      + `not reused ${String(r.lost).padStart(6)}`);
  }
}
