// One-off: does a DeepSeek stream carry bytes that are not content?
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-keepalive.mjs
//
// The idle guard in server/llm/deepseek.js re-arms on every read(), so any
// byte at all keeps it from firing — including an SSE comment frame
// (": keep-alive") which the parser skips at the `startsWith('data:')` line.
// If such frames exist, a wedged upstream has no ceiling on it at all.
//
// Measured per read: the gap since the previous read, and whether the chunk
// carried anything the orchestrator would act on (reasoning, content, a tool
// fragment, usage). Two numbers come out of it:
//   maxGap     — longest silence between reads (what today's guard sees)
//   maxDryGap  — longest silence between *content-bearing* frames
// and the count of non-`data:` lines, which is the whole question.

import fs from 'node:fs';

const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const MODEL = process.env.PROBE_MODEL ?? 'deepseek-v4-flash';

// Long enough to make it think hard, small enough to bound the bill.
const HEAVY = [
  'Design the complete architecture for a browser game: a side-scrolling',
  'platformer with a level editor, save files, gamepad support and a replay',
  'system. Think the whole thing through — every module, every file, every',
  'edge case, the data formats, the failure modes — before you write a single',
  'word of the answer. Be exhaustive in your reasoning.',
].join(' ');

async function probe(label, { messages, maxTokens }) {
  const started = process.hrtime.bigint();
  const ms = () => Number(process.hrtime.bigint() - started) / 1e6;

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
    }),
  });
  const headersAt = ms();
  if (!res.ok) {
    console.log(`${label}: HTTP ${res.status} ${await res.text()}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reads = 0;
  let bytes = 0;
  let comments = 0;
  let blanks = 0;          // data: frames carrying no delta the loop acts on
  let reasoningFrames = 0;
  let contentFrames = 0;
  let firstByteAt = null;
  let lastReadAt = null;
  let lastDryAt = null;    // last read that carried something actionable
  let maxGap = 0;
  let maxDryGap = 0;
  let gapAtMax = null;
  const samples = [];
  let finish = null;
  let usage = null;

  for (;;) {
    const { done, value } = await reader.read();
    const at = ms();
    if (done) break;
    reads += 1;
    bytes += value.length;
    if (firstByteAt === null) {
      firstByteAt = at;
      lastReadAt = at;
      lastDryAt = at;
    }
    const gap = at - lastReadAt;
    if (gap > maxGap) { maxGap = gap; gapAtMax = at; }
    lastReadAt = at;

    buffer += decoder.decode(value, { stream: true });
    let actionable = false;
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl === -1) break;
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line === '') continue;
      if (!line.startsWith('data:')) {
        comments += 1;
        if (samples.length < 5) samples.push(`${at.toFixed(0)}ms  ${JSON.stringify(line)}`);
        continue;
      }
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let chunk;
      try { chunk = JSON.parse(payload); } catch { continue; }
      if (chunk.usage) { usage = chunk.usage; actionable = true; }
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finish = choice.finish_reason;
      const delta = choice?.delta ?? {};
      if (delta.reasoning_content) { reasoningFrames += 1; actionable = true; }
      if (delta.content) { contentFrames += 1; actionable = true; }
      if (delta.tool_calls) actionable = true;
      if (!actionable) blanks += 1;
    }
    if (actionable) {
      const dry = at - lastDryAt;
      if (dry > maxDryGap) maxDryGap = dry;
      lastDryAt = at;
    }
  }

  const total = ms();
  console.log(`\n=== ${label} (${MODEL}) ===`);
  console.log(`headers at        ${headersAt.toFixed(0)}ms`);
  console.log(`first byte at     ${firstByteAt?.toFixed(0)}ms`);
  console.log(`stream ended at   ${total.toFixed(0)}ms`);
  console.log(`reads             ${reads} (${bytes} bytes)`);
  console.log(`reasoning frames  ${reasoningFrames}`);
  console.log(`content frames    ${contentFrames}`);
  console.log(`non-data: lines   ${comments}   <-- the question`);
  console.log(`empty data frames ${blanks}`);
  console.log(`max gap           ${maxGap.toFixed(0)}ms${gapAtMax ? ` (at ${gapAtMax.toFixed(0)}ms)` : ''}`);
  console.log(`max dry gap       ${maxDryGap.toFixed(0)}ms  (silence between actionable frames)`);
  console.log(`finish_reason     ${finish}`);
  console.log(`usage             ${JSON.stringify(usage)}`);
  if (samples.length) {
    console.log('non-data samples:');
    for (const s of samples) console.log(`  ${s}`);
  }
}

await probe('trivial', {
  messages: [{ role: 'user', content: 'Say OK.' }],
  maxTokens: 64,
});
await probe('heavy think', {
  messages: [{ role: 'user', content: HEAVY }],
  maxTokens: 4096,
});
