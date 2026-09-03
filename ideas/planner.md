# Small asks: a planner, steps, and a standard builder chat

Nothing here is built. Decided 2026-09-03 after four probes against the live
API (`tmp/probe-lib.mjs` and the four `tmp/probe-*.mjs` beside it); the
numbers below are theirs and spec.md §14 carries their tables. *Sizing*,
*builder*, and `Building` as the builder's room were agreed the same day and
are in GLOSSARY.md. "Step" below is a plain word: the glossary already has
*step* for a row of a story scene, so a plan's item still needs its name.

## The problem, as measured

A helper handed a whole request thinks in proportion to the request. §14's
cliff: an ambitious ask at the default effort thinks until the budget is gone
and writes nothing; at `low` it wrote files after 1,597 and 6,886 tokens of
trace, 16–56 s to the first call. Real requests are now tripping the *thinking
cap* at `low` — two minutes of trace, then the studio cuts the stream, throws
the trace away, and asks the **same turn again with thinking off**
(`orchestrator.js`, `thinkingOff`). Three things follow, and all three are
what the kid sees:

- The retry knows nothing the trace had worked out. Measured (probe 4): it
  takes a terse stab — one to four files, 700–2,900 characters, done in 3–8 s
  — where the same retry handed its trace wrote three to eight files and up to
  15,700 characters. The design was there; the retry never saw it.
- The wall of prose the kid reads is **not** explained by the retry: at `none`
  a whole-game ask wrote 97–149 characters of prose before its first call, in
  both runs. Where the wall comes from is still to be found — the candidates
  are the real preamble and a helper description (the probes use §14's
  trimmed preamble and no description), reply text accumulating over a
  24-turn `low` fire (`replyText +=` per turn, all persisted), or the trace
  panel itself streaming for minutes. A real receipt from the production
  studio would say: it holds the last request's prompt and every request's
  reasoning-against-output split.
- The trace is design deliberation and pseudo-code more than finished code
  (5–13% code-shaped lines in the two captured), ending — at 35 K characters,
  85–89 s — on "OK write files now." A reasoning model drafts in the trace and
  then produces the clean copy as the tool call, so what it does write is
  written twice. §14 already found the prompt is not the lever for this. The
  effort setting and the **size of the ask** are.

The cap, the retry and the banners treat the symptom. The cause is one call
asked to do the whole job.

## What the probes found

### 1. Tools and the cache (`probe-tools-cache.mjs`)

Space-racer's tree in the system prompt, ~12.3 K tokens, a transcript growing
one exchange per round, four rounds.

| | hit |
|---|---|
| control: tools every request, rounds 2–4 | 99% |
| no-tools request, first round (fresh prefix) | 0% |
| tools request straight after it, same round | **95%** |
| both, rounds 2–4 | 99–100% |

A no-tools call and a with-tools call **share the cached prefix**: the tools
array is not ahead of the system prompt, and the 455 tokens it costs are all
that misses. So a sizing call without tools warms the fire that follows it.
Also measured, both unmeasured until now: `tool_choice: 'none'` is accepted
and stops the call (and drops the tools from the prompt — same token count as
sending none), and `response_format: {type: 'json_object'}` is accepted and
returned valid JSON at 99% cache. Sending no tools is simpler than
`tool_choice` and equivalent.

### 2. Sizing (`probe-sizing.mjs`)

One call, no tools, thinking off, `max_tokens` 800, JSON asked for in the
last user message (the system prompt stays byte-identical to the fire's).

| ask | answer | wall | out tokens |
|---|---|---|---|
| tank game, empty tree ×5 | big, 7–8 steps ×4; one overran 800 tokens | 3.6–7.1 s | 427–800 |
| "make the ship turn a bit faster", space-racer ×3 | small | 0.8–1.3 s | 5 |
| "add a second player with split screen" ×3 | big, 4–6 steps | 3.6–6.6 s | 246–688 |
| "it doesn't work" ×2 | small | 0.8–1.4 s | 5–93 |
| "do you think the game is fun?" ×2 | small | 0.9–1.2 s | 5 |
| tank, `response_format` json_object ×2 | big, 6–8 steps | 4.7–5.7 s | 445–670 |

Every plan was in a sensible order with sensible files. Two things to fix in
the ask: the step count runs long (7–8 for a tank game; 5–6 would do) and one
plan named `studio/screens.js` as a file to write, because the probe's trimmed
preamble does not say `studio/` is read-only — the real one does. Raise
`max_tokens` to ~1,200 or shorten `what`.

### 3. A step instead of the whole (`probe-step.mjs`)

Same preamble, same tools, same tank game. The last message is one step of a
six-step plan, plan shown, "do only this step, then one line".

| | reasoning tokens | first call | files | prose | wall |
|---|---|---|---|---|---|
| §14: whole game, `low` | 1,597 / 6,886 | 16 s / 56 s | 3 / 3 | — | 24 s / 62 s |
| §14: whole game, default ×9 | fills the budget | never (8 of 9) | 0 | — | 59–131 s |
| step 1 (page + config), `low` ×3 | **0 / 19 / 157** | 1–2 s | 5 | 0 | 11–14 s |
| step 1, `none` ×3 | 0 | 1 s | 5–6 | 44–55 chars | 10–15 s |
| step 2 (input + tank + loop, on step 1's files), `low` ×3 | 264 / 1,571 / 3,651 | 3 / 12 / 32 s | 3–4 | 56–94 chars | 8 / 18 / 37 s |
| step 2, `none` ×3 | 0 | 1 s | 3–4 | 53–108 chars | 8–9 s |

Every run stayed inside its step: step 2 wrote `js/input.js`, `js/tank.js`,
`js/game.js` and patched the script tags into `index.html`, nothing else. The
prose at `none` was the one-line note that was asked for — **no out-loud
planning at step scope**, on either setting. Editing an existing tree thinks
more than creating (step 2 vs step 1), and `low` is the less predictable of
the two: 8–37 s against 8–9 s. Quality was not scored, as in §14.

### 4. Handing the trace on (`probe-trace-handoff.mjs`, `probe-handoff-json.mjs`)

Two traces capped at 35,000 characters (85 s and 89 s, default effort, tools,
the whole tank game — the studio's own cap path). Each then retried three ways
on the same prompt, thinking off.

| retry | run 1 | run 2 |
|---|---|---|
| A today: trace dropped | 4 files, 2,857 chars, 149 prose, 8 s | **1 file, 713 chars**, 97 prose, 3 s |
| B same ask + the trace as "your notes so far" | 3 files, 5,376 chars, 74 prose, 10 s | **8 files, 15,661 chars**, 103 prose, 25 s |
| C planner, notes *before* the JSON ask | prose, not JSON | prose, not JSON |
| C1 planner, JSON ask *after* the notes | big, 5 steps, 3.5 s | big, 5 steps, 5.0 s |
| C2 C1 + `response_format` json_object | big, 5 steps, 4.5 s | big, 5 steps, 5.0 s |
| C3 C2 with only the trace's last 8 K chars | big, 6 steps, 4.4 s | big, 7 steps, 4.8 s |

Both retries act at once (first call at 1 s) — neither re-plans in the open.
The difference is how much of the design survives: today's retry under-
delivers, the handed trace is followed. Every plan in C1–C3 kept the trace's
own file layout (`js/state.js`, `js/levels.js`, `js/sound.js` …), which is
the point of handing it on. The ask must come **after** the notes, or a 35 K
attachment swamps it; `response_format` is a belt on top. The trace costs
~10 K new input tokens once (cache 4–14% on that request).

## The design

Three calls where there was one, each small.

**Sizing.** On a human message in a builder chat (below), one
`complete()` — the microhelper shape in `deepseek.js` — with the fire's own
system prompt, no tools, thinking off, `response_format` json_object as belt
and the prompt's own JSON ask as braces, parsed defensively like the fill.
Two answers: `small`, or `big` with 2–6 steps of `{title, files, what}`.
Costs a second or two and warms the fire's cache.

**Small.** Today's fire, unchanged — the cap still stands behind it.

**Steps.** One fire per step. Its last user turn is a `[studio]`
row: the request, the plan, which step this is, "do only this step, then one
line". That reuses the continuation machinery as it stands — a `system` row
enters the transcript as a user turn and is what gives the next fire something
to answer — so no new loop. Each step is a fresh context from disk, so the
reasoning pile never accumulates and nothing sheds. Each step's reply is one
short message row with its own commit and its own `message_writes`.

**The cap, when it still trips.** Hand the trace to the sizing call as "what a
helper had worked out so far", notes first and the JSON ask after, and let it
become a plan instead of retrying the same ask with thinking off. Measured:
the plan keeps the trace's decisions, in 3.5–5 s. The trace stays unpersisted
and never crosses a fire; §8/§12's "never replayed" relaxes to "handed once,
as text, to the next request of the same fire". In an open room with no
planner, the cheaper half of the same finding applies: the retry should carry
the trace too (probe 4, arm B).

**Thinking levels.** Decided: the planner and every step at `none` — 8–9 s
and a one-line note, measured — and a small ask at the helper's own level,
`low` by default, because no plan thought for it first.

## The builder chat

Today every game has `Humans only` and `Building`, and the *starter helper* —
an admin-picked `agents` row — joins `Building` chatty. What is wanted is a
default that is clean and tight: a standard builder, one request at a time,
formalised, short rows, and **no user-picked helpers in that room**. Open
rooms with chosen helpers stay as they are, made with `Add chat…`.

- **The builder is the studio's, not a row somebody made.** A reserved
  `agents` row (flagged, never listed for editing or deletion, description
  owned by the code the way the preamble is), file tools on, model and
  thinking fixed by the studio. It is a *helper* in the interface like any
  other; it is not a *microhelper*, because it keeps message rows, commits and
  receipts.
- **Its room takes no other helper.** The same door `Humans only` has:
  `assertBotsAllowed` refuses a `chat_agents` row there. A chat column says
  which room is the builder's (`chats.bots` grows a third state, or a
  `builder` flag — implementation detail).
- **One request at a time.** A message that arrives mid-plan waits for the
  running step, then goes through sizing with "steps X–Y of a plan are still
  to do" in the ask, and the planner may return the revised remaining steps.
  Re-plan on interrupt, nothing cleverer.
- **Which room.** Decided: `Building` becomes the builder's room. It is already
  "where a helper can be", the *starter helper* setting becomes moot, and three
  rooms at birth is more furniture. An existing game's `Building` with helpers
  in it is renamed to an ordinary chat and given a fresh `Building`.

## Context per step

Today a fire carries the whole tree (400 KB cap), the brief, the description
and up to 200 KB of transcript. A step needs far less, and the planner has
already named its files:

- **Files.** Whole contents for the step's named files plus `BRIEF.md` and
  `config/`; the tree with sizes for the rest, and `read_file` for anything
  else — the shape the block already takes when the cap binds, with the plan's
  list as a far better pin than a kid's `context_paths`.
- **Transcript.** Not the chat's history: the request that spawned the plan,
  the plan, the one-line notes of the steps done so far, this step. A prompt
  small enough to read whole in the receipt.
- **Cache.** A different file subset per step misses on the file block — but
  every step writes files, so the block would miss anyway, and a block of a
  few files costs little to miss. The preamble still caches.
- **Small asks** keep today's whole-tree context for now. Narrowing them
  needs the sizer to name files even for `small`; cheap, and worth measuring
  after the steps are in.

## What the kid sees

- Small: one short reply and the files it touched, as today.
- Big: one **plan card** — a checklist that ticks as steps land — then one
  short row per step ("Step 2 of 6 · Two tanks that drive · js/input.js,
  js/tank.js, js/game.js"), then a closing line asking them to press play.
- The trace at step scope is 0–150 tokens at `low` and nothing at `none`, so
  the thinking panel all but disappears on its own. Receipts stay.

## Decided 2026-09-03

- Steps and the planner at `none`; a small ask at the helper's own level.
  Quality on real games is unscored and is what to watch first.
- The plan's progress is a `plans` row (steps, done count, status) and the
  plan card — not the game's `TODO.md`. The step probe showed the `[studio]`
  turn alone is enough for the model, so a file would only be a second copy
  for the kid, which the card already is, and studio bookkeeping in a game's
  commits is surface.
- `Building` is the builder's room (above).
- Names: *sizing* and *builder*, in GLOSSARY.md; the room keeps its name.
  *Step* turned out to be taken (a row of a story scene), so the plan's item
  is unnamed — *piece* is the candidate, from the banners' "ask for one piece
  at a time".

## Still open

- Where the wall of text comes from. Not the retry (probe 4). Find one real
  instance in the production studio and read its receipt before assuming.

## Build order (one TODO.md line points here)

1. `complete()` sizing with the fire's system prompt; the JSON shape with
   `response_format` json_object as the belt (and deepseek.js's comment saying
   it was never measured comes out); tests against the fake LLM.
2. The builder row and its room; `assertBotsAllowed` for it; migration.
3. Steps as continuations with the `[studio]` step turn; per-step message
   rows and commits; the plan row; interrupt = re-plan.
4. The plan card in the client.
5. Per-step context narrowing.
6. The cap hands its trace to the planner.
7. spec.md §8 and the GLOSSARY entries losing their "Planned"; `npm test`
   green at every step. §14 already carries the measurements.
