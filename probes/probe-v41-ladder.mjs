// Is there a ladder between 'none' and the default on V4.1, and does any rung
// of it think usefully instead of to the ceiling?
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-ladder.mjs > probes/probe-v41-ladder.out 2>&1
//
// §14 twice says there is no ladder in the middle, both times measured on the
// retired V4-Flash and both times on a prompt with no tools in front of it —
// where the spread between neighbours was larger than any trend. The tool
// measurements are the ones that mattered, and they only ever compared three
// settings: the API's own default, 'low' and 'none'.
//
// Two things have changed. probe-v41.mjs found `max` is accepted and that the
// ends differ (none → 0, low → 10, max → 43 on a trivial prompt), and
// probe-v41-cliff.mjs found 'low' now produces almost no trace at all (10 and
// 46 tokens against 1,597 and 6,886 on V4-Flash) while the default is a coin
// flip: three of six runs spent the whole allowance and produced nothing.
//
// That makes the top rung the question. The studio's `full` is "send no
// reasoning_effort", which is the coin flip. If a named rung thinks a bounded
// amount and still acts, the top of the thinking level could stop being one.
//
// Same preamble, tools and request as the cliff table, so the rows compare.

import { preamble, TOOLS, TASK, KEY, MODEL, ENDPOINT } from './probe-lib.mjs';

const MAX = Number(process.env.PROBE_MAX ?? 8192);
const REPS = Number(process.env.PROBE_REPS ?? 2);
const SYSTEM = preamble('Tank');

// 'default' is the absent parameter, which is what the studio's `full` sends.
const RUNGS = (process.env.PROBE_RUNGS ?? 'none,minimal,low,medium,high,max,default').split(',');

async function run(label, effort) {
  const started = Date.now();
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: TASK }],
    tools: TOOLS,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX,
  };
  if (effort !== 'default') body.reasoning_effort = effort;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log(`${label.padEnd(16)} HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let finish = null;
  let firstCallAt = null;
  let prose = '';
  const names = [];
  let argChars = 0;
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
        if (firstCallAt === null) firstCallAt = Date.now() - started;
        if (call.function?.name) names.push(call.function.name.replace('_file', ''));
        argChars += call.function?.arguments?.length ?? 0;
      }
    }
  }
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const out = usage?.completion_tokens ?? 0;
  const writes = names.filter((n) => n === 'write' || n === 'patch').length;
  console.log(
    `${label.padEnd(16)} reasoning ${String(reasoning).padStart(5)}/${String(out).padStart(5)} out  `
    + `calls ${String(names.length).padStart(2)} (${String(writes).padStart(2)} write)  `
    + `first at ${firstCallAt === null ? ' never' : `${(firstCallAt / 1000).toFixed(0)}s`.padStart(6)}  `
    + `${String(argChars).padStart(6)} chars  ${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s  ${finish}`,
  );
  if (names.length) console.log(`${' '.repeat(18)}${names.join(' ')}`);
  else if (prose) console.log(`${' '.repeat(18)}said only: “${prose.replace(/\s+/g, ' ').slice(0, 110)}…”`);
}

console.log(`${MODEL}, preamble + file tools, "${TASK}"`);
console.log(`max_tokens ${MAX}, one turn, ${REPS} runs a rung\n`);
for (const rung of RUNGS) {
  for (let i = 1; i <= REPS; i += 1) await run(`${rung} #${i}`, rung);
}
