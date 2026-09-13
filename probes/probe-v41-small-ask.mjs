// `none` against `low` on the fire the studio actually runs at `low`.
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-small-ask.mjs > probes/probe-v41-small-ask.out 2>&1
//
// ⚠️ probe-v41-none-vs-low.mjs builds a whole game from an empty tree, which
// is *not* the shape of the studio's commonest non-`none` fire. `BUILDER_
// THINKING` is `'low'` and it is spent on a **small ask against an existing
// tree** — a value, a line, a bug (server/builder.js, spec/ §8). A piece of a
// plan already runs at `none`. So if `low` is to be deleted, this is the arm
// that has to clear it.
//
// §14's V4-Flash step table found editing thinks *more* than creating: step 1
// on an empty tree produced 0/19/157 reasoning tokens at `'low'`, step 2 on
// step 1's files produced 264/1,571/3,651. If that still holds on V4.1, a
// small ask is exactly where a trace would earn its place — or fail to.
//
// Three asks, from §14's own sizing table so the rows are familiar: one plain
// edit, one vaguer report, one that names no file. Each run is a closed tool
// loop against a real copy of space-racer.
//
// Scored: turns and calls used (the studio's budget is 24 and 40), how many
// files it touched (a small ask should touch one), whether every .js still
// parses afterwards, and the trace it spent. The tree is kept for reading.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { preamble, fileBlock, TOOLS, KEY, MODEL, ENDPOINT } from './probe-lib.mjs';

const GAME = 'games/space-racer';
const MAX_TURNS = Number(process.env.PROBE_TURNS ?? 8);
const MAX_TOKENS = Number(process.env.PROBE_MAX ?? 16384);
const IDLE_MS = Number(process.env.PROBE_IDLE_MS ?? 120_000);
const TREES = 'tmp/small-ask-trees';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

const ASKS = [
  ['turn', 'make the ship turn a bit faster'],
  ['broken', "it doesn't work when I hold both arrow keys"],
  ['rivals', 'the rivals are too easy to beat'],
];

const files = fileBlock(GAME);

// The game's text files, as the loop's starting tree.
function loadTree() {
  const tree = new Map();
  const walk = (sub) => {
    for (const entry of fs.readdirSync(path.join(GAME, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) walk(rel);
      else if (!/\.(png|wav|mp3|jpg|jpeg|gif|webp)$/i.test(rel)) {
        tree.set(rel, fs.readFileSync(path.join(GAME, rel), 'utf8'));
      }
    }
  };
  walk('');
  return tree;
}

async function turn({ system, messages, effort }) {
  const started = Date.now();
  const controller = new AbortController();
  let idle = null;
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), IDLE_MS);
  };
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: system }, ...messages],
    tools: TOOLS,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX_TOKENS,
  };
  if (effort !== 'full') body.reasoning_effort = effort;

  let res;
  try {
    bump();
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(idle);
    return { ok: false, stalled: controller.signal.aborted, error: String(err).slice(0, 120) };
  }
  if (!res.ok) {
    clearTimeout(idle);
    return { ok: false, status: res.status, error: (await res.text()).slice(0, 200) };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let finish = null;
  let prose = '';
  const byIndex = new Map();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bump();
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const nl = buffer.indexOf('\n');
        if (nl === -1) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const delta = choice?.delta ?? {};
        if (delta.content) prose += delta.content;
        for (const call of delta.tool_calls ?? []) {
          const slot = byIndex.get(call.index) ?? { id: null, name: '', args: '' };
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name = call.function.name;
          slot.args += call.function?.arguments ?? '';
          byIndex.set(call.index, slot);
        }
      }
    }
  } catch (err) {
    clearTimeout(idle);
    return { ok: false, stalled: controller.signal.aborted, error: String(err).slice(0, 120) };
  }
  clearTimeout(idle);

  return {
    ok: true,
    finish,
    prose,
    calls: [...byIndex.entries()].sort((x, y) => x[0] - y[0]).map(([, c]) => c),
    ms: Date.now() - started,
    total: usage?.prompt_tokens ?? 0,
    hit: usage?.prompt_cache_hit_tokens ?? 0,
    out: usage?.completion_tokens ?? 0,
    reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

function serve(tree, touched, name, rawArgs) {
  let args;
  try { args = JSON.parse(rawArgs); } catch { return 'That call could not be read as JSON.'; }
  const p = args.path ?? '';
  if (name === 'read_file') return tree.has(p) ? tree.get(p) : `There is no file at ${p}.`;
  if (name === 'write_file') {
    tree.set(p, String(args.content ?? ''));
    touched.add(p);
    return `Wrote ${p}, ${tree.get(p).length} bytes.`;
  }
  if (name === 'patch_file') {
    if (!tree.has(p)) return `There is no file at ${p}.`;
    const parts = tree.get(p).split(args.old_text ?? '');
    if (parts.length !== 2) return `old_text appears ${parts.length - 1} times in ${p}; it must appear exactly once.`;
    tree.set(p, parts.join(args.new_text ?? ''));
    touched.add(p);
    return `Patched ${p}, now ${tree.get(p).length} bytes.`;
  }
  return `No such tool: ${name}.`;
}

async function run(label, effort, ask) {
  const system = `Run ${STAMP} · Arm ${label}.\n\n${preamble('Space Racer')}\n\n${files}`;
  const messages = [{ role: 'user', content: `[Dann] ${ask}` }];
  const tree = loadTree();
  const before = new Map(tree);
  const touched = new Set();
  const started = Date.now();
  const traces = [];
  let out = 0;
  let calls = 0;
  let reads = 0;
  let turns = 0;
  let ended = 'ran out of turns';
  let reply = '';

  for (; turns < MAX_TURNS; turns += 1) {
    const t = await turn({ system, messages, effort });
    if (!t.ok) {
      ended = t.stalled ? `STALLED (no bytes for ${IDLE_MS / 1000}s)` : `HTTP ${t.status ?? '?'}`;
      console.log(`   ${t.error}`);
      turns += 1;
      break;
    }
    traces.push(t.reasoning);
    out += t.out;
    if (!t.calls.length) {
      ended = t.finish === 'length' ? 'CLIFF' : 'finished on its own';
      reply = t.prose;
      turns += 1;
      break;
    }
    calls += t.calls.length;
    reads += t.calls.filter((c) => c.name === 'read_file').length;
    messages.push({
      role: 'assistant',
      content: t.prose || null,
      tool_calls: t.calls.map((c) => ({
        id: c.id, type: 'function', function: { name: c.name, arguments: c.args },
      })),
    });
    for (const c of t.calls) {
      messages.push({ role: 'tool', tool_call_id: c.id, content: serve(tree, touched, c.name, c.args) });
    }
  }

  // Only the files it actually changed, and only where the bytes differ.
  const changed = [...touched].filter((p) => tree.get(p) !== before.get(p));
  const dir = path.join(TREES, label.replace(/[^a-z0-9]+/gi, '-'));
  fs.rmSync(dir, { recursive: true, force: true });
  for (const p of changed) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, tree.get(p));
  }
  const bad = [];
  for (const p of changed) {
    if (!p.endsWith('.js')) continue;
    try {
      execFileSync(process.execPath, ['--check', path.join(dir, p)], { stdio: 'pipe' });
    } catch { bad.push(p); }
  }

  const reasoning = traces.reduce((n, r) => n + r, 0);
  console.log(`${label.padEnd(20)} ${String(turns).padStart(2)} turns  ${String(calls).padStart(2)} calls `
    + `(${String(reads).padStart(2)} read)  ${String(changed.length).padStart(2)} files changed  `
    + `reasoning ${String(reasoning).padStart(5)}  out ${String(out).padStart(5)}  `
    + `${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s  ${ended}`);
  console.log(`   traces:  ${traces.join(' ')}`);
  console.log(`   changed: ${changed.length ? changed.join('  ') : '⚠️ NOTHING'}`);
  console.log(`   parse:   ${bad.length ? `⚠️ FAILED: ${bad.join(' ')}` : 'ok'}`);
  if (reply) console.log(`   said:    “${reply.replace(/\s+/g, ' ').slice(0, 150)}”`);
  console.log('');
}

console.log(`${MODEL}, space-racer's tree, small asks — the builder's own 'low' path`);
console.log(`max_tokens ${MAX_TOKENS}, at most ${MAX_TURNS} turns, idle guard ${IDLE_MS / 1000}s\n`);
for (const [key, ask] of ASKS) {
  console.log(`— “${ask}”`);
  for (const effort of ['none', 'low']) {
    await run(`${key}/${effort}`, effort, ask);
  }
}
