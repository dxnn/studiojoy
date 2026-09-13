// One-off: how much thinking happens before the first tool call, and does a
// prompt rule move it?
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-do-more.mjs
//
// The complaint this measures: a helper handed a whole game spends its output
// allowance reasoning and never writes a file. probe-keepalive.mjs showed the
// upstream is healthy while that happens — ~90 reasoning tokens/s, no silence
// — so it is not a stall, it is the model choosing to plan in a place that is
// discarded and re-billed rather than in a file that is kept and cached.
//
// Prompt A is the studio's own preamble, trimmed to the parts about building a
// game (the full text is studioPreamble in server/agents/orchestrator.js; the
// asset, scoreboard and library sections are left out because no library note
// or asset request is in play here). Prompt B is A plus one rule: write the
// plan down, do not hold it.
//
// Measured per run: reasoning tokens *before the first tool call fragment*,
// total reasoning, how many calls came out, and whether it ran out of room.
// Two runs each, because reasoning length varies a lot run to run.

import fs from 'node:fs';

const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const MODEL = process.env.PROBE_MODEL ?? 'deepseek-v4-flash';
// Well below the studio's 65536, so a run costs minutes not tens of minutes.
// The ratio is what transfers; the absolute numbers scale.
//
// ⚠️ At 8192 this probe cannot answer its own question: probe-tools-effort.mjs
// then showed that this prompt provokes ~13.7k reasoning tokens before the
// first tool call, so *both* arms hit the ceiling still thinking and neither
// one got to act. Run it at PROBE_MAX=16384, where the baseline does write
// files, for the comparison to mean anything.
const MAX = Number(process.env.PROBE_MAX ?? 8192);
const REPS = Number(process.env.PROBE_REPS ?? 2);

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

const A = [
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
  'Keep the project documents at the root, next to the code. They are notes for the people and agents',
  'working on the game, and never part of the game itself:',
  'BRIEF.md — the file map: what each file is for, how the pieces fit together, what someone needs to',
  '  know before touching them. Keep it short, and update it whenever you add, move, or repurpose a file.',
  'SPEC.md — what the game is and how it is meant to work: rules, controls, screens, and the decisions',
  '  already settled. Update it when a decision changes, not on every turn.',
  'TODO.md — one task per line, and only when the list is long enough to be worth staging. Delete a',
  '  line when it is done. For a small job, skip the file and do the work.',
  '',
  'This reply gets at most 24 turns and 40 tool calls, then it is cut off wherever it happens to be.',
  'Several tool calls in one turn cost one turn, so send them together: a turn spent on a single read is',
  'a turn you do not get back. If you can see you will not finish, stop and say what is left rather than',
  'being cut off mid-file.',
  '',
  'Keep your reply short — a note on what you did or think. The files carry the detail.',
].join('\n');

// The candidate rule. Three claims, all true of this studio: thinking is
// discarded, files are kept and cached, and the turn is the unit of recovery.
const RULE = [
  '',
  'Think on disk, not in your head. Your thinking is thrown away at the end of every turn and paid for',
  'again on the next one; a file is kept, is in front of you next turn, and costs almost nothing to carry.',
  'So a plan you are holding in your head is a plan you are about to lose. Write it into TODO.md and',
  'SPEC.md as your first turn — a short list, one line per file you mean to write — and then work down',
  'the list. Do not settle every detail before you start: your first turn should end in tool calls, and',
  'the decisions you have not made yet are what the later turns are for. A turn that produced no file is',
  'a turn that produced nothing.',
].join('\n');

const B = A + RULE;

const TASK = 'Build me a tank game. Two players, split screen, destructible walls, power-ups.';

async function run(label, system) {
  const started = process.hrtime.bigint();
  const ms = () => Number(process.hrtime.bigint() - started) / 1e6;
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: TASK }],
      tools: TOOLS,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: MAX,
    }),
  });
  if (!res.ok) {
    console.log(`${label.padEnd(22)} HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let finish = null;
  let reasoningChars = 0;
  let charsBeforeCall = null;
  let firstCallAt = null;
  const paths = [];
  let prose = '';
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
      if (delta.reasoning_content) reasoningChars += delta.reasoning_content.length;
      if (delta.content) prose += delta.content;
      for (const call of delta.tool_calls ?? []) {
        if (firstCallAt === null) {
          firstCallAt = ms();
          charsBeforeCall = reasoningChars;
        }
        const name = call.function?.name;
        if (name) paths.push(name);
        const args = call.function?.arguments ?? '';
        const m = args.match(/"path"\s*:\s*"([^"]+)"/);
        if (m) paths[paths.length - 1] = `${paths[paths.length - 1]}:${m[1]}`;
      }
    }
  }
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  // reasoning_tokens is only reported at the end, so the share before the
  // first call is measured in characters and scaled.
  const before = charsBeforeCall === null || reasoningChars === 0
    ? null
    : Math.round((charsBeforeCall / reasoningChars) * reasoning);
  console.log(
    `${label.padEnd(22)} reasoning ${String(reasoning).padStart(5)}  `
    + `before 1st call ${before === null ? '  never' : String(before).padStart(5)}  `
    + `at ${firstCallAt === null ? '     -' : `${(firstCallAt / 1000).toFixed(1)}s`.padStart(6)}  `
    + `calls ${String(paths.length).padStart(2)}  ${(ms() / 1000).toFixed(0).padStart(3)}s  ${finish}`,
  );
  if (paths.length) console.log(`${' '.repeat(24)}${paths.join('  ')}`);
  else if (prose) console.log(`${' '.repeat(24)}said only: “${prose.slice(0, 90).replace(/\n/g, ' ⏎ ')}…”`);
}

console.log(`${MODEL}, max_tokens ${MAX}, tools present, "build me a tank game"\n`);
for (let i = 0; i < REPS; i += 1) await run(`A: preamble #${i + 1}`, A);
for (let i = 0; i < REPS; i += 1) await run(`B: + think-on-disk #${i + 1}`, B);
