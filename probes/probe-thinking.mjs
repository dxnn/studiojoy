// One-off: how much of the output allowance can be steered away from the
// reasoning trace and towards the answer?
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-thinking.mjs
//
// §14 measured `reasoning_effort` on a *trivial* prompt, where 'minimal' and
// 'low' both produced more trace than the default — noise, not a ladder. This
// re-measures on a prompt heavy enough that baseline reasoning eats the whole
// allowance, which is the case that matters: a helper asked to build a game.
//
// Unknown parameters are silently ignored (§14), so a budget parameter cannot
// be probed by looking for an error — only by its effect on reasoning_tokens.
// Three candidate spellings are tried for that reason.
//
// Reported per variant: reasoning tokens, answer tokens, wall time,
// finish_reason. A variant that produces answer tokens where the baseline
// produces none is the whole point.

import fs from 'node:fs';

const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const MODEL = process.env.PROBE_MODEL ?? 'deepseek-v4-flash';
const MAX = 8192;

// Ambitious enough to invite a long think, but with a short answer available:
// the ratio is the measurement.
const PROMPT = [
  'You are building a browser game: a side-scrolling platformer with a level',
  'editor, save files, gamepad support and a replay system. Plan the whole',
  'thing, then answer with just the list of files you would create, one line',
  'each, path and a half-sentence of purpose. Nothing else.',
].join(' ');

const VARIANTS = [
  ['baseline (no param)', {}],
  ["effort 'minimal'", { reasoning_effort: 'minimal' }],
  ["effort 'low'", { reasoning_effort: 'low' }],
  ["effort 'medium'", { reasoning_effort: 'medium' }],
  ["effort 'high'", { reasoning_effort: 'high' }],
  ["effort 'none'", { reasoning_effort: 'none' }],
  ['thinking.budget_tokens 512', { thinking: { type: 'enabled', budget_tokens: 512 } }],
  ['max_reasoning_tokens 512', { max_reasoning_tokens: 512 }],
  ['reasoning_max_tokens 512', { reasoning_max_tokens: 512 }],
];

async function run(label, extra) {
  const started = process.hrtime.bigint();
  const ms = () => Number(process.hrtime.bigint() - started) / 1e6;
  let res;
  try {
    res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: PROMPT }],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: MAX,
        ...extra,
      }),
    });
  } catch (err) {
    console.log(`${label.padEnd(28)} request failed: ${err.message}`);
    return;
  }
  if (!res.ok) {
    console.log(`${label.padEnd(28)} HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let finish = null;
  let content = '';
  let firstContentAt = null;
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
      const delta = choice?.delta?.content;
      if (delta) {
        if (firstContentAt === null) firstContentAt = ms();
        content += delta;
      }
    }
  }
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const out = usage?.completion_tokens ?? 0;
  console.log(
    `${label.padEnd(28)} reasoning ${String(reasoning).padStart(5)}  `
    + `answer ${String(out - reasoning).padStart(5)}  `
    + `first answer byte ${firstContentAt === null ? '   none' : `${(firstContentAt / 1000).toFixed(1)}s`.padStart(7)}  `
    + `total ${(ms() / 1000).toFixed(1).padStart(5)}s  ${finish}`,
  );
  if (content) console.log(`${' '.repeat(30)}“${content.slice(0, 70).replace(/\n/g, ' ⏎ ')}…”`);
}

console.log(`${MODEL}, max_tokens ${MAX}, same heavy prompt each time\n`);
for (const [label, extra] of VARIANTS) await run(label, extra);
