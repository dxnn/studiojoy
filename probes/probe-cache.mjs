// One-off: measure DeepSeek's real prefix-cache hit rate for the two places
// the ambient file block could live (spec.md §8). Not part of npm test.
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-cache.mjs
//
// Shape A (what the code does today): the file block is glued onto the last
// user message, so it sits *after* all history.
// Shape B (the alternative): the file block goes in the system prompt, so it
// sits *before* all history.
//
// Between two fires, history grows. That is what decides which shape keeps its
// prefix stable. Within one fire the tool loop appends, which is a third case
// (A1b) worth measuring because it is where 24 turns actually get paid for.

import fs from 'node:fs';

const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const MODEL = 'deepseek-v4-flash';

const PREAMBLE = [
  'You are an agent in Game Studio, working with people on the browser game "Redwolf Radness".',
  'The project is a working tree of files. Every change is committed to git, so nothing is unrecoverable.',
  '',
  'Paths are project-relative and / separated: no leading slash, no "..", no ".git", at most 8 segments.',
  '',
  'You have file tools. Prefer patch_file over write_file when changing a file that already exists —',
  'it is cheaper and cannot silently lose the parts you did not mean to touch.',
  '',
  'The game is served from a different origin than the studio, so absolute URLs back to the studio',
  'will not resolve. Use relative paths inside the game.',
].join('\n');

const game = fs.readFileSync('games/redwolf-radness/index.html', 'utf8');
const filesBlock = (body) => [
  `PROJECT FILES\nindex.html (${body.length} bytes)`,
  `--- FILE: index.html (${body.length} bytes) ---\n${body}\n--- END FILE ---`,
].join('\n\n');

const FILES = filesBlock(game);
// One byte changed, deep in the file: the "a helper edited something" case.
const FILES_EDITED = filesBlock(game.replace('const', 'let'));

const h1 = '[Dann] make the wolf jump higher';
const r1 = 'Raised the jump impulse and shortened the coyote window.';
const m1 = '[Dann] now make the ground scroll faster';
const r2 = 'Ground speed is up 40%.';
const m2 = '[Dann] the wolf falls through the floor sometimes';

const u = (content) => ({ role: 'user', content });
const a = (content) => ({ role: 'assistant', content });

async function ask(label, { system, messages }) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: 8,
      reasoning_effort: 'none',
    }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(`${label}: ${res.status} ${JSON.stringify(payload)}`);
  const usage = payload.usage ?? {};
  const total = usage.prompt_tokens ?? 0;
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? 0;
  return {
    label, total, hit, miss, pct: total ? Math.round((hit / total) * 100) : 0,
  };
}

const rows = [];
const run = async (label, req) => {
  const row = await ask(label, req);
  rows.push(row);
  console.log(`${label.padEnd(4)} ${String(row.total).padStart(7)} total  `
    + `${String(row.hit).padStart(7)} hit  ${String(row.miss).padStart(7)} miss  ${row.pct}%`);
};

// --- Shape A: file block on the last user message (today) -------------------
await run('A1', { system: PREAMBLE, messages: [u(h1), a(r1), u(`${FILES}\n\n${m1}`)] });

// A1b: turn 2 of the same fire. Everything before the appended tool exchange
// is byte-identical to A1, which is the case the current design is good at.
await run('A1b', {
  system: PREAMBLE,
  messages: [
    u(h1), a(r1), u(`${FILES}\n\n${m1}`),
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_0',
        type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) },
      }],
    },
    { role: 'tool', tool_call_id: 'call_0', content: 'index.html (200 bytes)\n<!doctype html>' },
  ],
});

// A2: the next fire. Two more turns of history landed *before* the file block.
await run('A2', {
  system: PREAMBLE,
  messages: [u(h1), a(r1), u(m1), a(r2), u(`${FILES}\n\n${m2}`)],
});

// A3: same fire as A2, but a file changed too.
await run('A3', {
  system: PREAMBLE,
  messages: [u(h1), a(r1), u(m1), a(r2), u(`${FILES_EDITED}\n\n${m2}`)],
});

// --- Shape B: file block in the system prompt -------------------------------
const SYS_B = `${PREAMBLE}\n\n${FILES}`;
await run('B1', { system: SYS_B, messages: [u(h1), a(r1), u(m1)] });

// B2: the next fire, history appended after the block rather than before it.
await run('B2', { system: SYS_B, messages: [u(h1), a(r1), u(m1), a(r2), u(m2)] });

// B3: the next fire after a file changed — the case shape B is bad at.
await run('B3', {
  system: `${PREAMBLE}\n\n${FILES_EDITED}`,
  messages: [u(h1), a(r1), u(m1), a(r2), u(m2)],
});

console.log('\nsummary');
for (const r of rows) {
  console.log(`  ${r.label.padEnd(4)} hit ${r.pct}%  (${r.hit}/${r.total}, miss ${r.miss})`);
}
console.log(`\ngame file: ${game.length} bytes`);
