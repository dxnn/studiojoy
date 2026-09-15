// The sizing table, re-taken on V4.1 in the shape the studio sends today.
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-sizing.mjs > probes/probe-v41-sizing.out 2>&1
//
// §14's "one small call plans the whole" table was measured 2026-09-03 on
// V4-Flash (probes/probe-sizing.mjs) with the ask on the last user message and
// two answers, small and big. All three have moved since: the rules stand in
// the system prompt behind a short trigger, the answers are reply or pieces,
// and the model is V4.1. Same asks as that table, so the rows compare; the
// studio's own words from server/agents/sizing.js, so what is measured is
// what runs. response_format json_object is on, as it is in production.
//
// Measured: wall time, output tokens, cache hit, what size it chose, and the
// pieces and their titles — and on the first tank plan, the summary and the
// assumptions a draft card would show.

import { complete, preamble, fileBlock, TASK, EMPTY_TREE, u, MODEL } from './probe-lib.mjs';
import {
  sizingRules, sizingTrigger, parseSizing, SIZING_MAX_TOKENS,
} from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 5);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

// The fire's own system prompt, sizing rules in it, as the builder's room has
// it. Salted per tree so a re-run cannot hit yesterday.
const systemFor = (name, block) => [
  `Run ${STAMP}.`, '', preamble(name), '', sizingRules(), '', block,
].join('\n');

const sizeOf = (plan) => {
  if (!plan) return 'unparseable';
  if (plan.size === 'reply') return 'reply';
  return plan.pieces.length === 1 ? 'one piece' : `${plan.pieces.length} pieces`;
};

async function size(label, system, message) {
  const r = await complete({
    system,
    messages: [u(`[Dann] ${message}\n\n${sizingTrigger()}`)],
    tools: null,
    effort: 'none',
    maxTokens: SIZING_MAX_TOKENS,
    extra: { response_format: { type: 'json_object' } },
  });
  if (!r.ok) {
    console.log(`${label.padEnd(26)} HTTP ${r.status} ${r.error}`);
    return null;
  }
  const plan = parseSizing(r.text);
  const head = `${label.padEnd(26)} ${`${(r.ms / 1000).toFixed(1)}s`.padStart(6)}  `
    + `out ${String(r.out).padStart(4)}  cache ${String(r.pct).padStart(3)}%  ${r.finish}  `;
  console.log(`${head}${sizeOf(plan)}${plan?.clear !== undefined && plan?.clear !== null ? `, clear ${plan.clear}` : ''}`);
  if (plan?.size === 'pieces' && plan.pieces.length > 1) {
    for (const [i, p] of plan.pieces.entries()) {
      console.log(`${' '.repeat(28)}${i + 1}. ${p.title}  [${p.files.join(', ')}]`);
    }
  }
  if (!plan) console.log(`${' '.repeat(28)}✗ ${r.text.slice(0, 100).replace(/\n/g, ' ⏎ ')}`);
  return plan;
}

console.log(`${MODEL}, the builder's own rules and trigger, response_format json_object\n`);

const tank = systemFor('Tank', EMPTY_TREE);
console.log('tank game, empty tree');
let firstPlan = null;
for (let i = 1; i <= REPS; i += 1) {
  const plan = await size(`tank #${i}`, tank, TASK);
  if (plan?.size === 'pieces' && plan.pieces.length > 1 && !firstPlan) firstPlan = plan;
}

const racer = systemFor('Space Racer', fileBlock('games/space-racer'));
console.log('\nspace-racer, real tree');
for (let i = 1; i <= 3; i += 1) await size(`small: turn faster #${i}`, racer, 'make the ship turn a bit faster');
for (let i = 1; i <= 3; i += 1) await size(`big: split screen #${i}`, racer, 'add a second player with split screen so two people can race each other');
for (let i = 1; i <= 2; i += 1) await size(`vague: doesn't work #${i}`, racer, "it doesn't work");
for (let i = 1; i <= 2; i += 1) await size(`chat: is it good? #${i}`, racer, 'do you think the game is fun?');

if (firstPlan) {
  console.log('\nthe first tank plan, in full — what the draft card would show:');
  console.log(`  summary: ${firstPlan.summary || '(none)'}`);
  console.log(`  assumptions: ${firstPlan.assumptions.length ? '' : '(none)'}`);
  for (const a of firstPlan.assumptions) console.log(`    - ${a}`);
  for (const [i, p] of firstPlan.pieces.entries()) {
    console.log(`  ${i + 1}. ${p.title}\n     files: ${p.files.join(', ')}\n     ${p.what}`);
  }
}
