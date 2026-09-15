// The three shapes for a piece's fire, re-taken on V4.1 in the studio's own
// transcript. §14's piece-shape table (probes/probe-extension.mjs, 2026-09-07)
// was measured on V4-Flash under the old long sizing ask, and that probe
// cannot be re-run: it imports `sizingAsk`, which the builder's second
// chapter replaced. This is the same three arms on the words the studio sends
// today, from server/agents/sizing.js.
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-pieces.mjs > probes/probe-v41-pieces.out 2>&1
//
// One big ask on space-racer's real tree, one plan for all three arms, each
// piece a real tool loop writing into its own copy of the tree, thinking off:
//   A  narrowed: a fresh system prompt per piece with the piece's files whole
//      and the rest listed; one [studio] turn.
//   B  frozen and extended — what production does (orchestrator.js,
//      `extended`): the plan's system prompt byte for byte; the request, the
//      plan card as the builder's reply, the Build press and its answer; then
//      the piece turn with fresh copies of the files this piece writes that
//      changed since.
//   C  whole tree rebuilt from disk per piece, coldest first; one turn.
// Every arm's system prompt starts with its own salt, so the arms cannot warm
// each other, and a run stamp so a re-run cannot hit yesterday.
//
// Read against the old table with one thing in mind: arm B's first piece hit
// 49% there because the old ask tripped the 6 K rule, which is gone on V4.1
// (§14). The number to watch is that first request — and whether B is still
// the cheapest shape once the rule that half-made it is gone.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { complete, preamble, TOOLS, u, a } from './probe-lib.mjs';
import {
  sizingRules, sizingTrigger, parseSizing, pieceTurn, planBody, CONFIRM_TRIGGER, SIZING_MAX_TOKENS,
} from '../server/agents/sizing.js';

const PIECE_TURNS = Number(process.env.PROBE_PIECE_TURNS ?? 8);
const SRC = 'games/space-racer';
const GAME = 'Space Racer';
const BIG = 'add a second player with split screen';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const salt = (arm) => `Run ${STAMP} · Arm ${arm}.`;
const say = (...s) => console.log(...s);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const usageRow = (r) => (r.ok
  ? `total ${String(r.total).padStart(6)}  hit ${String(r.hit).padStart(6)}  miss ${String(r.miss).padStart(6)}  ${String(r.pct).padStart(3)}%  out ${String(r.out).padStart(5)}  ${secs(r.ms).padStart(6)}`
  : `HTTP ${r.status} ${r.error}`);

// §14's prices on this model: a hit is a fiftieth of a miss, output four
// times one (server/llm/deepseek.js). The old table weighed a hit at a
// thirtieth and output at three — V4-Flash's shape — so its miss-equivalents
// do not compare with these, only its hit rates do.
const HIT_WEIGHT = 50;
const OUTPUT_WEIGHT = 4;

// ---------- the tree ----------

const TEXT = new Set(['.html', '.css', '.js', '.md', '.json', '.txt', '.svg']);
const isText = (p) => TEXT.has(path.extname(p));

function copyTree(arm) {
  const dir = path.join(os.tmpdir(), 'probe-pieces', STAMP, arm);
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
// files this piece writes, names for the rest (orchestrator.js, freshCopies).
function freshCopies(dir, frozen, pieceFiles) {
  const now = snapshot(dir);
  const changed = [...now.keys()].filter((p) => frozen.get(p) !== now.get(p)).sort();
  if (!changed.length) return '';
  const shown = changed.filter((p) => pieceFiles.includes(p));
  const named = changed.filter((p) => !pieceFiles.includes(p));
  const parts = ['[studio] Some files have changed since the copies above were read. These are current and replace them:'];
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

// ---------- the sizing, in the studio's shape ----------

const systemFor = (armSalt, files) => [armSalt, '', preamble(GAME), '', sizingRules(), '', files].join('\n');

async function sizing(system) {
  const ask = u(`[Dann] ${BIG}\n\n${sizingTrigger()}`);
  const r = await complete({
    system, messages: [ask], tools: null, effort: 'none', maxTokens: SIZING_MAX_TOKENS,
    extra: { response_format: { type: 'json_object' } },
  });
  return { ask, r };
}

say(`${process.env.PROBE_MODEL ?? 'deepseek-flash'} — "${BIG}" on space-racer, one plan, three shapes\n`);
const dirs = { A: copyTree('A'), B: copyTree('B'), C: copyTree('C') };
const frozenBlock = block(dirs.B);
const frozenFiles = snapshot(dirs.B);
const sysB = systemFor(salt('B'), frozenBlock);

let plan = null;
for (let attempt = 1; attempt <= 3 && !plan; attempt += 1) {
  const { r } = await sizing(sysB);
  say(`sizing #${attempt}  ${usageRow(r)}`);
  const parsed = r.ok ? parseSizing(r.text) : null;
  if (parsed?.size === 'pieces' && parsed.pieces.length >= 2) plan = parsed;
  else say(`  sized ${parsed?.size ?? 'unparseable'} (${parsed?.pieces?.length ?? 0} pieces): ${r.text?.slice(0, 160)}`);
}
if (!plan) { say('no plan of two or more after three tries; stopping'); process.exit(1); }
say(`plan: ${plan.pieces.length} pieces`);
for (const [i, p] of plan.pieces.entries()) say(`  ${i + 1}. ${p.title} — ${p.files.join(', ')}`);
if (plan.summary) say(`  summary: ${plan.summary}`);
for (const line of plan.assumptions) say(`  assuming: ${line}`);
say('');

// Arm B's prefix, as production lays it down on Build (orchestrator.js,
// runQueued → sizeRequest with CONFIRM_TRIGGER, then `extended`): the request,
// the draft card as the builder's reply, the Build press, its answer. The
// confirm is a real request so the cache unit the pieces extend exists.
const pieces = plan.pieces.map((p) => ({ ...p, status: 'todo', note: null }));
const card = planBody(pieces, { status: 'draft', summary: plan.summary, assumptions: plan.assumptions });
const buildMessages = [u(`[Dann] ${BIG}`), a(card), u(CONFIRM_TRIGGER)];
const confirm = await complete({
  system: sysB, messages: buildMessages, tools: null, effort: 'none', maxTokens: 16,
  extra: { response_format: { type: 'json_object' } },
});
say(`Build it (arm B's confirm)  ${usageRow(confirm)}  → ${confirm.ok ? confirm.text.trim() : ''}`);
const exchange = [...buildMessages, a(confirm.ok ? confirm.text : '{"ok":true}')];
say('');

const summary = {};
for (const arm of ['A', 'B', 'C']) {
  const dir = dirs[arm];
  const mine = plan.pieces.map((p) => ({ ...p, status: 'todo', note: null }));
  const sum = { first: [], hit: 0, miss: 0, out: 0, requests: 0, patchFails: 0, ms: 0, written: 0 };
  say(`--- Arm ${arm} ---`);
  for (let i = 0; i < mine.length; i += 1) {
    const piece = mine[i];
    const turn = pieceTurn({
      request: BIG, pieces: mine, index: i, summary: plan.summary, assumptions: plan.assumptions,
    });
    let system; let messages;
    if (arm === 'A') {
      system = systemFor(salt('A'), block(dir, new Set(piece.files)));
      messages = [u(turn)];
    } else if (arm === 'B') {
      system = sysB;
      const fresh = freshCopies(dir, frozenFiles, piece.files);
      messages = [...exchange, u(fresh ? `${turn}\n\n${fresh}` : turn)];
    } else {
      system = systemFor(salt('C'), block(dir));
      messages = [u(turn)];
    }
    const started = Date.now();
    const got = await pieceLoop({ dir, system, messages });
    const ms = Date.now() - started;
    say(`${arm} piece ${i + 1}/${mine.length}  ${piece.title}  [${piece.files.join(', ')}]`);
    got.rows.forEach((r, k) => say(`   r${k + 1}  ${usageRow(r)}`));
    say(`   wrote ${got.written.length ? got.written.join(', ') : 'nothing'}  patch fails ${got.patchFails}  ${secs(ms)}`);
    say(`   note: ${firstLine(got.reply) || '(none)'}`);
    mine[i] = { ...piece, status: 'done', note: firstLine(got.reply) || piece.title };
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
say(`arm  first-request hit% per piece      requests   hit tokens  miss tokens   out   miss-equiv (hit/${HIT_WEIGHT} + out×${OUTPUT_WEIGHT})  patch fails  files  wall`);
for (const [arm, s] of Object.entries(summary)) {
  const equiv = s.miss + Math.ceil(s.hit / HIT_WEIGHT) + s.out * OUTPUT_WEIGHT;
  say(`${arm}    ${s.first.map((p) => `${p}%`).join(' ').padEnd(32)} ${String(s.requests).padStart(8)}   ${String(s.hit).padStart(10)}  ${String(s.miss).padStart(11)}  ${String(s.out).padStart(5)}  ${String(equiv).padStart(10)}                    ${String(s.patchFails).padStart(11)}  ${String(s.written).padStart(5)}  ${secs(s.ms)}`);
}
say(`trees under ${path.join(os.tmpdir(), 'probe-pieces', STAMP)}`);
