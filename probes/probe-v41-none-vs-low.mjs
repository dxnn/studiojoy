// Does `none` build as well as `low`? The run that decides whether the
// thinking level is worth having at all.
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-none-vs-low.mjs > probes/probe-v41-none-vs-low.out 2>&1
//
// probe-v41-loop.mjs got one `low` arm through a closed tool loop — 19 files,
// 74,935 bytes, eight turns — and stalled before it reached its `none` arms,
// so V4.1 has no `none` comparison at all. Everything the studio believes
// about `low` being worth its runaway risk rests on that single run.
//
// ⚠️ Every table in §14, this one's ancestors included, scores *whether tool
// calls came out* and not *whether the game was any good*. That caveat is
// stated three times on that page and has never been closed. A control is
// about to be deleted on this evidence, so this probe scores two things the
// others could not:
//
//   - every .js the arm wrote is checked with `node --check`, so a file that
//     cannot parse is counted rather than admired for its byte count;
//   - the whole tree is kept on disk, so the game can be opened in a browser
//     afterwards. Bytes are not a game.
//
// It also carries the **idle guard** the earlier probes lacked. Two streams
// went silent for over eight minutes on 2026-09-13 and had to be killed by
// hand; §14 measured that the upstream sends no keep-alive frames, so a long
// silence really is a dead stream. Here one is a recorded outcome, not a hang.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { preamble, TOOLS, EMPTY_TREE, TASK, KEY, MODEL, ENDPOINT } from './probe-lib.mjs';

const MAX_TURNS = Number(process.env.PROBE_TURNS ?? 10);
const MAX_TOKENS = Number(process.env.PROBE_MAX ?? 16384);
const REPS = Number(process.env.PROBE_REPS ?? 2);
// §14: no comment frames, and the longest gap inside a healthy 45-second
// stream was 439 ms. Two minutes of nothing is dead.
const IDLE_MS = Number(process.env.PROBE_IDLE_MS ?? 120_000);
const TREES = 'tmp/loop-trees';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

const SYSTEM = (arm) => `Run ${STAMP} · Arm ${arm}.\n\n${preamble('Tank')}\n\n${EMPTY_TREE}`;

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

function serve(tree, name, rawArgs) {
  let args;
  try { args = JSON.parse(rawArgs); } catch { return 'That call could not be read as JSON.'; }
  const p = args.path ?? '';
  if (name === 'read_file') return tree.has(p) ? tree.get(p) : `There is no file at ${p}.`;
  if (name === 'write_file') {
    tree.set(p, String(args.content ?? ''));
    return `Wrote ${p}, ${tree.get(p).length} bytes.`;
  }
  if (name === 'patch_file') {
    if (!tree.has(p)) return `There is no file at ${p}.`;
    const parts = tree.get(p).split(args.old_text ?? '');
    if (parts.length !== 2) return `old_text appears ${parts.length - 1} times in ${p}; it must appear exactly once.`;
    tree.set(p, parts.join(args.new_text ?? ''));
    return `Patched ${p}, now ${tree.get(p).length} bytes.`;
  }
  return `No such tool: ${name}.`;
}

// Keep the tree so a person, or a browser, can look at what was built.
function writeTree(dir, tree) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, body] of tree) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
}

// Bytes are not a game. The cheapest real check: does every .js parse?
function checkSyntax(dir, tree) {
  const bad = [];
  for (const rel of tree.keys()) {
    if (!rel.endsWith('.js')) continue;
    try {
      execFileSync(process.execPath, ['--check', path.join(dir, rel)], { stdio: 'pipe' });
    } catch (err) {
      bad.push(`${rel}: ${String(err.stderr ?? '').split('\n').find((l) => l.includes('Error')) ?? 'parse failed'}`);
    }
  }
  return bad;
}

async function run(label, effort) {
  const system = SYSTEM(label);
  const messages = [{ role: 'user', content: TASK }];
  const tree = new Map();
  const started = Date.now();
  const traces = [];
  let out = 0;
  let calls = 0;
  let turns = 0;
  let ended = 'ran out of turns';

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
    console.log(`   turn ${turns + 1}: reasoning ${String(t.reasoning).padStart(5)}  `
      + `out ${String(t.out).padStart(5)}  calls ${String(t.calls.length).padStart(2)}  `
      + `cache ${String(t.total ? Math.round((t.hit / t.total) * 100) : 0).padStart(3)}%  `
      + `${(t.ms / 1000).toFixed(0).padStart(3)}s  ${t.finish}`);

    if (!t.calls.length) {
      ended = t.finish === 'length' ? 'CLIFF' : 'finished on its own';
      if (t.prose) console.log(`   said: “${t.prose.replace(/\s+/g, ' ').slice(0, 140)}…”`);
      turns += 1;
      break;
    }
    calls += t.calls.length;
    messages.push({
      role: 'assistant',
      content: t.prose || null,
      tool_calls: t.calls.map((c) => ({
        id: c.id, type: 'function', function: { name: c.name, arguments: c.args },
      })),
    });
    for (const c of t.calls) {
      messages.push({ role: 'tool', tool_call_id: c.id, content: serve(tree, c.name, c.args) });
    }
  }

  const dir = path.join(TREES, label.replace(/[^a-z0-9]+/gi, '-'));
  let bad = [];
  if (tree.size) {
    writeTree(dir, tree);
    bad = checkSyntax(dir, tree);
  }
  const bytes = [...tree.values()].reduce((n, s) => n + s.length, 0);
  const reasoning = traces.reduce((n, r) => n + r, 0);
  console.log(`${label.padEnd(12)} ${String(turns).padStart(2)} turns  ${String(calls).padStart(2)} calls  `
    + `${String(tree.size).padStart(2)} files  ${String(bytes).padStart(6)} bytes  `
    + `reasoning ${String(reasoning).padStart(5)}  out ${String(out).padStart(6)}  `
    + `${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s  ${ended}`);
  console.log(`   traces: ${traces.join(' ')}`);
  if (tree.size) console.log(`   files:  ${[...tree.keys()].join('  ')}`);
  console.log(`   parse:  ${bad.length ? `⚠️ ${bad.length} FAILED — ${bad.join(' | ')}` : 'every .js parses'}`);
  console.log(`   tree:   ${tree.size ? dir : '(nothing written)'}\n`);
}

console.log(`${MODEL}, preamble + empty tree, file tools served, "${TASK}"`);
console.log(`max_tokens ${MAX_TOKENS} a turn, at most ${MAX_TURNS} turns, `
  + `idle guard ${IDLE_MS / 1000}s, trees kept under ${TREES}/\n`);
for (const effort of ['none', 'low']) {
  for (let i = 1; i <= REPS; i += 1) await run(`${effort} #${i}`, effort);
}
