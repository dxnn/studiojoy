// Does DeepSeek v4 accept an image? §14 does not cover it and the project
// measures rather than guesses. A 1x1 PNG is enough: if the parameter shape
// is rejected we learn that without paying for a real screenshot.
import fs from 'node:fs';

const apiKey = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();

// 1x1 red PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function ask(label, content) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content }],
      max_tokens: 200,
      reasoning_effort: 'none',
    }),
  });
  const body = await res.json().catch(() => null);
  console.log(`\n--- ${label}`);
  console.log(`status ${res.status}`);
  if (body?.error) console.log('error :', JSON.stringify(body.error));
  else console.log('reply :', JSON.stringify(body?.choices?.[0]?.message?.content ?? null).slice(0, 300));
}

await ask('control: plain text', 'Reply with the single word: ok');

await ask('image_url with a data URI', [
  { type: 'text', text: 'What colour is this image? One word.' },
  { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
]);

await ask('anthropic-style image block', [
  { type: 'text', text: 'What colour is this image? One word.' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
]);
