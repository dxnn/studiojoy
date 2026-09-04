## 14. DeepSeek API — verified behaviour

Measured against the live API on 2026-08-12, not assumed. Every finding below
replaced a guess, and three of the original five guesses were wrong.

### Models

`GET /v1/models` returns exactly two: **`deepseek-v4-flash`** and
**`deepseek-v4-pro`**. A bad model id is rejected with a message naming those
two, so they are the canonical set.

The familiar `deepseek-chat` and `deepseek-reasoner` names still resolve, but
they are undocumented compatibility aliases, both served by
`deepseek-v4-flash`. They differ only in reasoning: `deepseek-chat` returns no
trace, `deepseek-reasoner` does. This app uses the canonical ids and controls
reasoning explicitly instead.

### Reasoning

Reasoning is **on by default** on both canonical models.
`reasoning_effort: 'none'` turns it off; `thinking: {type: 'disabled'}` also
works. Unrecognised parameters are silently ignored rather than rejected
(`enable_thinking: false` had no effect), so parameter support cannot be
probed by looking for an error.

The intermediate effort levels did not behave monotonically on a trivial
prompt — `'minimal'` and `'low'` both produced *more* trace than the default.
That reading is what kept this app on a per-agent boolean for as long as it
was; the tool measurements below overturned it, and the setting is now a
three-way **thinking level** (`full`, `low`, `none`).

In streaming, `delta.reasoning_content` arrives interleaved and ahead of
`delta.content`. `completion_tokens_details.reasoning_tokens` reports the cost.

Re-measured on a *heavy* prompt on 2026-08-31 (`tmp/probe-keepalive.mjs`,
`tmp/probe-thinking.mjs`), because the trivial-prompt numbers above turned out
to describe noise rather than the case that matters:

- **The stream carries no comment frames.** Zero non-`data:` lines in a
  45-second, 1.3 MB stream, and the longest gap between reads was 439 ms. The
  idle guard below therefore cannot be held open by a keep-alive, and a
  two-minute silence really is a dead stream. This was a guess until now.
- **Reasoning streams at ~90 tokens/s, ~320 bytes of SSE per token.** At the
  65,536 ceiling that is **~12 minutes and ~20 MB** for one turn's trace, all
  of which the studio re-broadcasts to every connected tab, one frame per
  delta (§9).
- **The whole allowance can go to the trace.** 4096 of 4096 completion tokens
  were reasoning, no content, no tool call, `finish_reason: 'length'`. So a
  helper that "thought too long and did nothing" has not timed out and has not
  faulted: it reached the output ceiling while still thinking. The
  `hitLength && changed.length === 0` banner (§8) is the only thing that says
  so.
- **Still no ladder in the middle.** With no tools in play: baseline 1316
  reasoning tokens, `'minimal'` 692, `'low'` 482, `'medium'` 3643, `'high'`
  675 — one sample each, and the spread between neighbours is larger than any
  trend. But that is not the same question as whether the *ends* matter; see
  the tool measurements below, where they matter more than anything else on
  this page. `'none'` is a real zero.
- **A reasoning budget parameter remains unmeasured**, not disproven.
  `thinking: {budget_tokens}`, `max_reasoning_tokens` and
  `reasoning_max_tokens` each produced a trace within run-to-run variance of
  the baseline at n=1, and unknown parameters are ignored silently, so nothing
  can be concluded either way from that.

### ⚠️ Thinking against tools: the cliff

The measurement this studio most needed and did not have. The studio's own
preamble, its file tools, and one ambitious open request — *"Build me a tank
game. Two players, split screen, destructible walls, power-ups."* — against
`deepseek-v4-flash` (`tmp/probe-do-more.mjs`, `tmp/probe-tools-effort.mjs`,
2026-08-31):

| effort | `max_tokens` | runs | reasoning / output | tool calls | first call at | wall |
| --- | --- | --- | --- | --- | --- | --- |
| default | 8192 | 4 of 4 | 8192 / 8192 | **0** | never | 59–91 s |
| default | 16384 | 4 of 5 | 16384 / 16384 | **0** | never | 114–131 s |
| default | 16384 | 1 of 5 | 13679 / 16321 | 6 | 67 s | 82 s |
| `'low'` | 8192 | 1 of 2 | 6886 / 8192 | 3 | 56 s | 62 s |
| `'low'` | 8192 | 1 of 2 | 1597 / 3185 | 3 | 16 s | 24 s |
| `'none'` | 8192 | 1 of 1 | 0 / 803 | 2 | 1 s | 7 s |

Two findings, and the first one is the important one:

**⚠️ At the default effort the trace expands to fill whatever it is given, and
produces nothing when it does.** Nine runs at the default: 8192 became 8192 of
reasoning, 16384 became 16384, and **one run in nine** stopped thinking (at
13679) and wrote its six files. The appetite is not a fixed size the budget
either covers or does not — raising `max_tokens` mostly buys a longer silence,
which is why the studio's 65536 is no protection and is the setting this
failure happened under. There is no partial credit either: a run that does not
finish thinking writes no file, says no word and calls no tool, so the failure
is a cliff rather than a slope. From the outside it cannot be told from a hang
— at the 90–125 tokens/s measured here, a full 65536 of thinking is **nine to
twelve silent minutes** ending in an empty reply. That is what "the helper
thought too long and did nothing" is, and no timeout is involved.

**`reasoning_effort` is the lever, and the trivial-prompt measurement above
hid it.** At the same 8192 where the default wrote nothing, `'low'` wrote three
files on both runs, and `'none'` wrote two in seven seconds for 803 output
tokens. Between default and `'low'` the difference is not a rung on a ladder;
it is files against nothing. The run-to-run spread inside `'low'` is still
wide (6886 and 1597), so it bounds the thinking loosely, not tightly.

**The prompt is not the lever.** A rule added to the preamble telling it to
write its plan into `TODO.md` rather than hold it — that its thinking is
discarded and re-billed while a file is kept and cached, and that a turn
producing no file produced nothing — changed nothing at either budget: four
runs, zero tool calls, same as the preamble without it. The self-note strategy
it was pointing at already exists (`TODO.md` is in the preamble, and a
continuation rebuilds context from disk), and it is not what is missing. The
model does not decline to write its plan down; it never reaches the point of
writing anything at all.

A caveat kept deliberately: these arms were scored on whether tool calls came
out, not on whether the game was any good. `'none'` wrote the fewest bytes of
the three that acted, and how much prose each wrote was not measured. `'low'`
has two runs behind it and `'none'` one, against nine at the default — enough
to show the direction, not enough to size it.

### ⚠️ The size of the ask is the lever

Measured 2026-09-03 (`tmp/probe-sizing.mjs`, `tmp/probe-step.mjs`,
`tmp/probe-trace-handoff.mjs`, `tmp/probe-handoff-json.mjs`; outputs beside
them) with the same preamble, tools and request as the cliff table above, so
the rows compare. The design they led to is ideas/planner.md.

**One small call plans the whole.** No tools, `reasoning_effort: 'none'`,
`max_tokens` 800, JSON asked for in the last user message so the system
prompt stays byte-identical to the fire's:

| ask | answer | wall | out tokens |
| --- | --- | --- | --- |
| the tank game, empty tree ×5 | big, 7–8 steps (one overran 800 tokens) | 3.6–7.1 s | 427–800 |
| "make the ship turn a bit faster", space-racer's tree ×3 | small | 0.8–1.3 s | 5 |
| "add a second player with split screen" ×3 | big, 4–6 steps | 3.6–6.6 s | 246–688 |
| "it doesn't work" ×2, "do you think the game is fun?" ×2 | small | 0.8–1.4 s | 5–93 |

Every plan was in a sensible order with sensible files. `response_format:
{type: 'json_object'}` is **accepted** and returned valid JSON (two runs, and
a JSON one-liner at 99% cache) — the parameter §6's fill treated as
unmeasured. The prompt's own ask stays as the braces.

**A step thinks in proportion to the step.** The same request as one step of
a six-step plan, plan shown, "do only this step, then one line":

| ask | effort | reasoning tokens | first call at | files | prose | wall |
| --- | --- | --- | --- | --- | --- | --- |
| the whole game (above) | `'low'` | 1,597 / 6,886 | 16 s / 56 s | 3 / 3 | — | 24 s / 62 s |
| step 1, page + config, empty tree ×3 | `'low'` | 0 / 19 / 157 | 1–2 s | 5 | 0 | 11–14 s |
| step 1 ×3 | `'none'` | 0 | 1 s | 5–6 | 44–55 chars | 10–15 s |
| step 2, input + tank + loop, on step 1's files ×3 | `'low'` | 264 / 1,571 / 3,651 | 3 / 12 / 32 s | 3–4 | 56–94 chars | 8 / 18 / 37 s |
| step 2 ×3 | `'none'` | 0 | 1 s | 3–4 | 53–108 chars | 8–9 s |

Every run stayed inside its step, and the prose at `'none'` was the one-line
note asked for: no planning in the open at step scope, on either setting.
Editing thinks more than creating, and `'none'` is the predictable one.
Quality unscored, as above.

**A capped trace is worth handing on.** Two traces cut at 35,000 characters
(85 s and 89 s at the default effort — the studio's own cap path), each
retried on the same prompt with thinking off:

| retry | run 1 | run 2 |
| --- | --- | --- |
| trace dropped (what §8's cap does today) | 4 files, 2,857 chars, 149 prose, 8 s | 1 file, 713 chars, 97 prose, 3 s |
| the trace in the message as "your notes so far" | 3 files, 5,376 chars, 74 prose, 10 s | 8 files, 15,661 chars, 103 prose, 25 s |
| the planner, notes *before* the JSON ask | prose, not JSON | prose, not JSON |
| the planner, JSON ask *after* the notes | big, 5 steps, 3.5 s | big, 5 steps, 5.0 s |

Both retries act at once — the guess that the dropped-trace retry re-plans in
the open was wrong — but it under-delivers where the handed one is followed.
A 35 K attachment swamps an ask placed ahead of it; the ask goes after. The
two traces were design deliberation and pseudo-code more than code (5–13%
code-shaped lines), both ending at the cap on "OK write files now."

### Tools

**Both** models support function calling — the original guess that
`deepseek-reasoner` could not was wrong, which removes the per-model
capability gate the earlier draft specified. Parallel tool calls in one
assistant turn work: a two-file request produced two `write_file` calls.

Streaming tool calls arrive as `delta.tool_calls[]` fragments keyed by
`index`, with `id` and `function.name` on the first fragment and
`function.arguments` accumulating across the rest. Reassembling by index and
parsing at the end works. The `role: 'tool'` + `tool_call_id` result round trip
works, and an assistant message with `content: null` alongside `tool_calls` is
accepted.

Truncation mid-tool-call is cleaner than Anthropic's: the non-streaming
response omits `tool_calls` entirely rather than returning partial JSON. The
streaming path still needs the unparseable-buffer guard, because fragments are
delivered before the cut.

`tool_choice: 'none'` is **accepted** (2026-09-03, `tmp/probe-tools-cache.mjs`):
the model answers in prose with no call, and the prompt shrinks by the tools'
455 tokens — the same as sending no tools, which is simpler and what the
sizing call does.

### Limits

- **Context: 1,048,576 tokens.** A 160 K-token prompt was accepted without
  complaint; overshooting produced `This model's maximum context length is
  1048576 tokens`. The earlier 64 K assumption was wrong by 16×, and §8's
  context strategy was rewritten because of it.
- **Output: 65,536 tokens**, and that is also the default when `max_tokens` is
  omitted — a request with no `max_tokens` ran to exactly 65536 and stopped
  with `finish_reason: 'length'`. Oversized `max_tokens` values are clamped
  silently rather than rejected, so the parameter cannot be used to discover
  the ceiling.
- **`max_tokens` bounds the reasoning trace and the reply together**, because
  `completion_tokens` includes `completion_tokens_details.reasoning_tokens`.
  Measured on "make me a tank game" (`deepseek-v4-flash`, reasoning on):
  25,004 of 32,768 tokens went to reasoning, leaving ~7.7 K for tool call
  arguments — the fifth `write_file` was cut off mid-arguments. The same
  prompt at 65,536 spent 38,590 on reasoning and emitted all eight
  `write_file` calls intact, the largest carrying 17,710 characters of
  content. Reasoning cost scales with the prompt's ambition, so it cannot be
  budgeted around; the ceiling is the only safe setting. This is why §8 sets
  `max_tokens` to 65536 rather than to a lower cost guard.
- `finish_reason: 'length'` fires reliably on truncation.

### Images

**Not supported.** Both content-part shapes are rejected before the model is
reached: `{type: 'image_url', image_url: {url}}` returns 400 `unknown variant
'image_url', expected 'text'`, and the Anthropic-style `{type: 'image',
source: {...}}` returns 400 `unknown variant 'image'`. The deserializer
accepts only `text`, so this is not a model capability gate that a different
model id would lift.

The consequence is architectural: an agent cannot be shown what its game looks
like. Screenshots are not merely awkward to produce without a headless browser
— they could not be sent even if we had them. Anything an agent learns about
its running game has to arrive as text, which is what the runtime error feed
is for (§8).

### Usage and caching

```json
{ "prompt_tokens": 4018, "completion_tokens": 1, "total_tokens": 4019,
  "prompt_tokens_details": { "cached_tokens": 3968 },
  "completion_tokens_details": { "reasoning_tokens": 16 },
  "prompt_cache_hit_tokens": 3968, "prompt_cache_miss_tokens": 50 }
```

Caching is automatic on a repeated prefix — a second identical 4018-token
prompt reported 3968 cached. `prompt_tokens` is the **total**, hits plus
misses, which is why §8's budget formula uses the split rather than
`prompt_tokens`.

Partial prefixes are served only back to a **branch point**: a depth at which
an earlier request already diverged. A request that diverges at a *new* depth
reports zero hits however long its shared prefix is — and that miss is what
creates the branch the requests after it hit on. Measured in
`tmp/probe-order.mjs` (2026-08-23): the first edit of a file deep in a
10 K-token system prompt scored 0%, the second 42%, the third and fourth 94%,
in 64-token blocks; a pure extension of a previous request (history appended,
nothing changed) always scored ~100%. Spacing the requests 20 s apart measured
identically to back-to-back, so this is structure, not write latency. §8's
file-block ordering exists because of this: the win is not the first fire
after an edit, it is every fire after that one, provided the divergence depth
holds still.

**The tools array does not sit ahead of the system prompt.** Measured
2026-09-03 (`tmp/probe-tools-cache.mjs`): space-racer's tree in the system
prompt, ~12.3 K tokens, a transcript growing one exchange a round. A request
with no tools and the with-tools request straight after it, same round, hit
95% on the first round and 99–100% every round after, against 99% for the
tools-every-time control; the array costs 455 prompt tokens and those are all
that misses. So a no-tools call — the sizing call — warms the fire that
follows it. (The branch-point rule above would have predicted 0% for that
first with-tools request, which diverges from the no-tools one at a depth
nothing had diverged at before; it did not. Whether the rule is really about
divergence *inside* a block, or the cache has changed since 2026-08-23, is
unresolved — one arm, one run.)

Within one tool-call chain, the model's own output — the **reasoning trace
included** — is re-attached server-side to the next request's prompt and
billed as input, even though the client never sends it back: a continuation's
prompt grows by the previous request's `completion_tokens`, not by the bytes
the client appended (measured in `tmp/probe-reasoning-replay.mjs`,
2026-08-28, and visible in any multi-request receipt). It **accumulates** —
every earlier round's trace stays in the prompt until the chain closes — and
rides the prefix cache at a tenth, so a long fire pays a tenth of an
ever-growing pile on every request: roughly quadratic in the round count. A
`role: 'user'` message **closes the chain and sheds the whole pile** from
billing (measured: the prompt shrank by the accumulated trace), at the price
of the branch point moving — the loop's tail re-pays once. §8's invariant
that a trace is never replayed is about the client and still holds: nothing
stores or sends one; this is the API's own accounting.

### Errors

`{"error": {"message", "type", "param", "code"}}`, with 400 for an invalid
model and 401 for a bad key. Straightforward to surface.

### Dev-environment note

This sandbox reaches the network only through a CONNECT proxy at
`localhost:63983`; DNS does not resolve directly. `curl` picks the proxy up
from `$https_proxy` automatically, but Node's `fetch` ignores those variables
unless started with **`node --use-env-proxy`**. That flag is a local
development detail only — the deployed server talks to DeepSeek directly, and
the test suite never touches the network.
