// One-off: measure what the file block's internal order is worth to the
// prefix cache when a file changes between fires (spec.md §8). Companion to
// probe-cache.mjs, which measured where the block should live; this measures
// how it should be ordered inside. Not part of npm test.
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-order.mjs
//
// OLD shape (before b074082): tree with exact sizes first, sections
// alphabetical, so any edit changes the tree and re-bills the whole block.
// NEW shape: sections least-recently-modified first, tree last, so an edit
// re-bills only from the changed file's section onward.
//
// The project is a real one (space-racer, nine text files). js/game.js plays
// the "hot" file an agent is iterating on; config/look.js plays a cold file
// edited once, which under mtime ordering moves to the tail and is cheap to
// edit from then on.

import fs from 'node:fs';
import path from 'node:path';

const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const MODEL = 'deepseek-v4-flash';
const GAME = 'games/space-racer';

// SALT makes every prompt of a run unique, so a re-run cannot hit the cache
// the previous run wrote. SLEEP_MS spaces the requests out: divergent-prefix
// lookups seem to need the earlier entry to have finished building, which an
// immediate back-to-back request is too fast for (run 1 measured exactly
// that), while real fires are minutes apart.
const SALT = process.env.SALT ?? '';
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 0);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const PREAMBLE = [
  `You are an agent in Game Studio${SALT ? ` (${SALT})` : ''}, working with people on the browser game "Space Racer".`,
  'The project is a working tree of files. Every change is committed to git, so nothing is unrecoverable.',
  '',
  'Paths are project-relative and / separated: no leading slash, no "..", no ".git", at most 8 segments.',
].join('\n');

const PATHS = [
  'index.html', 'css/style.css', 'js/track.js', 'config/controls.js',
  'config/words.js', 'config/world.js', 'config/play.js', 'config/look.js',
  'js/game.js',
];
const read = () => Object.fromEntries(
  PATHS.map((p) => [p, fs.readFileSync(path.join(GAME, p), 'utf8')]),
);

const section = (p, body) =>
  `--- FILE: ${p} (${Buffer.byteLength(body)} bytes) ---\n${body}\n--- END FILE ---`;
const tree = (files) => `PROJECT FILES\n${[...PATHS].sort()
  .map((p) => `${p} (${Buffer.byteLength(files[p])} bytes)`).join('\n')}`;

// OLD: tree first, sections alphabetical. NEW: sections in the given
// (coldest-first) order, tree last.
const oldSys = (files) => [PREAMBLE, tree(files),
  ...[...PATHS].sort().map((p) => section(p, files[p]))].join('\n\n');
const newSys = (files, order) => [PREAMBLE,
  ...order.map((p) => section(p, files[p])), tree(files)].join('\n\n');

// order0: js/game.js is the file being iterated on, so it sits at the tail.
// After config/look.js is edited it becomes the most recent and moves there.
const order0 = PATHS;
const order1 = [...PATHS.filter((p) => p !== 'config/look.js'), 'config/look.js'];

const v0 = read();
const v1 = { ...v0, 'js/game.js': v0['js/game.js'].replace('const', 'let') };
const v2 = { ...v1, 'config/look.js': `${v1['config/look.js']}\n// tuned\n` };
const v3 = { ...v2, 'config/look.js': `${v2['config/look.js']}// tuned again\n` };

const u = (content) => ({ role: 'user', content });
const a = (content) => ({ role: 'assistant', content });
// Fire N carries the history all earlier fires saw, plus two more turns.
const HIST = [
  u('[Dann] make the ship drift a little in the corners'),
  a('Added drift to the steering model.'),
  u('[Dann] now the boost feels weak'),
  a('Boost impulse is up 30%.'),
  u('[Dann] the ai cars still win too easily'),
  a('Slowed the rubber-banding.'),
  u('[Dann] colours are too dark on the second track'),
  a('Brightened the track two palette.'),
  u('[Dann] a touch more'),
];
const hist = (turns) => HIST.slice(0, turns);

async function ask(label, system, messages) {
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
  const { prompt_tokens: total = 0, prompt_cache_hit_tokens: hit = 0,
    prompt_cache_miss_tokens: miss = 0 } = payload.usage ?? {};
  const row = { label, total, hit, miss, pct: total ? Math.round((hit / total) * 100) : 0 };
  console.log(`${label.padEnd(28)} ${String(total).padStart(6)} total `
    + `${String(hit).padStart(6)} hit ${String(miss).padStart(6)} miss  ${row.pct}%`);
  if (SLEEP_MS > 0) await sleep(SLEEP_MS);
  return row;
}

// Stage 2 (STAGE=2, same SALT): the steady-state fires. The cache serves a
// partial prefix only up to a branch point an earlier divergence created, so
// the first edit at a given depth is a full miss and the repeats are what
// production actually looks like — an agent iterating on the same tail file.
const v4 = { ...v3, 'config/look.js': `${v3['config/look.js']}// third pass\n` };
const v5 = { ...v4, 'config/look.js': `${v4['config/look.js']}// fourth pass\n` };
const o3 = { ...v1, 'js/game.js': v1['js/game.js'].replace('let', 'var') };

if (process.env.STAGE === '2') {
  console.log('--- steady state: the same file edited again ---');
  await ask('N6 tail file, third edit', newSys(v4, order1), hist(9));
  await ask('N7 tail file, fourth edit', newSys(v5, order1), hist(9));
  await ask('O3 old shape, third edit', oldSys(o3), hist(5));
} else {
  console.log('--- NEW shape: contents coldest-first, tree last ---');
  await ask('N1 prime', newSys(v0, order0), hist(1));
  await ask('N2 next fire, no edit', newSys(v0, order0), hist(3));
  await ask('N3 hot file edited', newSys(v1, order0), hist(5));
  await ask('N4 cold file edited (moves)', newSys(v2, order1), hist(7));
  await ask('N5 same file edited again', newSys(v3, order1), hist(9));

  console.log('--- OLD shape: tree first, sections alphabetical ---');
  await ask('O1 prime', oldSys(v0), hist(1));
  await ask('O2 hot file edited', oldSys(v1), hist(3));
}
