// One-off: when the thinking cap stops a turn, is the trace worth handing on?
// (ideas/planner.md, to be written.)
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-trace-handoff.mjs
//
// Today (orchestrator.js): the stream is cut at THINKING_CAP_CHARS, the trace
// is dropped, and the same turn is asked again with thinking off. The claim
// to test is that the retry then re-derives everything in the open — a wall
// of prose the kid reads and the transcript keeps.
//
// For each capped trace, three retries on the same prompt:
//   A  today: thinking off, tools, trace dropped
//   B  same, with the trace in the message as "what you had worked out"
//   C  the planner instead (probe-sizing's ask), no tools, the trace as notes
// Measured: prose before the first tool call (the wall), time to first call,
// calls, chars written, wall time; for C, whether a plan came out and how fast.

import fs from 'node:fs';
import {
  stream, streamRow, complete, preamble, TOOLS, TASK, EMPTY_TREE, SIZING, u,
} from './probe-lib.mjs';

const TRACES = Number(process.env.PROBE_TRACES ?? 2);
const CAP = 35_000;
const system = `${preamble('Tank')}\n\n${EMPTY_TREE}`;

const HANDOFF = (trace) => [
  '[studio] You were stopped after about two minutes of thinking with nothing written yet. Below is',
  'what you had worked out before you were stopped. Do not start over and do not repeat it back: pick',
  'up from where it ends and write the files.',
  '',
  '--- your notes so far ---',
  trace,
  '--- end of notes ---',
].join('\n');

const NOTES_FOR_PLANNER = (trace) => [
  '[studio] A helper already thought about this for two minutes before being stopped. Its notes are',
  'below; use them to shape the steps, and keep the decisions it had reached.',
  '',
  '--- notes ---',
  trace,
  '--- end of notes ---',
].join('\n');

let got = 0;
for (let attempt = 1; got < TRACES && attempt <= TRACES + 2; attempt += 1) {
  console.log(`\n=== capping run ${attempt} (default effort, tools, cap ${CAP} chars) ===`);
  const capRun = await stream({
    system, messages: [u(TASK)], tools: TOOLS, effort: 'full', maxTokens: 65536, capChars: CAP,
  });
  console.log(streamRow('cap run', capRun));
  if (!capRun.ok || !capRun.capped) {
    console.log('   not capped — it produced something first; trying again');
    continue;
  }
  got += 1;
  const trace = capRun.trace;
  fs.writeFileSync(`tmp/probe-trace-${got}.txt`, trace);
  const codeish = (trace.match(/^\s*(const|let|function|class|if \(|for \(|\}|<\w+|ctx\.)/gm) ?? []).length;
  const lines = trace.split('\n').length;
  console.log(`   trace ${trace.length} chars, ${lines} lines, ${codeish} code-looking lines (${Math.round((100 * codeish) / lines)}%), saved to tmp/probe-trace-${got}.txt`);

  const A = await stream({ system, messages: [u(TASK)], tools: TOOLS, effort: 'none', maxTokens: 16384 });
  console.log(streamRow(`A today (none)`, A));
  console.log(`   prose before first call: ${A.proseBeforeFirstCall} chars`);

  const B = await stream({
    system, messages: [u(`${TASK}\n\n${HANDOFF(trace)}`)], tools: TOOLS, effort: 'none', maxTokens: 16384,
  });
  console.log(streamRow(`B handoff (none)`, B));
  console.log(`   prose before first call: ${B.proseBeforeFirstCall} chars`);

  const C = await complete({
    system, messages: [u(`${TASK}\n\n${SIZING}\n\n${NOTES_FOR_PLANNER(trace)}`)],
    tools: null, effort: 'none', maxTokens: 800,
  });
  if (!C.ok) console.log(`C planner              HTTP ${C.status} ${C.error}`);
  else {
    let plan = null;
    try { plan = JSON.parse(C.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')); } catch { /* below */ }
    console.log(`C planner (none)           ${(C.ms / 1000).toFixed(1)}s  out ${C.out}  cache ${C.pct}%  `
      + (plan ? `${plan.size}${plan.steps ? `, ${plan.steps.length} steps` : ''}` : `✗ not JSON: ${C.text.slice(0, 80)}`));
    for (const [i, s] of (plan?.steps ?? []).entries()) console.log(`   ${i + 1}. ${s.title}  [${(s.files ?? []).join(', ')}]`);
  }
}
