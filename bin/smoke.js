// One live round trip against DeepSeek, kept out of `npm test` because it
// needs a key and the network. Run it after touching server/llm/deepseek.js:
//
//   DEEPSEEK_API_KEY=sk-... npm run smoke
//
// In the development sandbox all egress goes through a CONNECT proxy and DNS
// does not resolve, which is why the npm script passes --use-env-proxy.
import { readFile } from 'node:fs/promises';
import { createDeepSeek, tokensCharged, MODEL } from '../server/llm/deepseek.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('set DEEPSEEK_API_KEY');
  process.exit(2);
}

const client = createDeepSeek({ apiKey });
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function drain(opts) {
  const seen = { reasoning: '', text: '', tools: [], failed: [], end: null };
  for await (const event of client.stream(opts)) {
    if (event.type === 'reasoning') seen.reasoning += event.text;
    else if (event.type === 'delta') seen.text += event.text;
    else if (event.type === 'tool_use') seen.tools.push(event);
    else if (event.type === 'tool_use_failed') seen.failed.push(event);
    else if (event.type === 'end') seen.end = event;
  }
  return seen;
}

console.log(`model: ${MODEL}\n`);

// 1. Plain streaming with thinking left at 'full', which sends no
//    reasoning_effort at all and gets the API's own default.
{
  const seen = await drain({
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    thinking: 'full',
    maxTokens: 64,
  });
  check('text streams', seen.text.trim().toLowerCase().includes('ok'), JSON.stringify(seen.text));
  check('thinking full leaves the trace on', seen.reasoning.length > 0,
    `${seen.reasoning.length} chars`);
  check('end carries a finish reason', seen.end?.finish_reason === 'stop', seen.end?.finish_reason);
  check('end carries usage', tokensCharged(seen.end?.usage) > 0,
    `charged ${tokensCharged(seen.end?.usage)} tokens`);
}

// 2. thinking: 'none' must actually suppress the trace.
{
  const seen = await drain({
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    thinking: 'none',
    maxTokens: 64,
  });
  check("thinking 'none' suppresses the trace", seen.reasoning.length === 0,
    `${seen.reasoning.length} chars`);
  check('the reply still arrives', seen.text.trim().length > 0, JSON.stringify(seen.text));
}

// 3. The middle setting: a trace, but a shorter one, and the reply still
//    arrives. The size claim is §14's, measured against tools; this only
//    checks the parameter is accepted and behaves like reasoning-on.
{
  const seen = await drain({
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    thinking: 'low',
    maxTokens: 64,
  });
  check("thinking 'low' still traces", seen.reasoning.length > 0, `${seen.reasoning.length} chars`);
  check('the reply still arrives', seen.text.trim().length > 0, JSON.stringify(seen.text));
}

// 3. Streamed tool calls, which is the shape the orchestrator depends on.
{
  const tools = [{
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file in the project working tree.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  }];
  const seen = await drain({
    system: 'You edit game files with tools. Call them immediately, no preamble.',
    messages: [{ role: 'user', content: 'Create index.html containing exactly <h1>Hi</h1>' }],
    tools,
    maxTokens: 512,
  });
  const call = seen.tools[0];
  check('a tool call is reassembled', Boolean(call), `${seen.tools.length} call(s)`);
  check('the tool name survives', call?.name === 'write_file', call?.name);
  check('the arguments parse', typeof call?.input?.path === 'string',
    JSON.stringify(call?.input)?.slice(0, 90));
  check('finish_reason reports tool use', seen.end?.finish_reason === 'tool_calls',
    seen.end?.finish_reason);
  check('no truncated calls', seen.failed.length === 0, `${seen.failed.length} failed`);
}

// 4. Parallel calls in a single turn — what lets one turn write several files.
{
  const tools = [{
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  }];
  const seen = await drain({
    system: 'You edit game files with tools. Call them immediately, no preamble.',
    messages: [{
      role: 'user',
      content: 'Create two files now: a.txt containing "A" and b.txt containing "B".',
    }],
    tools,
    maxTokens: 512,
  });
  check('parallel tool calls arrive', seen.tools.length >= 2,
    seen.tools.map((c) => c.input?.path).join(', '));
}

// 5. The one shape `npm test` can assert but never prove: a picture handed
//    back on a tool result, which is where look_at puts one (spec.md §14).
//    ⚠️ An image on a system or assistant message is a 400; only user and
//    tool messages take one, which is why the ambient file block cannot.
{
  const png = await readFile('public/story-art/backgrounds/forest.png');
  const url = `data:image/png;base64,${png.toString('base64')}`;
  const call = {
    id: 'call_look', type: 'function',
    function: { name: 'look_at', arguments: '{"path":"assets/images/forest.png"}' },
  };
  const seen = await drain({
    messages: [
      { role: 'user', content: 'What two colours is assets/images/forest.png? Six words max.' },
      { role: 'assistant', content: null, tool_calls: [call] },
      {
        role: 'tool',
        tool_call_id: call.id,
        content: [
          { type: 'text', text: 'assets/images/forest.png (3177 bytes)' },
          { type: 'image_url', image_url: { url } },
        ],
      },
    ],
    thinking: 'none',
    maxTokens: 64,
  });
  // The picture is a green and brown pixel-art forest. Naming either one is
  // the whole check: it cannot be guessed from the path, which says only
  // "forest", and a model that dropped the image answers colours at random —
  // which is exactly what deepseek-v4-pro does.
  check('a picture on a tool result is seen', /green|brown/i.test(seen.text),
    JSON.stringify(seen.text));
  const pictureTokens = (seen.end?.usage?.prompt_tokens ?? 0) - 40;
  check('and costs a couple of hundred tokens, not its bytes',
    pictureTokens > 50 && pictureTokens < 1100, `~${pictureTokens} tokens for 3.1 KB of PNG`);
}

console.log(failures === 0 ? '\nall live checks passed' : `\n${failures} live check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
