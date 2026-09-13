// One-off, after probe-extension-3.mjs. What is known by now:
//   - a request that extends the one before it misses a constant ~6,000 tokens
//     — the tail of the earlier request's input — at every prompt size (F2);
//   - unless the earlier request said enough: after a 173-token paragraph the
//     extension hit 95% (F3), after a 5-token `{"size":"small"}` it hit 50%;
//   - and a json_object request with a 304-token plan did not make its tail
//     reusable either (probe 1, arm B piece 1: 49%).
// So the recipe for the sizing call is what decides whether the fire after it
// hits. This pins it:
//
//   G1  plain first request cut at N output tokens, N in 8..128, then the
//       extension — where is the threshold?
//   G2  json_object first request with a long JSON answer, then the extension
//       — does json mode break it whatever the length?
//   G3  the production candidate: a plain sizing whose JSON carries a "why"
//       sentence, then today's fire shape and then the extension shape.
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-extension-4.mjs > tmp/probe-extension-4.out 2>&1

import { complete, preamble, fileBlock, TOOLS, u, a } from './probe-lib.mjs';
import { sizingAsk, SIZING_MAX_TOKENS } from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 2);
const SMALL = 'make the ship turn a bit faster';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const files = fileBlock('games/space-racer');
const system = (arm) => `Run ${STAMP} · Arm ${arm}.\n\n${preamble('Space Racer')}\n\n${files}`;
const row = (label, r) => console.log(`${label.padEnd(26)} ${r.ok
  ? `total ${String(r.total).padStart(6)}  hit ${String(r.hit).padStart(6)}  miss ${String(r.miss).padStart(6)}  ${String(r.pct).padStart(3)}%  out ${String(r.out).padStart(5)}  ${r.finish ?? ''}`
  : `HTTP ${r.status} ${r.error}`}`);
const ext = (sys, q, text) => complete({
  system: sys, messages: [q, a(text), u('[studio] Go ahead.')], tools: TOOLS, effort: 'none', maxTokens: 64,
});

console.log('G1 — a plain first request cut at N output tokens, then the extension');
const para = u(`[Dann] ${SMALL}\n\n[studio] Before doing anything, say in a few paragraphs how you would do it. No tools.`);
for (const n of [8, 16, 32, 48, 64, 128]) {
  const sys = system(`G1 ${n}`);
  const first = await complete({ system: sys, messages: [para], tools: null, effort: 'none', maxTokens: n });
  row(`G1 out=${n} first`, first);
  row(`G1 out=${n} ext`, await ext(sys, para, first.text));
}

console.log('\nG2 — a json_object first request with a long answer, then the extension');
const longJson = u(`[Dann] ${SMALL}\n\n[studio] Answer with JSON only: {"size":"small","notes":"…"} where notes is about 120 words on how you would do it.`);
for (let rep = 1; rep <= REPS; rep += 1) {
  const sys = system(`G2 #${rep}`);
  const first = await complete({
    system: sys, messages: [longJson], tools: null, effort: 'none', maxTokens: 600,
    extra: { response_format: { type: 'json_object' } },
  });
  row(`G2 json long #${rep}`, first);
  row(`G2 ext #${rep}`, await ext(sys, longJson, first.text));
}

console.log('\nG3 — the candidate: plain sizing with a "why" sentence, then both fire shapes');
const withWhy = u(`[Dann] ${SMALL}\n\n${sizingAsk()}\nAdd a "why" key: one sentence saying what makes it that size.`);
for (let rep = 1; rep <= REPS; rep += 1) {
  const sys = system(`G3 today #${rep}`);
  let s = await complete({ system: sys, messages: [withWhy], tools: null, effort: 'none', maxTokens: SIZING_MAX_TOKENS });
  row(`G3 sizing #${rep}`, s);
  console.log(`   → ${s.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  row(`G3 today's fire #${rep}`, await complete({
    system: sys, messages: [u(`[Dann] ${SMALL}`)], tools: TOOLS, effort: 'none', maxTokens: 64,
  }));
  const sys2 = system(`G3 ext #${rep}`);
  s = await complete({ system: sys2, messages: [withWhy], tools: null, effort: 'none', maxTokens: SIZING_MAX_TOKENS });
  row(`G3 sizing #${rep}`, s);
  row(`G3 extension fire #${rep}`, await ext(sys2, withWhy, s.text));
}
