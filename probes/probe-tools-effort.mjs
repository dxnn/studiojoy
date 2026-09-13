// One-off, and the decisive one: with the studio's own preamble and its file
// tools in front of it, what makes deepseek-v4-flash actually call a tool
// instead of thinking until the output ceiling stops it?
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-tools-effort.mjs
//
// probe-do-more.mjs established the failure: "build me a tank game", tools
// present, reasoning on — 8192 of 8192 completion tokens went to the trace,
// zero tool calls, finish_reason 'length', four runs out of four. A prompt
// rule telling it to write its plan down rather than hold it made no
// difference. So the question is no longer how to ask nicely.
//
// Two things to separate:
//   - Does more room help or does it just get eaten? (baseline at 16384)
//   - Does reasoning_effort get it writing? ('low', 'none')
// The prompt and the tools are the same in every arm.

import fs from 'node:fs';

const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const MODEL = process.env.PROBE_MODEL ?? 'deepseek-v4-flash';

const TOOLS = [
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

const SYSTEM = [
  'You are an agent in Unbridled Joy, a game studio, working with people on the browser game "Tank".',
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

const TASK = 'Build me a tank game. Two players, split screen, destructible walls, power-ups.';

const ARMS = [
  ['baseline, 16384', { max_tokens: 16384 }],
  ["effort 'low', 8192", { max_tokens: 8192, reasoning_effort: 'low' }],
  ["effort 'low', 8192 #2", { max_tokens: 8192, reasoning_effort: 'low' }],
  ["effort 'none', 8192", { max_tokens: 8192, reasoning_effort: 'none' }],
];

async function run(label, extra) {
  const started = process.hrtime.bigint();
  const ms = () => Number(process.hrtime.bigint() - started) / 1e6;
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: TASK }],
      tools: TOOLS,
      stream: true,
      stream_options: { include_usage: true },
      ...extra,
    }),
  });
  if (!res.ok) {
    console.log(`${label.padEnd(24)} HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let finish = null;
  let firstCallAt = null;
  let prose = '';
  const paths = [];
  let argChars = 0;
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
      if (delta.content) prose += delta.content;
      for (const call of delta.tool_calls ?? []) {
        if (firstCallAt === null) firstCallAt = ms();
        if (call.function?.name) paths.push(call.function.name);
        const args = call.function?.arguments ?? '';
        argChars += args.length;
        const m = args.match(/"path"\s*:\s*"([^"]+)"/);
        if (m && paths.length) paths[paths.length - 1] = `${paths[paths.length - 1]}:${m[1]}`;
      }
    }
  }
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const out = usage?.completion_tokens ?? 0;
  console.log(
    `${label.padEnd(24)} reasoning ${String(reasoning).padStart(5)}/${String(out).padStart(5)} out  `
    + `calls ${String(paths.length).padStart(2)}  `
    + `first at ${firstCallAt === null ? '  never' : `${(firstCallAt / 1000).toFixed(0)}s`.padStart(7)}  `
    + `${String(argChars).padStart(6)} chars written  ${(ms() / 1000).toFixed(0).padStart(3)}s  ${finish}`,
  );
  if (paths.length) console.log(`${' '.repeat(26)}${paths.join('  ')}`);
  else if (prose) console.log(`${' '.repeat(26)}said only: “${prose.slice(0, 100).replace(/\n/g, ' ⏎ ')}…”`);
}

console.log(`${MODEL}, studio preamble, file tools, "build me a tank game"\n`);
for (const [label, extra] of ARMS) await run(label, extra);
