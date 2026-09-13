// Shared harness for the four planner probes (probe-tools-cache, probe-sizing,
// probe-step, probe-trace-handoff). Not part of npm test.
//
// The preamble and the tools are the ones probe-tools-effort.mjs measured
// spec.md §14's cliff with, so every number here compares with that table.

import fs from 'node:fs';
import path from 'node:path';

export const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
// ⚠️ Was 'deepseek-v4-flash' until 2026-09-13, which DeepSeek retired on
// 2026-09-10 and still answers through a compatibility alias with no end date
// — so a probe run without PROBE_MODEL was measuring V4.1 through the old name
// and reporting the old name in its header. Default to the canonical id.
export const MODEL = process.env.PROBE_MODEL ?? 'deepseek-flash';
export const ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a file or replace its entire contents. Prefer patch_file for '
        + 'edits to an existing file — it is cheaper and cannot lose the parts you did '
        + 'not mean to change.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'project-relative path, / separated' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_file',
      description: 'Replace one exact snippet in a file. old_text must appear exactly once.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file that was not included in your context.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
];

export const preamble = (name) => [
  `You are an agent in Unbridled Joy, a game studio, working with people on the browser game "${name}".`,
  'The project is a working tree of files. Every change is committed to git, so nothing is unrecoverable.',
  '',
  'Paths are project-relative and / separated: no leading slash, no "..", no ".git", at most 8 segments.',
  '',
  'You have file tools. Prefer patch_file over write_file when changing a file that already exists —',
  'it is cheaper and cannot silently lose the parts you did not mean to touch.',
  '',
  'Build a game as many small files rather than one big page. index.html holds the markup and nothing',
  'else; css/ holds the styles; js/ holds one file per part of the game — input, drawing, levels, sound,',
  'state; config/ holds the numbers and the words. A few hundred lines each. One enormous index.html',
  'cannot be patched cheaply and is the thing most likely to be cut off half-written.',
  '',
  'config/ is the part a person tunes without reading code: plain values only, written as',
  '`const NAME = value;`, with a comment on every value in words a ten-year-old can read.',
  '',
  'Keep the project documents at the root, next to the code: BRIEF.md (the file map), SPEC.md (what the',
  'game is and how it works), TODO.md (one task per line, only when the list is worth staging).',
  '',
  'This reply gets at most 24 turns and 40 tool calls, then it is cut off wherever it happens to be.',
  'Several tool calls in one turn cost one turn, so send them together: a turn spent on a single read is',
  'a turn you do not get back. If you can see you will not finish, stop and say what is left rather than',
  'being cut off mid-file.',
  '',
  'Keep your reply short — a note on what you did or think. The files carry the detail.',
].join('\n');

export const TASK = 'Build me a tank game. Two players, split screen, destructible walls, power-ups.';

export const EMPTY_TREE = 'PROJECT FILES\n(the project has no files yet)';

// The sizing ask, riding the last user message the way pins and errors do so
// the system prompt stays byte-identical to the fire's.
export const SIZING = [
  '[studio] Before anything is built, size this request. Answer with JSON only — no prose, no code fence:',
  '{"size":"small"} when it is one change a helper can make in one go: a value, a line, a bug, one file.',
  '{"size":"big","steps":[{"title":"…","files":["…"],"what":"…"}]} when it is more than that. Split it into',
  '2 to 8 steps, each a job one helper can finish in one sitting — a few files at most — and each leaving',
  'the game runnable. "title" under 8 words; "what" is one or two sentences for the helper who will do',
  'that step, saying what it makes and what it must not touch. Order the steps so each builds on the last.',
].join('\n');

// A game's text files as the orchestrator's file block, studio/ left out the
// way the real block leaves it out.
export function fileBlock(dir) {
  const files = [];
  const walk = (sub) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.name === '.git' || rel === 'studio') continue;
      if (entry.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  walk('');
  files.sort();
  const parts = [];
  for (const rel of files) {
    if (rel.endsWith('.png') || rel.endsWith('.wav') || rel.endsWith('.mp3')) continue;
    const body = fs.readFileSync(path.join(dir, rel), 'utf8');
    parts.push(`--- FILE: ${rel} (${body.length} bytes) ---\n${body}\n--- END FILE ---`);
  }
  parts.push(`PROJECT FILES\n${files.map((f) => `${f}`).join('\n')}`);
  return parts.join('\n\n');
}

// Files given as {path: text}, in the same shape.
export function blockOf(files) {
  const parts = Object.entries(files)
    .map(([p, body]) => `--- FILE: ${p} (${body.length} bytes) ---\n${body}\n--- END FILE ---`);
  parts.push(`PROJECT FILES\n${Object.keys(files).join('\n')}`);
  return parts.join('\n\n');
}

const usageOf = (usage) => {
  const total = usage?.prompt_tokens ?? 0;
  const hit = usage?.prompt_cache_hit_tokens ?? 0;
  const miss = usage?.prompt_cache_miss_tokens ?? 0;
  return {
    total, hit, miss, pct: total ? Math.round((hit / total) * 100) : 0,
    out: usage?.completion_tokens ?? 0,
    reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
};

// One whole request, one whole answer. `extra` goes into the body verbatim.
export async function complete({
  system, messages, tools = null, maxTokens = 8, effort = 'none', extra = {},
}) {
  const started = Date.now();
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: system }, ...messages],
    max_tokens: maxTokens,
    ...extra,
  };
  if (effort !== 'full') body.reasoning_effort = effort;
  if (tools) body.tools = tools;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  const ms = Date.now() - started;
  if (!res.ok) {
    return { ok: false, status: res.status, error: JSON.stringify(payload?.error ?? payload).slice(0, 200), ms };
  }
  const choice = payload.choices?.[0];
  return {
    ok: true,
    status: res.status,
    text: choice?.message?.content ?? '',
    toolCalls: choice?.message?.tool_calls ?? [],
    finish: choice?.finish_reason ?? null,
    ms,
    ...usageOf(payload.usage),
  };
}

// A streamed request, watched the way the orchestrator watches one. capChars
// mirrors THINKING_CAP_CHARS: once that much reasoning has gone by with no
// content and no tool fragment, the stream is cancelled and the trace kept.
export async function stream({
  system, messages, tools = null, maxTokens = 16384, effort = 'low', capChars = 0,
}) {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: system }, ...messages],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
  };
  if (effort !== 'full') body.reasoning_effort = effort;
  if (tools) body.tools = tools;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: (await res.text()).slice(0, 200), ms: ms() };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let finish = null;
  let firstCallAt = null;
  let firstReasoningAt = null;
  let prose = '';
  let proseBeforeFirstCall = 0;
  const calls = [];
  let argChars = 0;
  let reasoning = '';
  let produced = false;
  let capped = false;

  outer:
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
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
      if (delta.reasoning_content) {
        if (firstReasoningAt === null) firstReasoningAt = ms();
        reasoning += delta.reasoning_content;
        if (capChars && !produced && reasoning.length > capChars) {
          capped = true;
          await reader.cancel().catch(() => {});
          break outer;
        }
      }
      if (delta.content) {
        prose += delta.content;
        produced = true;
        if (firstCallAt === null) proseBeforeFirstCall = prose.length;
      }
      if (delta.tool_calls?.length) produced = true;
      for (const call of delta.tool_calls ?? []) {
        if (firstCallAt === null) firstCallAt = ms();
        if (call.function?.name) calls.push(call.function.name);
        const args = call.function?.arguments ?? '';
        argChars += args.length;
        const m = args.match(/"path"\s*:\s*"([^"]+)"/);
        if (m && calls.length) calls[calls.length - 1] = `${calls[calls.length - 1]}:${m[1]}`;
      }
    }
  }
  return {
    ok: true,
    finish,
    prose,
    proseBeforeFirstCall,
    calls,
    argChars,
    firstCallAt,
    firstReasoningAt,
    // The trace text; `reasoning` below is the token count from usage.
    trace: reasoning,
    reasoningChars: reasoning.length,
    capped,
    ms: ms(),
    ...usageOf(usage),
  };
}

// One line per streamed run, in the shape of probe-tools-effort.out so the
// rows can sit under §14's table.
export function streamRow(label, r) {
  if (!r.ok) return `${label.padEnd(26)} HTTP ${r.status} ${r.error}`;
  const first = r.firstCallAt === null ? '  never' : `${(r.firstCallAt / 1000).toFixed(0)}s`.padStart(7);
  const head = `${label.padEnd(26)} reasoning ${String(r.reasoning).padStart(5)}/${String(r.out).padStart(5)} out  `
    + `calls ${String(r.calls.length).padStart(2)}  first at ${first}  `
    + `${String(r.argChars).padStart(6)} chars written  ${String(r.prose.length).padStart(5)} prose  `
    + `${(r.ms / 1000).toFixed(0).padStart(3)}s  ${r.capped ? 'CAPPED' : r.finish}  cache ${r.pct}%`;
  const tail = r.calls.length
    ? `\n${' '.repeat(28)}${r.calls.join('  ')}`
    : (r.prose ? `\n${' '.repeat(28)}said only: “${r.prose.slice(0, 120).replace(/\n/g, ' ⏎ ')}…”` : '');
  return head + tail;
}

export const u = (content) => ({ role: 'user', content });
export const a = (content) => ({ role: 'assistant', content });
