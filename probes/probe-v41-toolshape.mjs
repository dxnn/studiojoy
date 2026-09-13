// The exact tool-result shape the studio is about to ship: a label and a
// picture in one `role: 'tool'` message, inside a real tool loop.
// Run: node --use-env-proxy tmp/probe-v41-toolshape.mjs
import fs from 'node:fs';

const key = fs.readFileSync('tmp/deepseek.key', 'utf8').trim();
const base = 'https://api.deepseek.com/v1';
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
const png = fs.readFileSync('public/story-art/backgrounds/forest.png');
const url = `data:image/png;base64,${png.toString('base64')}`;

const tools = [{
  type: 'function',
  function: {
    name: 'look_at',
    description: 'Look at a picture in the game: a PNG, JPEG, GIF or WebP under assets/.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
}];

async function post(label, messages, extra = {}) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      model: 'deepseek-flash', messages, tools, max_tokens: 150,
      reasoning_effort: 'none', ...extra,
    }),
  });
  const p = await res.json().catch(() => null);
  if (!res.ok) {
    console.log(`${label}\n    ${res.status} ${JSON.stringify(p?.error?.message ?? p).slice(0, 250)}`);
    return null;
  }
  const m = p.choices[0].message;
  console.log(`${label}\n    prompt ${p.usage.prompt_tokens}  calls ${JSON.stringify(m.tool_calls?.map((c) => c.function) ?? null)}\n    text ${JSON.stringify((m.content ?? '').slice(0, 160))}`);
  return m;
}

const system = 'You are a helper in a game studio. The game has one picture: '
  + 'assets/sprites/hero.png (3177 bytes).';
const first = [
  { role: 'system', content: system },
  { role: 'user', content: 'What colour is the hero? Look first, then answer in six words.' },
];

const asked = await post('1. the model asks to look', first);

const call = asked?.tool_calls?.[0] ?? {
  id: 'call_1', type: 'function', function: { name: 'look_at', arguments: '{"path":"assets/sprites/hero.png"}' },
};

await post('2. the label and the picture in one tool result', [
  ...first,
  { role: 'assistant', content: asked?.content ?? null, tool_calls: [call] },
  {
    role: 'tool',
    tool_call_id: call.id,
    content: [
      { type: 'text', text: 'assets/sprites/hero.png (3177 bytes)' },
      { type: 'image_url', image_url: { url } },
    ],
  },
]);

await post('3. a refusal is still a plain string', [
  ...first,
  { role: 'assistant', content: null, tool_calls: [call] },
  { role: 'tool', tool_call_id: call.id, content: 'no such file: assets/sprites/hero.png' },
]);
