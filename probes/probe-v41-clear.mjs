// Can the sizing call judge whether an ask is *clear*, and does asking it
// that spoil the answer it already gives?
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-clear.mjs > probes/probe-v41-clear.out 2>&1
//
// probe-v41-small-ask.mjs found that thinking is worth nothing on a concrete
// ask and worth having on a vague one — "the rivals are too easy to beat" was
// the row where `low` finished and `none` ran out of turns having edited a
// shape-locked file. So the thinking level wants deciding per message rather
// than per agent, and the sizing call is already there, already carrying the
// fire's whole system prompt, already answering in JSON.
//
// ⚠️ Two things stand between that and building it, and both are guesses:
//
//   C1  Can a call with no tools and thinking off judge vagueness at all? It
//       is demonstrably good at *size* — §14's sizing table is 13 sensible
//       runs — but that is a different question and has no runs behind it.
//   C2  Does asking it two questions make the first one worse? The plan is
//       the studio's spine. A better thinking flag bought with a worse plan
//       is a bad trade, and it would be easy not to notice.
//
// Arm A is today's rules, unchanged, as the control. Arm B adds the one key.
// Both use the real sizingRules() out of server/agents/sizing.js and the real
// parseSizing, so this measures the shipped thing and not a paraphrase of it.
//
// ⚠️ The `clear` labels below are the author's, not ground truth. The rule
// applied: an ask is clear when it names what to change — a value, a thing, a
// name, or a symptom you can point at — and not clear when it names only how
// the game should feel or turn out, leaving what to change to be worked out.

import { complete, preamble, fileBlock, u, MODEL } from './probe-lib.mjs';
import { sizingRules, sizingTrigger, parseSizing, SIZING_MAX_TOKENS } from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 3);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const files = fileBlock('games/space-racer');

// The candidate addition, in the rules' own voice.
const CLEAR_RULE = [
  'On a one-piece answer add "clear": true when the request says what to change — a value, a thing, a',
  'name, or a symptom somebody can point at. "clear": false when it says only how the game should feel',
  'or how it should turn out, and what to change still has to be worked out. Leave it off a reply and',
  'off a plan of two or more.',
].join('\n');

// ask, what size it should come back as, and whether it should read as clear.
// `size` null means either answer is defensible and the row is reported only.
const ASKS = [
  ['fun?', 'do you think the game is fun?', 'reply', null],
  ['what', 'what does config/play.js do?', 'reply', null],
  ['turn', 'make the ship turn a bit faster', 'one', true],
  ['title', 'change the title to SPACE BLAST', 'one', true],
  ['rocks', 'make the rocks blue', 'one', true],
  ['bothkeys', "it doesn't work when I hold both arrow keys", 'one', true],
  ['rivals', 'the rivals are too easy to beat', 'one', false],
  ['boring', 'it feels a bit boring', null, false],
  ['controls', 'the controls feel wrong', null, false],
  ['splitscreen', 'add a second player with split screen', 'many', null],
];

const system = (arm) => [
  `Run ${STAMP} · Arm ${arm}.`,
  '',
  preamble('Space Racer'),
  '',
  arm === 'B' ? `${sizingRules()}\n${CLEAR_RULE}` : sizingRules(),
  '',
  files,
].join('\n');

const sizeOf = (plan) => {
  if (!plan) return 'unparseable';
  if (plan.size === 'reply') return 'reply';
  const n = plan.pieces?.length ?? 0;
  return n === 1 ? 'one' : n >= 2 ? 'many' : 'odd';
};

async function ask(sys, text) {
  const r = await complete({
    system: sys,
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
    plan: parseSizing(r.text),
    clear: typeof raw?.clear === 'boolean' ? raw.clear : null,
    out: r.out,
    pct: r.pct,
    ms: r.ms,
  };
}

const tally = { A: { size: 0, n: 0 }, B: { size: 0, n: 0, clear: 0, clearN: 0, missing: 0 } };

for (const arm of ['A', 'B']) {
  const sys = system(arm);
  console.log(`\n=== Arm ${arm} — ${arm === 'A' ? "today's rules" : 'plus "clear"'} ===\n`);
  for (const [key, text, wantSize, wantClear] of ASKS) {
    const sizes = [];
    const clears = [];
    let out = 0;
    let pct = 0;
    for (let rep = 0; rep < REPS; rep += 1) {
      const r = await ask(sys, text);
      if (!r.ok) { console.log(`${key.padEnd(12)} ${r.error}`); continue; }
      sizes.push(sizeOf(r.plan));
      clears.push(r.clear);
      out += r.out;
      pct = r.pct;
      if (wantSize) {
        tally[arm].n += 1;
        if (sizeOf(r.plan) === wantSize) tally[arm].size += 1;
      }
      if (arm === 'B' && wantClear !== null) {
        if (r.clear === null) tally.B.missing += 1;
        else {
          tally.B.clearN += 1;
          if (r.clear === wantClear) tally.B.clear += 1;
        }
      }
    }
    const shownClear = arm === 'B'
      ? `  clear ${clears.map((c) => (c === null ? '·' : c ? 'Y' : 'n')).join('')}${wantClear === null ? '' : ` want ${wantClear ? 'Y' : 'n'}`}`
      : '';
    console.log(`${key.padEnd(12)} size ${sizes.join(' ').padEnd(18)}`
      + `${wantSize ? ` want ${wantSize.padEnd(6)}` : ' —          '}`
      + `${shownClear}  ${Math.round(out / REPS)} out avg, cache ${pct}%`);
  }
}

console.log('\n— C2: does the second question spoil the first? —');
console.log(`  arm A size agreement: ${tally.A.size}/${tally.A.n}`);
console.log(`  arm B size agreement: ${tally.B.size}/${tally.B.n}`);
console.log('\n— C1: can it judge vagueness? —');
console.log(`  arm B clear agreement: ${tally.B.clear}/${tally.B.clearN}`
  + `${tally.B.missing ? `, and ${tally.B.missing} answers left the key off` : ''}`);
console.log(`\n(${MODEL}; the clear labels are the author's, stated at the top of this file.)`);
