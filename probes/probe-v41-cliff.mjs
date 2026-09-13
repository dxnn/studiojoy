// A copy of probe-tools-effort.mjs, prompt and tools byte-identical, re-taken
// on deepseek-flash (V4.1) so the rows compare with §14's cliff table. That
// table was measured 2026-08-31 on deepseek-v4-flash, retired 2026-09-10.
//
//   NODE_OPTIONS=--use-env-proxy node probes/probe-v41-cliff.mjs > probes/probe-v41-cliff.out 2>&1
//
// What §14 says today, and what this asks again:
//   - At the default effort the trace expands to fill whatever it is given and
//     produces nothing: 8 of 9 runs wrote no file, called no tool, said no
//     word. Does V4.1 still do that?
//   - 'low' wrote files on both runs at the same 8192; 'none' wrote two in
//     seven seconds. Is reasoning_effort still the lever, or is it a ladder
//     now that `max` exists?
//
// Everything the studio rests on is downstream of the answer: the thinking
// level, the thinking cap, and every piece of a plan running at 'none'.

import fs from 'node:fs';

const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const MODEL = process.env.PROBE_MODEL ?? 'deepseek-flash';

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

// Each arm run several times, because the old table's one-in-nine says the
// interesting number is a rate rather than a reading.
const ARMS = [
  ['default, 8192', { max_tokens: 8192 }, 3],
  ['default, 16384', { max_tokens: 16384 }, 3],
  ["'low', 8192", { max_tokens: 8192, reasoning_effort: 'low' }, 2],
  ["'none', 8192", { max_tokens: 8192, reasoning_effort: 'none' }, 2],
].flatMap(([label, extra, reps]) =>
  Array.from({ length: reps }, (_, i) => [`${label} #${i + 1}`, extra]));

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
