// Where may a picture sit? The ambient file block lives in the system prompt
// (spec/ §8); the vision guide says images are user-message only. Measure it,
// and measure whether a tool result can carry one.
// Run: node --use-env-proxy tmp/probe-v41-where.mjs
import fs from 'node:fs';

const key = fs.readFileSync('tmp/deepseek.key', 'utf8').trim();
const base = 'https://api.deepseek.com/v1';
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
const png = fs.readFileSync('public/story-art/backgrounds/forest.png');
const url = `data:image/png;base64,${png.toString('base64')}`;
const ask = 'What colours are in the picture you were given? Six words max.';

async function post(label, body) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: H, body: JSON.stringify({ max_tokens: 60, reasoning_effort: 'none', model: 'deepseek-flash', ...body }),
  });
  const p = await res.json().catch(() => null);
  if (!res.ok) {
    console.log(`${label}\n    ${res.status} ${JSON.stringify(p?.error?.message ?? p).slice(0, 220)}`);
    return;
  }
  console.log(`${label}\n    prompt ${p.usage.prompt_tokens}  -> ${JSON.stringify(p.choices[0].message.content?.slice(0, 70))}`);
}

await post('picture in the SYSTEM message (content array)', {
  messages: [
    { role: 'system', content: [{ type: 'text', text: 'You are a helper.' }, { type: 'image_url', image_url: { url } }] },
    { role: 'user', content: ask },
  ],
});

await post('picture in an ASSISTANT message', {
  messages: [
    { role: 'user', content: 'Show me the picture.' },
    { role: 'assistant', content: [{ type: 'text', text: 'Here:' }, { type: 'image_url', image_url: { url } }] },
    { role: 'user', content: ask },
  ],
});

await post('picture in a TOOL result', {
  messages: [
    { role: 'user', content: 'Look at assets/hero.png' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'look_at', arguments: '{"path":"assets/hero.png"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: [{ type: 'image_url', image_url: { url } }] },
    { role: 'user', content: ask },
  ],
});

await post('control: picture in a USER message', {
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Here is a picture.' }, { type: 'image_url', image_url: { url } }] },
    { role: 'user', content: ask },
  ],
});

await post('two pictures, one user message, named by text', {
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'assets/a.png:' }, { type: 'image_url', image_url: { url } },
      { type: 'text', text: 'assets/b.png:' }, { type: 'image_url', image_url: { url } },
      { type: 'text', text: 'How many pictures did you get, and what are they called?' },
    ],
  }],
});
