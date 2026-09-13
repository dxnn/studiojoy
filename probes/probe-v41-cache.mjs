// Does a picture on the last user message cost the ~6,000-token prefix the
// way a long message does (spec/ §14)? And does a picture itself cache?
// Run: node --use-env-proxy tmp/probe-v41-cache.mjs
import fs from 'node:fs';

const key = fs.readFileSync('tmp/deepseek.key', 'utf8').trim();
const base = 'https://api.deepseek.com/v1';
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };

const png = fs.readFileSync('public/story-art/backgrounds/forest.png');
const dataUri = `data:image/png;base64,${png.toString('base64')}`;
const big = fs.readFileSync('public/story-art/portraits/' + fs.readdirSync('public/story-art/portraits')[0]);
const bigUri = `data:image/png;base64,${big.toString('base64')}`;

// ~12 K tokens of stable system prompt, the size of a real game's file block.
const para = 'The studio keeps every game in its own git repository and commits '
  + 'each edit as it lands, so a version is a commit and nothing else. ';
const system = `You are a helper in a game studio.\n\n${para.repeat(340)}`;

let n = 0;
async function post(label, messages, extra = {}) {
  n += 1;
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      model: 'deepseek-flash',
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: 40,
      reasoning_effort: 'none',
      ...extra,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    console.log(`${label}: ${res.status} ${JSON.stringify(payload?.error).slice(0, 200)}`);
    return null;
  }
  const u = payload.usage;
  const pct = Math.round((u.prompt_cache_hit_tokens / u.prompt_tokens) * 100);
  console.log(
    `${label}\n    prompt ${u.prompt_tokens}  hit ${u.prompt_cache_hit_tokens} (${pct}%)`
    + `  miss ${u.prompt_cache_miss_tokens}  out ${u.completion_tokens}`
    + `  -> ${JSON.stringify((payload.choices[0].message.content ?? '').slice(0, 60))}`,
  );
  return payload;
}

const imageTurn = {
  role: 'user',
  content: [
    { type: 'text', text: 'What colours are in this picture? Six words max.' },
    { type: 'image_url', image_url: { url: dataUri } },
  ],
};
const shortTurn = { role: 'user', content: 'Thanks. Reply: ok' };

console.log('\n--- how many tokens is a picture');
await post('  small png (3.1 KB), alone', [imageTurn]);
await post('  same small png again (cacheable?)', [imageTurn]);
await post('  portrait png, alone', [{
  role: 'user',
  content: [
    { type: 'text', text: 'What colours are in this picture? Six words max.' },
    { type: 'image_url', image_url: { url: bigUri } },
  ],
}]);

console.log('\n--- does a picture on the last message cost the 6 K prefix');
const a = await post('  1. short last message', [shortTurn]);
const withImage = [
  shortTurn,
  { role: 'assistant', content: a?.choices?.[0]?.message?.content ?? 'ok' },
  imageTurn,
];
const b = await post('  2. extends 1, picture on the last message', withImage);
await post('  3. extends 2, short last message', [
  ...withImage,
  { role: 'assistant', content: b?.choices?.[0]?.message?.content ?? 'ok' },
  { role: 'user', content: 'And now reply: ok' },
]);

console.log('\n--- control: the same chain with a short last message throughout');
const c = await post('  4. short', [shortTurn]);
const chain = [
  shortTurn,
  { role: 'assistant', content: c?.choices?.[0]?.message?.content ?? 'ok' },
  { role: 'user', content: 'Reply: ok again' },
];
const d = await post('  5. extends 4', chain);
await post('  6. extends 5', [
  ...chain,
  { role: 'assistant', content: d?.choices?.[0]?.message?.content ?? 'ok' },
  { role: 'user', content: 'And now reply: ok' },
]);

console.log('\n--- where else may a picture go');
await post('  picture in an earlier user turn, short last message', [
  imageTurn,
  { role: 'assistant', content: 'Green and brown.' },
  { role: 'user', content: 'What did you just see? Six words max.' },
]);
