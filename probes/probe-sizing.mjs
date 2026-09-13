// One-off: can one small call, thinking off, no tools, size a request and
// plan the big ones? (ideas/planner.md, to be written.)
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-sizing.mjs
//
// The sizing instruction rides the last user message, like pins and errors
// do, so the system prompt is byte-identical to the fire's and shares its
// cache. JSON is asked for in the prompt and parsed defensively, the way the
// fill does (spec.md §6); response_format is tried once at the end.
//
// Measured: wall time, whether the JSON parses, what size it chose, how many
// steps, and their titles. Five runs on the tank game against an empty tree
// (§14's cliff prompt), then a small, a big and an ambiguous request against
// the real space-racer tree.

import { complete, preamble, fileBlock, TASK, EMPTY_TREE, SIZING, u } from './probe-lib.mjs';

const REPS = Number(process.env.PROBE_REPS ?? 5);

function parsePlan(text) {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    const obj = JSON.parse(raw);
    if (obj.size === 'small') return { size: 'small', steps: [] };
    if (obj.size === 'big' && Array.isArray(obj.steps)) return { size: 'big', steps: obj.steps };
    return { error: `shape: ${raw.slice(0, 80)}` };
  } catch {
    return { error: `not JSON: ${raw.slice(0, 80).replace(/\n/g, ' ⏎ ')}` };
  }
}

async function size(label, system, message, extra = {}) {
  const r = await complete({
    system, messages: [u(`${message}\n\n${SIZING}`)], tools: null, maxTokens: 800, effort: 'none', extra,
  });
  if (!r.ok) {
    console.log(`${label.padEnd(26)} HTTP ${r.status} ${r.error}`);
    return null;
  }
  const plan = parsePlan(r.text);
  const head = `${label.padEnd(26)} ${`${(r.ms / 1000).toFixed(1)}s`.padStart(6)}  out ${String(r.out).padStart(4)}  cache ${String(r.pct).padStart(3)}%  ${r.finish}  `;
  if (plan.error) console.log(`${head}✗ ${plan.error}`);
  else if (plan.size === 'small') console.log(`${head}small`);
  else {
    console.log(`${head}big, ${plan.steps.length} steps`);
    for (const [i, s] of plan.steps.entries()) {
      console.log(`${' '.repeat(28)}${i + 1}. ${s.title}  [${(s.files ?? []).join(', ')}]`);
    }
  }
  return { r, plan };
}

const tankSystem = `${preamble('Tank')}\n\n${EMPTY_TREE}`;
console.log('tank game, empty tree');
let firstPlan = null;
for (let i = 1; i <= REPS; i += 1) {
  const got = await size(`tank #${i}`, tankSystem, TASK);
  if (got?.plan.steps?.length && !firstPlan) firstPlan = got.plan;
}

const racer = `${preamble('Space Racer')}\n\n${fileBlock('games/space-racer')}`;
console.log('\nspace-racer, real tree');
for (let i = 1; i <= 3; i += 1) await size(`small: turn faster #${i}`, racer, '[Dann] make the ship turn a bit faster');
for (let i = 1; i <= 3; i += 1) await size(`big: split screen #${i}`, racer, '[Dann] add a second player with split screen so two people can race each other');
for (let i = 1; i <= 2; i += 1) await size(`vague: doesn't work #${i}`, racer, "[Dann] it doesn't work");
for (let i = 1; i <= 2; i += 1) await size(`chat: is it good? #${i}`, racer, '[Dann] do you think the game is fun?');

console.log('\nresponse_format json_object, tank');
for (let i = 1; i <= 2; i += 1) {
  await size(`tank json_object #${i}`, tankSystem, TASK, { response_format: { type: 'json_object' } });
}

if (firstPlan) {
  console.log('\nthe first tank plan, in full:');
  for (const [i, s] of firstPlan.steps.entries()) {
    console.log(`  ${i + 1}. ${s.title}\n     files: ${(s.files ?? []).join(', ')}\n     ${s.what}`);
  }
}
