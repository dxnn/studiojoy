// One-off, after probe-extension-7.mjs, which found the rule: when the last
// user message of a request is longer than about 110–160 tokens, the next
// request that extends it loses ~6,000 tokens of the system prompt before it;
// under that, it reuses everything but the last block. The sizing ask is ~250
// tokens on the last message. The fix to test: the sizing rules move into the
// system prompt — cached like the rest, byte-identical for the fire — and the
// last message carries a short trigger.
//
//   K1  the small ask with the rules in the system prompt and a short trigger:
//       sizing, then the extension fire. Does it still answer small? Does the
//       fire hit?
//   K2  the big ask the same way: sizing, then piece 1 (its ~600-token turn),
//       then piece 2 beside it.
//   K3  a long kid message (~300 tokens) as its own user turn, the trigger as
//       a second user turn after it. Is it the last message alone that counts?
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-extension-8.mjs > tmp/probe-extension-8.out 2>&1

import { complete, preamble, fileBlock, TOOLS, u, a } from './probe-lib.mjs';
import { sizingAsk, parseSizing, pieceTurn, SIZING_MAX_TOKENS } from '../server/agents/sizing.js';

const SMALL = 'make the ship turn a bit faster';
const BIG = 'add a second player with split screen';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const files = fileBlock('games/space-racer');
const row = (label, r) => console.log(`${label.padEnd(30)} ${r.ok
  ? `total ${String(r.total).padStart(6)}  hit ${String(r.hit).padStart(6)}  miss ${String(r.miss).padStart(6)}  ${String(r.pct).padStart(3)}%  out ${String(r.out).padStart(5)}  ${r.finish ?? ''}`
  : `HTTP ${r.status} ${r.error}`}`);

// The ask's own lines, as standing rules rather than a request.
const RULES = `SIZING\n${sizingAsk()
  .replace('[studio] Before anything is built, size this request. Answer with JSON only — no prose, no code fence:',
    'When a [studio] message asks you to size the request, answer with JSON only — no prose, no code fence:')}`;
const TRIGGER = '[studio] Size this request.';
const system = (arm) => `Run ${STAMP} · Arm ${arm}.\n\n${preamble('Space Racer')}\n\n${RULES}\n\n${files}`;
const sizing = (sys, messages) => complete({
  system: sys, messages, tools: null, effort: 'none', maxTokens: SIZING_MAX_TOKENS,
  extra: { response_format: { type: 'json_object' } },
});
const fire = (sys, messages) => complete({ system: sys, messages, tools: TOOLS, effort: 'none', maxTokens: 64 });

console.log('K1 — the small ask, rules in the system prompt, short trigger');
for (let rep = 1; rep <= 2; rep += 1) {
  const sys = system(`K1 #${rep}`);
  const ask = u(`[Dann] ${SMALL}\n\n${TRIGGER}`);
  const s = await sizing(sys, [ask]); row(`K1 sizing #${rep}`, s);
  console.log(`   → ${s.text.replace(/\s+/g, ' ').slice(0, 120)}`);
  row(`K1 extension fire #${rep}`, await fire(sys, [ask, a(s.text), u('[studio] Go ahead.')]));
}

console.log('\nK2 — the big ask the same way, then piece 1 and piece 2');
for (let rep = 1; rep <= 2; rep += 1) {
  const sys = system(`K2 #${rep}`);
  const ask = u(`[Dann] ${BIG}\n\n${TRIGGER}`);
  const s = await sizing(sys, [ask]); row(`K2 sizing #${rep}`, s);
  const plan = parseSizing(s.text);
  if (plan?.size !== 'big') { console.log(`   sized ${plan?.size ?? 'unparseable'}: ${s.text.slice(0, 160)}`); continue; }
  const pieces = plan.pieces.map((p) => ({ ...p, status: 'todo', note: null }));
  console.log(`   plan ${pieces.length} pieces: ${pieces.map((p) => p.title).join(' · ')}`);
  row(`K2 piece 1 #${rep}`, await fire(sys, [ask, a(s.text), u(pieceTurn({ request: BIG, pieces, index: 0 }))]));
  pieces[0] = { ...pieces[0], status: 'done', note: 'Done.' };
  row(`K2 piece 2 #${rep}`, await fire(sys, [ask, a(s.text), u(pieceTurn({ request: BIG, pieces, index: 1 }))]));
}

console.log('\nK3 — a long kid message as its own turn, the trigger as the turn after it');
const LONG = `[Dann] ${SMALL}. ${'I mean when I press left or right the ship takes ages to come round and the rivals get past me on every bend, so it should feel snappier but not silly. '.repeat(6)}`;
for (let rep = 1; rep <= 2; rep += 1) {
  const sys = system(`K3 #${rep}`);
  const kid = u(LONG);
  const trigger = u(TRIGGER);
  const s = await sizing(sys, [kid, trigger]); row(`K3 sizing #${rep}`, s);
  console.log(`   → ${s.text.replace(/\s+/g, ' ').slice(0, 120)}`);
  row(`K3 extension fire #${rep}`, await fire(sys, [kid, trigger, a(s.text), u('[studio] Go ahead.')]));
}
