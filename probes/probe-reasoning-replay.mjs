// Does a tool-call continuation get billed for the previous request's
// reasoning, even though the client never sends it back? The receipts say
// yes; this measures it directly, and asks the two follow-ups that matter
// for a 40-request fire:
//   1. Does the replayed reasoning ACCUMULATE round over round?
//   2. Does a role:'user' turn close the chain and shed it?
//
// Run: node --use-env-proxy probes/probe-reasoning-replay.mjs

import fs from 'node:fs';
import { createDeepSeek } from '../server/llm/deepseek.js';

const key = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const llm = createDeepSeek({ apiKey: key });

const tools = [{
  type: 'function',
  function: {
    name: 'save_note',
    description: 'Save one short note',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
}];

const rows = [];

async function run(label, messages) {
  let usage = null;
  let text = '';
  const calls = [];
  for await (const e of llm.stream({ model: 'deepseek-v4-flash', messages, tools })) {
    if (e.type === 'delta') text += e.text;
    else if (e.type === 'tool_use') calls.push(e);
    else if (e.type === 'end') usage = e.usage;
  }
  const row = {
    label,
    miss: usage.prompt_cache_miss_tokens,
    hit: usage.prompt_cache_hit_tokens,
    prompt: usage.prompt_tokens,
    out: usage.completion_tokens,
    reasoning: usage.completion_tokens_details?.reasoning_tokens ?? null,
    visible_chars: text.length + calls.reduce((n, c) => n + JSON.stringify(c.input).length, 0),
    calls: calls.length,
  };
  rows.push(row);
  console.log(row);
  return { text, calls };
}

const messages = [{
  role: 'user',
  content: 'Think step by step. Save three short notes, one save_note call per'
    + ' turn: first a pun about clocks, then one about cheese, then one about'
    + ' the sea. After the third tool result, reply with just: done',
}];

// The orchestrator's loop, verbatim in miniature.
for (let round = 1; round <= 5; round += 1) {
  const { text, calls } = await run(`round ${round}`, messages);
  if (calls.length === 0) break;
  messages.push({
    role: 'assistant',
    content: text || null,
    tool_calls: calls.map((c) => ({
      id: c.id, type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.input) },
    })),
  });
  for (const c of calls) {
    messages.push({ role: 'tool', tool_call_id: c.id, content: 'saved' });
  }
}

// Now close the turn with a user message: is the accumulated reasoning shed?
messages.push({ role: 'user', content: 'save one more, about rain, then reply: done' });
const { text, calls } = await run('after user turn', messages);
if (calls.length > 0) {
  messages.push({
    role: 'assistant',
    content: text || null,
    tool_calls: calls.map((c) => ({
      id: c.id, type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.input) },
    })),
  });
  for (const c of calls) {
    messages.push({ role: 'tool', tool_call_id: c.id, content: 'saved' });
  }
  await run('continuation after user turn', messages);
}

console.log('\nprompt growth per round vs previous out (replay = growth ≈ out):');
for (let i = 1; i < rows.length; i += 1) {
  console.log(
    `${rows[i].label}: grew ${rows[i].prompt - rows[i - 1].prompt},`
    + ` previous out ${rows[i - 1].out}`
    + ` (of which reasoning ${rows[i - 1].reasoning}),`
    + ` previous visible ~${Math.round(rows[i - 1].visible_chars / 4)} tokens`,
  );
}
