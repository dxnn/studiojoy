// Two questions in one run, both about the sizing call.
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-symptom.mjs > probes/probe-v41-symptom.out 2>&1
//
// S1 — the fix. probe-v41-clear.mjs found a bug report sizing as a *reply*
//      two times in three: "it doesn't work when I hold both arrow keys" came
//      back as words rather than a fix, in both arms. `sizingRules()` now
//      carries two lines saying a symptom is work. Does that move the row,
//      and does it cost agreement anywhere else? The whole ask list is re-run,
//      not just the broken one, because a rule added to catch one case is
//      exactly the kind that quietly swallows its neighbours.
//
// S2 — the design question behind extending sizing past `Building`. In the
//      builder's room the sizing is free-ish: it carries the fire's own system
//      prompt and the fire extends it, so the fire hits 96%+ (§14 arm B). An
//      open room has no such call to ride. Two ways to give it one:
//
//        (i)  a full-prompt sizing the fire extends — cheap per token, but it
//             wants the sizing rules in every room's preamble and a [studio]
//             trigger on a child's message in a room that never mentions
//             sizing;
//        (ii) a *tiny* standalone call: the message text, a definition, no
//             tree, no preamble. Its own prefix, so it misses whole — but a
//             ~200-token miss is $0.00006 and it disturbs nothing.
//
//      (ii) is far less invasive if it is as good. `clear` is defined on the
//      *wording* of the request — does it name what to change, or only how
//      the game should feel — which may not need the tree at all. This asks
//      whether the tiny one agrees with the full one.

import { complete, preamble, fileBlock, u, MODEL, KEY, ENDPOINT } from './probe-lib.mjs';
import { sizingRules, sizingTrigger, parseSizing, SIZING_MAX_TOKENS } from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 3);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const files = fileBlock('games/space-racer');

// Same list as probe-v41-clear.mjs so the rows compare, plus two more
// symptoms — one run alone can't tell a fixed rule from a lucky row.
const ASKS = [
  ['fun?', 'do you think the game is fun?', 'reply', null],
  ['what', 'what does config/play.js do?', 'reply', null],
  ['turn', 'make the ship turn a bit faster', 'one', true],
  ['title', 'change the title to SPACE BLAST', 'one', true],
  ['rocks', 'make the rocks blue', 'one', true],
  ['bothkeys', "it doesn't work when I hold both arrow keys", 'one', true],
  ['stuck', 'my ship gets stuck on the edge of the track', 'one', true],
  ['noscore', 'the score stays at 0 even when I finish a lap', 'one', true],
  ['rivals', 'the rivals are too easy to beat', 'one', false],
  ['boring', 'it feels a bit boring', null, false],
  ['controls', 'the controls feel wrong', null, false],
  ['splitscreen', 'add a second player with split screen', 'many', null],
];

const system = [
  `Run ${STAMP} · S1.`, '', preamble('Space Racer'), '', sizingRules(), '', files,
].join('\n');

// (ii): everything the judgement might need and nothing else.
const TINY = [
  'Somebody is building a browser game and has sent a message about it.',
  'Answer with JSON only: {"clear": true} when the message says what to change — a value, a thing, a',
  'name, or a symptom somebody can point at. {"clear": false} when it says only how the game should',
  'feel or how it should turn out, and what to change still has to be worked out.',
].join('\n');

const sizeOf = (plan) => {
  if (!plan) return 'unparseable';
  if (plan.size === 'reply') return 'reply';
  const n = plan.pieces?.length ?? 0;
  return n === 1 ? 'one' : n >= 2 ? 'many' : 'odd';
};

async function full(text) {
  const r = await complete({
    system,
    messages: [u(`[Dann] ${text}\n\n${sizingTrigger()}`)],
    tools: null,
    effort: 'none',
    maxTokens: SIZING_MAX_TOKENS,
    extra: { response_format: { type: 'json_object' } },
  });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status} ${r.error}` };
  let raw = null;
  try { raw = JSON.parse(r.text); } catch { /* parseSizing is the defensive one */ }
  return {
    ok: true,
    size: sizeOf(parseSizing(r.text)),
    clear: typeof raw?.clear === 'boolean' ? raw.clear : null,
    total: r.total,
    out: r.out,
    pct: r.pct,
  };
}

async function tiny(text) {
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: TINY }, { role: 'user', content: text }],
      max_tokens: 32,
      reasoning_effort: 'none',
      response_format: { type: 'json_object' },
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  let raw = null;
  try { raw = JSON.parse(payload.choices?.[0]?.message?.content ?? ''); } catch { /* below */ }
  return {
    ok: true,
    clear: typeof raw?.clear === 'boolean' ? raw.clear : null,
    total: payload.usage?.prompt_tokens ?? 0,
    out: payload.usage?.completion_tokens ?? 0,
    ms: Date.now() - started,
  };
}

const mark = (c) => (c === null ? '·' : c ? 'Y' : 'n');
let sizeOk = 0;
let sizeN = 0;
let clearOk = 0;
let clearN = 0;
let tinyOk = 0;
let tinyN = 0;
let agree = 0;
let agreeN = 0;
let tinyPrompt = 0;
let tinyCalls = 0;

console.log(`${MODEL}\n`);
console.log('S1 — the symptom rule, whole list re-run     |  S2 — the tiny standalone judge\n');
for (const [key, text, wantSize, wantClear] of ASKS) {
  const sizes = [];
  const clears = [];
  const tinies = [];
  for (let rep = 0; rep < REPS; rep += 1) {
    const f = await full(text);
    if (f.ok) {
      sizes.push(f.size);
      clears.push(f.clear);
      if (wantSize) { sizeN += 1; if (f.size === wantSize) sizeOk += 1; }
      if (wantClear !== null && f.clear !== null) { clearN += 1; if (f.clear === wantClear) clearOk += 1; }
    } else sizes.push('ERR');

    const t = await tiny(text);
    if (t.ok) {
      tinies.push(t.clear);
      tinyPrompt += t.total;
      tinyCalls += 1;
      if (wantClear !== null && t.clear !== null) { tinyN += 1; if (t.clear === wantClear) tinyOk += 1; }
      if (f.ok && f.clear !== null && t.clear !== null) { agreeN += 1; if (f.clear === t.clear) agree += 1; }
    } else tinies.push(null);
  }
  console.log(`${key.padEnd(12)} ${sizes.join(' ').padEnd(20)}`
    + `${wantSize ? `want ${wantSize.padEnd(5)}` : '          '}`
    + ` full ${clears.map(mark).join('')}  tiny ${tinies.map(mark).join('')}`
    + `${wantClear === null ? '' : `  want ${mark(wantClear)}`}`);
}

console.log(`\nS1  size agreement ${sizeOk}/${sizeN}`
  + '  (was 20/24 before the symptom rule, over ten of these twelve asks)');
console.log(`    full-prompt clear agreement ${clearOk}/${clearN}`);
console.log(`\nS2  tiny clear agreement ${tinyOk}/${tinyN}`);
console.log(`    tiny agrees with full ${agree}/${agreeN}`);
console.log(`    tiny prompt ${Math.round(tinyPrompt / Math.max(1, tinyCalls))} tokens a call`
  + ` — a whole miss, at $0.30/M that is $${((tinyPrompt / Math.max(1, tinyCalls)) * 0.3e-6).toFixed(7)}`);
