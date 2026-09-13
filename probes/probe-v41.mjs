// What changed on 2026-09-10, measured rather than read off the changelog.
// Run: node --use-env-proxy tmp/probe-v41.mjs
import fs from 'node:fs';

const key = fs.readFileSync('tmp/deepseek.key', 'utf8').trim();
const base = 'https://api.deepseek.com/v1';
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };

const png = fs.readFileSync('public/story-art/backgrounds/forest.png');
const dataUri = `data:image/png;base64,${png.toString('base64')}`;

async function post(label, body) {
  const started = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: H, body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  const ms = Date.now() - started;
  const choice = payload?.choices?.[0];
  console.log(`\n=== ${label} (${res.status}, ${ms}ms)`);
  if (!res.ok) {
    console.log('  error:', JSON.stringify(payload?.error ?? payload).slice(0, 400));
    return null;
  }
  console.log('  text:', JSON.stringify((choice?.message?.content ?? '').slice(0, 200)));
  console.log('  finish:', choice?.finish_reason);
  console.log('  usage:', JSON.stringify(payload?.usage));
  return payload;
}

const models = await fetch(`${base}/models`, { headers: H }).then((r) => r.json());
console.log('=== GET /v1/models');
console.log(' ', JSON.stringify(models));

const imageMessage = [{
  role: 'user',
  content: [
    { type: 'text', text: 'Name the two main colours in this picture. Six words max.' },
    { type: 'image_url', image_url: { url: dataUri } },
  ],
}];

await post('deepseek-flash + image, effort none', {
  model: 'deepseek-flash', messages: imageMessage, max_tokens: 64, reasoning_effort: 'none',
});

await post('deepseek-v4-flash (legacy alias) + image', {
  model: 'deepseek-v4-flash', messages: imageMessage, max_tokens: 64, reasoning_effort: 'none',
});

await post('deepseek-v4-pro + image', {
  model: 'deepseek-v4-pro', messages: imageMessage, max_tokens: 64, reasoning_effort: 'none',
});

await post('deepseek-flash, text only, effort none', {
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  max_tokens: 16, reasoning_effort: 'none',
});

await post('deepseek-flash, text only, effort low', {
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  max_tokens: 64, reasoning_effort: 'low',
});

await post('deepseek-flash, effort max', {
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  max_tokens: 64, reasoning_effort: 'max',
});

await post('deepseek-flash, image + tools + effort none', {
  model: 'deepseek-flash',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Write what you see into notes.txt using write_file.' },
      { type: 'image_url', image_url: { url: dataUri } },
    ],
  }],
  tools: [{
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a file or replace its contents.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  }],
  max_tokens: 200, reasoning_effort: 'none',
}).then((p) => {
  const calls = p?.choices?.[0]?.message?.tool_calls;
  if (calls) console.log('  tool_calls:', JSON.stringify(calls).slice(0, 300));
});

await post('deepseek-flash, max_tokens 200000 (is 65536 still the ceiling?)', {
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  max_tokens: 200000, reasoning_effort: 'none',
});
