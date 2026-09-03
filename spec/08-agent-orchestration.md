## 8. Agent orchestration

### Eligibility

On each human message, the helpers **in that chat** are evaluated — nobody
else's conversation is woken by it. Eligible if `chatty = 1` **or** the body
contains an `@mention` matching the agent's name (case-insensitive). Agent
messages never make agents eligible — bot-to-bot dampening — but agents do see
each other's messages as context.

The human-only chat has no helpers to evaluate, by construction rather than by
a filter here: nothing can be written into `chat_agents` for it. A fire's
transcript, its pins and its history floor are all that chat's, so a helper
sees the conversation it is in and no other.

### Dirty bit + cooldown

Unchanged from `new-y` §8, keyed on `project_agents.id`:

1. Set `response_pending = 1`.
2. If this agent is already mid-fire, stop — the in-flight fire re-checks the
   flag when it finishes.
3. Else if `cooldown_until` is null or past, fire now.
4. Else schedule a wake at `cooldown_until`.

Cooldown is 5 s, measured from the *end* of a response. Wake timers live in an
in-process `Map`; a restart loses scheduled wakes (accepted).

### Fire

1. Clear the pending flag, mark the agent as firing.
2. Check the studio budget. If exhausted, post a `'system'` banner and return
   without calling the API.
3. Build context (below).
4. Run the tool loop, streaming `agent.stream.chunk` deltas as they arrive.
5. Persist one `messages` row, one git commit covering every file the turn
   wrote, and one `message_writes` row per path.
6. Add the turn's tokens to `studio_state`.
7. Broadcast `message.new`, `agent.stream.end`, and `files.changed`.
8. Unmark firing, set `cooldown_until = now + 5 s`, re-check the pending flag.

The tool loop (step 4) and the persisting (steps 5–7) are functions of their
own, `runLoop` and `persistReply`, because the builder's room runs them more
than once per fire.

### The builder's room: sizing and pieces

Everything above is any room's. `Building` — the *builder*'s room, every game's
(§3) — sizes a message before answering it, because the measurement behind it
(§14) is that a helper thinks in proportion to the ask: a whole game at once
thinks until the budget is gone; one piece of it thinks for a second. The
design is ideas/planner.md; the four probes are §14.

**Sizing.** One `complete()` — the microhelper shape (§6) — with the fire's own
system prompt, no tools, thinking off, `response_format` json_object as a belt
and the prompt's own ask as the braces, parsed defensively. The ask rides the
last user message *after* everything else on it, for two measured reasons: the
system prompt stays byte-identical to the fire's and so shares its cache
prefix, and an attachment placed ahead of the ask swamped it. It answers
`{"size":"small"}` — one change, or a question or a remark — or
`{"size":"big","pieces":[{title, files, what}]}`, two to six pieces, each a
job one helper finishes in one sitting leaving the game runnable. An answer
that will not parse, or an upstream that will not answer, is small: today's
fire, the cap behind it. Charged to the asker like the fire it goes ahead of.

**Small** is the ordinary fire, at the builder's own thinking level (`low`).

**Big** is a **plan**: a message of kind `'plan'` by the builder — its own words
in the transcript, *That's a big one — I'll do it in N pieces*, and the list —
over a `plans` row (§3), shown as a checklist that ticks. Then one fire per
**piece**, in order:

- A fresh context from disk, **narrowed**: the transcript is the one `[studio]`
  turn naming the request, the plan, what the earlier pieces said they made,
  and this piece — *do only this piece, then stop with a one-line note* —
  never the chat's history; and the file block sends whole only the files the
  plan named for this piece plus `BRIEF.md`, `SPEC.md` and `config/`, listing
  the rest for `read_file`. A prompt small enough to read whole in the receipt.
- Thinking `none`: measured at this scope, 8–9 s and a one-line note every
  time, against 8–37 s at `low` (§14). A piece is where the plan already did
  the thinking.
- Its own message row (the note, or *Piece i of N: title* when it said
  nothing), its own commit (`Builder: piece i of N — title`), its own receipt,
  and a `plan.update` (§9) as it lands. A piece that hit a limit still counts
  as done: what it wrote is on disk and the next piece builds on it.

**Interruptions.** A message arriving mid-plan sets the dirty bit as it always
did; the running piece finishes, the plan is **paused** with a banner saying
after which piece, and the fire the message re-arms sizes it with the pieces
still to do in the ask. Then: `{"size":"small","resume":true}` — a remark or a
question — is answered and the plan carries on; `resume:false` — *stop* — is
answered and the plan is set aside; big replaces the plan, the old one marked
`dropped`, the pieces still to do folded into the new list as the message asks.
Running out of a day's tokens pauses the same way, and a piece's stream dying
with nothing to show pauses too. A restart pauses every running plan on open
(§3): the next message in that chat picks up the rest.

**The cap in this room.** A small ask whose first turn trips the thinking cap
hands its trace to the sizing call as notes, ahead of the ask; big, and it is a
plan that keeps the trace's decisions (measured: every plan kept the trace's
own file layout); still small, and the retry carries the trace as any room's
does. Either way the abandoned trace is charged.

**What is not in this room.** Other helpers: `assertBotsAllowed` refuses them,
the `+` and the rename are not offered, and the Crew tab does not add into it.
The builder's chip has no `···`. Everything else — pins, runtime errors,
continuations on a small ask, the receipt — is as in any room.

### Context

DeepSeek's context window is 1,048,576 tokens (§14) — three orders of
magnitude more headroom than the original design assumed. So an agent is given
the **whole project** by default rather than only the files a human
remembered to attach. Pinning becomes emphasis, not the sole channel.

The system prompt is, in order, **most stable part first** — the ordering is
what prompt caching pays for (below):

1. A fixed studio preamble: what this app is, the project slug, the path rules
   from §4, how each tool behaves, a nudge to prefer `patch_file` over
   rewriting whole files, the project documents and file layout it is expected
   to keep (below), each held library's API note followed by the **shape of a
   game** those notes are for, two paragraphs on **method** (both below), and
   a section for the game's *type* when it has one — a visual
   novel is told what `config/story.js` is, that the person writes it in the
   "story editor" tab beside the chat, and that a picture is asked for by the
   name the story gives it — and a note that games run on a separate origin so
   absolute URLs back to the studio will not resolve. Fixed per project rather
   than per fire, so it caches like the rest.
2. `BRIEF.md`'s content, if the file exists, cut to `BRIEF_BYTES` with a note
   saying where it was cut.
3. The agent's `description`.
4. The **files**, each emitted exactly once between
   `--- FILE: <path> (<size>) ---` and `--- END FILE ---` markers, least
   recently modified first: the files being worked on sit at the tail, so a
   commit invalidates the cached prefix from the oldest file it touched
   rather than from the top of the block.
5. The **file tree**, last: every path with its size, binary files as
   `[binary: <path>, <size>]` — the agent learns they exist without receiving
   bytes it cannot read — plus the left-out and library lists. A path already
   on disk that §4 validation refuses is listed and marked
   `[cannot be opened: …]`: no tool can touch it and the games origin will not
   serve it, so an agent that could not see it would have no way to explain
   why it 404s at runtime. The tree carries every size, so it changes whenever
   any file does — which is why it trails the contents: at the head of the
   block, where it used to sit, it re-billed every file behind it as a cache
   miss on every commit.

`BRIEF.md` therefore arrives twice: once as item 2, capped, and once in the
file block as an ordinary file. That is deliberate rather than an oversight —
one filename special-cased out of the file block would be a silent omission of
exactly the kind §8 otherwise refuses to make, and a typical brief is 2 KB
duplicated at a 100% cache hit rate.

The final user message carries, in order:

1. The **runtime errors** for the current commit, one per line, omitted
   entirely when there are none (below).
2. A line naming the **pinned files**, omitted when nothing is pinned.
3. The human's message body.

Errors and pins sit here rather than with the files because they change on
every playthrough and on every human turn: in the system prompt they would
invalidate the file block behind them on every fire.

A **pinned file** is a path in the current turn's `context_paths`, or in
either of the previous two human turns'. Pinning is **priority, not
exemption**: pinned files are offered to the byte cap first, then the rest,
each group smallest-first, so the largest files are the ones dropped and the
whole block is bounded by `AMBIENT_BYTES`. Pinning decides selection, never
emission: the block keeps its stable order and the last user message is what
names the pins, because a label inside the block moved with every human turn
and re-billed everything behind it as a cache miss. Content is always read
fresh from disk at fire time, never from the message the human sent. Dropped
files are named in the prompt with a note to call `read_file` — a dropped
*pinned* file is still named as pinned, since it is still what the human is
pointing at.

Earlier chat turns map to OpenAI roles: this agent's own messages become
`assistant`, everyone else's become `user` prefixed with `[Name] `. History is
trimmed oldest-first to fit its budget — and past it, back to half, so the
boundary can then hold still: a seam cut exactly to the cap moved one message
per fire, and the seam line at the transcript's front re-billed the whole
transcript as a cache miss every time. The boundary only advances, held in
memory per project; a restart re-derives it, which costs one fire of misses.
The seam is marked twice — a
`[studio]` turn at the front of the transcript saying how many messages are not
shown, and `messages.trimmed` on the reply, which the UI renders under the
bubble (§3). Silence there was the one drop in the whole context that nobody was
told about, agent or human: a dropped file is named, a trimmed conversation just
began later than it had before. Past turns'
tool calls are not replayed — only the persisted reply text — so history stays
compact and no stale `tool_call_id` can dangle.

Budgets, in one constants block so they are easy to retune:

| constant | value | ≈ tokens | governs |
|---|---|---|---|
| `AMBIENT_BYTES` | 400 KB | ~115 K | the whole file block, pinned included |
| `HISTORY_BYTES` | 200 KB | ~57 K | replayed chat turns |
| `BRIEF_BYTES` | 32 KB | ~9 K | `BRIEF.md` in the system prompt |
| `LOOP_GROWTH_BYTES` | 512 KB | ~146 K | what the tool loop may add per fire |
| total request | ~1.2 MB | ~350 K | worst case, everything binding at once |

Every one of these is measured in **bytes, not tokens**, and they are
independent and additive: nothing counts tokens or checks the sum against the
1 M-token ceiling. The table is the proof that the sum cannot reach it. The
caps that matter are the last two — before them, `BRIEF.md` and the tool loop
were the two places one fire could grow without limit.

Prompt caching is why the file block is in the system prompt and not on the
last user message, where it used to be. Measured against the live API with a
62 KB project (`tmp/probe-cache.mjs`), on 24.5 K-token prompts:

| case | cache hit |
|---|---|
| turn 2 of one fire, file block on the last user message | 99% |
| the next fire, file block on the last user message | **0%** |
| the next fire, file block in the system prompt, no file changed | **100%** |
| the next fire, file block in the system prompt, one file changed | 0% |

On the last user message the block sat behind the whole transcript, so the
history arriving in front of it moved it and every fire was charged as a full
miss — 0%, not even the preamble, because the surviving prefix was too short to
register. In the system prompt the prefix a second fire matches on includes the
files.

A file changing is subtler, and was measured separately against the real
space-racer tree (`tmp/probe-order.mjs`, 10 K-token prompts). The cache serves
a partial prefix only back to a **branch point** — a depth where an earlier
request already diverged (§14) — so the *first* edit at a given depth is a
full miss under any ordering. But a working session edits the same files fire
after fire, and with the contents coldest-first and the tree last, that depth
stops moving:

| case | tree first, alphabetical (old) | coldest-first, tree last |
|---|---|---|
| next fire, no file changed | 100% | 100% |
| first edit of the tail file | 0% | 0% |
| second edit of the same file | 0% | 42% |
| third and every later edit | 0% | **94%** |

The old shape diverged at the size-stamped tree a few blocks in, so its branch
point bought almost nothing and an edited fire was a full miss forever. The
62 KB measured is well under `AMBIENT_BYTES`; a 400 KB system prompt has not
been tried.

### Project documents

The preamble asks an agent with file tools for a shape rather than leaving it
to guess one, because left to guess it writes a single enormous
`index.html` — the games built here before the preamble asked were exactly
that, one of them 62 KB in one file, which is also the file most likely to be cut off
half-written (§14). So it asks for `index.html` holding markup only, `css/`,
and one file per part of the game under `js/`, a few hundred lines each.

`config/` is the part a person tunes without reading code: `play.js` for
movement and timings, `world.js` for level or board data, `look.js` for colours
and sizes, `words.js` for every string the player sees, `controls.js` for which
button does what (§6, Files). The preamble asks for
plain `const NAME = value;` declarations — numbers, strings, booleans, and
lists or groups of those, with a comment on each value — because the studio
opens these files as a **config form** rather than as text (§6, Files).

Agents change config files whenever the game needs it; the earlier idea that
they should never rewrite one was wrong, since adding a level or a line of
dialogue *is* the job. Two narrower rules replace it: keep the comment when you
change a value, because that comment is what makes the file readable by a
ten-year-old; and prefer `patch_file` for a single value. A human editing at the
same time is not a prompt problem at all — it is the `If-Match` conflict already
in the file routes (§6), which the form uses like the text editor does.

The preamble also names **every studio affordance an agent cannot reach on its
own**, by the words on the button. An agent that does not know a person can draw
a sprite in one click writes the game without one, and an agent that does not
know `js/input.js` exists writes its own `keydown` handler beside it — so the
capability may as well not exist. That makes the preamble the place these are
kept in step, and `test/orchestrator.test.js` asserts each one is present:

| what an agent cannot do | what it is told to say |
|---|---|
| make or change a picture or a sound | ask for the path by name, and name the button — `Add a file`, and which of its choices: `+ Draw a picture`, `+ Make a sound`, `+ Upload` |
| change a *studio library* | call it, say what needs changing, and load it with its `<script>` tag when writing `index.html` |

Naming a capability is not the same as asking for it to be used, and the
difference cost a game. Each library's **API note** says what its calls do and
nothing says a game is *expected* to make them, so an agent reading six notes
reads six optional conveniences: one hand-rolled its own title screen,
game-over banner, restart and controls hint rather than calling any of them.
So the notes are followed by the **shape of a game**: the title and
game-over screen are one call with the score as the difference, the HUD strip
is `Screens.chips`, a frame begins with `Input.update()`, choosing `SCHEME` is
the game's job, `Moments.say` goes on the line where the thing happens. ⚠️ Each
line is gated on the manifest exactly as the notes are — a game without
`screens.js` is told nothing about `Screens`, because a call into nothing is
worse than silence — and `test/orchestrator.test.js` asserts both the presence
and the gating.

Two paragraphs on **method** sit beside the turn budget, and both were paid for
by the same fire. The preview reports what a game throws back into the next
turn (below), which an agent had no way to know, so it guessed instead: nothing
is tested until somebody presses play, and asking them to is part of the job.
And a design is settled before it is written — the same fire spent many turns
patching a file it had written minutes earlier without ever reading it back.

One exception is worth stating, because it is easy to get wrong in both
directions: `.svg` is in the text extensions, so `write_file` and `patch_file`
do work on it and an agent *can* make that one kind of picture. The preamble
says so, and says a sprite is still a person's job.

Three **project documents** live at the root, next to the code. They are notes
for the people and agents working on the game and never part of the game
itself:

| file | what it holds | when it is written |
|---|---|---|
| `BRIEF.md` | the file map: what each file is for, how the pieces fit | whenever a file is added, moved, or repurposed |
| `SPEC.md` | what the game is and how it works: rules, controls, screens, settled decisions | when a decision changes |
| `TODO.md` | one task per line | only when the list is long enough to be worth staging |

`BRIEF.md` is the only one injected into the system prompt (above), which is
why it is capped and why the preamble asks for it to stay short. `SPEC.md` and
`TODO.md` ride in the ambient file block like any other file — small, so
smallest-first selection always includes them, and pinnable when a human wants
to point at one.

Every way of starting a game now scaffolds a `BRIEF.md`, and the earlier answer
here — that a new project should be created without one — was wrong in the one
case it was actually tested on. A template's brief describes *that* template's
setup: which libraries it uses, and, more usefully, which it deliberately does
not and why, so the shape section above does not get a helper "fixing" a DOM
quiz onto `Screens.title`. The blank page ships one too, written by
`scaffoldStart` beside the page: it is the only place that says which script
tags that page carries, and that the *control scheme* named in
`config/controls.js` is one somebody chose when the game was made — so an
agent reads it before writing input code and changes it only if asked, rather
than treating it as a default to improve on. No `{{name}}` in it — that substitution is HTML-escaped, which is right
for the page and wrong for markdown. `SPEC.md` is a template's to ship and
nobody else's; `TODO.md` is never scaffolded.

### Reasoning traces

Both models emit `reasoning_content` — a **reasoning trace** — alongside the
reply unless the agent's **thinking level** is `none`. It streams as its own
`agent.stream.reasoning` event and renders in a dimmed collapsible block, stuck
to the newest thought: the block is a few lines tall and a trace runs to
hundreds, so left alone it shows the first ten lines for as long as the helper
thinks, which is what made a working nine-minute reply look like a stopped one.
The line under the name counts the thinking — `thinking, 2m 14s` — off the
deltas themselves rather than a timer, so it stops when they do.

Thinking is bounded twice. The level (§14) decides how hard it thinks at all,
and the **thinking cap** stops a turn whose trace runs past
`THINKING_CAP_CHARS` (35,000 — near 10 K tokens at 3.5 characters each, about
90 seconds at the rate measured in §14) with nothing else produced: the stream
is closed, the same turn is asked again with thinking off **and the trace in
hand** — a `[studio]` note on the user turn saying what it had worked out so
far and to carry on from there — and a `'system'` banner says so. Measured
(§14): the retry without the trace acts at once but under-delivers, one file
where the design had eight; with it, the design is followed. In the builder's
room a cap on the *first* turn goes to the sizing call instead (below): a
request that thought that long wanted splitting. The cap is characters rather
than tokens because `reasoning_tokens` is only reported when the stream ends,
by which time the whole allowance is spent. It is off once the turn produces
content or a tool call, since a trace interleaved with real output is a turn
that is working.

The cap sits above the traces `'low'` actually produces (1,597 and 6,886
tokens in §14's runs), so what it mostly catches is a helper left on `'full'`.

⚠️ **`max_tokens` is not the dial to turn here, and lowering it is worse than
leaving it.** The trace is generated before the reply and the tool calls, so a
smaller ceiling rations the *files*, not the thinking: measured at 32,768, one
run spent 25,004 on reasoning and had its fifth `write_file` cut off
mid-arguments, committing a game with a file missing, where the same prompt at
65,536 finished all eight cleanly (§14). A capped trace is a visible failure
with a banner on it; a truncated tool call is a silent one.

The abandoned attempt does not count as a turn but **is** charged, from
`tokensForChars` over the trace the stream watched go past. No usage frame
arrives for a stream nobody let finish, so there is nothing exact to bill;
the tokens were generated and the key is paying for them regardless. Only the
trace is estimated — the prompt behind it was billed too and there is no count
to put on it — so the studio still undercounts a capped turn, by less.

It is **never persisted** to `messages.body` and **never sent back** in a
later fire's history. Both rules matter: it would bloat the database and
DeepSeek's own guidance is not to feed traces back as context. What survives a
turn is the reply text and the file writes. The one time a trace enters a
request is the hand-on above — the same fire, once, as text — and the receipt's
prompt carries a placeholder naming its length where it rode, so the trace is
in no row anywhere.

### Runtime error feed

An agent cannot be shown its game. DeepSeek rejects every image content shape
(§14), so this is not a matter of producing a screenshot — it could not be
sent. Everything an agent learns about the running game therefore arrives as
text, and this is the channel.

The **reporter** is a small script that runs inside the game. It is not a file
in the working tree and not a tag in the game's markup: the games listener
serves the project's own `index.html` with the reporter injected at a reserved
path, `/<slug>/_studio.html` (§6), and the studio's preview iframe points
there. The **wrapper** is that document. Nothing else uses it — the public
plays `/<slug>/`, whose bytes are exactly what is on disk.

The studio cannot inject the script from the browser: `contentDocument` is null
across origins, and anything that let the studio reach into the frame would let
the frame reach back into the studio (§7). Server-side injection is the only
place this can happen, which turns out to be the better place anyway — no game
is edited, none can lose it, no agent has to know it exists, and every game
that predates the feature reports without being touched.

Inside the game the reporter catches uncaught errors, failed resource loads
(capture phase — a `<script>` that 404s never reaches `window` otherwise) and
`console.error`, and posts each distinct one to `window.parent`. It reports
only when framed, never throws, and sends each distinct problem once per page
load, capped at 20 — a game that throws inside its animation loop would
otherwise report sixty times a second.

Each report carries the **version the wrapper was built from**. That is what
files a problem against the code that actually caused it rather than against
whatever HEAD happens to be when the report lands, and it is why a fixed error
cannot come back as a current one: `POST /errors` drops any report whose
version is not the current one, because the preview is already reloading and
anything still broken will say so again. The wrapper reads HEAD *before*
reading `index.html`, so a commit landing in between makes the version older
than the bytes — losing a report, which is safe, rather than mislabelling one,
which is not.

The version is HEAD's sha — or, while the project's *pending commit* is open
(§5), `<sha>:<n>` for the n-th save on top of it, so the bytes a preview is
running always have a name whether or not they are committed yet, and each
save is a new version the way each commit used to be. When the window lands,
the rows filed under its last stamp are re-keyed to the commit they became,
and a report still carrying that stamp is taken as HEAD's until the next save
opens a new window. ⚠️ Without this, the moment a run of saves landed every
problem the preview had reported against them would have belonged to a version
that no longer existed.

The studio page checks the sender's origin against the games origin and the
message's slug against the open project, batches for 500 ms, and posts. The
list is broadcast as `game.errors` and painted into the panel under the preview
**without a re-render**: rebuilding the tree rebuilds the preview iframe, which
restarts the game, which reports its problems again — a loop that does not
settle. This is the same reason a streaming reply mutates its nodes. The panel
is rendered whether or not the preview is folded away, because problems from
before it was folded are still the answer to why the game is broken.

The same reporter also forwards the game's **moments** — what `Moments.say()`
dispatches on the window (§4, *moments library*). It listens for the `moment`
event, so it hears every one without knowing the library exists, and posts the
latest value per name a few times a second, at most fifty names a batch. The
studio keeps them per game for the session and paints a chip per name under the
problems panel — **in place, never through `render()`**, for the same reason the
problems are: a moment said at startup, drawn through a render, would rebuild
the frame, restart the game and say it again. The point of showing them is the
*achievements editor*, which offers the names the game has been seen to say. A
moment reaches the studio page only; it never reaches an agent's context (a
score is the model — talk about the work, not the work), and the games origin
never sees one, only the unlock a rule made of it (§3, §6).

Two things the wrapper does not cover. A game that navigates its frame to a
second page leaves the wrapper behind and stops reporting until it returns. And
what the studio previews differs from what the public plays by exactly one
injected script — close enough for every practical purpose, not identical.

⚠️ Everything in this feed is text from LLM-written game code, arriving over
`postMessage` from a public origin. It is capped, stripped of control
characters, and only ever rendered as text — but it does reach an agent's
context, so a game can put words in front of its own helpers. It could already
do that by writing a file, so this adds reach, not a new capability.

### Tools

Offered whenever `file_tools = 1`. No model gating is needed — both DeepSeek
models support function calling, including parallel calls in a single turn
(§14), so an agent can write several files at once and cut loop iterations.

| tool | args | behaviour |
|---|---|---|
| `write_file` | `path, content` | create or overwrite, whole file |
| `patch_file` | `path, old_text, new_text` | exact replace; errors unless `old_text` occurs exactly once |
| `read_file` | `path` | a file the byte cap dropped, or one at an older commit |
| `delete_file` | `path` | remove; recoverable from git |

Every tool validates its path per §4 and returns an error string to the model
on violation rather than throwing — a confused agent gets a correction, not a
dead turn.

Bounded loop: at most 24 assistant turns, 40 tool calls, and
`LOOP_GROWTH_BYTES` of appended messages per fire. On hitting any of the three
the turn ends with a `'system'` banner noting it stopped early.
Both numbers are runaway guards, not a work allowance — the daily token budget
is what caps cost. The original 8/12 proved too tight in use: the "stopped
after 8 turns without finishing" banner became routine. DeepSeek usually emits
one or two calls per turn, so turns bind first and 12 tool calls were rarely
reached, while a whole small game — an `index.html`, a stylesheet, four or
five scripts, and a read or two before patching — needs more than eight. The
preamble states both numbers to the model so it can batch its calls and wrap
up rather than being cut off mid-file.

The byte guard is the one that bounds the request itself. Everything else in
the context is capped once per fire; the loop is the part that grows as it runs
— 40 reads at 128 KB each, plus every file it writes echoed back in the
assistant turn that wrote it, which is the only route by which a single fire
could have walked the model's window. On hitting it the loop stops rather than
dropping earlier messages: a dropped message orphans a `tool_call_id`, and the
recovery is a continuation, which rebuilds its context from disk and so starts
light again.

Running out of turns is not the end of the reply. The agent may **continue**
itself up to 3 times, counted from the last human message and reset by the
next one, so a half-built game finishes without a human typing "keep going".
A continuation is armed by posting the `'system'` banner and setting
`response_pending` again: a `'system'` row enters the transcript as a user
turn (§8, Context), which is exactly what gives the next fire something to
answer — without one, the agent's own reply would be the newest turn and the
fire would no-op. The daily token budget is rechecked before each one.

`max_tokens` is set to the full 65536 ceiling per request, not to a lower cost
guard. **`completion_tokens` counts the reasoning trace as well as the reply
and the tool call arguments**, so a cap set below the ceiling mostly rations
thinking and leaves the files whatever is left over. Measured on "make me a
tank game" against `deepseek-v4-flash`: at 32768, 25,004 tokens went to
reasoning, the fifth `write_file` was cut off mid-arguments, and the game
would have been committed with a missing script. The same prompt at 65536
spent 38,590 on reasoning and finished all eight files with
`finish_reason: 'tool_calls'`. The earlier claim here — that 32 K carries
roughly 130 KB of markup, so truncation is not a practical concern — assumed
the whole allowance was available to file content, and was wrong.

The HTTP client's timeout is an **idle guard**, re-armed every time bytes
arrive, not a deadline on the whole request: it fires only when nothing has
arrived for two minutes, and surfaces as an `LlmError` naming the stall. It
used to be a hard ten-minute ceiling, which is exactly how long a healthy
big turn — a full reasoning trace plus several files — can stream, so it
aborted real replies mid-flight. Between chunks the gap is sub-second, and
the longest legitimate silence is prompt processing before the first token,
seconds even on a full cache miss. It is re-armed by **bytes**, not by
content, which is only safe because the stream carries no keep-alive frames —
measured, since a single comment frame every few seconds would hold the guard
open for ever (§14).

Truncation is still detected, and now recovered from rather than only
reported. A tool call cut off mid-arguments wrote **nothing** — the JSON never
parsed, so there was no path and no content — but the model's own reply says
it wrote the file. So the orchestrator feeds it a studio note saying the call
was cut and nothing was saved, and the loop continues so it can write the file
again in smaller pieces. Only a cut still outstanding when the loop ends
produces the `'system'` banner; one that a later turn rewrote successfully is
not a missing file and is not reported. Non-streaming truncation drops the
tool call entirely; the streaming path can deliver partial argument fragments,
so both cases are handled.

A stream that dies mid-fire — the connection dropped, the request aborted —
is salvaged rather than discarded. Whatever was said up to the failure is
persisted as the message, files already written are committed and credited
to it, and a `'system'` banner says the helper was cut off. No automatic
continuation: retrying a dead upstream can loop on the failure, so carrying
on is the human's call. Only a fire with nothing said and nothing written
ends as a bare `agent.stream.end {error: true}` with no message row — and
when a row lands, the end event carries its id and no error flag, because
the client treats an error after `message.new` as a fresh live entry that
nothing would ever clear.

⚠️ **A fault that is not the stream ends the fire the same way.** A fire is
called from a timer and its caller can only print, so anything thrown between
the start event and the end event — a git commit that cannot take the lock, a
database that will not write, a full disk — used to end as a console line with
the browser still saying "Thinking…" for ever: the start event had gone out
and nothing was ever going to answer it. None of those are the stream failing,
so none of them reached the salvage path above. A `catch` around the whole
fire now emits `agent.stream.end {error: true}` — but only if a start event
went out, since an error end with nothing live *creates* the ghost entry the
paragraph above is about — and then posts a `'system'` banner. The end event
goes first, because it is the part that cannot fail while the database is a
candidate for what just broke.

The other silence it closes: a fire that ends cleanly having produced no
prose, no files and no limit — the model simply said nothing — used to emit a
bare end event that took the live entry away and left no word behind. It gets
a `'system'` banner too. Nothing an agent does should be able to remove the
row without replacing it with a sentence.

A long chain **sheds** its reasoning pile. DeepSeek re-attaches everything it
has said in the current tool-call chain — reasoning included — to every
continuation, billed as cached input (§14), so a marathon fire pays a tenth
of an ever-growing pile on each request. When another round is coming and
carrying the pile a few more rounds (`SHED_HORIZON_ROUNDS`) would cost more
than re-paying the visible tail once, the loop appends a one-line `[studio]`
housekeeping note as a user turn — the same shape as the cut notice — which
closes the chain and drops the pile from billing. Both sides of the rule are
runtime-visible: the pile from `reasoning_tokens` per request, the shed's
price from the bytes appended since the last one. A floor
(`SHED_FLOOR_TOKENS`, 8k) keeps short fires from ever shedding. The note is
never persisted, and the receipt counts the sheds.

Every persisted reply also leaves a **receipt** (`message_receipts`, §3):
the context half is captured in `buildContext` — bytes per system-prompt part,
files sent whole and left out, transcript size and trim — and the fire adds
per-request usage (cache hit, miss, output, one entry per turn) and the loop's
appended bytes. The prompt itself is captured at the top of each turn, before
the request is made, so what is stored is exactly what the last request
carried — the loop appends tool results it may never send. It is rendered as
labelled plain text, not the JSON body, and no reasoning trace is in it,
because a trace is never in a request to begin with. The UI opens all of this
from the token note under the bubble; cached tokens are shown counting a
tenth, so the lines visibly sum to the note.

### Budget

`studio_state.tokens_used_today` accumulates

```
prompt_cache_miss_tokens
  + ceil(prompt_cache_hit_tokens / 10)
  + completion_tokens
```

Cached prompt tokens are counted at a tenth to mirror DeepSeek's cache
pricing. Note that `prompt_tokens` already includes the cached ones, so
summing it with the hit count would double-charge — the miss/hit split is the
correct input (§14).

`completion_tokens` includes `completion_tokens_details.reasoning_tokens`; the
trace is discarded but it was still billed, so it is still counted.

If `budget_reset_at` has passed, the counter resets to 0 and the timestamp
advances to the next UTC midnight. Over budget: a `'system'` banner per failed
check, no API call.
