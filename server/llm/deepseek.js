// DeepSeek client. Every shape here was verified against the live API
// (spec.md §14) rather than assumed.
//
// Yields a simplified event stream the orchestrator consumes:
//   {type:'reasoning', text}       reasoning trace, never persisted
//   {type:'delta', text}           reply text
//   {type:'tool_use', id, name, input}
//   {type:'tool_use_failed', id, name, reason}
//   {type:'end', text, finish_reason, usage}

export const MODEL_IDS = ['deepseek-v4-flash', 'deepseek-v4-pro'];

// The model's ceiling is 65536, and omitting max_tokens uses all of it.
//
// This is the whole ceiling, not a cost guard set below it, because
// completion_tokens counts the reasoning trace as well as the reply and the
// tool call arguments. Measured on "make me a tank game" against
// deepseek-v4-flash: 25,004 of 32,768 tokens went to reasoning, the fifth
// write_file was cut off mid-arguments, and the game was committed with a
// missing file. The same prompt at 65,536 spent 38,590 on reasoning and
// finished all eight files cleanly. A lower cap mostly rations thinking and
// leaves the files whatever is left over (spec.md §8, §14).
export const MAX_OUTPUT_TOKENS = 65536;
export const DEFAULT_MAX_TOKENS = MAX_OUTPUT_TOKENS;

export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

export class LlmError extends Error {
  constructor(message, { status = null, type = null, code = null } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

// Sum the tokens a turn actually cost. prompt_tokens is the total of hits and
// misses, so adding it to the hit count would charge cached tokens twice —
// the split is the correct input. Cache hits are billed at roughly a tenth,
// which is mirrored here. completion_tokens already includes reasoning
// tokens: the trace is discarded but it was still billed.
export function tokensCharged(usage) {
  if (!usage) return 0;
  const miss = usage.prompt_cache_miss_tokens
    ?? usage.prompt_tokens
    ?? 0;
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const out = usage.completion_tokens ?? 0;
  return miss + Math.ceil(hit / 10) + out;
}

async function readError(res) {
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // Non-JSON error body; the status is all we have.
  }
  const err = payload?.error ?? {};
  return new LlmError(
    err.message || `deepseek returned ${res.status}`,
    { status: res.status, type: err.type ?? null, code: err.code ?? null },
  );
}

// idleMs is an idle guard, not a deadline: the abort timer is re-armed every
// time bytes arrive, so it fires only when the stream has stalled. It used to
// be a hard 10-minute ceiling on the whole request, which killed healthy long
// turns — a big reasoning trace plus several files streams for longer than
// that — and it aborted them mid-flight with everything unsaved. Between
// chunks the gap is sub-second; the long silence is prompt processing before
// the first token, seconds even on a full cache miss, so two minutes is
// generous for a stall and never binds on a working stream.
export function createDeepSeek({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  idleMs = 2 * 60 * 1000,
}) {
  if (!apiKey) throw new Error('createDeepSeek requires an apiKey');

  return {
    async *stream({
      model = MODEL_IDS[0],
      system = null,
      messages,
      tools = null,
      reasoning = true,
      maxTokens = DEFAULT_MAX_TOKENS,
    }) {
      const body = {
        model,
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
        stream: true,
        // Without this the final chunk carries no usage and the budget can't
        // be charged.
        stream_options: { include_usage: true },
        max_tokens: Math.min(maxTokens, MAX_OUTPUT_TOKENS),
      };
      if (tools && tools.length > 0) body.tools = tools;
      // Reasoning is on by default on both canonical models; this is the
      // switch that turns it off. Unknown parameters are silently ignored by
      // the API, so a typo here would fail open rather than error.
      if (!reasoning) body.reasoning_effort = 'none';

      const controller = new AbortController();
      let timer = null;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), idleMs);
        timer.unref?.();
      };
      // The first arming also covers connecting and waiting for headers.
      arm();

      let res;
      try {
        res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        throw new LlmError(`deepseek request failed: ${err.message}`);
      }

      if (!res.ok) {
        clearTimeout(timer);
        throw await readError(res);
      }
      if (!res.body) {
        clearTimeout(timer);
        throw new LlmError('deepseek returned no body');
      }

      // Tool call fragments arrive keyed by index: id and name on the first,
      // arguments accumulating across the rest.
      const partialTools = new Map();
      let text = '';
      let finishReason = null;
      let usage = null;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;

      try {
        while (!finished) {
          const { done, value } = await reader.read();
          arm();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          for (;;) {
            const newline = buffer.indexOf('\n');
            if (newline === -1) break;
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith('data:')) continue;

            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              finished = true;
              break;
            }
            let chunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              // A frame we can't parse is skipped rather than fatal; the
              // stream may still complete usefully.
              continue;
            }

            if (chunk.usage) usage = chunk.usage;
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta ?? {};
            if (delta.reasoning_content) {
              yield { type: 'reasoning', text: delta.reasoning_content };
            }
            if (delta.content) {
              text += delta.content;
              yield { type: 'delta', text: delta.content };
            }
            for (const call of delta.tool_calls ?? []) {
              const index = call.index ?? 0;
              const current = partialTools.get(index)
                ?? { id: '', name: '', args: '' };
              if (call.id) current.id = call.id;
              if (call.function?.name) current.name = call.function.name;
              if (call.function?.arguments) current.args += call.function.arguments;
              partialTools.set(index, current);
            }
          }
        }
      } catch (err) {
        // The guard firing surfaces as a bare AbortError from reader.read();
        // name what actually happened.
        if (controller.signal.aborted) {
          throw new LlmError(`deepseek stream stalled: nothing arrived for ${idleMs / 1000}s`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
        reader.cancel().catch(() => {});
      }

      // Arguments are only complete once the stream is, so tool calls are
      // emitted here rather than mid-flight. Truncation mid-call leaves
      // unparseable JSON — the non-streaming API drops the call entirely, but
      // streaming has already delivered fragments, so that case needs a
      // distinct event the orchestrator can report.
      for (const [index, call] of [...partialTools.entries()].sort((a, b) => a[0] - b[0])) {
        let input;
        try {
          input = call.args ? JSON.parse(call.args) : {};
        } catch {
          yield {
            type: 'tool_use_failed',
            id: call.id || `call_${index}`,
            name: call.name,
            reason: 'arguments were truncated',
          };
          continue;
        }
        yield {
          type: 'tool_use', id: call.id || `call_${index}`, name: call.name, input,
        };
      }

      yield { type: 'end', text, finish_reason: finishReason, usage };
    },
  };
}
