// The cliff's rate at 'low' and 'none', eight runs each, in the studio's own
// shape. Those are the two settings the studio sends: BUILDER_THINKING is
// 'low', and a piece of a plan runs at 'none' (spec/ §8).
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-rate.mjs > probes/probe-v41-rate.out 2>&1
//
// §14's V4.1 cliff table rests on 7 runs at 'low' and 4 at 'none', pooled
// from three probes of two shapes — and two of the three had no ambient file
// block, which §14 itself says is not measuring the studio. The runs taken
// since, all with the block (probe-v41-loop.mjs, probe-v41-none-vs-low.mjs
// and the unfinished probe-v41-low-rate.out), put a 'low' first turn at 5
// runaways in 8, against the table's 1 in 7. One shape, one probe, eight a
// rung, so the rate the thinking level rests on has a footing.
//
// The shape: the preamble, the empty-tree block (production always has one),
// the three tools, one turn, max_tokens 8192 — a runaway spends whatever it
// is given, so 8192 only makes one cost 35 s rather than 70. ⚠️ A turn ending
// on `length` is a runaway *whatever it emitted on the way out* (§14's own
// definition): the first run of this probe let a turn that squeezed two
// writes out at 33 s of an 8192-token trace count as healthy, and it is not
// — in the studio the thinking cap cuts that turn at ~43 s and retries it.
// One ending on tool_calls or stop is healthy, and its trace is the number
// kept. The idle guard is the later probes' 120 s: a silent stream is an
// outcome here, not a hang.

import { preamble, TOOLS, EMPTY_TREE, TASK, KEY, MODEL, ENDPOINT } from './probe-lib.mjs';

const MAX = Number(process.env.PROBE_MAX ?? 8192);
const REPS = Number(process.env.PROBE_REPS ?? 8);
const IDLE_MS = Number(process.env.PROBE_IDLE_MS ?? 120_000);
const RUNGS = (process.env.PROBE_RUNGS ?? 'low,none').split(',');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

// Salted per run so no run warms the next: a first turn from a cold prefix is
// the case being measured.
const system = (label) => `Run ${STAMP} · ${label}.\n\n${preamble('Tank')}\n\n${EMPTY_TREE}`;

async function run(label, effort) {
  const started = Date.now();
  const controller = new AbortController();
  let idle = null;
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), IDLE_MS);
  };
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: system(label) }, { role: 'user', content: TASK }],
    tools: TOOLS,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX,
  };
  if (effort !== 'default') body.reasoning_effort = effort;

  let usage = null;
  let finish = null;
  let firstCallAt = null;
  let prose = '';
  const names = [];
  let argChars = 0;
  let stalled = false;
  try {
    bump();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      clearTimeout(idle);
      console.log(`${label.padEnd(10)} HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
      return null;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bump();
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const nl = buffer.indexOf('\n');
        if (nl === -1) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const delta = choice?.delta ?? {};
        if (delta.content) prose += delta.content;
        for (const call of delta.tool_calls ?? []) {
          if (firstCallAt === null) firstCallAt = Date.now() - started;
          if (call.function?.name) names.push(call.function.name.replace('_file', ''));
          argChars += call.function?.arguments?.length ?? 0;
        }
      }
    }
  } catch (err) {
    stalled = controller.signal.aborted;
    if (!stalled) {
      clearTimeout(idle);
      console.log(`${label.padEnd(10)} ${String(err).slice(0, 120)}`);
      return null;
    }
  }
  clearTimeout(idle);

  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const out = usage?.completion_tokens ?? 0;
  const writes = names.filter((n) => n === 'write' || n === 'patch').length;
  const runaway = !stalled && finish === 'length';
  const verdict = stalled ? `STALLED (no bytes for ${IDLE_MS / 1000}s)` : runaway ? 'RUNAWAY' : 'healthy';
  console.log(
    `${label.padEnd(10)} reasoning ${String(reasoning).padStart(5)}/${String(out).padStart(5)} out  `
    + `calls ${String(names.length).padStart(2)} (${String(writes).padStart(2)} write)  `
    + `first at ${firstCallAt === null ? ' never' : `${(firstCallAt / 1000).toFixed(0)}s`.padStart(6)}  `
    + `${String(argChars).padStart(6)} chars  ${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s  `
    + `${finish ?? '-'}  ${verdict}`,
  );
  if (names.length) console.log(`${' '.repeat(12)}${names.join(' ')}`);
  else if (prose) console.log(`${' '.repeat(12)}said only: “${prose.replace(/\s+/g, ' ').slice(0, 110)}…”`);
  return { reasoning, runaway, stalled };
}

console.log(`${MODEL}, preamble + empty-tree block + file tools, "${TASK}"`);
console.log(`max_tokens ${MAX}, one turn, ${REPS} runs a rung, idle guard ${IDLE_MS / 1000}s\n`);
const totals = {};
for (const rung of RUNGS) {
  const rows = [];
  for (let i = 1; i <= REPS; i += 1) {
    const r = await run(`${rung} #${i}`, rung);
    if (r) rows.push(r);
  }
  totals[rung] = rows;
  console.log('');
}
console.log('Summary — one turn from a cold prefix, the studio\'s shape');
for (const [rung, rows] of Object.entries(totals)) {
  const ran = rows.filter((r) => r.runaway).length;
  const stalled = rows.filter((r) => r.stalled).length;
  const healthy = rows.filter((r) => !r.runaway && !r.stalled).map((r) => r.reasoning);
  console.log(`${rung.padEnd(8)} ${rows.length} runs  ran away ${ran}  stalled ${stalled}  `
    + `healthy traces: ${healthy.length ? healthy.join(' ') : '—'}`);
}
