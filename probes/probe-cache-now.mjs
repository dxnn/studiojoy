// One-off (2026-08-30): the studio's receipts say "0 remembered" on every
// reply. Send the same prompt twice, back to back, and print the raw usage
// object each time. If the second request reports cached tokens somewhere
// but prompt_cache_hit_tokens is 0 or gone, DeepSeek changed the field; if
// nothing anywhere reports a hit, the cache itself stopped serving us.
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-cache-now.mjs

import fs from 'node:fs';

const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const MODEL = 'deepseek-v4-flash';

// Comfortably past the 64-token cache block size.
const SYSTEM = [
  'You are an agent in Game Studio, working with people on the browser game "Redwolf Radness".',
  'The project is a working tree of files. Every change is committed to git, so nothing is unrecoverable.',
  'Paths are project-relative and / separated: no leading slash, no "..", no ".git", at most 8 segments.',
  'You have file tools. Prefer patch_file over write_file when changing a file that already exists.',
  'The game is served from a different origin than the studio, so absolute URLs back to the studio',
  'will not resolve. Use relative paths inside the game. Keep your reply short.',
].join('\n');

async function ask(label) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: 'Say the word ready and nothing else.' },
      ],
      max_tokens: 8,
      reasoning_effort: 'none',
    }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(`${label}: ${res.status} ${JSON.stringify(payload)}`);
  console.log(`${label} usage: ${JSON.stringify(payload.usage, null, 2)}`);
}

await ask('first ');
await ask('second');
