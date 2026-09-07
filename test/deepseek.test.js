import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeepSeek, tokensCharged, tokensForChars, LlmError, MODEL_IDS,
  DEFAULT_MAX_TOKENS, MAX_OUTPUT_TOKENS,
} from '../server/llm/deepseek.js';

// Build an SSE body from chunk objects. `sliceAt` emits the bytes in small
// pieces so the parser is exercised on frames split mid-JSON, which is what
// a real socket does.
function sseBody(chunks, { sliceSize = 0, withDone = true } = {}) {
  const text = chunks
    .map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`)
    .join('') + (withDone ? 'data: [DONE]\n\n' : '');
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      if (sliceSize <= 0) {
        controller.enqueue(bytes);
      } else {
        for (let i = 0; i < bytes.length; i += sliceSize) {
          controller.enqueue(bytes.slice(i, i + sliceSize));
        }
      }
      controller.close();
    },
  });
}

function fakeFetch(chunks, opts = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (opts.status && opts.status !== 200) {
      return new Response(JSON.stringify(opts.errorBody ?? {}), {
        status: opts.status, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(sseBody(chunks, opts), {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    });
  };
  impl.calls = calls;
  return impl;
}

const textChunk = (content) => ({
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
});
const reasoningChunk = (reasoning_content) => ({
  choices: [{ index: 0, delta: { reasoning_content }, finish_reason: null }],
});
const finalChunk = (finish_reason = 'stop', usage = null) => ({
  choices: [{ index: 0, delta: {}, finish_reason }],
  ...(usage ? { usage } : {}),
});
const toolChunk = (index, patch) => ({
  choices: [{ index: 0, delta: { tool_calls: [{ index, ...patch }] } }],
});

async function collect(client, opts = {}) {
  const events = [];
  for await (const event of client.stream({ messages: [{ role: 'user', content: 'hi' }], ...opts })) {
    events.push(event);
  }
  return events;
}

test('text deltas stream and the end event carries the whole reply', async () => {
  const fetchImpl = fakeFetch([
    textChunk('Hello'), textChunk(' '), textChunk('world'),
    finalChunk('stop', { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }),
  ]);
  const events = await collect(createDeepSeek({ apiKey: 'k', fetchImpl }));

  assert.deepEqual(
    events.filter((e) => e.type === 'delta').map((e) => e.text),
    ['Hello', ' ', 'world'],
  );
  const end = events.at(-1);
  assert.equal(end.type, 'end');
  assert.equal(end.text, 'Hello world');
  assert.equal(end.finish_reason, 'stop');
  assert.equal(end.usage.completion_tokens, 3);
});

test('a reasoning trace is its own event and stays out of the reply', async () => {
  const fetchImpl = fakeFetch([
    reasoningChunk('Let me think. '), reasoningChunk('91 = 7 x 13.'),
    textChunk('No'), finalChunk(),
  ]);
  const events = await collect(createDeepSeek({ apiKey: 'k', fetchImpl }));

  assert.deepEqual(
    events.filter((e) => e.type === 'reasoning').map((e) => e.text),
    ['Let me think. ', '91 = 7 x 13.'],
  );
  const end = events.at(-1);
  assert.equal(end.text, 'No', 'the trace must not leak into the persisted reply');
});

test('tool call fragments are reassembled and parsed', async () => {
  const fetchImpl = fakeFetch([
    toolChunk(0, { id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '' } }),
    toolChunk(0, { function: { arguments: '{"path": "index' } }),
    toolChunk(0, { function: { arguments: '.html", "content"' } }),
    toolChunk(0, { function: { arguments: ': "<h1>Hi</h1>"}' } }),
    finalChunk('tool_calls'),
  ]);
  const events = await collect(createDeepSeek({ apiKey: 'k', fetchImpl }));

  const call = events.find((e) => e.type === 'tool_use');
  assert.equal(call.id, 'call_1');
  assert.equal(call.name, 'write_file');
  assert.deepEqual(call.input, { path: 'index.html', content: '<h1>Hi</h1>' });
  assert.equal(events.at(-1).finish_reason, 'tool_calls');
});

test('parallel tool calls come out in index order', async () => {
  const fetchImpl = fakeFetch([
    toolChunk(0, { id: 'c0', function: { name: 'write_file', arguments: '{"path":"a.txt",' } }),
    toolChunk(1, { id: 'c1', function: { name: 'write_file', arguments: '{"path":"b.txt",' } }),
    toolChunk(1, { function: { arguments: '"content":"B"}' } }),
    toolChunk(0, { function: { arguments: '"content":"A"}' } }),
    finalChunk('tool_calls'),
  ]);
  const events = await collect(createDeepSeek({ apiKey: 'k', fetchImpl }));

  const calls = events.filter((e) => e.type === 'tool_use');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.input.path), ['a.txt', 'b.txt']);
  assert.deepEqual(calls.map((c) => c.input.content), ['A', 'B']);
});

// Truncation mid tool call: the non-streaming API drops the call, but
// streaming has already delivered fragments, so the leftovers won't parse.
test('truncated tool arguments surface as a failure, not a silent drop', async () => {
  const fetchImpl = fakeFetch([
    toolChunk(0, { id: 'c0', function: { name: 'write_file', arguments: '{"path":"game.html","content":"<html' } }),
    finalChunk('length'),
  ]);
  const events = await collect(createDeepSeek({ apiKey: 'k', fetchImpl }));

  const failed = events.find((e) => e.type === 'tool_use_failed');
  assert.equal(failed.name, 'write_file');
  assert.match(failed.reason, /truncated/);
  assert.equal(events.find((e) => e.type === 'tool_use'), undefined);
  assert.equal(events.at(-1).finish_reason, 'length');
});

test('frames split across arbitrary byte boundaries still parse', async () => {
  const chunks = [
    reasoningChunk('thinking'),
    textChunk('Hello'),
    toolChunk(0, { id: 'c0', function: { name: 'write_file', arguments: '{"path":"a.txt","content":"A"}' } }),
    finalChunk('tool_calls', { prompt_tokens: 5, completion_tokens: 2 }),
  ];
  // One byte at a time is the pathological case.
  for (const sliceSize of [1, 3, 17]) {
    const fetchImpl = fakeFetch(chunks, { sliceSize });
    const events = await collect(createDeepSeek({ apiKey: 'k', fetchImpl }));
    assert.equal(events.find((e) => e.type === 'delta').text, 'Hello', `slice ${sliceSize}`);
    assert.deepEqual(
      events.find((e) => e.type === 'tool_use').input,
      { path: 'a.txt', content: 'A' },
      `slice ${sliceSize}`,
    );
    assert.equal(events.at(-1).usage.completion_tokens, 2);
  }
});

test('an unparseable frame is skipped rather than fatal', async () => {
  const fetchImpl = fakeFetch([
    textChunk('before'), '{not json at all', textChunk('after'), finalChunk(),
  ]);
  const events = await collect(createDeepSeek({ apiKey: 'k', fetchImpl }));
  assert.equal(events.at(-1).text, 'beforeafter');
});

test('a stream that stops without [DONE] still ends cleanly', async () => {
  const fetchImpl = fakeFetch(
    [textChunk('partial'), finalChunk('stop')], { withDone: false },
  );
  const events = await collect(createDeepSeek({ apiKey: 'k', fetchImpl }));
  const end = events.at(-1);
  assert.equal(end.type, 'end');
  assert.equal(end.text, 'partial');
});

test('an error response becomes an LlmError carrying the API message', async () => {
  const fetchImpl = fakeFetch([], {
    status: 400,
    errorBody: {
      error: {
        message: 'The supported API model names are deepseek-v4-pro or deepseek-v4-flash',
        type: 'invalid_request_error',
        code: 'invalid_request_error',
      },
    },
  });
  await assert.rejects(
    () => collect(createDeepSeek({ apiKey: 'k', fetchImpl })),
    (err) => {
      assert.ok(err instanceof LlmError);
      assert.equal(err.status, 400);
      assert.equal(err.type, 'invalid_request_error');
      assert.match(err.message, /deepseek-v4-flash/);
      return true;
    },
  );
});

test('a 401 is reported as such', async () => {
  const fetchImpl = fakeFetch([], {
    status: 401,
    errorBody: { error: { message: 'Authentication Fails', type: 'authentication_error' } },
  });
  await assert.rejects(
    () => collect(createDeepSeek({ apiKey: 'bad', fetchImpl })),
    (err) => err.status === 401 && /Authentication Fails/.test(err.message),
  );
});

test('a transport failure is wrapped rather than leaking', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  await assert.rejects(
    () => collect(createDeepSeek({ apiKey: 'k', fetchImpl })),
    (err) => err instanceof LlmError && /request failed/.test(err.message),
  );
});

test('the request body matches what the API expects', async () => {
  const fetchImpl = fakeFetch([finalChunk()]);
  const client = createDeepSeek({ apiKey: 'secret-key', fetchImpl });
  await collect(client, {
    model: 'deepseek-v4-pro',
    system: 'You edit game files.',
    tools: [{ type: 'function', function: { name: 'write_file' } }],
  });

  const { url, init, body } = fetchImpl.calls[0];
  assert.match(url, /\/chat\/completions$/);
  assert.equal(init.headers.Authorization, 'Bearer secret-key');
  assert.equal(body.model, 'deepseek-v4-pro');
  assert.equal(body.stream, true);
  // Without include_usage the final chunk carries no usage and the budget
  // cannot be charged.
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.max_tokens, DEFAULT_MAX_TOKENS);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].content, 'hi');
  assert.equal(body.tools.length, 1);
  // The default thinking level is 'low', which names itself.
  assert.equal(body.reasoning_effort, 'low');
});

test('each thinking level sends the effort the API expects', async () => {
  // 'full' means the API's own default, which is reasoning on — so the
  // parameter has to be absent rather than set to anything.
  const full = fakeFetch([finalChunk()]);
  await collect(createDeepSeek({ apiKey: 'k', fetchImpl: full }), { thinking: 'full' });
  assert.equal('reasoning_effort' in full.calls[0].body, false);

  for (const level of ['low', 'none']) {
    const fetchImpl = fakeFetch([finalChunk()]);
    await collect(createDeepSeek({ apiKey: 'k', fetchImpl }), { thinking: level });
    assert.equal(fetchImpl.calls[0].body.reasoning_effort, level);
  }
});

// ⚠️ The backstop against the nine-minute silence: a trace that runs on with
// nothing else coming is stopped rather than waited out (spec.md §14).
test('a trace past the cap with nothing produced stops the stream', async () => {
  const fetchImpl = fakeFetch([
    reasoningChunk('a'.repeat(30)), reasoningChunk('b'.repeat(30)),
    textChunk('never reached'), finalChunk(),
  ]);
  const events = [];
  await assert.rejects(
    async () => {
      for await (const event of createDeepSeek({ apiKey: 'k', fetchImpl })
        .stream({ messages: [{ role: 'user', content: 'hi' }], thinkingCap: 50 })) {
        events.push(event);
      }
    },
    (err) => {
      assert.ok(err instanceof LlmError);
      assert.equal(err.code, 'thinking_cap');
      // The trace it ran up rides out on the error: no usage frame arrives
      // for a stream nobody let finish, so this is all the caller has to
      // charge from.
      assert.equal(err.reasoningChars, 60);
      return true;
    },
  );
  // The trace up to the cap was delivered, and nothing after it.
  assert.deepEqual(events.map((e) => e.type), ['reasoning', 'reasoning']);
});

test('a trace is estimated in tokens, and nonsense is zero', () => {
  assert.equal(tokensForChars(35_000), 10_000);
  assert.equal(tokensForChars(1), 1);
  assert.equal(tokensForChars(0), 0);
  // A cap thrown by something that did not count characters must not poison
  // the sum it is added to.
  assert.equal(tokensForChars(undefined), 0);
  assert.equal(tokensForChars(-5), 0);
  assert.equal(tokensForChars(NaN), 0);
});

test('the cap is off once the turn has produced something', async () => {
  // Same volume of trace, but a tool call arrives first: a turn that is
  // working is not a turn that is stuck, however long it goes on thinking.
  const fetchImpl = fakeFetch([
    toolChunk(0, { id: 'c1', function: { name: 'write_file', arguments: '{"path":"a.js"' } }),
    reasoningChunk('a'.repeat(200)),
    toolChunk(0, { function: { arguments: ',"content":"x"}' } }),
    finalChunk('tool_calls'),
  ]);
  const events = await collect(createDeepSeek({ apiKey: 'k', fetchImpl }), { thinkingCap: 50 });
  assert.deepEqual(events.filter((e) => e.type === 'tool_use').map((e) => e.input),
    [{ path: 'a.js', content: 'x' }]);
});

test('tools and system are omitted when absent', async () => {
  const fetchImpl = fakeFetch([finalChunk()]);
  await collect(createDeepSeek({ apiKey: 'k', fetchImpl }), { tools: [] });
  const { body } = fetchImpl.calls[0];
  assert.equal('tools' in body, false);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
});

test('max_tokens is clamped to the model ceiling', async () => {
  const fetchImpl = fakeFetch([finalChunk()]);
  await collect(createDeepSeek({ apiKey: 'k', fetchImpl }), { maxTokens: 999_999 });
  assert.equal(fetchImpl.calls[0].body.max_tokens, MAX_OUTPUT_TOKENS);
});

test('a client without a key is a programming error', () => {
  assert.throws(() => createDeepSeek({ apiKey: '' }), /apiKey/);
});

// prompt_tokens is hits plus misses, so charging it alongside the hit count
// would bill cached tokens twice. The weights are the price list's (§14): a
// hit a thirtieth, output three times a miss.
test('tokensCharged weighs hits and output as the price list does', () => {
  assert.equal(tokensCharged({
    prompt_tokens: 4018,
    prompt_cache_hit_tokens: 3968,
    prompt_cache_miss_tokens: 50,
    completion_tokens: 1,
  }), 50 + Math.ceil(3968 / 30) + 3);

  // A cold prompt: everything is a miss, and the output counts three times.
  assert.equal(tokensCharged({
    prompt_tokens: 322,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 322,
    completion_tokens: 67,
  }), 322 + 67 * 3);

  // If the split is ever absent, fall back to the total rather than zero.
  assert.equal(tokensCharged({ prompt_tokens: 100, completion_tokens: 5 }), 115);
  assert.equal(tokensCharged(null), 0);
  assert.equal(tokensCharged({}), 0);
});

test('the canonical model ids are the two verified ones', () => {
  assert.deepEqual(MODEL_IDS, ['deepseek-v4-flash', 'deepseek-v4-pro']);
});

// A fetch whose body arrives on a clock, for the idle guard. Mirrors the one
// piece of real fetch the fakes above skip: aborting the signal errors the
// body stream, which is how the guard firing reaches reader.read().
function timedFetch(chunks, { gapMs = 0, hang = false } = {}) {
  const encoder = new TextEncoder();
  return async (url, init) => {
    const body = new ReadableStream({
      async start(controller) {
        init.signal?.addEventListener('abort', () => {
          try {
            controller.error(new DOMException('This operation was aborted', 'AbortError'));
          } catch { /* already closed */ }
        });
        for (const chunk of chunks) {
          if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
          if (init.signal?.aborted) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        if (!hang) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      },
    });
    return new Response(body, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    });
  };
}

// The guard is idle time, not a deadline: this stream takes 160 ms in total,
// past the 120 ms guard, but no single gap does — a whole-request timer would
// have killed it mid-reply, which is exactly what it used to do to long turns.
test('a slow stream survives as long as chunks keep arriving', async () => {
  const fetchImpl = timedFetch(
    [textChunk('a'), textChunk('b'), textChunk('c'), finalChunk()],
    { gapMs: 40 },
  );
  const events = await collect(createDeepSeek({ apiKey: 'k', fetchImpl, idleMs: 120 }));
  assert.deepEqual(
    events.filter((e) => e.type === 'delta').map((e) => e.text),
    ['a', 'b', 'c'],
  );
  assert.equal(events.at(-1).type, 'end');
});

test('a stalled stream aborts with a legible error', async () => {
  const fetchImpl = timedFetch([textChunk('almost')], { hang: true });
  await assert.rejects(
    collect(createDeepSeek({ apiKey: 'k', fetchImpl, idleMs: 80 })),
    (err) => {
      assert.ok(err instanceof LlmError);
      assert.match(err.message, /stalled/);
      return true;
    },
  );
});

/* complete() — the whole answer at once, for the studio's own small asks ----- */

function jsonFetch(payload, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(payload), {
      status, headers: { 'content-type': 'application/json' },
    });
  };
  impl.calls = calls;
  return impl;
}

const said = (content, usage = null) => ({
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  ...(usage ? { usage } : {}),
});

test('complete asks for one whole answer and hands back its text and usage', async () => {
  const usage = { prompt_tokens: 200, prompt_cache_miss_tokens: 200, completion_tokens: 40 };
  const fetchImpl = jsonFetch(said('{"lines": []}', usage));
  const answer = await createDeepSeek({ apiKey: 'k', fetchImpl }).complete({
    system: 'be brief',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 1024,
  });

  assert.equal(answer.text, '{"lines": []}');
  assert.equal(answer.finish_reason, 'stop');
  assert.equal(tokensCharged(answer.usage), 200 + 40 * 3);

  const { body } = fetchImpl.calls[0];
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 1024);
  // Thinking off by default: these have nothing to show while they wait, and
  // a trace would be the whole of what they cost (spec.md §14).
  assert.equal(body.reasoning_effort, 'none');
  assert.equal('tools' in body, false);
  assert.equal('stream_options' in body, false);
  assert.deepEqual(body.messages[0], { role: 'system', content: 'be brief' });
});

// Measured 2026-09-03 (spec.md §14): the API accepts response_format and
// answers valid JSON. A belt over the prompt's own ask — sent only when asked
// for, since an unknown parameter would be ignored silently.
test('complete sends response_format only when asked to', async () => {
  const plain = jsonFetch(said('{"size":"small"}'));
  await createDeepSeek({ apiKey: 'k', fetchImpl: plain }).complete({
    messages: [{ role: 'user', content: 'x' }],
  });
  assert.equal('response_format' in plain.calls[0].body, false);

  const json = jsonFetch(said('{"size":"small"}'));
  await createDeepSeek({ apiKey: 'k', fetchImpl: json }).complete({
    messages: [{ role: 'user', content: 'x' }], responseFormat: 'json_object',
  });
  assert.deepEqual(json.calls[0].body.response_format, { type: 'json_object' });
});

test('complete clamps max_tokens and surfaces an upstream error as an LlmError', async () => {
  const ok = jsonFetch(said('hi'));
  await createDeepSeek({ apiKey: 'k', fetchImpl: ok }).complete({
    messages: [{ role: 'user', content: 'x' }],
    maxTokens: 999_999,
  });
  assert.equal(ok.calls[0].body.max_tokens, MAX_OUTPUT_TOKENS);

  const bad = jsonFetch({ error: { message: 'nope', type: 'invalid_request_error' } }, { status: 400 });
  await assert.rejects(
    createDeepSeek({ apiKey: 'k', fetchImpl: bad }).complete({
      messages: [{ role: 'user', content: 'x' }],
    }),
    (err) => {
      assert.ok(err instanceof LlmError);
      assert.equal(err.status, 400);
      assert.match(err.message, /nope/);
      return true;
    },
  );
});

test('complete answers with empty text rather than throwing on an empty choice', async () => {
  const fetchImpl = jsonFetch({ choices: [] });
  const answer = await createDeepSeek({ apiKey: 'k', fetchImpl }).complete({
    messages: [{ role: 'user', content: 'x' }],
  });
  assert.equal(answer.text, '');
  assert.equal(answer.usage, null);
  assert.equal(tokensCharged(answer.usage), 0);
});
