// Round 3: explicit reasoning control, default max_tokens, output ceiling.
import fs from 'node:fs';

const KEY = (process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync('tmp/deepseek.key', 'utf8')).trim();
const BASE = 'https://api.deepseek.com/v1';
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` };
const line = (s) => console.log('\n===== ' + s + ' =====');
const post = (body) => fetch(`${BASE}/chat/completions`, {
  method: 'POST', headers: H, body: JSON.stringify(body),
});

const Q = [{ role: 'user', content: 'What is 6*7? Answer with the number only.' }];

// ---------- A. is there an explicit knob to turn reasoning off? ----------
line('A. reasoning control params on deepseek-v4-flash');
const attempts = [
  { label: 'baseline (no param)', extra: {} },
  { label: "reasoning_effort:'none'", extra: { reasoning_effort: 'none' } },
  { label: "reasoning_effort:'minimal'", extra: { reasoning_effort: 'minimal' } },
  { label: "reasoning_effort:'low'", extra: { reasoning_effort: 'low' } },
  { label: "reasoning_effort:'high'", extra: { reasoning_effort: 'high' } },
  { label: 'thinking:{type:disabled}', extra: { thinking: { type: 'disabled' } } },
  { label: 'enable_thinking:false', extra: { enable_thinking: false } },
];
for (const a of attempts) {
  try {
    const r = await post({ model: 'deepseek-v4-flash', messages: Q, max_tokens: 300, ...a.extra });
    const j = await r.json();
    if (j.error) {
      console.log(`${a.label.padEnd(26)} -> ${r.status} ${(j.error.message || '').slice(0, 90)}`);
    } else {
      console.log(
        `${a.label.padEnd(26)} -> 200`,
        `reasoning=${j.choices?.[0]?.message?.reasoning_content?.length ?? 0}ch`,
        `rtok=${j.usage?.completion_tokens_details?.reasoning_tokens ?? '-'}`,
      );
    }
  } catch (e) { console.log(a.label, 'FAILED', e.message); }
}

// ---------- B. default max_tokens when omitted ----------
line('B. omit max_tokens — how long can one turn run?');
try {
  const r = await post({
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'Write the numbers 1 to 6000, comma separated, nothing else.' }],
  });
  const j = await r.json();
  if (j.error) console.log('ERROR', JSON.stringify(j.error).slice(0, 200));
  else console.log(
    'completion_tokens:', j.usage?.completion_tokens,
    'finish_reason:', j.choices?.[0]?.finish_reason,
  );
} catch (e) { console.log('FAILED', e.message); }

// ---------- C. force a truncation so we know finish_reason='length' fires ----------
line("C. deliberate truncation -> finish_reason");
try {
  const r = await post({
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'Write a 500 word essay about tetris.' }],
    max_tokens: 40,
  });
  const j = await r.json();
  console.log(
    'completion_tokens:', j.usage?.completion_tokens,
    'finish_reason:', j.choices?.[0]?.finish_reason,
  );
} catch (e) { console.log('FAILED', e.message); }

// ---------- D. truncation mid tool_call -> what does the arg buffer look like? ----------
line('D. truncated tool_call (max_tokens too small for the args)');
try {
  const r = await post({
    model: 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: 'You edit game files with tools. Use them immediately.' },
      { role: 'user', content: 'Create game.html containing a complete 300-line snake game.' },
    ],
    tools: [{
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
    }],
    max_tokens: 60,
  });
  const j = await r.json();
  const tc = j.choices?.[0]?.message?.tool_calls?.[0];
  console.log('finish_reason:', j.choices?.[0]?.finish_reason);
  console.log('args tail:', JSON.stringify(tc?.function?.arguments?.slice(-60)));
  let ok = 'n/a';
  if (tc) { try { JSON.parse(tc.function.arguments); ok = 'parses'; } catch { ok = 'UNPARSEABLE'; } }
  console.log('args:', ok);
} catch (e) { console.log('FAILED', e.message); }

// ---------- E. pro vs flash on the same tool task, for the model table ----------
line('E. deepseek-v4-pro tool call sanity');
try {
  const r = await post({
    model: 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: 'You edit game files with tools. Use them immediately.' },
      { role: 'user', content: 'Create a.txt containing "A".' },
    ],
    tools: [{
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
    }],
    max_tokens: 500,
  });
  const j = await r.json();
  console.log('finish_reason:', j.choices?.[0]?.finish_reason,
    'tool:', j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments,
    'usage:', JSON.stringify(j.usage));
} catch (e) { console.log('FAILED', e.message); }
