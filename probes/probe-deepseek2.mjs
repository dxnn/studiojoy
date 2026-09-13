// Round 2: model aliases, reasoning streaming, output ceiling, context ceiling.
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

// ---------- A. what do the aliases resolve to? ----------
line('A. alias -> served model, and does it reason?');
for (const model of ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-pro']) {
  try {
    const r = await post({
      model,
      messages: [{ role: 'user', content: 'What is 6*7? Answer with the number only.' }],
      max_tokens: 200,
    });
    const j = await r.json();
    if (j.error) { console.log(`${model} -> ERROR ${JSON.stringify(j.error).slice(0, 160)}`); continue; }
    const m = j.choices?.[0]?.message;
    console.log(
      `${model.padEnd(18)} -> served="${j.model}"`,
      `reasoning=${m?.reasoning_content ? m.reasoning_content.length + 'ch' : 'none'}`,
      `reasoning_tokens=${j.usage?.completion_tokens_details?.reasoning_tokens ?? '-'}`,
      `content=${JSON.stringify(m?.content)?.slice(0, 30)}`,
    );
  } catch (e) { console.log(model, 'FAILED', e.message); }
}

// ---------- B. streaming reasoning deltas ----------
line('B. deepseek-reasoner streaming: where does reasoning_content arrive?');
try {
  const r = await post({
    model: 'deepseek-reasoner',
    messages: [{ role: 'user', content: 'Is 91 prime? Answer yes or no.' }],
    max_tokens: 400,
    stream: true,
    stream_options: { include_usage: true },
  });
  const text = await r.text();
  const lines = text.split('\n').filter((l) => l.startsWith('data:'));
  let rc = 0, ct = 0, keysSeen = new Set(), usageChunk = null, finish = null;
  for (const l of lines) {
    const p = l.slice(5).trim();
    if (p === '[DONE]') continue;
    let j; try { j = JSON.parse(p); } catch { continue; }
    const d = j.choices?.[0]?.delta;
    for (const k of Object.keys(d ?? {})) keysSeen.add(k);
    if (d?.reasoning_content) rc += d.reasoning_content.length;
    if (d?.content) ct += d.content.length;
    if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
    if (j.usage) usageChunk = { choices: j.choices?.length ?? 0, usage: j.usage };
  }
  console.log('chunks:', lines.length, 'delta keys seen:', [...keysSeen]);
  console.log('reasoning chars:', rc, 'content chars:', ct, 'finish:', finish);
  console.log('usage chunk:', JSON.stringify(usageChunk));
} catch (e) { console.log('FAILED', e.message); }

// ---------- C. output ceiling: can a single turn exceed 8192 tokens? ----------
line('C. output ceiling — ask for a long file, max_tokens=16000');
try {
  const r = await post({
    model: 'deepseek-chat',
    messages: [{
      role: 'user',
      content: 'Output a single HTML file for a playable snake game. '
        + 'Inline all CSS and JS. Be thorough and verbose, include comments. '
        + 'Output only code, no prose.',
    }],
    max_tokens: 16000,
  });
  const j = await r.json();
  if (j.error) console.log('ERROR', JSON.stringify(j.error).slice(0, 200));
  else console.log(
    'completion_tokens:', j.usage?.completion_tokens,
    'finish_reason:', j.choices?.[0]?.finish_reason,
    'content bytes:', Buffer.byteLength(j.choices?.[0]?.message?.content ?? ''),
  );
} catch (e) { console.log('FAILED', e.message); }

// ---------- D. context ceiling — deliberately overshoot ----------
line('D. context ceiling — oversized prompt, expect a 400 naming the limit');
for (const approxTokens of [200000, 2000000]) {
  // ~4 chars/token of filler
  const filler = 'alpha beta gamma delta epsilon zeta eta theta '.repeat(
    Math.ceil((approxTokens * 4) / 45),
  );
  try {
    const r = await post({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: filler + '\nReply: ok' }],
      max_tokens: 10,
    });
    const j = await r.json();
    if (j.error) {
      console.log(`~${approxTokens} tok -> ${r.status}: ${(j.error.message || '').slice(0, 220)}`);
      break;
    }
    console.log(`~${approxTokens} tok -> 200, prompt_tokens=${j.usage?.prompt_tokens}`);
  } catch (e) { console.log(`~${approxTokens} tok FAILED`, e.message); }
}

// ---------- E. does an oversized max_tokens get silently clamped? ----------
line('E. reported vs requested max_tokens on a long generation');
try {
  const r = await post({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'Write the numbers 1 to 4000, comma separated, nothing else.' }],
    max_tokens: 100000,
  });
  const j = await r.json();
  if (j.error) console.log('ERROR', JSON.stringify(j.error).slice(0, 200));
  else console.log(
    'completion_tokens:', j.usage?.completion_tokens,
    'finish_reason:', j.choices?.[0]?.finish_reason,
  );
} catch (e) { console.log('FAILED', e.message); }

// ---------- F. error shape for a bad model id ----------
line('F. error envelope shape');
try {
  const r = await post({ model: 'nope-not-a-model', messages: [{ role: 'user', content: 'hi' }] });
  console.log('status', r.status, 'body:', (await r.text()).slice(0, 300));
} catch (e) { console.log('FAILED', e.message); }

// ---------- G. 401 shape (wrong key) ----------
line('G. 401 envelope');
try {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-bogus' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }),
  });
  console.log('status', r.status, 'body:', (await r.text()).slice(0, 200));
} catch (e) { console.log('FAILED', e.message); }
