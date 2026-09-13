// One-off, after probe-extension-4.mjs. Known: a first request cut off at 8
// output tokens, or answering 138 tokens of JSON, leaves its whole input
// reusable by an extension (95–96%). The real sizing — `{"size":"small"}`,
// five tokens, a natural stop — leaves only the first half (50%), and so did
// a 304-token plan in probe 1 (arm B piece 1, 49%). This pins what the fire
// after a sizing needs the sizing to look like.
//
//   H1  natural stops of four lengths, plain: one sentence, two, ~60 words,
//       ~100 words. Then the extension.
//   H2  the small ask, production shape (json_object), the ask changed so the
//       small answer carries "why" and "files". Then today's fire and the
//       extension fire.
//   H3  the big ask, production shape: the plan as the assistant turn — the
//       exact text, and the same JSON canonicalised — then piece 1's turn.
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-extension-5.mjs > tmp/probe-extension-5.out 2>&1

import { complete, preamble, fileBlock, TOOLS, u, a } from './probe-lib.mjs';
import {
  sizingAsk, parseSizing, pieceTurn, SIZING_MAX_TOKENS,
} from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 2);
const SMALL = 'make the ship turn a bit faster';
const BIG = 'add a second player with split screen';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const files = fileBlock('games/space-racer');
const system = (arm) => `Run ${STAMP} · Arm ${arm}.\n\n${preamble('Space Racer')}\n\n${files}`;
const row = (label, r) => console.log(`${label.padEnd(30)} ${r.ok
  ? `total ${String(r.total).padStart(6)}  hit ${String(r.hit).padStart(6)}  miss ${String(r.miss).padStart(6)}  ${String(r.pct).padStart(3)}%  out ${String(r.out).padStart(5)}  ${r.finish ?? ''}`
  : `HTTP ${r.status} ${r.error}`}`);
const fire = (sys, messages) => complete({ system: sys, messages, tools: TOOLS, effort: 'none', maxTokens: 64 });

console.log('H1 — natural stops of four lengths, then the extension');
for (const [label, want] of [['one sentence', 'one short sentence'], ['two sentences', 'two sentences'], ['~60 words', 'about 60 words'], ['~100 words', 'about 100 words']]) {
  const sys = system(`H1 ${label}`);
  const q = u(`[Dann] ${SMALL}\n\n[studio] Before doing anything, say in ${want} how you would do it. No tools.`);
  const first = await complete({ system: sys, messages: [q], tools: null, effort: 'none', maxTokens: 600 });
  row(`H1 ${label} first`, first);
  row(`H1 ${label} ext`, await fire(sys, [q, a(first.text), u('[studio] Go ahead.')]));
}

// The ask with a richer small answer: sizingAsk's own lines, the small shape
// changed. Kept in step with server/agents/sizing.js by hand.
const richAsk = sizingAsk()
  .replace('{"size":"small"} when it is one change', '{"size":"small","why":"…","files":["…"]} when it is one change')
  .replace('file — or a question or a remark, which wants an answer rather than work.',
    'file — or a question or a remark, which wants an answer rather than work. "why" is one sentence on what\nmakes it small; "files" names the files it will touch, none for a remark.');

console.log('\nH2 — the small ask, json_object, the small answer carrying why and files');
for (let rep = 1; rep <= REPS; rep += 1) {
  for (const shape of ['today', 'extension']) {
    const sys = system(`H2 ${shape} #${rep}`);
    const ask = u(`[Dann] ${SMALL}\n\n${richAsk}`);
    const s = await complete({
      system: sys, messages: [ask], tools: null, effort: 'none', maxTokens: SIZING_MAX_TOKENS,
      extra: { response_format: { type: 'json_object' } },
    });
    row(`H2 ${shape} sizing #${rep}`, s);
    console.log(`   → ${s.text.replace(/\s+/g, ' ').slice(0, 200)}`);
    const messages = shape === 'today'
      ? [u(`[Dann] ${SMALL}`)]
      : [ask, a(s.text), u('[studio] Go ahead.')];
    row(`H2 ${shape} fire #${rep}`, await fire(sys, messages));
  }
}

console.log('\nH3 — the big ask, json_object, the plan replayed exact and canonical, then piece 1');
for (let rep = 1; rep <= REPS; rep += 1) {
  for (const shape of ['exact', 'canonical']) {
    const sys = system(`H3 ${shape} #${rep}`);
    const ask = u(`[Dann] ${BIG}\n\n${sizingAsk()}`);
    const s = await complete({
      system: sys, messages: [ask], tools: null, effort: 'none', maxTokens: SIZING_MAX_TOKENS,
      extra: { response_format: { type: 'json_object' } },
    });
    row(`H3 ${shape} sizing #${rep}`, s);
    const plan = parseSizing(s.text);
    if (plan?.size !== 'big') { console.log(`   sized ${plan?.size ?? 'unparseable'}; skipped`); continue; }
    const pieces = plan.pieces.map((p) => ({ ...p, status: 'todo', note: null }));
    const turn = pieceTurn({ request: BIG, pieces, index: 0 });
    let replay = s.text;
    if (shape === 'canonical') { try { replay = JSON.stringify(JSON.parse(s.text)); } catch { /* keep */ } }
    console.log(`   plan ${pieces.length} pieces, answer ${s.text.length} chars, replay ${replay.length} chars, ends ${JSON.stringify(s.text.slice(-12))}`);
    row(`H3 ${shape} piece 1 #${rep}`, await fire(sys, [ask, a(replay), u(turn)]));
  }
}
