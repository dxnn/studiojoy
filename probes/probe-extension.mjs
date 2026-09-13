// One-off: does the fire after a sizing call hit the cache, and which shape of
// piece fire hits most? (ideas/planner.md, second chapter, step 2.)
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-extension.mjs > tmp/probe-extension.out 2>&1
//
// DeepSeek's caching guide: a request hits only when it fully matches a cache
// prefix unit, and units are made at request boundaries. A production receipt
// showed the sizing and the fire after it both missing. This measures the way
// round it — the next message goes on top of the last one — against space-
// racer's real tree, with the studio's own sizing ask and piece turn.
//
// Arm D — the small ask ("make the ship turn a bit faster"), REPS times each:
//   D1  today: sizing (ask on the last message, no tools), then the fire with
//       the ask dropped and tools added. What does the fire's request hit?
//   D2  extension: the fire is the sizing's prompt, the sizing's answer as the
//       assistant turn, one user turn on top, tools.
//   D3  D2 with the assistant turn rewritten to a canonical JSON: is the
//       prompt alone a unit, or does the fire need the model's exact words?
//
// Arms A, B, C — one big ask ("add a second player with split screen"), one
// plan for all three (the sizing that B carries), each piece a real tool loop
// writing into its own copy of the tree, thinking off:
//   A  narrowed, as today: a fresh system prompt per piece with the piece's
//      files whole and the rest listed; one [studio] turn.
//   B  frozen and extended: the sizing's system prompt byte for byte; the
//      sizing exchange; the piece turn with fresh copies of the files this
//      piece writes that changed since.
//   C  whole tree refreshed: the block rebuilt from disk per piece, coldest
//      first; one [studio] turn.
// Every arm's system prompt starts with its own salt, so the arms cannot warm
// each other, and a run stamp so a re-run cannot hit yesterday.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { complete, preamble, TOOLS, u, a } from './probe-lib.mjs';
import {
  sizingAsk, parseSizing, pieceTurn, SIZING_MAX_TOKENS,
} from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 2);
const PIECE_TURNS = Number(process.env.PROBE_PIECE_TURNS ?? 8);
const SRC = 'games/space-racer';
const GAME = 'Space Racer';
const SMALL = 'make the ship turn a bit faster';
const BIG = 'add a second player with split screen';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const salt = (arm) => `Run ${STAMP} · Arm ${arm}.`;
const say = (...s) => console.log(...s);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const usageRow = (r) => (r.ok
  ? `total ${String(r.total).padStart(6)}  hit ${String(r.hit).padStart(6)}  miss ${String(r.miss).padStart(6)}  ${String(r.pct).padStart(3)}%  out ${String(r.out).padStart(5)}  ${secs(r.ms).padStart(6)}`
  : `HTTP ${r.status} ${r.error}`);

// ---------- the tree ----------

const TEXT = new Set(['.html', '.css', '.js', '.md', '.json', '.txt', '.svg']);
const isText = (p) => TEXT.has(path.extname(p));

function copyTree(arm) {
  const dir = path.join(os.tmpdir(), 'probe-ext', STAMP, arm);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(SRC, dir, { recursive: true, filter: (s) => !s.split(path.sep).includes('.git') });
  return dir;
}

function walk(dir) {
  const out = [];
  const step = (sub) => {
    for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.name === '.git') continue;
      if (e.isDirectory()) step(rel);
      else {
        const st = fs.statSync(path.join(dir, rel));
        out.push({ path: rel, size: st.size, mtime: st.mtimeMs, library: rel.startsWith('studio/') });
      }
    }
  };
  step('');
  return out;
}

// The orchestrator's block: contents coldest-first, library listed and never
// opened, the size-stamped tree last. `whole` narrows it to a piece's files
// plus the brief, the spec and config/, the rest listed for read_file.
function block(dir, whole = null) {
  const files = walk(dir);
  const texts = files.filter((f) => !f.library && isText(f.path))
    .sort((x, y) => (x.mtime !== y.mtime ? x.mtime - y.mtime : (x.path < y.path ? -1 : 1)));
  const binaries = files.filter((f) => !f.library && !isText(f.path));
  const wanted = (f) => whole === null || whole.has(f.path)
    || f.path === 'BRIEF.md' || f.path === 'SPEC.md' || f.path.startsWith('config/');
  const parts = [];
  const omitted = [];
  for (const f of texts) {
    if (!wanted(f)) { omitted.push(f.path); continue; }
    const body = fs.readFileSync(path.join(dir, f.path), 'utf8');
    parts.push(`--- FILE: ${f.path} (${f.size} bytes) ---\n${body}\n--- END FILE ---`);
  }
  for (const f of binaries) parts.push(`[binary: ${f.path}, ${f.size} bytes]`);
  if (omitted.length) {
    parts.push(`(not sent for this piece — call read_file if you need one: ${omitted.sort().join(', ')})`);
  }
  const lib = files.filter((f) => f.library);
  parts.push(`STUDIO LIBRARY (${lib.length} files) — yours to call, not to change:\n${lib.map((f) => f.path).join('\n')}`);
  parts.push(`PROJECT FILES\n${files.filter((f) => !f.library).map((f) => `${f.path} (${f.size} bytes)`).join('\n')}`);
  return parts.join('\n\n');
}

const snapshot = (dir) => new Map(
  walk(dir).filter((f) => !f.library && isText(f.path))
    .map((f) => [f.path, fs.readFileSync(path.join(dir, f.path), 'utf8')]),
);

// What changed since the frozen block was read: whole current copies of the
// files this piece writes, names for the rest.
function freshCopies(dir, frozen, pieceFiles) {
  const now = snapshot(dir);
  const changed = [...now.keys()].filter((p) => frozen.get(p) !== now.get(p)).sort();
  if (!changed.length) return '';
  const shown = changed.filter((p) => pieceFiles.includes(p));
  const named = changed.filter((p) => !pieceFiles.includes(p));
  const parts = ['', '[studio] Some files have changed since the copies above were read. These are current and replace the ones above:'];
  for (const p of shown) {
    const body = now.get(p);
    parts.push(`--- FILE: ${p} (${Buffer.byteLength(body)} bytes) ---\n${body}\n--- END FILE ---`);
  }
  if (named.length) parts.push(`Also changed, not shown — read_file if you need one: ${named.join(', ')}`);
  return parts.join('\n\n');
}

// ---------- the tools ----------

const stats = { patchFails: 0 };
function runTool(dir, name, args) {
  const rel = String(args.path ?? '');
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..') || rel.startsWith('studio/')) {
    return `error: ${rel || '(no path)'} is not a path you can write`;
  }
  const abs = path.join(dir, rel);
  if (name === 'write_file') {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(args.content ?? ''));
    return `wrote ${rel}`;
  }
  if (!fs.existsSync(abs)) return `error: no such file: ${rel}`;
  const text = fs.readFileSync(abs, 'utf8');
  if (name === 'read_file') return text;
  if (name === 'patch_file') {
    const old = String(args.old_text ?? '');
    const n = old ? text.split(old).length - 1 : 0;
    if (n !== 1) {
      stats.patchFails += 1;
      return `error: old_text occurs ${n} times in ${rel}; it must occur exactly once`;
    }
    fs.writeFileSync(abs, text.replace(old, String(args.new_text ?? '')));
    return `patched ${rel}`;
  }
  return `error: unknown tool ${name}`;
}

// One piece's tool loop, thinking off, every request's usage kept.
async function pieceLoop({ dir, system, messages }) {
  const rows = [];
  const written = new Set();
  const failsBefore = stats.patchFails;
  let reply = '';
  for (let turn = 0; turn < PIECE_TURNS; turn += 1) {
    const r = await complete({ system, messages, tools: TOOLS, effort: 'none', maxTokens: 16384 });
    rows.push(r);
    if (!r.ok) break;
    if (r.text) reply = r.text;
    if (!r.toolCalls.length) break;
    messages.push({ role: 'assistant', content: r.text || null, tool_calls: r.toolCalls });
    for (const call of r.toolCalls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments); } catch { /* cut off */ }
      const result = runTool(dir, call.function.name, args);
      if (!result.startsWith('error') && call.function.name !== 'read_file') written.add(args.path);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  return { rows, written: [...written], patchFails: stats.patchFails - failsBefore, reply };
}

const firstLine = (t) => String(t ?? '').trim().split('\n')[0].slice(0, 72);

// ---------- arm D: the small ask ----------

async function sizing(system, body) {
  const ask = u(`[Dann] ${body}\n\n${sizingAsk()}`);
  const r = await complete({
    system, messages: [ask], tools: null, effort: 'none', maxTokens: SIZING_MAX_TOKENS,
    extra: { response_format: { type: 'json_object' } },
  });
  return { ask, r };
}

async function armD() {
  say('Arm D — the small ask: does the fire after the sizing hit?');
  const dir = copyTree('D');
  const files = block(dir);
  for (let rep = 1; rep <= REPS; rep += 1) {
    for (const shape of ['D1 today', 'D2 extension', 'D3 canonical']) {
      const system = `${salt(`${shape} #${rep}`)}\n\n${preamble(GAME)}\n\n${files}`;
      const { ask, r: s } = await sizing(system, SMALL);
      say(`${shape} #${rep}  sizing   ${usageRow(s)}  → ${s.ok ? s.text.replace(/\s+/g, ' ').slice(0, 60) : ''}`);
      let messages;
      if (shape === 'D1 today') messages = [u(`[Dann] ${SMALL}`)];
      else if (shape === 'D2 extension') messages = [ask, a(s.text), u('[studio] Go ahead.')];
      else messages = [ask, a('{"size":"small"}'), u('[studio] Go ahead.')];
      const f = await complete({ system, messages, tools: TOOLS, effort: 'none', maxTokens: 64 });
      say(`${shape} #${rep}  fire     ${usageRow(f)}`);
    }
  }
  say('');
}

// ---------- arms A, B, C: the pieces ----------

async function armPieces() {
  say(`Arms A, B, C — "${BIG}" on space-racer, one plan, three shapes`);
  const dirs = { A: copyTree('A'), B: copyTree('B'), C: copyTree('C') };
  const frozenBlock = block(dirs.B);
  const frozenFiles = snapshot(dirs.B);
  const sysB = `${salt('B')}\n\n${preamble(GAME)}\n\n${frozenBlock}`;

  let ask; let sized; let plan = null;
  for (let attempt = 1; attempt <= 3 && !plan; attempt += 1) {
    ({ ask, r: sized } = await sizing(sysB, BIG));
    say(`sizing #${attempt}  ${usageRow(sized)}`);
    const parsed = sized.ok ? parseSizing(sized.text) : null;
    if (parsed?.size === 'big') plan = parsed;
    else say(`  sized ${parsed?.size ?? 'unparseable'}: ${sized.text?.slice(0, 200)}`);
  }
  if (!plan) { say('no plan after three tries; stopping'); return; }
  say(`plan: ${plan.pieces.length} pieces`);
  for (const [i, p] of plan.pieces.entries()) say(`  ${i + 1}. ${p.title} — ${p.files.join(', ')}`);
  say('');

  const summary = {};
  for (const arm of ['A', 'B', 'C']) {
    const dir = dirs[arm];
    const pieces = plan.pieces.map((p) => ({ ...p, status: 'todo', note: null }));
    const sum = { first: [], hit: 0, miss: 0, out: 0, requests: 0, patchFails: 0, ms: 0, written: 0 };
    say(`--- Arm ${arm} ---`);
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i];
      const turn = pieceTurn({ request: BIG, pieces, index: i });
      let system; let messages;
      if (arm === 'A') {
        system = `${salt('A')}\n\n${preamble(GAME)}\n\n${block(dir, new Set(piece.files))}`;
        messages = [u(turn)];
      } else if (arm === 'B') {
        system = sysB;
        messages = [ask, a(sized.text), u(turn + freshCopies(dir, frozenFiles, piece.files))];
      } else {
        system = `${salt('C')}\n\n${preamble(GAME)}\n\n${block(dir)}`;
        messages = [u(turn)];
      }
      const started = Date.now();
      const got = await pieceLoop({ dir, system, messages });
      const ms = Date.now() - started;
      say(`${arm} piece ${i + 1}/${pieces.length}  ${piece.title}  [${piece.files.join(', ')}]`);
      got.rows.forEach((r, k) => say(`   r${k + 1}  ${usageRow(r)}`));
      say(`   wrote ${got.written.length ? got.written.join(', ') : 'nothing'}  patch fails ${got.patchFails}  ${secs(ms)}`);
      say(`   note: ${firstLine(got.reply) || '(none)'}`);
      pieces[i] = { ...piece, status: 'done', note: firstLine(got.reply) || piece.title };
      const ok = got.rows.filter((r) => r.ok);
      if (ok[0]) sum.first.push(ok[0].pct);
      for (const r of ok) { sum.hit += r.hit; sum.miss += r.miss; sum.out += r.out; sum.requests += 1; }
      sum.patchFails += got.patchFails;
      sum.ms += ms;
      sum.written += got.written.length;
    }
    summary[arm] = sum;
    say('');
  }

  say('Summary — per arm, over every piece');
  say('arm  first-request hit% per piece      requests   hit tokens  miss tokens   out   miss-equiv   patch fails  files  wall');
  for (const [arm, s] of Object.entries(summary)) {
    const equiv = s.miss + Math.ceil(s.hit / 30) + s.out * 3;
    say(`${arm}    ${s.first.map((p) => `${p}%`).join(' ').padEnd(32)} ${String(s.requests).padStart(8)}   ${String(s.hit).padStart(10)}  ${String(s.miss).padStart(11)}  ${String(s.out).padStart(5)}  ${String(equiv).padStart(10)}  ${String(s.patchFails).padStart(11)}  ${String(s.written).padStart(5)}  ${secs(s.ms)}`);
  }
  say(`trees under ${path.join(os.tmpdir(), 'probe-ext', STAMP)}`);
}

await armD();
await armPieces();
