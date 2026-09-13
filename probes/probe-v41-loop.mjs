// The cliff, but with the tool loop closed — deepseek-flash (V4.1).
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-loop.mjs > probes/probe-v41-loop.out 2>&1
//
// probe-v41-cliff.mjs asks §14's original question — one turn, does a tool
// call come out — and on V4.1 the answer went bimodal: a run either thinks
// almost nothing and calls a tool in a second, or thinks to the ceiling and
// produces nothing at all. But its first act is now a *read* where the old
// model's was a write, and one turn cannot tell a helper that oriented itself
// and went on to build from one that only ever read.
//
// So: the same preamble and tools, the loop actually served, up to MAX_TURNS.
// Two differences from the cliff probe, both deliberate:
//   - the ambient file block is present (empty tree), because it always is in
//     production, and without it a turn spent reading files that cannot exist
//     is the probe's omission rather than the model's habit;
//   - a turn that ends on `length` having called nothing ends the run, which
//     is what the studio does with it (§8's banner).
//
// What each arm answers: does the default effort get a game built now, and
// does the trace blow up on a later turn rather than the first?

import { preamble, TOOLS, EMPTY_TREE, TASK, KEY, MODEL, ENDPOINT } from './probe-lib.mjs';

const MAX_TURNS = Number(process.env.PROBE_TURNS ?? 8);
const MAX_TOKENS = Number(process.env.PROBE_MAX ?? 16384);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

const SYSTEM = (arm) => `Run ${STAMP} · Arm ${arm}.\n\n${preamble('Tank')}\n\n${EMPTY_TREE}`;

// One streamed turn, with the tool calls reassembled by index so they can be
// served. `delta.tool_calls[]` carries id and name on the first fragment and
// arguments across the rest (§14).
async function turn({ system, messages, effort }) {
  const started = Date.now();
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: system }, ...messages],
    tools: TOOLS,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX_TOKENS,
  };
  if (effort !== 'full') body.reasoning_effort = effort;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 200) };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let finish = null;
  let prose = '';
  const byIndex = new Map();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
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
        const slot = byIndex.get(call.index) ?? { id: null, name: '', args: '' };
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name = call.function.name;
        slot.args += call.function?.arguments ?? '';
        byIndex.set(call.index, slot);
      }
    }
  }
  return {
    ok: true,
    finish,
    prose,
    calls: [...byIndex.entries()].sort((x, y) => x[0] - y[0]).map(([, c]) => c),
    ms: Date.now() - started,
    total: usage?.prompt_tokens ?? 0,
    hit: usage?.prompt_cache_hit_tokens ?? 0,
    out: usage?.completion_tokens ?? 0,
    reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

// The tools, served against a tree held in memory.
function serve(tree, name, rawArgs) {
  let args;
  try { args = JSON.parse(rawArgs); } catch { return 'That call could not be read as JSON.'; }
  const path = args.path ?? '';
  if (name === 'read_file') {
    return tree.has(path) ? tree.get(path) : `There is no file at ${path}.`;
  }
  if (name === 'write_file') {
    tree.set(path, String(args.content ?? ''));
    return `Wrote ${path}, ${tree.get(path).length} bytes.`;
  }
  if (name === 'patch_file') {
    if (!tree.has(path)) return `There is no file at ${path}.`;
    const body = tree.get(path);
    const parts = body.split(args.old_text ?? '');
    if (parts.length !== 2) return `old_text appears ${parts.length - 1} times in ${path}; it must appear exactly once.`;
    tree.set(path, parts.join(args.new_text ?? ''));
    return `Patched ${path}, now ${tree.get(path).length} bytes.`;
  }
  return `No such tool: ${name}.`;
}

async function run(label, effort) {
  const system = SYSTEM(label);
  const messages = [{ role: 'user', content: TASK }];
  const tree = new Map();
  const started = Date.now();
  let reasoning = 0;
  let out = 0;
  let calls = 0;
  let turns = 0;
  let ended = 'done';
  const reads = new Set();

  for (; turns < MAX_TURNS; turns += 1) {
    const t = await turn({ system, messages, effort });
    if (!t.ok) { ended = `HTTP ${t.status}`; console.log(`   ${t.error}`); break; }
    reasoning += t.reasoning;
    out += t.out;
    console.log(`   turn ${turns + 1}: reasoning ${String(t.reasoning).padStart(5)}  `
      + `out ${String(t.out).padStart(5)}  calls ${String(t.calls.length).padStart(2)}  `
      + `cache ${String(t.total ? Math.round((t.hit / t.total) * 100) : 0).padStart(3)}%  `
      + `${(t.ms / 1000).toFixed(0).padStart(3)}s  ${t.finish}`
      + (t.calls.length ? `  ${t.calls.map((c) => `${c.name.replace('_file', '')}:${(JSON.parse(c.args || '{}').path ?? '?')}`).join(' ')}` : ''));

    if (!t.calls.length) {
      // The cliff: the whole allowance gone to the trace, nothing produced.
      ended = t.finish === 'length' ? 'CLIFF' : 'done';
      if (t.prose) console.log(`   said: “${t.prose.replace(/\s+/g, ' ').slice(0, 140)}…”`);
      turns += 1;
      break;
    }
    calls += t.calls.length;
    messages.push({
      role: 'assistant',
      content: t.prose || null,
      tool_calls: t.calls.map((c) => ({
        id: c.id, type: 'function', function: { name: c.name, arguments: c.args },
      })),
    });
    for (const c of t.calls) {
      if (c.name === 'read_file') reads.add(JSON.parse(c.args || '{}').path ?? '?');
      messages.push({ role: 'tool', tool_call_id: c.id, content: serve(tree, c.name, c.args) });
    }
  }

  const bytes = [...tree.values()].reduce((n, s) => n + s.length, 0);
  console.log(`${label.padEnd(18)} ${String(turns).padStart(2)} turns  `
    + `${String(calls).padStart(2)} calls  ${String(tree.size).padStart(2)} files  `
    + `${String(bytes).padStart(6)} bytes  reasoning ${String(reasoning).padStart(6)}  `
    + `out ${String(out).padStart(6)}  ${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s  ${ended}`);
  if (tree.size) console.log(`   files: ${[...tree.keys()].join('  ')}`);
  if (reads.size) console.log(`   read:  ${[...reads].join('  ')}`);
  console.log('');
}

console.log(`${MODEL}, preamble + empty tree, file tools served, "${TASK}"`);
console.log(`max_tokens ${MAX_TOKENS} a turn, at most ${MAX_TURNS} turns\n`);
for (const [effort, reps] of [['full', 2], ['low', 2], ['none', 2]]) {
  for (let i = 1; i <= reps; i += 1) await run(`${effort} #${i}`, effort);
}
