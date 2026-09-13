// Follow-up to probe-trace-handoff.mjs arm C: with a 35 K-character trace in
// the message, the planner answered in prose and ignored the JSON ask. Two
// fixes tried on the saved traces, no re-capping needed:
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-handoff-json.mjs
//
//   C1  sizing ask *after* the notes (recency), prompt-asked JSON only
//   C2  the same, plus response_format json_object (probe-tools-cache showed
//       it is accepted)
//   C3  response_format, and the notes cut to their last 8,000 characters —
//       the tail is where the trace had got to, and the whole thing is what
//       swamped the ask

import fs from 'node:fs';
import { complete, preamble, TASK, EMPTY_TREE, SIZING, u } from './probe-lib.mjs';

const system = `${preamble('Tank')}\n\n${EMPTY_TREE}`;

const notes = (trace) => [
  '[studio] A helper already thought about this for two minutes before being stopped. Its notes are',
  'below; use them to shape the steps, and keep the decisions it had reached.',
  '',
  '--- notes ---',
  trace,
  '--- end of notes ---',
].join('\n');

function parsePlan(text) {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    const obj = JSON.parse(raw);
    return obj.size ? obj : { error: `shape: ${raw.slice(0, 80)}` };
  } catch {
    return { error: `not JSON: ${raw.slice(0, 80).replace(/\n/g, ' ⏎ ')}` };
  }
}

async function arm(label, message, extra = {}) {
  const r = await complete({
    system, messages: [u(message)], tools: null, maxTokens: 1200, effort: 'none', extra,
  });
  if (!r.ok) {
    console.log(`${label.padEnd(30)} HTTP ${r.status} ${r.error}`);
    return;
  }
  const plan = parsePlan(r.text);
  const head = `${label.padEnd(30)} ${(r.ms / 1000).toFixed(1)}s  out ${String(r.out).padStart(4)}  cache ${String(r.pct).padStart(3)}%  ${r.finish}  `;
  if (plan.error) console.log(`${head}✗ ${plan.error}`);
  else {
    console.log(`${head}${plan.size}${plan.steps ? `, ${plan.steps.length} steps` : ''}`);
    for (const [i, s] of (plan.steps ?? []).entries()) console.log(`${' '.repeat(32)}${i + 1}. ${s.title}  [${(s.files ?? []).join(', ')}]`);
  }
}

for (const file of ['tmp/probe-trace-1.txt', 'tmp/probe-trace-2.txt']) {
  if (!fs.existsSync(file)) continue;
  const trace = fs.readFileSync(file, 'utf8');
  console.log(`\n${file} (${trace.length} chars)`);
  await arm('C1 ask after notes', `${TASK}\n\n${notes(trace)}\n\n${SIZING}`);
  await arm('C2 + response_format', `${TASK}\n\n${notes(trace)}\n\n${SIZING}`, { response_format: { type: 'json_object' } });
  await arm('C3 + tail 8k only', `${TASK}\n\n${notes(trace.slice(-8000))}\n\n${SIZING}`, { response_format: { type: 'json_object' } });
}
