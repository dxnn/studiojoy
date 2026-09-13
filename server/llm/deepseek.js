// DeepSeek client. Every shape here was verified against the live API
// (spec.md §14) rather than assumed.
//
// Yields a simplified event stream the orchestrator consumes:
//   {type:'reasoning', text}       reasoning trace, never persisted
//   {type:'delta', text}           reply text
//   {type:'tool_start', index, name, path}          a call as it begins to arrive
//   {type:'tool_progress', index, name, path, bytes} how much of it has, so far
//   {type:'tool_use', id, name, input}
//   {type:'tool_use_failed', id, name, reason}
//   {type:'end', text, finish_reason, usage}

// One model, and no choice anywhere above this line. `GET /v1/models` offers
// `deepseek-v4-pro` as well, at 4.4× the price of a missed token and with no
// eyes — it drops a picture and answers anyway (spec/ §14) — so the studio
// does not send it anything. `deepseek-v4-flash` still resolves as a
// compatibility alias for this same model and is deliberately not used: the
// alias has no published end date.
export const MODEL = 'deepseek-flash';

// How hard a helper thinks before it answers, worst to best for getting work
// done. Three rather than the old on/off because the middle one is where the
// measurement landed: with tools in front of it and an ambitious request, the
// default effort produced no file at all in eight of nine runs, while 'low'
// wrote files on both of its (spec.md §14).
//   full — no reasoning_effort sent, which is the API's own default
//   low  — reasoning_effort: 'low'
//   none — reasoning_effort: 'none', no trace at all
//
// ⚠️ Re-measured on V4.1, 2026-09-13 (spec/ §14). The three still rank in this
// order and 'low' is still the right default, but not for the reasons above:
// the default writes nothing in one run of *two* now rather than one of nine;
// 'low' thinks 8–105 tokens on a first turn rather than 1,597–6,886; and
// DeepSeek's own middle rungs — minimal, medium, high, max — are
// indistinguishable from each other and from 'low', each able to run away too.
// What 'low' still buys is the rest of a fire: 500–2,100 tokens a turn while
// building a whole game across eight turns.
export const THINKING_LEVELS = ['full', 'low', 'none'];
export const DEFAULT_THINKING = 'low';

// Characters of reasoning_content per token, near enough to turn a trace we
// watched go past into the tokens it cost. Only an estimate: reasoning_tokens
// is reported at the end of a stream, and a capped turn has no end.
export const CHARS_PER_TOKEN = 3.5;
export const tokensForChars = (chars) => Math.ceil(
  Math.max(0, Number(chars) || 0) / CHARS_PER_TOKEN,
);

// ⚠️ A ceiling on one turn's trace, counted in characters of
// reasoning_content, because reasoning_tokens is only reported when the
// stream ends — by which time the whole allowance is already spent. At
// CHARS_PER_TOKEN this is near 10 K tokens, about 90 seconds at the 90–125
// tokens/s measured in §14, and still well above the traces 'low' actually
// produces there (1,597 and 6,886 tokens): it is a backstop against the
// nine-minute silence, not a working limit, and what it mostly catches is a
// helper left on 'full'. It applies only until the turn produces something
// else, since a trace interleaved with real output is a turn that is working.
//
// ⚠️ V4.1 moved both numbers under it (spec/ §8, §14). Reasoning streams at
// ~233 tokens/s, so 35,000 characters is ~43 seconds, not ~90, and the
// allowance it guards is ~4.7 silent minutes, not nine. The number itself
// stays: a first turn thinks 8–105 tokens at every setting, but the largest
// *healthy* trace measured is 4,263 (~14,900 characters), on a vague ask —
// so the 12,000 briefly proposed on 2026-09-13 would have cut the one trace
// that did any good. The biggest traces come from the vaguest asks, not the
// biggest ones.
export const THINKING_CAP_CHARS = 35_000;

// The model's ceiling is 65536, and omitting max_tokens uses all of it.
//
// This is the whole ceiling, not a cost guard set below it, because
// completion_tokens counts the reasoning trace as well as the reply and the
// tool call arguments. Measured on "make me a tank game" against
// the retired deepseek-v4-flash: 25,004 of 32,768 went to reasoning, the fifth
// write_file was cut off mid-arguments, and the game was committed with a
// missing file. The same prompt at 65,536 spent 38,590 on reasoning and
// finished all eight files cleanly. A lower cap mostly rations thinking and
// leaves the files whatever is left over (spec.md §8, §14).
export const MAX_OUTPUT_TOKENS = 65536;
export const DEFAULT_MAX_TOKENS = MAX_OUTPUT_TOKENS;

export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

// A tool call while it is still arriving, for the line under a helper's name
// (spec.md §9). Arguments stream as fragments and are only whole at the end,
// which is when the call itself is yielded — but a file takes as long to
// arrive as it takes the model to write it, and that was the longest silence
// in a fire. So: `tool_start` once the call's name and path can be read, and
// `tool_progress` every PROGRESS_STEP characters after, saying how much has
// come. `path` is the first key in every tool's arguments (agents/tools.js),
// so it is readable within the first fragment or two; a call that has run
// PROGRESS_STEP characters without one is announced with the path unknown
// rather than kept back.
const PATH_IN_ARGS = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/;
// At the ~360 characters a second measured in §14, one event a second or two.
export const PROGRESS_STEP = 512;

function pathIn(args) {
  const found = PATH_IN_ARGS.exec(args);
  if (!found) return null;
  try {
    return JSON.parse(`"${found[1]}"`);
  } catch {
    return found[1];
  }
}

function toolProgress(current, index) {
  if (!current.name) return null;
  if (!current.announced) {
    const path = pathIn(current.args);
    if (path === null && current.args.length < PROGRESS_STEP) return null;
    current.announced = true;
    current.path = path;
    return { type: 'tool_start', index, name: current.name, path };
  }
  const step = Math.floor(current.args.length / PROGRESS_STEP);
  if (step <= current.reported) return null;
  current.reported = step;
  // Announced without one: the path may be readable by now.
  if (current.path === null) current.path = pathIn(current.args);
  return {
    type: 'tool_progress', index, name: current.name, path: current.path,
    bytes: Buffer.byteLength(current.args, 'utf8'),
  };
}

export class LlmError extends Error {
  constructor(message, {
    status = null, type = null, code = null, reasoningChars = 0,
  } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.type = type;
    this.code = code;
    // Only the thinking cap sets this: the trace a turn ran up before it was
    // abandoned, so the caller can charge for what was generated.
    this.reasoningChars = reasoningChars;
  }
}

// The price list's weights, read 2026-09-10 (spec.md §14): on this model a
// cache hit is a fiftieth of a miss and output is four times a miss, in the
// peak and the off-peak window alike. Output includes the reasoning trace,
// which is what makes thinking the dearest thing a turn does — and V4.1 made
// it dearer still relative to input, where the old model's output was three.
export const HIT_DIVISOR = 50;
export const OUTPUT_WEIGHT = 4;

// Sum the tokens a turn actually cost, in miss-priced tokens. prompt_tokens is
// the total of hits and misses, so adding it to the hit count would charge
// cached tokens twice — the split is the correct input. completion_tokens
// already includes reasoning tokens: the trace is discarded but it was still
// billed.
export function tokensCharged(usage) {
  if (!usage) return 0;
  const miss = usage.prompt_cache_miss_tokens
    ?? usage.prompt_tokens
    ?? 0;
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const out = usage.completion_tokens ?? 0;
  return miss + Math.ceil(hit / HIT_DIVISOR) + out * OUTPUT_WEIGHT;
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

  // A whole request with a whole answer, for the studio's own small asks —
  // the fill and the stand-in maker (spec.md §6). No tools, no trace, no
  // events: they have nothing to show while they wait and nothing to do with
  // half an answer, so the streaming machinery above would be all cost.
  // Same key, same errors, same idle guard, and the usage is charged the way
  // a fire's is.
  //
  // JSON is asked for in the prompt and parsed by the caller either way.
  // `responseFormat: 'json_object'` is a belt on top: measured 2026-09-03
  // (§14), the API accepts `response_format` and answered valid JSON — but
  // an unknown parameter is ignored silently, so a caller that relied on it
  // alone would fail open the day it stopped being one. Parse defensively.
  async function complete({
    system = null,
    messages,
    thinking = 'none',
    maxTokens = 1024,
    responseFormat = null,
  }) {
    const body = {
      model: MODEL,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      stream: false,
      max_tokens: Math.min(maxTokens, MAX_OUTPUT_TOKENS),
    };
    if (thinking !== 'full') body.reasoning_effort = thinking;
    if (responseFormat) body.response_format = { type: responseFormat };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), idleMs);
    timer.unref?.();

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
      if (controller.signal.aborted) {
        throw new LlmError(`deepseek did not answer within ${idleMs / 1000}s`);
      }
      throw new LlmError(`deepseek request failed: ${err.message}`);
    }

    try {
      if (!res.ok) throw await readError(res);
      const payload = await res.json().catch(() => null);
      if (!payload) throw new LlmError('deepseek returned no answer');
      const choice = payload.choices?.[0];
      return {
        text: choice?.message?.content ?? '',
        finish_reason: choice?.finish_reason ?? null,
        usage: payload.usage ?? null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    complete,

    async *stream({
      system = null,
      messages,
      tools = null,
      thinking = DEFAULT_THINKING,
      thinkingCap = THINKING_CAP_CHARS,
      maxTokens = DEFAULT_MAX_TOKENS,
    }) {
      const body = {
        model: MODEL,
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
        stream: true,
        // Without this the final chunk carries no usage and the budget can't
        // be charged.
        stream_options: { include_usage: true },
        max_tokens: Math.min(maxTokens, MAX_OUTPUT_TOKENS),
      };
      if (tools && tools.length > 0) body.tools = tools;
      // Reasoning is on by default, so 'full' sends
      // nothing at all and the other two name themselves. Unknown parameters
      // are silently ignored by the API, so a typo here would fail open
      // rather than error.
      if (thinking !== 'full') body.reasoning_effort = thinking;

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
      // The two halves of the thinking cap: how much trace has arrived, and
      // whether this turn has produced anything but trace.
      let reasoningChars = 0;
      let produced = false;

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
              reasoningChars += delta.reasoning_content.length;
              yield { type: 'reasoning', text: delta.reasoning_content };
              // ⚠️ Thrown rather than aborted through the controller, so the
              // catch below can tell this from the idle guard firing. The
              // finally cancels the reader, which is what closes the request
              // and stops the model. No usage frame ever arrives, so the
              // trace we watched go past is carried out on the error and the
              // caller charges an estimate of it — the tokens were generated
              // and the key is paying for them whatever this stream saw.
              if (thinkingCap && !produced && reasoningChars > thinkingCap) {
                throw new LlmError(
                  `deepseek thought past ${thinkingCap} characters without producing anything`,
                  { code: 'thinking_cap', reasoningChars },
                );
              }
            }
            if (delta.content) {
              text += delta.content;
              produced = true;
              yield { type: 'delta', text: delta.content };
            }
            if (delta.tool_calls?.length) produced = true;
            for (const call of delta.tool_calls ?? []) {
              const index = call.index ?? 0;
              const current = partialTools.get(index)
                ?? { id: '', name: '', args: '', announced: false, path: null, reported: 0 };
              if (call.id) current.id = call.id;
              if (call.function?.name) current.name = call.function.name;
              if (call.function?.arguments) current.args += call.function.arguments;
              partialTools.set(index, current);
              const arriving = toolProgress(current, index);
              if (arriving) yield arriving;
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
