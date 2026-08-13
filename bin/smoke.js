// One live round trip against DeepSeek, kept out of `npm test` because it
// needs a key and the network. Run it after touching server/llm/deepseek.js:
//
//   DEEPSEEK_API_KEY=sk-... npm run smoke
//
// In the development sandbox all egress goes through a CONNECT proxy and DNS
// does not resolve, which is why the npm script passes --use-env-proxy.
import { createDeepSeek, tokensCharged, MODEL_IDS } from '../server/llm/deepseek.js';

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

console.log(`models: ${MODEL_IDS.join(', ')}\n`);

// 1. Plain streaming, reasoning left on (the default for both models).
{
  const seen = await drain({
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    maxTokens: 64,
  });
  check('text streams', seen.text.trim().toLowerCase().includes('ok'), JSON.stringify(seen.text));
  check('reasoning is on by default', seen.reasoning.length > 0, `${seen.reasoning.length} chars`);
  check('end carries a finish reason', seen.end?.finish_reason === 'stop', seen.end?.finish_reason);
  check('end carries usage', tokensCharged(seen.end?.usage) > 0,
    `charged ${tokensCharged(seen.end?.usage)} tokens`);
}

// 2. reasoning: false must actually suppress the trace.
{
  const seen = await drain({
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    reasoning: false,
    maxTokens: 64,
  });
  check('reasoning: false suppresses the trace', seen.reasoning.length === 0,
    `${seen.reasoning.length} chars`);
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

// 5. The pro model answers the same shape.
{
  const seen = await drain({
    model: 'deepseek-v4-pro',
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    maxTokens: 64,
  });
  check('deepseek-v4-pro streams', seen.text.trim().length > 0, JSON.stringify(seen.text));
}

console.log(failures === 0 ? '\nall live checks passed' : `\n${failures} live check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
