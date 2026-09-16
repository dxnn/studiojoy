## 14. DeepSeek API — verified behaviour

Measured against the live API on 2026-08-12, not assumed. Every finding below
replaced a guess, and three of the original five guesses were wrong.

⚠️ **Everything below dated before 2026-09-10 was measured on
`deepseek-v4-flash`, which DeepSeek retired that day.** The studio ran on V4.1
for two days before anybody noticed, because the old name still answers.

Re-taken on V4.1 on 2026-09-13, both with the preamble, tools and request the
old tables used, so the rows compare: **the cliff** (`probes/probe-v41-cliff.mjs`,
`probes/probe-v41-ladder.mjs`, `probes/probe-v41-loop.mjs`) and **the 6 K prefix
rule** (`probes/probe-v41-prefix.mjs`, run twice). One changed shape and the
other went away; both sections say so where they sit.

Re-taken again on V4.1 on 2026-09-15, in the shape the studio sends today:
**the sizing table** (`probes/probe-v41-sizing.mjs`), **the piece-shape arms**
(`probes/probe-v41-pieces.mjs`) and **the cliff's rate**, sixteen runs a rung
at `low` and `none` (`probes/probe-v41-rate.mjs`, run twice). Each sits under
the V4-Flash table it replaces, so nothing on this page is the retired model's
alone any more; the old tables stay as the shape the studio was designed on.

⚠️ The `probe-extension-*.mjs` family cannot be re-run as written — every one
of them imports `sizingAsk`, which the builder's second chapter replaced with
`sizingRules` and `sizingTrigger` on 2026-09-06. `probe-v41-prefix.mjs` was
written to depend on nothing that moves, and `probe-v41-pieces.mjs` is that
family's re-take on `sizingRules` and `sizingTrigger`.

**Running them.** Every probe on this page lives in **`probes/`**, tracked,
each carrying a header saying what it asks and why, with its output beside it
as `.out`. They lived in gitignored `tmp/` until 2026-09-13, so this page cited
scripts nobody but the machine that ran them had; probes older than that date
still name their original `tmp/` path in their own header, and the invocation
below is the current one. ⚠️ The **key** did not move: it stays at
`tmp/deepseek.key` or in `$DEEPSEEK_API_KEY`, and `probes/` must never hold
one. The 2026-09-13 four and the 2026-09-15 three run as

```sh
env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
  node probes/probe-v41-<name>.mjs > probes/probe-v41-<name>.out 2>&1
```

reading the key from `$DEEPSEEK_API_KEY` or `tmp/deepseek.key`;
`--use-env-proxy` is this sandbox's requirement, not the API's, and none of
them is in `npm test`, which never touches the network. `probe-v41-ladder.mjs`
also takes `PROBE_RUNGS` and `PROBE_REPS`, `probe-v41-loop.mjs` takes
`PROBE_TURNS` and `PROBE_MAX`. ⚠️ Three of the four take their model id from
`probes/probe-lib.mjs`, whose default was the **retired** `deepseek-v4-flash`
until 2026-09-13: a probe run without `PROBE_MODEL` before that date measured
V4.1 through the old alias while printing the old name in its own header.

### Models

`GET /v1/models` returned, 2026-09-12, exactly two: **`deepseek-flash`**
(V4.1) and **`deepseek-v4-pro`**.

**The studio sends `deepseek-flash` and nothing else** (`llm/deepseek.js`,
one `MODEL` constant, no column read, no picker). Pro is 4.4× a missed token
and 3.3× an output token, and ⚠️ it has no eyes — see Images — so the one
thing it could have been kept for, a harder second opinion, it now does worse.

`deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` still resolve, routed
to V4.1 by DeepSeek's own compatibility shim with no published end date, and
are deliberately not used. `deepseek-chat` and `deepseek-reasoner` are older
aliases of the same kind, differing only in whether a trace comes back; this
app controls reasoning explicitly instead.

### Reasoning

Reasoning is **on by default**.
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

Re-measured on a *heavy* prompt on 2026-08-31 (`probes/probe-keepalive.mjs`,
`probes/probe-thinking.mjs`), because the trivial-prompt numbers above turned out
to describe noise rather than the case that matters:

- **The stream carries no comment frames.** Zero non-`data:` lines in a
  45-second, 1.3 MB stream, and the longest gap between reads was 439 ms. The
  idle guard below therefore cannot be held open by a keep-alive, and a
  two-minute silence really is a dead stream. This was a guess until now.
- **Reasoning streams at ~90 tokens/s, ~320 bytes of SSE per token.** At the
  65,536 ceiling that is **~12 minutes and ~20 MB** for one turn's trace, all
  of which the studio re-broadcasts to every connected tab, one frame per
  delta (§9).

  ⚠️ **V4.1 reasons ~2.6× faster: ~233 tokens/s** (nine readings on
  2026-09-13, 205–248, across all three of that day's probes — tight enough to
  rely on). Every wall-clock figure on this page that was taken at ~90 tokens/s
  is that much too long. The two that matter: the 65,536 ceiling is **~4.7
  silent minutes**, not nine to twelve, and the *thinking cap* — 35,000
  characters, near 10 K tokens — fires at **~43 seconds**, not ~90.
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

⚠️ **The cliff survives on V4.1 and is worse, but it is a different shape and
the numbers below are not its numbers.** Read *The cliff on V4.1* at the end
of this section before acting on anything in it; what follows first is the
V4-Flash measurement the studio was built on, kept because every design
decision on this page still points at it.

The measurement this studio most needed and did not have. The studio's own
preamble, its file tools, and one ambitious open request — *"Build me a tank
game. Two players, split screen, destructible walls, power-ups."* — against
`deepseek-v4-flash` (`probes/probe-do-more.mjs`, `probes/probe-tools-effort.mjs`,
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

#### The cliff on V4.1

Re-taken 2026-09-13 on `deepseek-flash`: same preamble, same three tools, same
request, held byte-identically in `probes/probe-lib.mjs` so the rows compare.
`probes/probe-v41-cliff.mjs` re-runs the arms above, `probes/probe-v41-ladder.mjs`
puts every `reasoning_effort` value against them, and `probes/probe-v41-loop.mjs`
serves the tool loop rather than stopping at the first turn.

⚠️ **The trace no longer expands to fill whatever it is given. It is either
almost nothing or all of it.** Every one-turn run of the day:

| setting | runs | ran away | trace when it did not |
| --- | --- | --- | --- |
| default — what `full` sends | 10 | **5** | 0–60 |
| `'minimal'` | 2 | 1 | 10 |
| `'low'` | 7 | 1 | 8–105 |
| `'medium'` | 2 | 1 | 8 |
| `'high'` | 2 | 0 | 9–10 |
| `'max'` | 2 | 1 | 19 |
| `'none'` | 4 | **0** | 0, and it writes files |

A runaway spends every token of its allowance on the trace — 8192 of 8192,
16384 of 16384 — and produces no file, no word and no call, exactly as before.
What changed is everything around it: **nothing between ~105 tokens and the
ceiling was seen at any setting**, where V4-Flash's default climbed steadily
into its budget. Three things follow.

**The default is now the worst setting on this page, by a wide margin.** One
run in nine produced nothing on V4-Flash; one in two does here. It is still a
person's choice (§6) and the *thinking cap* still catches it — sooner, at
~43 s rather than ~90.

**⚠️ There is no ladder, and the tool case now says so too.** The reasoning
section above hedged: no ladder on a trivial prompt, but the *ends* mattered
once tools were in play. With tools in play all six named rungs behave alike —
a trace of 8–105 tokens, or a runaway. `'max'` is accepted and is not more
thinking. The only distinction left is `'none'` against everything else. ⚠️
`'minimal'`, `'medium'` and `'max'` carry two runs each: direction, not a rate,
and the one-in-seven at `'low'` is no better founded.

**`'low'` no longer buys thinking on a first turn.** It produced 1,597 and
6,886 tokens of trace on V4-Flash and 8–105 here. What it does still buy only
appears once the loop is closed.

**The loop, served.** `probes/probe-v41-loop.mjs` answers the calls instead of
stopping at the first turn, with the ambient file block present — an empty
tree, as production always has one — `max_tokens` 16,384 a turn, at most 8:

| effort | result |
| --- | --- |
| default ×2 | ran away on turn 1 both times, 66 s and 69 s, nothing produced |
| `'low'` | **19 files, 74,935 bytes**, 8 turns, 30 calls, 7,016 reasoning, 33,882 output, 124 s |

The `'low'` run wrote BRIEF, SPEC, TODO and `config/` first, then one `js/`
file per part of the game, then patched its own work; **cache hit was 96–99%
from turn 2 on**. Its traces by turn were 0, 751, 527, 711, 816, 749, 2,055
and 1,407 tokens — so `'low'` does think, just not on the turn that starts
from nothing. One run, quality unscored, the same caveat the arms above carry.

⚠️ **The largest healthy trace is 4,263 tokens, ~14,900 characters** — the
first turn of a vague ask, in the next section. It was recorded as 2,055 for
a few hours on the strength of this run alone, and the number matters: a cap
at 12,000 characters looked generous against 2,055 and would have cut the
single most useful trace measured all day. `THINKING_CAP_CHARS` is 35,000,
which is 2.4× the real figure rather than 4.9× the wrong one. A *healthy*
trace here means one on a turn that ended on `tool_calls` or `stop`; a turn
that ended on `length` had run away, whatever it emitted on the way out.

**A false alarm worth recording.** In the cliff and ladder probes every
non-`none` run that acted opened with `read_file` on files that could not
exist, where V4-Flash's opened with `write_file`. That is those two probes
having no ambient file block, not a habit of V4.1's — with an empty-tree block
present, `'low'` writes on its first turn. ⚠️ A probe without the file block
is not measuring the studio.

**Two streams went silent and never returned**, out of roughly sixty requests
that afternoon: one `'low'` one-turn run and one loop turn, no bytes and no
completion for over eight minutes each, both cancelled by hand. Neither probe
carries an idle guard and the studio does (§8) — which is the argument for it,
though a rate cannot be read off two events. The probes written after them do
carry one, at 120 s.

#### The cliff's rate, sixteen a rung

The table above pooled 7 runs at `low` and 4 at `none` from three probes of
two shapes, and ⚠️ two of the three had no ambient file block — which this
page already said is not measuring the studio. Re-taken 2026-09-15
(`probes/probe-v41-rate.mjs`, run twice: `probe-v41-rate-1.out` and
`probe-v41-rate.out`), one shape and the studio's — the preamble, the
empty-tree block, the three tools, one turn from a cold prefix, `max_tokens`
8192 — eight runs a rung, twice:

| setting | runs | ran away | healthy traces |
| --- | --- | --- | --- |
| `'low'` | 16 | **15** | 4,086 |
| `'none'` | 16 | **0** | 0 ×16, and every one wrote 3–7 files in 9–14 s |

⚠️ **With the block present, `low` on an ambitious open ask from an empty
tree runs away nearly every time.** The one-in-seven above was the no-block
probes' `read read` turn — a first act of reading files that cannot exist,
over in a second, a degenerate turn and not a first turn of building. The two
`low` arms in the next section that both ran away on turn 1 were the rule,
not the exception. Three things follow. The `'low'` row of the V4.1 cliff
table above is void. Production `low` on a whole-game ask is `none` plus a
~35–43 s detour to the *thinking cap* almost every time — the number the
TODO line about the cap's cost was waiting for, and the argument for sizing
an open request outside `Building` the way the builder sizes one. And the
first run's own verdict column is wrong on its first row: a turn that ended
on `length` having squeezed two writes out at 33 s was counted healthy, and
by this page's definition it is a runaway; the source was corrected before
the second run, and the rate above counts it as one. `none` is not a coin
flip the other way: sixteen of sixteen acted, none thought, and the 8192
allowance was never near.

#### ⚠️ Is the thinking worth anything? `none` against `low`

The question every table above dodges. §14 has scored *whether tool calls came
out* since 2026-08-12 and never *whether the result was any good*, and on V4.1
a first turn thinks 8–105 tokens at every setting — so the obvious reading is
that the thinking level has stopped earning its place. Measured 2026-09-13
(`probes/probe-v41-none-vs-low.mjs`, `probes/probe-v41-small-ask.mjs`), which
score two things the older probes could not: every `.js` written is put through
`node --check`, and the tree is kept so the game can be **opened in a browser**.

**A whole game, empty tree, at most 10 turns:**

| arm | turns | calls | files | bytes | reasoning | wall | ended | in a browser |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `none` #1 | 10 | 17 | 15 | 58,603 | **0** | 81 s | out of turns | **runs clean** |
| `none` #2 | 10 | 30 | 19 | 86,466 | **0** | 122 s | out of turns | **runs clean** |
| `low` #1 | 8 | 20 | 17 | 54,381 | 18,766 | 142 s | finished | ⚠️ **throws every frame** |
| `low` #2 | 10 | 27 | 17 | 55,282 | 20,665 | 157 s | out of turns | runs clean |

⚠️ **Both `low` arms spent their first turn on a runaway** — 14,169 and 14,717
reasoning tokens, both ending on `length`. In the studio the *thinking cap*
fires at ~10 K tokens and retries with thinking off, so **production `low` on
an ambitious open request is `none` plus a ~43-second detour**. And `low` #1
is the one broken game of the four: `node --check` passed every file, and
`drawWalls` reads `game.grid[r][c]` outside the grid on the first frame. Bytes
and a parse are not a game — that failure is only visible in a browser.
`none` #2's defect is cosmetic by comparison: HTML entities (`&mdash;`) in
strings drawn to a canvas, which render literally.

**A small ask on space-racer's tree — the fire the studio actually runs at
`low`** (`BUILDER_THINKING`, §8), which the whole-game arms above are *not*:

| ask | arm | turns | calls (reads) | files changed | reasoning | ended |
| --- | --- | --- | --- | --- | --- | --- |
| "make the ship turn a bit faster" | `none` | 2 | 1 (0) | 1 | 0 | finished |
| | `low` | 2 | 1 (0) | 1 | 106 | finished |
| "it doesn't work when I hold both arrow keys" | `none` | 5 | 9 (3) | 3 | 0 | finished |
| | `low` | 4 | 6 (2) | 2 | 4,042 | finished |
| **"the rivals are too easy to beat"** | `none` | 8 | 25 (**15**) | 5 | 0 | ⚠️ **out of turns** |
| | `low` | 6 | 10 (1) | 5 | 4,590 | finished |

Three readings, and the third is the one that decides it.

**On a concrete ask the thinking buys nothing.** Both arms changed the same
one file, `config/play.js`, by the same kind of amount, and explained it as
well. `low` spent 106 tokens to arrive where `none` already was.

**On a bug report both are right, and `low` is more thorough.** `none` named
the cause exactly — `Input.axis` is `held(right) - held(left)`, so both keys
down gives `1 - 1 = 0` — and fixed it. `low` spent 4,042 tokens and wrote the
last-key-wins fix instead, which is the better answer to the same bug.

**⚠️ On a vague ask `low` finishes and `none` does not.** `none` read fifteen
times, touched five files, ran out of turns, and — worst of it — wandered into
`config/achievements.js` and added four achievement rules nobody asked for.
That file is **shape-locked**: a stray key there costs somebody their editor
(§6, §12). `low` thought once, for 4,263 tokens, then spent one read and nine
writes on the three files the change needed plus SPEC.md and TODO.md.

So the thinking level keeps its place, now for a measured reason rather than
an inherited one: **thinking is worth nothing on a small concrete ask, worth
less than nothing on a big open one — the cap cancels it — and worth having on
a vague one**, which is the ask a kid actually makes. That is also exactly the
shape the builder already has: it sizes every message first, a big ask becomes
pieces that run at `none` (§8), and what is left on `low` is the small or
vague ask, which is where this table says `low` wins.

⚠️ Two runs an arm, one run per ask. Direction, not a rate.

#### Can the sizing call judge it? The `clear` key

If the thinking wants deciding by the *ask* rather than by the person in
advance, the sizing call is where it belongs: it already carries the fire's
whole system prompt, already answers in JSON, and costs almost nothing because
its output is short and its prompt is the fire's — every request below hit
**98%**. A second classifier call would be a second full prompt; one more key
on this one is near-free. Measured 2026-09-13,
`probes/probe-v41-clear.mjs`, three runs an ask, arm A today's rules and arm B
the same plus the key.

| | arm A | arm B |
| --- | --- | --- |
| size agreement with the author's labels | 20/24 | 19/24 |
| `clear` agreement, where it answered | — | **8/8** |

**It judges well and answers unreliably.** Every `clear` it gave agreed,
including the one that matters — `"the rivals are too easy to beat"` came back
`false`. But it left the key off about three one-piece answers in ten. So the
key is built to be optional: absent means the level, which is what happened
before it existed.

**No degradation the size of this sample could see.** 20/24 against 19/24 is
one row, and the rows moved in both directions — `"make the rocks blue"` went
from three-for-three to one, `"the rivals are too easy"` went the other way.
⚠️ Three runs an ask cannot rule out a small loss; what it rules out is a
large one.

⚠️ **Two things arm A found that matter more than the key**, both in the rules
as they ship today:

- **A bug report sizes as a *reply* two times in three.** `"it doesn't work
  when I hold both arrow keys"` came back `reply, reply` and one piece, in
  both arms. A child reporting a broken game is answered with words instead of
  a fix. Nothing in the rules tells the sizing that a symptom is work.
- **A vague ask rarely reaches the one-piece path at all.** `"the rivals are
  too easy to beat"` sized as a plan of two or more in two runs of three, and
  `"it feels a bit boring"` and `"the controls feel wrong"` were replies in
  every run. So in `Building` vagueness is already routed to the **draft** and
  its assumptions, or to an answer in words. ⚠️ Which means the `none`-versus-
  `low` result above — `low` finishing where `none` ran out of turns — is
  about a fire with **no sizing in front of it**: an open room, where the
  a-priori level still rules and this whole mechanism does not reach.

#### The symptom rule, and the tiny judge

Both of the above were acted on the same day and re-measured together
(`probes/probe-v41-symptom.mjs`, three runs an ask, twelve asks — the ten
above plus two more symptoms, because a rule written to catch one row is
exactly the kind that fits only that row).

**The symptom rule helps and does not finish the job.** Two lines went into
`sizingRules()` saying that something being broken is not a remark. Size
agreement over the whole list went to **28/30**, and on the eight asks
common to both runs it went from 20/24 to 23/24:

| ask | before | after |
| --- | --- | --- |
| "it doesn't work when I hold both arrow keys" | 1/3 | 2/3 |
| "my ship gets stuck on the edge of the track" | — | 2/3 |
| "the score stays at 0 even when I finish a lap" | — | 3/3 |
| "the rivals are too easy to beat" | 1/3 | 3/3, and `clear: false` every time |

⚠️ **A bug report still comes back as words about one time in three.** Seven
of nine symptom runs sized as work, against roughly three of nine before.
Better, not fixed, and three runs an ask is not the sample to tune prompt
wording against — that way lies fitting the noise.

**A tiny judge beats the key it rides beside.** The other half of the same
run asked whether a *standalone* call could make the `clear` judgement with
no tree and no preamble — the message, a definition, nothing else — because
an open room has no sizing call to ride and giving it one would want the
sizing rules in every preamble and a `[studio]` trigger landing on a child's
message in a room that never mentions sizing.

| | the `clear` key on a full sizing | a tiny standalone call |
| --- | --- | --- |
| agreed with the labels | 13/14 | **26/27** |
| answered at all | about two-thirds of the time | **every time** |
| prompt | the fire's whole system prompt, ~98% cached | **119 tokens, a whole miss** |
| cost | rides a call already being made | **$0.0000355** |

The two agreed with each other 12/14. So the tiny one is not merely adequate,
it is the more reliable of the two: one job, one answer, and it never forgets
to give it. ⚠️ It also answers `false` for a plain question — `"do you think
the game is fun?"` — which is not wrong so much as meaningless, and is why
every caller treats anything but `true` as "keep the level" rather than as a
judgement about the request.

#### The tiny judge on a whole-game ask

Since 2026-09-13 every open room runs the tiny judge ahead of its fire, and
`clear: true` fires at `none`. It had only been scored on space-racer's small
asks; the ask the *cliff's rate* is about — a whole game from an empty tree,
where `low` runs away 15 times in 16 — had never been put to it. Measured
2026-09-15 (`probes/probe-v41-judge-whole.mjs`), eight big open asks five
times each, the shipped wording byte for byte:

| ask | `clear: true` of 5 |
| --- | --- |
| the tank ask (two players, split screen, walls, power-ups) | 1 |
| "make me a platformer where a frog eats flies" | 0 |
| "I want a game like flappy bird but with a dragon" | 4 |
| "make a racing game" | 0 |
| "make a game" | 0 |
| "build a quiz about dinosaurs" | 2 |
| "add a second player with split screen so two people can race each other" | 5 |
| "make me something fun to play with my brother" | 0 |
| **all** | **12 of 40**, `false` 28, unsaid 0 |

⚠️ **A whole-game ask is `false` more often than not, so an open room fires
it at `low` and takes the ~43 s detour to the cap nearly every time.** The
judge is not wrong by its own definition — *what to change still has to be
worked out* is exactly true of a game from nothing — but the definition lumps
two asks together that want opposite treatment: a vague *small* ask, where
`low` finishes and `none` runs out of turns (above), and a whole game, where
`low` is `none` plus the detour. `Building` tells them apart because its
sizing answers in pieces and a plan of two or more runs at `none`; an open
room has no such call. What to do about it is a decision, not a measurement
(TODO.md): size an open request the way `Building` does, or give the tiny
judge a second key for "more than one sitting", or leave an open room's
whole-game ask to the builder's room, which is where the studio already sends
every new game.

### ⚠️ The size of the ask is the lever

Measured 2026-09-03 (`probes/probe-sizing.mjs`, `probes/probe-step.mjs`,
`probes/probe-trace-handoff.mjs`, `probes/probe-handoff-json.mjs`; outputs beside
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

**Re-taken on V4.1, 2026-09-15** (`probes/probe-v41-sizing.mjs`), in the
studio's own shape: the rules in the system prompt, `[studio] Size this
request.` on the last message, `response_format` json_object, and the answers
`reply` and `pieces`. Same asks, so the rows compare:

| ask | answer | wall | out tokens |
| --- | --- | --- | --- |
| the tank game, empty tree ×5 | pieces: 6, 6, 4, 4, 5 | 2.2–5.7 s | 337–887 |
| "make the ship turn a bit faster", space-racer's tree ×3 | one piece | 1.2–1.8 s | 63–131 |
| "add a second player with split screen" ×3 | 3, 3, 2 pieces | 2.3–4.5 s | 289–722 |
| "it doesn't work" ×2 | **one piece** | 1.5–1.6 s | 107–117 |
| "do you think the game is fun?" ×2 | reply | 0.6–1.0 s | 5 |

The plans are shorter — 4–6 pieces where V4-Flash gave 7–8 — every one in a
sensible order and none naming `studio/`, and the vague "it doesn't work" is
work now rather than `small`, which is the symptom rule at work. Behind a
warm prefix the call hit 85–98%. The first tank plan's summary and its five
assumptions read as a draft card should, one of them an invention (a
"distraction button") which is exactly what the editable assumptions are
for. ⚠️ **One plan in five came back with its titles in Chinese**
(核心骨架与分屏 — "core skeleton and split screen"), its files and shape
otherwise right. Nothing in the rules names a language, and a kid would get a
card they cannot read.

**The language line, measured and withdrawn** (`probes/probe-v41-language.mjs`,
the same day): thirty sizings a side — the tank ask twenty times, the
split-screen ask ten — once on the rules as shipped and once with one more
line, *write every title, what, summary and assumption in the language the
person wrote their message in*:

| rules | not in English |
| --- | --- |
| as shipped (`-1.out`, with the five above) | 1 of 35 |
| with the language line (`-line.out`, `-2.out`) | **4 of 42** |

⚠️ The line did not help and may have hurt: naming the language reads as
priming the switch rather than preventing it. It was taken out the same day,
`test/sizing.test.js` holds the door shut against putting it back, and the
rules carry a comment saying why. Forty a side cannot separate 3% from 10%,
but it can rule out "the line fixes it". The fix, if the rate is worth one,
is deterministic: a check on the answer's script against the request's, and
one re-ask — built and measured below.

**And a second thing the same run found, which matters more.** ⚠️ **Seven of
fifty-two tank sizings would not parse** — none of the twenty split-screen
ones — and every one had the same shape: a complete object closed right
after `pieces`, `…}]}`, with `,"summary":"…","assumptions":[…]}` written on
after it as though it had not closed. `response_format` json_object did not
stop it; `finish_reason` was `stop`. In production an unparseable sizing was
a plain fire at the builder's level — on the one ask where `low` runs away
fifteen times in sixteen (above) — so about one whole-game request in eight
was taking the ~43 s detour for a reason nothing reported. `parseSizing` now
repairs it by taking the early `}` out and reading the whole, keeping the
summary and the assumptions, or failing that reads the first object alone;
`probes/probe-v41-language-unparseable.json` is the real answer, kept, and
`test/sizing.test.js` reads it.

**The re-ask, measured** (`probes/probe-v41-script.mjs`, 2026-09-15). The
check is `inOtherScript` in `server/agents/sizing.js`: any of a plan's words
in a script the request has none of — the CJK, Cyrillic, Arabic and Hebrew
the probe above counted — and the orchestrator asks once more on the same
transcript, the Chinese answer left standing as the assistant turn and
`SCRIPT_TRIGGER` after it, which names no language: *written in a different
script from the person's message … the way the person writes*. At 1 in 35 a
live run would see one case in an afternoon, so the probe measured the
re-ask alone: the tank ask, tank #12's five Chinese titles with the rest put
into Chinese by hand, then the trigger, forty times.

| re-ask | of 40 |
| --- | --- |
| in the person's script, parsed, the same five pieces | **39** |
| still Chinese | 1 |
| unparseable | 0 |

Every answer kept the plan's shape — five pieces, the same five jobs, the
titles a translation of the Chinese ones — so the re-ask changes the words
and not the plan. It rides the prefix at **87%**, ~3 s. One re-ask and no
more: the slip is 1 in 35 and the re-ask misses 1 in 40, so a kid sees a card
in Chinese about once in 1,400 plans, and a second slip is shown rather than
looped on. A request written in one of those scripts is answered in it,
unchecked, and a re-ask that will not parse leaves the first answer standing
(`test/builder.test.js`).

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

`tool_choice: 'none'` is **accepted** (2026-09-03, `probes/probe-tools-cache.mjs`):
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

**Supported, on `deepseek-flash` only.** Re-measured 2026-09-12
(`probes/probe-v41*.mjs`) because V4.1 reversed the finding this section carried
for a month — that both content-part shapes were rejected by the deserializer
before the model was reached, and that no model id could lift it.

`{type: 'image_url', image_url: {url: 'data:image/png;base64,…'}}` is
accepted. PNG, JPEG, GIF and WebP; **not SVG**, which is text anyway and which
`read_file` gives an agent more of. External `http(s)` URLs and an uploaded
`file_id` also work and are not used here: a game's pictures are on the
studio's own disk.

⚠️ **`deepseek-v4-pro` does not reject an image. It drops it and answers
anyway.** Same picture, same question, same request: Flash reported 209 prompt
tokens and said *"Green and brown"* of a green-and-brown forest; Pro reported
22 and said *"White and blue."* No error, no warning, a confident wrong
answer. A studio that offered both models would have to gate the capability on
the model; a studio with one model does not, and this is one of the reasons
there is one (see Models).

**Where a picture may sit is decided by the API, not by us:**

| placement | result |
| --- | --- |
| `system` message | 400 `Image in system message is unsupported` |
| `assistant` message | 400 `Image in assistant message is not supported` |
| `user` message | works |
| **`tool` result** | **works** — and is what `look_at` uses (§8) |

⚠️ The system-message refusal is the load-bearing one: the **ambient file
block lives in the system prompt** (§8, §12) and therefore cannot carry
pictures. It names them — `[binary: assets/sprites/hero.png, 1234 bytes]` —
and `look_at` shows one on request, which also means a picture costs nothing
until an agent asks for it.

**What a picture costs.** A 3.1 KB pixel-art PNG measured **~195–233 prompt
tokens**, a portrait the same; the documented ceiling is 1,024 tokens per
image whatever its size, images being resized to between ~544 and ~1300 px a
side. At the miss price that is $0.00006 a look. ⚠️ The **bytes** are not the
cost — a data URI is hundreds of kilobytes of base64 for those ~200 tokens —
which is why the loop's growth limit weighs a picture at a flat allowance
rather than at `JSON.stringify(message).length` (§8).

**A picture caches.** The same picture sent twice hit 99%: image tokens ride
the prefix cache like any others.

⚠️ **A picture on the last user message does not cost the ~6,000-token
prefix** that a ≥160-token text message costs (below). Measured on a
9.5 K-token prompt: the request extending it hit 98%, against 98% for a
short-message control and the 48–50% signature of the loss. One run. Nothing
leans on this yet; it is here because the arithmetic — a picture is ~200
tokens, the rule bites at ~160 — says it should have bitten and did not.

Limits, from the vision guide, unverified here: 600 images per request, 8,192
px a side (4,096 at ≥15 images), 32 MiB per external image, 48 MiB of request
body inline. The studio's own cap is 2 MB per picture (`agents/tools.js`),
which no picture its pixel editor makes comes near.

### Prices

Read from the price page on 2026-09-10
(`api-docs.deepseek.com/quick_start/pricing/`), per million tokens:

| model | miss, peak | hit, peak | output, peak | hit : miss | output : miss |
| --- | --- | --- | --- | --- | --- |
| **`deepseek-flash`** | **$0.30** | **$0.006** | **$1.20** | **1 : 50** | **4 : 1** |
| `deepseek-v4-pro` | $1.32 | $0.044 | $3.96 | 1 : 30 | 3 : 1 |
| `deepseek-v4-flash`, retired | $0.44 | $0.014 | $1.32 | 1 : 31 | 3 : 1 |

Peak is 01:00–04:00 and 06:00–10:00 UTC on weekdays; every other hour is
off-peak at exactly half, in every column, so the ratios hold around the
clock. §8's budget formula weighs a hit at a **fiftieth** and output at
**four** — this model's shape, and no longer a shape the two models share.

Three things follow. Output includes the reasoning trace, so thinking is the
dearest thing a turn does, and V4.1 made it dearer against input rather than
cheaper: a 6,886-token trace costs what 27 K missed or 1.4 M remembered tokens
cost, which is why a piece runs at `none` and the file block is the
second-order lever. ⚠️ 6,886 was one V4-Flash `'low'` trace; on V4.1 `'low'`
thinks 8–105 tokens on a first turn and 500–2,100 on a later one (the cliff
section), so that arithmetic now describes a **runaway** rather than a working
turn — and a runaway is what the *thinking cap* is for. The cache fell to a fiftieth, so carrying the whole
tree is close to free and the miss is nearly the whole of a fire's input bill.
And Pro is now 4.4× on a miss, with a cache of its own — a KV cache is one
model's — so a turn handed to it would start cold as well as dear. That, and
its blindness, is why nothing is handed to it.

Priced end to end on arm B of the piece-shape table below (397 K hit, 20.2 K
miss, 14.0 K output, three pieces): **3.29¢ on the retired model, 2.52¢ on
this one**, at peak, and half that off-peak.

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
`probes/probe-order.mjs` (2026-08-23): the first edit of a file deep in a
10 K-token system prompt scored 0%, the second 42%, the third and fourth 94%,
in 64-token blocks; a pure extension of a previous request (history appended,
nothing changed) always scored ~100%. Spacing the requests 20 s apart measured
identically to back-to-back, so this is structure, not write latency. §8's
file-block ordering exists because of this: the win is not the first fire
after an edit, it is every fire after that one, provided the divergence depth
holds still.

**The tools array does not sit ahead of the system prompt.** Measured
2026-09-03 (`probes/probe-tools-cache.mjs`): space-racer's tree in the system
prompt, ~12.3 K tokens, a transcript growing one exchange a round. A request
with no tools and the with-tools request straight after it, same round, hit
95% on the first round and 99–100% every round after, against 99% for the
tools-every-time control; the array costs 455 prompt tokens and those are all
that misses.

⚠️ **What that did and did not show**, resolved 2026-09-06 by DeepSeek's own
caching guide (`api-docs.deepseek.com/guides/kv_cache/`), a production
receipt and eight probes (`probes/probe-extension*.mjs`, outputs beside them).
The guide's rule: a request hits only when it **fully matches a cache prefix
unit**; units are persisted at request boundaries, when a common prefix is
detected across requests, and at fixed intervals in a long input; a
divergence mid-prompt hits nothing the first time and persists the common
prefix for the requests after it. That is the branch-point rule above, stated
by the vendor, and the probes bear it out — with one rule the guide does not
state, which is the one that was costing the builder's room half its prompt
on every reply. The cache lasts "hours to days" once idle.

**⚠️ The last user message decides how much of a request the next one can
reuse — on V4-Flash. ⚠️ Not on V4.1: re-measured 2026-09-13, the rule is
gone** (*The 6 K rule on V4.1*, below). What follows is the V4-Flash finding,
kept because the builder's second chapter was designed around it.

Measured on space-racer's 12.5 K-token prompt: a first request, then
a second carrying the first's messages, its answer as the assistant turn and
one more user turn on top.

| last user message of the first request | the second request hits |
| --- | --- |
| ≤ ~110 tokens (measured at 86 and 111) | everything to the end of the system prompt: 95–96% |
| ≥ ~160 tokens (161, 211, 261, 384, 512, 1024) | **the system prompt less ~6,000 tokens**: 48–50% |

The loss is a constant ~6,000 tokens at every prompt size tried, 6.5 K to
59 K (`probe-extension-3.mjs`), so at 12.5 K it is half and at 59 K a tenth.
Nothing else moved it: not `response_format` json_object (an identical
repeat hits 99% in both modes, and a 138-token JSON answer behind a short
message hits 95%), not the first request's `max_tokens` (64 to 4,800,
identical), not how much it said or how it stopped (8 tokens cut by `length`
and 131 ending in `stop` both hit 95%), not the words (JSON shapes in a short
message hit; the sizing ask with its shapes written out in prose missed), not
a 20 s wait. Two consecutive user turns count as one: a long turn with a
short trigger after it missed the same way. Tool-call outputs look exempt —
inside every tool loop measured, the second request reused the whole first
prompt behind a 600-token piece turn.

The sizing ask is ~250 tokens on the last user message. So the sizing hit
nothing, as any fresh prefix does, and the fire after it hit half — exactly
the production receipt. Dropping the ask from the fire (today) and keeping
the whole exchange (the extension the second chapter first designed) measured
the same 50%. **The fix is to make the last message short**: the sizing
rules move into the system prompt, cached with the rest and byte-identical
for the fire, and the last message carries `[studio] Size this request.`
Measured (`probe-extension-8.mjs`): the sizing still answers, small and big
alike, the fire that extends it hits 96%, and each piece of a plan, carrying
the plan and its own ~600-token turn on top, hits 91–93%, the miss being its
own turn. A kid's message long enough to trip the rule still costs the 6 K
once; whether a short assistant turn between it and the trigger rescues that
is unmeasured.

**⚠️ The 6 K rule on V4.1: gone.** Re-measured 2026-09-13 on `deepseek-flash`
(`probes/probe-v41-prefix.mjs`, run **twice** — nine last-message lengths each on
space-racer's 12.5 K prompt, two more on a padded 61 K one). What the request
that extends it hits:

| tokens on the last user message | V4-Flash | run 1 | run 2 |
| --- | --- | --- | --- |
| 32 | 96% | 96% | 96% |
| 86 | 95% | 95% | 95% |
| 111 | 95% | 94% | 94% |
| 128 | — | 94% | 94% |
| 145 | — | 94% | 94% |
| **161** | **48–50%** | **94%** | **94%** |
| 261 | 48–50% | 93% | 93% |
| 512 | 48–50% | 92% | 92% |
| 1024 | 48–50% | 89% | 89% |

On the 61 K prompt, where a constant 6,000-token loss would read as ~90%: 99%
behind an 86-token message and 98% behind a 512-token one.

What a request now fails to reuse is **the last message plus the turn appended
to it, and nothing else** — 578 tokens behind a 32-token message, rising to
1,479 behind a 1,024-token one, the two runs within a few tokens of each other
at every length. The only step left is one **128-token** block, the cache's
own granularity, appearing between 86 and 111 tokens and never growing after.

⚠️ What this changes and what it does not. The builder's shape — the sizing
rules in the system prompt, `[studio] Size this request.` on the last message
— is **kept**: still the cheapest arrangement, and it costs nothing. It is no
longer *forced*. Three claims that rested on the rule are void: a kid's long
message does not cost 6 K, a capped trace or a begun note riding ahead of the
trigger does not cost 6 K once, and the unmeasured question about a short
assistant turn rescuing it has nothing left to rescue (§8).

**Three shapes for a piece's fire**, same plan, same tree, real tool loops
writing into their own copies, thinking off (`probe-extension.mjs`; the plan
was sized under the old long ask, so piece 1 starts from a half or a cold
prefix in every arm):

| arm | first-request hit per piece | requests | hit | miss | out | miss-equivalents | files |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A — narrowed block, one turn (today) | 0% 0% 5% | 19 | 308 K | 68.5 K | 26.9 K | 159.5 K | 4 |
| B — the sizing's block frozen, the exchange kept, fresh copies on the piece turn | 49% 87% 98% | 24 | 397 K | 20.2 K | 14.0 K | **75.3 K** | 7 |
| C — whole block rebuilt per piece, one turn | 0% 0% 32% | 24 | 497 K | 69.3 K | 29.7 K | 174.9 K | 5 |

Miss-equivalents are §8's formula. A narrowed block diverges just after the
description on every piece, so its first request misses whole every time; a
rebuilt block diverges wherever the last piece's writes moved a file, a new
depth every time; the frozen block diverges only at the transcript, where the
branch point from the piece before already sits. B also wrote the fewest
output tokens and touched every file the plan named — one run, unscored.

**Re-taken on V4.1, 2026-09-15** (`probes/probe-v41-pieces.mjs`): the same
three arms on the words the studio sends today — the sizing's rules in the
system prompt and its short trigger — and arm B's transcript laid down as
production lays it on *Build it*: the request, the draft card as the builder's
reply, the Build press and its `{"ok":true}`, then each piece's turn with
fresh copies on top. One plan of three pieces, eight requests a piece,
thinking off:

| arm | first-request hit per piece | requests | hit | miss | out | miss-equivalents |
| --- | --- | --- | --- | --- | --- | --- |
| A — narrowed block, one turn | 0% 6% 10% | 24 | 387 K | 48.2 K | 18.3 K | 129.2 K |
| B — frozen and extended (production) | **92% 66% 94%** | 24 | 488 K | 31.9 K | 11.5 K | **87.5 K** |
| C — whole block rebuilt per piece | 0% 11% 45% | 24 | 419 K | 58.4 K | 11.4 K | 112.2 K |

⚠️ Weighed at this model's prices — a hit a fiftieth of a miss, output four —
so the equivalents do not compare with the V4-Flash table's, which weighed a
thirtieth and three; the hit rates do. B is still the cheapest shape, by a
quarter over C and a third over A, and its first piece now opens at **92%**
where the old ask's 6 K rule held it to 49%: the frozen block is kept on its
own merits, not the rule's. Its middle piece's 66% is the fresh copy of a
large `js/game.js` riding the piece turn — the miss is the turn itself, as
designed. Every arm ran every piece to the eight-request cap, so what this
measured is the cache and not the finish; quality unscored, as before.

Within one tool-call chain, the model's own output — the **reasoning trace
included** — is re-attached server-side to the next request's prompt and
billed as input, even though the client never sends it back: a continuation's
prompt grows by the previous request's `completion_tokens`, not by the bytes
the client appended (measured in `probes/probe-reasoning-replay.mjs`,
2026-08-28, and visible in any multi-request receipt). It **accumulates** —
every earlier round's trace stays in the prompt until the chain closes — and
rides the prefix cache at the hit price, so a long fire pays a thirtieth of an
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
