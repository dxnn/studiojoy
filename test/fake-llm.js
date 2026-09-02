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

// One whole answer, for llm.complete — the studio's own small asks, which
// stream nothing. `text` is what the model said; the caller does its own
// parsing, so a test can hand it a fence, a sentence first, or junk.
export function answers(text, { tokens = 40, prompt = 200 } = {}) {
  return { text, finish_reason: 'stop', usage: usage(tokens, prompt) };
}

// `script` is either an array of turns, consumed in order, or a function
// (opts, turnIndex) => turn, for tests that need to branch on what they were
// sent. Running past the end of an array yields a silent stop.
//
// `completions` is the same idea for complete(): an array consumed in order,
// or a function (opts, index) => answer. An entry that is an Error is thrown,
// which is how the upstream-failure path is driven. Running past the end
// answers with empty text, which every caller of complete() treats as
// nothing usable.
export function createFakeLlm(script = [], completions = []) {
  const calls_ = [];
  const asked_ = [];
  let index = 0;
  let completion = 0;

  return {
    // Every set of options the orchestrator passed, for asserting on context.
    calls: calls_,
    // Every set of options complete() was passed, likewise.
    asked: asked_,
    lastCall() {
      return calls_[calls_.length - 1];
    },
    lastAsked() {
      return asked_[asked_.length - 1];
    },
    async complete(opts) {
      const at = asked_.length;
      asked_.push(opts);
      const answer = typeof completions === 'function'
        ? completions(opts, at)
        : completions[completion++] ?? answers('');
      if (answer instanceof Error) throw answer;
      return answer;
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

// A turn that spent its whole output allowance on the reasoning trace and
// never reached a word or a tool call. Not an exotic case: whenever the
// allowance is below the thinking a request provokes, this is what comes back
// — all of it or none of it, no partial credit (spec.md §14).
export function thinksOnly({ tokens = 8192 } = {}) {
  return [
    { type: 'reasoning', text: 'let me consider the architecture. '.repeat(8) },
    { type: 'end', text: '', finish_reason: 'length', usage: usage(tokens, 100, tokens) },
  ];
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
