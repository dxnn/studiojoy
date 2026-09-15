// How often a plan comes back in a language the person did not write in.
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-language.mjs > probes/probe-v41-language.out 2>&1
//
// probe-v41-sizing.mjs (2026-09-15) sized the tank ask five times and one
// plan came back with its titles in Chinese — 核心骨架与分屏 — files and shape
// otherwise right. Nothing in `sizingRules()` names a language, and a kid
// would get a card they cannot read. One in five is a rate rather than an
// anecdote, and TODO.md says the rule is measured before and after rather
// than tuned against the run that showed it. So: the same ask many times,
// once on the rules as they stand and once with a language line in them —
// this probe reads `sizingRules()` off the server module, so the same script
// measures whatever the rules say that day.
//
// ⚠️ What it found (2026-09-15). `-1.out`, the rules as shipped: 0 of 30 in
// another language. `-line.out`, with a line saying to write in the person's
// language: 3 of 30. `-2.out`, twelve more with the line: 1 of 12. The line
// made it worse, or at best did nothing, and was withdrawn — naming the
// language primes the switch. And a second thing, which turned out to
// matter more: 7 of 52 tank sizings would not parse, every one a complete
// object closed right after `pieces` with the summary and assumptions
// written on after it (`-unparseable.json` is one, kept for the test). In
// production that was a plain fire at `low` on a whole-game ask — the
// runaway case — and `parseSizing` now repairs it (test/sizing.test.js).
//
// Two asks, both open enough to be planned: the tank game on an empty tree,
// which is where it happened, and the split-screen ask on space-racer's real
// tree, as a second sample. A plan counts as "not English" when any title,
// what, summary or assumption holds a CJK, Cyrillic, Arabic or Hebrew
// character — the scripts a model reaches for, and none of which a
// game-making studio in English ever writes.

import fs from 'node:fs';
import { complete, preamble, fileBlock, TASK, EMPTY_TREE, u, MODEL } from './probe-lib.mjs';
import {
  sizingRules, sizingTrigger, parseSizing, SIZING_MAX_TOKENS,
} from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 20);
const REPS_2 = Number(process.env.PROBE_REPS_2 ?? 10);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const FOREIGN = /[Ѐ-ӿ֐-ۿ぀-ヿ㐀-鿿가-힯]/;

const systemFor = (name, block) => [
  `Run ${STAMP}.`, '', preamble(name), '', sizingRules(), '', block,
].join('\n');

function wordsOf(plan) {
  if (!plan || plan.size !== 'pieces') return [];
  return [
    ...plan.pieces.flatMap((p) => [p.title, p.what]),
    plan.summary ?? '',
    ...(plan.assumptions ?? []),
  ];
}

async function sample(label, system, message, reps) {
  let foreign = 0;
  let unparsed = 0;
  let n = 0;
  for (let i = 1; i <= reps; i += 1) {
    const r = await complete({
      system,
      messages: [u(`[Dann] ${message}\n\n${sizingTrigger()}`)],
      tools: null,
      effort: 'none',
      maxTokens: SIZING_MAX_TOKENS,
      extra: { response_format: { type: 'json_object' } },
    });
    if (!r.ok) { console.log(`${label} #${i}  HTTP ${r.status} ${r.error}`); continue; }
    n += 1;
    const plan = parseSizing(r.text);
    // Why it would not parse: cut off by the token cap, or not JSON at all.
    // The whole answer is kept under tmp/ so the reason can be read off it.
    if (!plan) {
      unparsed += 1;
      let why = 'parsed as JSON, but not as a sizing';
      try { JSON.parse(r.text); } catch (err) { why = err.message; }
      const kept = `tmp/unparseable-${label}-${i}.json`;
      fs.mkdirSync('tmp', { recursive: true });
      fs.writeFileSync(kept, r.text);
      console.log(`${label} #${String(i).padStart(2)}  unparseable  finish ${r.finish}  out ${r.out}  ${why}  → ${kept}`);
      continue;
    }
    const words = wordsOf(plan);
    const bad = words.some((w) => FOREIGN.test(w));
    if (bad) foreign += 1;
    const titles = plan.size === 'pieces' ? plan.pieces.map((p) => p.title).join(' · ') : 'reply';
    console.log(`${label} #${String(i).padStart(2)}  ${bad ? '⚠️ NOT ENGLISH' : 'english    '}  ${`${(r.ms / 1000).toFixed(1)}s`.padStart(5)}  ${titles.slice(0, 110)}`);
  }
  console.log(`${label}: not English ${foreign} of ${n}${unparsed ? `, unparseable ${unparsed}` : ''}\n`);
  return { foreign, n };
}

console.log(`${MODEL}, the builder's rules as they stand in server/agents/sizing.js, response_format json_object`);
console.log(`the rules ${sizingRules().includes('language') ? 'DO' : 'do not'} name a language\n`);
const a = await sample('tank', systemFor('Tank', EMPTY_TREE), TASK, REPS);
const b = await sample('split', systemFor('Space Racer', fileBlock('games/space-racer')), 'add a second player with split screen so two people can race each other', REPS_2);
console.log(`altogether: not English ${a.foreign + b.foreign} of ${a.n + b.n}`);
