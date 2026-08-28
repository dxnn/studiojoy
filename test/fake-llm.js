// A scripted stand-in for the DeepSeek client. The real event shapes are
// pinned down by test/deepseek.test.js and bin/smoke.js; this exists so
// orchestrator tests can drive exact turn sequences with no network.

export const usage = (completion = 10, prompt = 100, reasoning = 0) => ({
  prompt_tokens: prompt,
  prompt_cache_hit_tokens: 0,
  prompt_cache_miss_tokens: prompt,
  completion_tokens: completion,
  ...(reasoning ? { completion_tokens_details: { reasoning_tokens: reasoning } } : {}),
});

// One turn that streams some prose and stops. `reasoningTokens` is what the
// usage reports, for the shed rule; `reasoning` is streamed trace text.
export function says(text, { reasoning = null, tokens = 10, reasoningTokens = 0 } = {}) {
  const events = [];
  if (reasoning) events.push({ type: 'reasoning', text: reasoning });
  if (text) events.push({ type: 'delta', text });
  events.push({
    type: 'end', text, finish_reason: 'stop', usage: usage(tokens, 100, reasoningTokens),
  });
  return events;
}

// One turn that calls tools, optionally with a preamble.
export function calls(toolCalls, { text = '', tokens = 20, reasoningTokens = 0 } = {}) {
  const events = [];
  if (text) events.push({ type: 'delta', text });
  toolCalls.forEach((call, i) => {
    events.push({
      type: 'tool_use',
      id: call.id ?? `call_${i}`,
      name: call.name,
      input: call.input,
    });
  });
  events.push({
    type: 'end', text, finish_reason: 'tool_calls', usage: usage(tokens, 100, reasoningTokens),
  });
  return events;
}

// A turn cut off by the output limit.
export function truncated({ text = '', toolName = 'write_file' } = {}) {
  const events = [];
  if (text) events.push({ type: 'delta', text });
  events.push({
    type: 'tool_use_failed', id: 'call_cut', name: toolName, reason: 'arguments were truncated',
  });
  events.push({ type: 'end', text, finish_reason: 'length', usage: usage(30) });
  return events;
}

// `script` is either an array of turns, consumed in order, or a function
// (opts, turnIndex) => turn, for tests that need to branch on what they were
// sent. Running past the end of an array yields a silent stop.
export function createFakeLlm(script = []) {
  const calls_ = [];
  let index = 0;

  return {
    // Every set of options the orchestrator passed, for asserting on context.
    calls: calls_,
    lastCall() {
      return calls_[calls_.length - 1];
    },
    stream(opts) {
      const turnIndex = calls_.length;
      calls_.push(opts);
      const turn = typeof script === 'function'
        ? script(opts, turnIndex)
        : script[index++] ?? says('');
      return (async function* generate() {
        for (const event of turn) yield event;
      })();
    },
  };
}

// An llm whose stream throws, for the failure path. `partial` is what it
// manages to say first; '' dies before saying anything.
export function createFailingLlm(message = 'upstream exploded', { partial = 'partial' } = {}) {
  return {
    calls: [],
    stream() {
      return (async function* generate() {
        if (partial) yield { type: 'delta', text: partial };
        throw new Error(message);
      })();
    },
  };
}
