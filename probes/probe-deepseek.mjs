// Resolve spec.md §14: verify DeepSeek's API shape against the live service.
// Compact output on purpose — shapes and field names, not full completions.
import fs from 'node:fs';

const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const BASE = 'https://api.deepseek.com/v1';

const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` };
const line = (s) => console.log('\n===== ' + s + ' =====');

async function post(body) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST', headers: H, body: JSON.stringify(body),
  });
  return r;
}

// ---------- 1. model list ----------
line('1. GET /models');
try {
  const r = await fetch(`${BASE}/models`, { headers: H });
  const j = await r.json();
  console.log('status', r.status);
  console.log('ids:', (j.data || []).map((m) => m.id));
} catch (e) { console.log('FAILED', e.message); }

// ---------- 2. plain completion + usage shape ----------
line('2. deepseek-chat non-streaming, usage fields');
try {
  const r = await post({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 20,
  });
  console.log('status', r.status);
  const j = await r.json();
  console.log('top-level keys:', Object.keys(j));
  console.log('choice keys:', Object.keys(j.choices?.[0] ?? {}));
  console.log('message keys:', Object.keys(j.choices?.[0]?.message ?? {}));
  console.log('finish_reason:', j.choices?.[0]?.finish_reason);
  console.log('content:', JSON.stringify(j.choices?.[0]?.message?.content));
  console.log('usage:', j.usage);
} catch (e) { console.log('FAILED', e.message); }

// ---------- 3. streaming text shape ----------
line('3. deepseek-chat streaming, event shape');
try {
  const r = await post({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'Count: one two three' }],
    max_tokens: 30,
    stream: true,
    stream_options: { include_usage: true },
  });
  console.log('status', r.status, 'ct:', r.headers.get('content-type'));
  const text = await r.text();
  const lines = text.split('\n').filter((l) => l.startsWith('data:'));
  console.log('data lines:', lines.length);
  console.log('first:', lines[0]?.slice(0, 220));
  console.log('second:', lines[1]?.slice(0, 220));
  console.log('penultimate:', lines[lines.length - 3]?.slice(0, 300));
  console.log('last-1:', lines[lines.length - 2]?.slice(0, 300));
  console.log('last:', lines[lines.length - 1]?.slice(0, 120));
} catch (e) { console.log('FAILED', e.message); }

// ---------- 4. tool calling, non-streaming ----------
const TOOLS = [{
  type: 'function',
  function: {
    name: 'write_file',
    description: 'Create or overwrite a file in the project working tree.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'project-relative path' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
}];

line('4. deepseek-chat tools, non-streaming');
try {
  const r = await post({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: 'You edit game files with tools. Use them.' },
      { role: 'user', content: 'Create index.html containing just <h1>Hi</h1>' },
    ],
    tools: TOOLS,
    max_tokens: 400,
  });
  console.log('status', r.status);
  const j = await r.json();
  const m = j.choices?.[0]?.message;
  console.log('finish_reason:', j.choices?.[0]?.finish_reason);
  console.log('message keys:', Object.keys(m ?? {}));
  console.log('content:', JSON.stringify(m?.content)?.slice(0, 120));
  console.log('tool_calls:', JSON.stringify(m?.tool_calls)?.slice(0, 400));
  console.log('usage:', j.usage);
} catch (e) { console.log('FAILED', e.message); }

// ---------- 5. tool calling, STREAMING (the critical one) ----------
line('5. deepseek-chat tools + stream — delta.tool_calls fragments');
try {
  const r = await post({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: 'You edit game files with tools. Use them.' },
      { role: 'user', content: 'Create index.html containing just <h1>Hi</h1>' },
    ],
    tools: TOOLS,
    max_tokens: 400,
    stream: true,
    stream_options: { include_usage: true },
  });
  console.log('status', r.status);
  const text = await r.text();
  const lines = text.split('\n').filter((l) => l.startsWith('data:'));
  console.log('data lines:', lines.length);
  // Show the first few and the tail, plus reconstruct the tool call.
  for (const i of [0, 1, 2]) console.log(`[${i}]`, lines[i]?.slice(0, 260));
  console.log('[-3]', lines[lines.length - 3]?.slice(0, 260));
  console.log('[-2]', lines[lines.length - 2]?.slice(0, 260));
  const acc = new Map();
  let finish = null;
  for (const l of lines) {
    const payload = l.slice(5).trim();
    if (payload === '[DONE]') continue;
    let j; try { j = JSON.parse(payload); } catch { continue; }
    const d = j.choices?.[0]?.delta;
    if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
    for (const tc of d?.tool_calls ?? []) {
      const cur = acc.get(tc.index) ?? { id: '', name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name = tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      acc.set(tc.index, cur);
    }
  }
  console.log('finish_reason:', finish);
  console.log('reconstructed:', [...acc.entries()].map(([i, v]) =>
    `#${i} ${v.name} id=${v.id} args=${v.args.slice(0, 90)}`));
  for (const [, v] of acc) {
    try { JSON.parse(v.args); console.log('args parse: OK'); }
    catch (e) { console.log('args parse FAIL:', e.message); }
  }
} catch (e) { console.log('FAILED', e.message); }

// ---------- 6. parallel tool calls in one turn? ----------
line('6. deepseek-chat — two files in one turn (parallel tool_calls)');
try {
  const r = await post({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: 'You edit game files with tools. Use them.' },
      { role: 'user', content: 'Create two files: a.txt containing "A" and b.txt containing "B". Do both now.' },
    ],
    tools: TOOLS,
    max_tokens: 500,
  });
  const j = await r.json();
  console.log('status', r.status, 'n tool_calls:',
    j.choices?.[0]?.message?.tool_calls?.length ?? 0);
  console.log('names:', (j.choices?.[0]?.message?.tool_calls ?? [])
    .map((t) => `${t.function.name}(${t.function.arguments.slice(0, 40)})`));
} catch (e) { console.log('FAILED', e.message); }

// ---------- 7. tool result round trip ----------
line('7. tool result round trip (role:tool)');
try {
  const r = await post({
    model: 'deepseek-chat',
    messages: [
      { role: 'user', content: 'Read the file notes.txt and tell me its contents.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_probe_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call_probe_1', content: 'hello from disk' },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    }],
    max_tokens: 80,
  });
  console.log('status', r.status);
  const j = await r.json();
  console.log('reply:', JSON.stringify(j.choices?.[0]?.message?.content)?.slice(0, 200));
  console.log('error:', j.error?.message);
} catch (e) { console.log('FAILED', e.message); }

// ---------- 8. deepseek-reasoner: tools supported? ----------
line('8. deepseek-reasoner WITH tools');
try {
  const r = await post({
    model: 'deepseek-reasoner',
    messages: [{ role: 'user', content: 'Create index.html with <h1>Hi</h1>' }],
    tools: TOOLS,
    max_tokens: 200,
  });
  console.log('status', r.status);
  const j = await r.json();
  if (j.error) console.log('error:', JSON.stringify(j.error).slice(0, 300));
  else {
    console.log('finish_reason:', j.choices?.[0]?.finish_reason);
    console.log('message keys:', Object.keys(j.choices?.[0]?.message ?? {}));
    console.log('tool_calls:', JSON.stringify(j.choices?.[0]?.message?.tool_calls)?.slice(0, 250));
  }
} catch (e) { console.log('FAILED', e.message); }

// ---------- 9. deepseek-reasoner without tools: reasoning_content ----------
line('9. deepseek-reasoner WITHOUT tools');
try {
  const r = await post({
    model: 'deepseek-reasoner',
    messages: [{ role: 'user', content: 'What is 17*23? Answer briefly.' }],
    max_tokens: 300,
  });
  console.log('status', r.status);
  const j = await r.json();
  if (j.error) console.log('error:', JSON.stringify(j.error).slice(0, 300));
  else {
    const m = j.choices?.[0]?.message;
    console.log('message keys:', Object.keys(m ?? {}));
    console.log('reasoning_content len:', m?.reasoning_content?.length ?? 'absent');
    console.log('content:', JSON.stringify(m?.content)?.slice(0, 120));
    console.log('usage:', j.usage);
  }
} catch (e) { console.log('FAILED', e.message); }

// ---------- 10. max_tokens ceiling ----------
line('10. max_tokens ceiling probe');
for (const model of ['deepseek-chat', 'deepseek-reasoner']) {
  for (const mt of [8192, 8193, 16384, 32768, 65536, 100000]) {
    const r = await post({
      model, messages: [{ role: 'user', content: 'hi' }], max_tokens: mt,
    });
    if (r.status === 200) {
      const j = await r.json();
      console.log(`${model} max_tokens=${mt} -> 200 (out ${j.usage?.completion_tokens})`);
    } else {
      const j = await r.json().catch(() => ({}));
      console.log(`${model} max_tokens=${mt} -> ${r.status}: ${(j.error?.message || '').slice(0, 130)}`);
      break;
    }
  }
}

// ---------- 11. cache fields on a repeated long prompt ----------
line('11. prompt cache fields (same long prefix twice)');
try {
  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(400);
  const msgs = [
    { role: 'system', content: 'You are terse. Reference material:\n' + filler },
    { role: 'user', content: 'Reply with exactly: one' },
  ];
  for (const pass of [1, 2]) {
    const r = await post({ model: 'deepseek-chat', messages: msgs, max_tokens: 10 });
    const j = await r.json();
    console.log(`pass ${pass} usage:`, j.usage);
  }
} catch (e) { console.log('FAILED', e.message); }

// ---------- 12. base URL without /v1 ----------
line('12. does https://api.deepseek.com (no /v1) also work?');
try {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: H,
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
    }),
  });
  console.log('status', r.status);
} catch (e) { console.log('FAILED', e.message); }
