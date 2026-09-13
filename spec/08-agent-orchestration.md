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
5. Persist one `messages` row — its `body` the **reply**, the last turn's
   words, and its `working` the turns before it (below) — one git commit
   covering every file the turn wrote, headed by the reply's first line, and
   one `message_writes` row per path.
6. Add the turn's tokens to `studio_state`.
7. Broadcast `message.new`, `agent.stream.end`, and `files.changed`.
8. Unmark firing, set `cooldown_until = now + 5 s`, re-check the pending flag.

The tool loop (step 4) and the persisting (steps 5–7) are functions of their
own, `runLoop` and `persistReply`, because the builder's room runs them more
than once per fire.

### The reply and its working

A tool-using fire says something on most turns — *now I'll write js/tank.js*
— and used to keep all of it, joined, as the reply. A real receipt
(2026-09-03) showed where that goes: 167 KB of it across three builder
replies, replayed into the next fire as ~48 K new tokens and then carried at
a tenth on each of that fire's 24 requests, about half its bill, and a chat
nobody could read. So a reply is cut at its last turn. `messages.body` is the
**reply**, the last thing said — the note a helper leaves once it stops
calling tools — and `messages.working` is its **working**, everything said
before that. The body is what the thread shows, what the commit subject comes
from and what history replays; the working sits behind a `Working` panel
above the bubble, beside `Thinking`, fetched on open
(`GET /api/messages/:id/working`) and never replayed. Live, the client folds
each turn's words into the same panel as the turn ends — on `agent.tool`, the
same cut the server makes — so the bubble is a short line that changes rather
than a wall that grows. A stream that dies mid-turn leaves the dying turn's
words as the reply. A closing request for a synopsis was considered and
declined: ~10 K tokens a fire for a note the model already writes.

### The builder's room: sizing and pieces

Everything above is any room's. `Building` — the *builder*'s room, every
game's (§3) — sizes a message before answering it, since a helper thinks in
proportion to the ask (§14): a whole game at once thinks until the budget is
gone; one piece of it thinks for a second. Design: ideas/planner.md.

**Sizing.** One `complete()` — the microhelper shape (§6) — with the fire's
own system prompt, no tools, thinking off, `response_format` json_object as
a belt. The **rules** — what small and big mean, the shape of a plan, what
to do about a paused plan or a begun one — stand in the room's preamble under
`SIZING`, cached with the rest; the last user message carries only the
**trigger**, `[studio] Size this request.`, after everything else on it,
with a paused plan's pieces still to do under it when there are any. ⚠️
Short on purpose, though no longer forced: measured on V4-Flash (§14), a
last user message over ~160 tokens left the request after it the system
prompt less ~6,000 tokens, and the ~250-token ask that rode there until
2026-09-06 cost every fire in this room half its prompt. ⚠️ Re-measured on
V4.1 on 2026-09-13, that penalty is **gone** — an extension hits 89–96%
behind a last message of any length from 32 to 1,024 tokens — so the short
trigger is now the cheapest arrangement rather than the only affordable one,
and a capped trace or a begun note riding ahead of it costs its own tokens
and nothing more. It answers `{"size":"reply"}` — a
question or a remark — or `{"size":"pieces","pieces":[{title, files,
what}]}`: one piece for one change, two to six for more, each finishable in
one sitting. An answer that won't parse, or an upstream that won't answer, is
a reply — the plain fire, its cap intact — charged to the asker like the fire
it precedes. Until 2026-09-06 the words were `small` and `big`, and a plan of
one collapsed into small; `parseSizing` still reads them.

**The fire extends the sizing.** Every fire in this room — a small ask's
and each piece's — is the sizing's transcript with its answer as the
assistant turn and one more user turn on top: `[studio] Go ahead.` for a
small ask, the piece turn for a piece. Measured (§14): the fire then reuses
everything to the end of the system prompt, 96%, where a fire that drops the
trigger from the last message diverges at the tail of it and reuses half.
The answer rides the prefix at hit price, a few hundred tokens at most, and
the receipt's prompt shows the exchange. A sizing that failed leaves no
exchange, and the turn goes on as a user message of its own.

**A reply** is the ordinary fire, at the builder's own thinking level (`low`),
under a budget of its own: `SMALL_TURNS` turns and `SMALL_TOOL_CALLS` tool
calls (6 and 12, against a room's 24 and 40). The whole tree is already in
the prompt, so one change is a patch, a read-back and a note — three turns —
and six is twice that path. The room's preamble names the small pair, since
the sizing shares the prefix. A reply that uses the budget up was work after
all: what it did is kept and committed as any reply is, a banner says it
turned out bigger than one go, and what is left goes back to the sizing with
the files it changed and its working as notes, ahead of the trigger
(`begunNote`), told to size the rest rather than the whole. Pieces, and a plan
for the rest runs — its card says so. A reply again, or no answer, and the
builder carries on the way any room does, one more go and sized again first,
so the next overrun gets another chance at a plan; bounded by the same
continuation count. There
is no other continuation in this room: the plan is the continuation. The
sizing's file block is the fire's, from before it wrote — that is the cache
prefix — so the note *names* the changed files rather than showing them, and
the pieces see what changed as fresh copies on their turns (below). Why: a
real receipt (2026-09-03) showed an ask sized small running to 24 turns and
carrying on.

**Pieces** is a **plan**, of one piece as often as of six: a message of kind
`'plan'` by the builder — *One piece:* or *That's a big one — I'll do it in N
pieces*, and the list — over a `plans` row (§3), shown as a checklist that
ticks. The card is the plan's one reply. Each piece's own row is filed behind
it (`messages.plan_message_id`, §3): left out of the thread and of history,
opened from its line on the card by id (§6), keeping its commit, its receipt
and its working. The card's token note is the pieces' summed, written onto
the card's row as each lands, so the plan costs what a reply shows itself
costing; each piece's receipt stays on its own row. ⚠️ The sizing and the
confirmation are billed and shown on no row — the same as a small reply,
whose note is its fire's alone. As a piece lands the card's body is rewritten from the plan
— its head, then per piece the title, the files it changed and its
**headline**, the closing paragraph of its reply — because the body is what
the thread shows for the plan and what history replays; the piece turn asks
for that paragraph, and `plan.update` (§9) carries the same shape. A plan of
one runs at once at the builder's own level, since no plan thought for it; a
plan of two or more waits as a draft (below) and its pieces run at `none`.
Then one fire per **piece**, in order:

- The sizing's **own system prompt**, byte for byte — the files as they were
  when the turn began, never narrowed to the piece and never rebuilt from
  disk — and its exchange, with this piece's turn on top: the request, the
  plan, what earlier pieces said they made, this piece (*do only this piece,
  then stop with a one-line note*), and **fresh copies**: the current whole
  text of any file this piece names that has changed since the block was
  read, the other changed files by name, a deleted one said so. Copies,
  never diffs: `patch_file`'s `old_text` must match the file as it is now.
  A copy over `FRESH_COPY_BYTES` is named instead, and a file the cap left
  out of the block is never "changed". Measured (§14) against a narrowed
  block and a block rebuilt per piece, on real tool loops: the only shape
  where every piece's first request hits — 87–98% after the first — at half
  the cost, because the other two diverge inside the system prompt at a new
  depth on every piece.
- Thinking `none` in a plan of two or more: 8–9 s and a short note every
  time, against 8–37 s at `low` (§14) — a piece is where the plan already did
  the thinking. A plan of one at the builder's own level.
- Its own message row behind the card, commit (`Builder: piece i of N —
  title`), receipt, and `plan.update` (§9) as it starts — the piece marked
  `running` *before* its stream's start event, so the card's line is where
  the live reply is born rather than the foot of the thread — and as it lands.
  A piece that hit a limit still counts as done: what it wrote is on disk and
  the next piece builds on it.

**A draft.** A plan of two or more pieces waits (`status = 'draft'`): nothing
runs and nothing is charged until **Build it**, one click and no
confirmation, since building is not destructive. The card holds the plan's
words — a **summary**, one paragraph saying what it is, and the
**assumptions** the planner made where the request left things open, both
asked for in the sizing rules — and the pieces, and all of it is the
person's to change while it waits: fields on the card, a `···` per piece
with Move up, Move down and Remove, one bordered `Add a piece`, each edit a
`PATCH /api/plans/:id` (§6) held to the sizing's own shapes. Assumptions
rather than questions: an interview costs a turn per question and a kid's
patience, and a decision written down is one click to accept and one edit to
overrule. A piece's files stay the planner's and are advisory, since a piece
sees the whole tree. A paused plan opens the same card for its pieces still
to do, its button reading *Carry on*; a plan of one never waits. A new plan
takes the place of a draft as it does of a paused plan.

**Build it** hands the plan to the builder as its next fire in the room
(`buildPlan`), charged to whoever pressed. First, a game with no `SPEC.md`
gets one written from the plan's words — the summary, the decisions, the
pieces — as the builder's own commit: a game's first Build is its spec moment,
and a person's approved words beat a spec the model invents in piece one. A
template's spec stands and a later plan never touches it. The context is read
after the write, so the block the pieces run on carries it. Then one request
the pieces extend (§14): for a plan built as written, `[studio] Build the
plan above as written. Answer {"ok":true}.` — short, the plan being the card
in the transcript already, and it makes piece one an extension rather than a
cold start; for a plan the person changed, a sizing over their words, told to
keep them and fill in each piece's files, splitting a piece only when it is
too big for one sitting, whose answer becomes the pieces still to do. Then
the pieces, on the room's own path. The press is refused while the builder is
mid-fire in that room, since it would land on a fire already running.

**Interruptions.** A message arriving mid-plan sets the dirty bit as usual;
the running piece finishes, the plan **pauses** with a banner saying after
which piece, and the message's fire sizes it with the pieces still to do in
the ask. Then: `resume:true` (a remark or question) carries the plan on;
`resume:false` (*stop*) sets it aside; big replaces it, marking the old one
`dropped` and folding its remaining pieces into the new list. Running out of
a day's tokens pauses the same way, as does a piece's stream dying with
nothing to show. A restart pauses every running plan on open (§3): the next
message in that chat picks up the rest.

**The cap in this room.** A small ask whose first turn trips the thinking
cap hands its trace to the sizing call as notes; big, and the plan keeps the
trace's decisions (measured: every plan kept its file layout); still small,
and the retry carries the trace as any room's does. Either way the abandoned
trace is charged.

**What is not in this room.** Other helpers: `assertBotsAllowed` refuses
them, the `+` and rename aren't offered, the Crew tab doesn't add into it,
and the builder's chip has no `···`. Everything else — pins, runtime
errors, continuations on a small ask, the receipt — is as in any room.

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
file block as an ordinary file. Deliberate, not an oversight — special-casing
one filename out of the file block would be exactly the silent omission §8
otherwise refuses, and a typical brief is 2 KB duplicated at a 100% cache
hit rate.

The final user message carries, in order:

1. The **runtime errors** for the current commit, one per line, omitted
   entirely when there are none (below).
2. A line naming the **pinned files**, omitted when nothing is pinned.
3. The human's message body.

Errors and pins sit here rather than with the files because they change on
every playthrough and on every human turn: in the system prompt they would
invalidate the file block behind them on every fire.

A **pinned file** is a path in the current turn's `context_paths`, or either
of the previous two human turns'. Pinning is **priority, not exemption**:
pinned files are offered to the byte cap first, then the rest, each group
smallest-first, so the largest files are the ones dropped and the whole
block stays bounded by `AMBIENT_BYTES`. Pinning decides selection, never
emission — the block keeps its stable order, and the last user message
names the pins instead, since a label inside the block would move with
every human turn and re-bill everything behind it as a cache miss. Content
is always read fresh from disk at fire time, never from the human's message.
Dropped files are named with a note to call `read_file`; a dropped *pinned*
file is still named as pinned, since it's still what the human is pointing
at.

Earlier chat turns map to OpenAI roles: this agent's own messages become
`assistant`, everyone else's `user` prefixed with `[Name] `. History is
trimmed oldest-first to fit its budget, and past it, back to half — so the
boundary then holds still, where a seam cut exactly to the cap would move
one message per fire and re-bill the whole transcript as a cache miss every
time. The boundary only advances, held in memory per project; a restart
re-derives it, costing one fire of misses. The seam is marked twice: a
`[studio]` turn at the transcript's front saying how many messages aren't
shown, and `messages.trimmed` on the reply, rendered under the bubble (§3) —
the one drop in the whole context that isn't silent, since a trimmed
conversation still needs to say it began later than it had before. Past
turns' tool calls are not replayed, and neither is a reply's working — only
the reply, the last turn's words (above) — so history stays compact and no
stale `tool_call_id` can dangle.

Budgets, in one constants block so they are easy to retune:

| constant | value | ≈ tokens | governs |
|---|---|---|---|
| `AMBIENT_BYTES` | 400 KB | ~115 K | the whole file block, pinned included |
| `HISTORY_BYTES` | 200 KB | ~57 K | replayed chat turns |
| `BRIEF_BYTES` | 32 KB | ~9 K | `BRIEF.md` in the system prompt |
| `LOOP_GROWTH_BYTES` | 512 KB | ~146 K | what the tool loop may add per fire |
| total request | ~1.2 MB | ~350 K | worst case, everything binding at once |

Every one of these is measured in **bytes, not tokens**, and they are
independent and additive — nothing counts tokens or checks the sum against
the 1 M-token ceiling; the table is the proof the sum can't reach it. The
last two caps are the ones that matter: before them, `BRIEF.md` and the tool
loop were the two places one fire could grow without limit.

Prompt caching is why the file block is in the system prompt and not on the
last user message, where it used to be. Measured against the live API with a
62 KB project (`tmp/probe-cache.mjs`), on 24.5 K-token prompts:

| case | cache hit |
|---|---|
| turn 2 of one fire, file block on the last user message | 99% |
| the next fire, file block on the last user message | **0%** |
| the next fire, file block in the system prompt, no file changed | **100%** |
| the next fire, file block in the system prompt, one file changed | 0% |

On the last user message the block sat behind the whole transcript, so
history arriving in front of it moved it and every fire was charged as a
full miss — 0%, not even the preamble, since the surviving prefix was too
short to register. In the system prompt, the prefix a second fire matches on
includes the files.

A file changing is subtler, measured separately against the real space-racer
tree (`tmp/probe-order.mjs`, 10 K-token prompts). The cache serves a partial
prefix only back to a **branch point** — a depth where an earlier request
already diverged (§14) — so the *first* edit at a given depth is a full miss
under any ordering. But a working session edits the same files fire after
fire, and with the contents coldest-first and the tree last, that depth
stops moving:

| case | tree first, alphabetical (old) | coldest-first, tree last |
|---|---|---|
| next fire, no file changed | 100% | 100% |
| first edit of the tail file | 0% | 0% |
| second edit of the same file | 0% | 42% |
| third and every later edit | 0% | **94%** |

The old shape diverged at the size-stamped tree a few blocks in, so its
branch point bought almost nothing and an edited fire was a full miss
forever. The 62 KB measured is well under `AMBIENT_BYTES`; a 400 KB system
prompt hasn't been tried.

### Project documents

The preamble asks an agent with file tools for a shape rather than leaving
it to guess one — left to guess, it writes a single enormous `index.html`
(the games built here before the preamble asked were exactly that, one 62 KB
in one file, and also the file most likely to be cut off half-written, §14).
So it asks for `index.html` holding markup only, `css/`, and one file per
part of the game under `js/`, a few hundred lines each.

`config/` is the part a person tunes without reading code: `play.js` for
movement and timings, `world.js` for level or board data, `look.js` for
colours and sizes, `words.js` for every string the player sees, `controls.js`
for which button does what (§6, Files). The preamble asks for plain
`const NAME = value;` declarations — numbers, strings, booleans, and lists
or groups of those, each with a comment — since the studio opens these files
as a **config form** rather than text (§6, Files). ⚠️ **Every number and
every word the game uses lives in one, and none in `js/`**: the rule the
preamble leads the block with, repeated in the sizing rules (a piece names
the config file its constants go in among its files) and on every piece
turn, and the blank page's brief names the three files a new game has yet to
make. Said three times because the builder, told only what a config file
looks like, left constants in game code until a person asked each time
(2026-09-07).

Agents change config files whenever the game needs it — adding a level or a
line of dialogue *is* the job, which is why the earlier "never rewrite one"
rule was wrong. Two narrower rules replace it: keep the comment when you
change a value, since that's what makes the file readable by a ten-year-old,
and prefer `patch_file` for a single value. A human editing at the same time
is just the `If-Match` conflict already in the file routes (§6), which the
form uses like the text editor does.

One line says **where the game is on its arc** (§6, `public/arc.js`): how
many stamps it holds and which it is working towards, with that stamp's
principle, and the ask to suggest what belongs to it and say so when a
request belongs to a later one. Read from `projects.stage`, which a helper
never moves — the stamps are a person's judgement — and changing only when
one is pressed, so it costs the cache nothing between presses.

The preamble also names **every studio affordance an agent cannot reach on
its own**, by the words on the button — an agent that doesn't know a person
can draw a sprite in one click writes the game without one, and one that
doesn't know `js/input.js` exists writes its own `keydown` handler beside
it, so the capability may as well not exist. `test/orchestrator.test.js`
asserts each one is present:

| what an agent cannot do | what it is told to say |
|---|---|
| make or change a picture or a sound | ask for the path by name, and name the button — `Add a file`, and which of its choices: `+ Draw a picture`, `+ Make a sound`, `+ Upload` |
| change a *studio library* | call it, say what needs changing, and load it with its `<script>` tag when writing `index.html` |

Naming a capability isn't the same as asking for it to be used, and the
difference cost a game: each library's **API note** says what its calls do,
but nothing says a game is *expected* to make them, so an agent reading six
notes reads six optional conveniences — one hand-rolled its own title
screen, game-over banner, restart and controls hint rather than calling any
of them. So the notes are followed by the **shape of a game**: the title and
game-over screen are one call with the score as the difference, how big the
game is on the screen is `Screens.fit` rather than width css of the game's
own, the HUD strip is `Screens.chips` — meters and the game's own nodes
included, so nothing about a HUD is left worth hand-rolling — a frame begins
with `Input.update()`, choosing `SCHEME` is the game's job, `Moments.say` goes
on the line where the thing happens. ⚠️ Each line is gated on the manifest exactly as the notes are — a
game without `screens.js` is told nothing about `Screens`, since a call into
nothing is worse than silence — and `test/orchestrator.test.js` asserts both
the presence and the gating.

Two paragraphs on **method** sit beside the turn budget, both paid for by
the same fire: the preview reports what a game throws back into the next
turn (below), which an agent had no way to know, so it guessed instead —
nothing is tested until somebody presses play, and asking them to is part
of the job; and a design is settled before it is written, the lesson of a
fire that spent many turns patching a file it had written minutes earlier
without ever reading it back.

One exception is worth stating, since it's easy to get wrong in both
directions: `.svg` is a text extension, so `write_file` and `patch_file`
work on it and an agent *can* make that one kind of picture — the preamble
says so, and says a sprite is still a person's job.

Three **project documents** live at the root, next to the code, as notes
for the people and agents working on the game and never part of the game
itself:

| file | what it holds | when it is written |
|---|---|---|
| `BRIEF.md` | the file map: what each file is for, how the pieces fit | whenever a file is added, moved, or repurposed |
| `SPEC.md` | what the game is and how it works: rules, controls, screens, settled decisions | when a decision changes |
| `TODO.md` | one task per line | only when the list is long enough to be worth staging |

`BRIEF.md` is the only one injected into the system prompt (above), which is
why it's capped and why the preamble asks it to stay short. `SPEC.md` and
`TODO.md` ride in the ambient file block like any other file — small, so
smallest-first selection always includes them, and pinnable when a human
wants to point at one.

Every way of starting a game now scaffolds a `BRIEF.md`. A template's brief
describes *that* template's setup: which libraries it uses, and, more
usefully, which it deliberately does not and why, so the shape section above
doesn't get a helper "fixing" a DOM quiz onto `Screens.title`. The blank
page ships one too, written by `scaffoldStart` beside the page — the only
place saying which script tags that page carries, and that the *control
scheme* named in `config/controls.js` was chosen when the game was made, so
an agent reads it before writing input code and changes it only if asked
rather than treating it as a default to improve on. No `{{name}}` in it,
since that substitution is HTML-escaped, right for the page and wrong for
markdown. `SPEC.md` is a template's to ship and nobody else's; `TODO.md` is
never scaffolded.

### Reasoning traces

The model emits `reasoning_content` — a **reasoning trace** — alongside the
reply unless the agent's **thinking level** is `none`. It streams as its own
`agent.stream.reasoning` event, rendered dimmed and collapsible, stuck to the
newest thought: the block is a few lines tall and a trace runs to hundreds,
so left alone it showed the first ten lines for as long as the helper
thought — a working nine-minute reply that looked like a stopped one. The
line under the name counts the thinking (`thinking, 2m 14s`) off the deltas
themselves, not a timer, so it stops when they do; a tool call takes the line
over as it *arrives* (`agent.tool`, §9), with how much of the file has come,
and the sizing call names itself there, so a fire that is working never
stands still on the screen.

Thinking is bounded twice. The level (§14) decides how hard it thinks at
all, and the **thinking cap** stops a turn whose trace runs past
`THINKING_CAP_CHARS` (35,000 — near 10 K tokens at 3.5 characters each,
about **43 seconds** at V4.1's ~233 tokens/s, and about 90 at the ~90
tokens/s the number was first sized against) with nothing else produced:
the stream closes, the same turn is asked again with thinking off **and the
trace in hand** — a `[studio]` note on the user turn saying what it had
worked out so far — and a `'system'` banner says so. Measured (§14): the
retry without the trace acts at once but under-delivers, one file where the
design had eight; with it, the design is followed. In the builder's room a
cap on the *first* turn goes to the sizing call instead (below) — a request
that thought that long wanted splitting. The cap is characters rather than
tokens since `reasoning_tokens` is only reported when the stream ends, by
which point the whole allowance is spent, and it's off once the turn
produces content or a tool call, since a trace interleaved with real output
is a turn that's working.

⚠️ **The cap is the rule that nothing above ~10 K tokens of trace is worth
waiting for, and on V4.1 that ceiling is now far above anything healthy.** It
was sized against V4-Flash, where `'low'` really did produce 1,597 and 6,886
tokens and the cap sat just over them, so it mostly caught a helper left on
`'full'`. On V4.1 (§14) a first turn thinks 8–105 tokens at every setting and
the busiest turn of a whole game built end to end thought 2,055 — ~7,200
characters, which the cap is 4.9× above. There is nothing between ~2 K tokens
and the ceiling: a trace is either working or it has run away.

So the cap now fires late rather than wrongly. It still catches every runaway
seen — those spend their entire allowance, and at `MAX_OUTPUT_TOKENS` that is
~229,000 characters, so 35,000 stops one about a seventh of the way in. What
it costs is the waiting: ~43 s of silence before the retry, where a cap at
12,000 characters (~3,400 tokens, 1.7× the largest healthy trace measured)
would cost ~15 s and still clear every working turn on record. ⚠️ Not changed:
that headroom is sized from **one** eight-turn run, which is one run's idea of
how much a busy turn thinks. It wants more runs before the constant moves.

⚠️ **`max_tokens` is not the dial to turn here, and lowering it is worse than
leaving it.** The trace is generated before the reply and the tool calls, so a
smaller ceiling rations the *files*, not the thinking: measured at 32,768, one
run spent 25,004 on reasoning and had its fifth `write_file` cut off
mid-arguments, committing a game with a file missing, where the same prompt at
65,536 finished all eight cleanly (§14). A capped trace is a visible failure
with a banner on it; a truncated tool call is a silent one.

The abandoned attempt doesn't count as a turn but **is** charged, from
`tokensForChars` over the trace the stream watched go past — no usage frame
arrives for a stream nobody let finish, so there's nothing exact to bill,
but the tokens were generated and the key pays for them regardless. Only the
trace is estimated, so the studio still undercounts a capped turn, by less.

It is **never persisted** to `messages.body` and **never sent back** in a
later fire's history: it would bloat the database, and DeepSeek's own
guidance is not to feed traces back as context. What survives a turn is the
reply text and the file writes. The one time a trace enters a request is
the hand-on above — the same fire, once, as text — and the receipt's prompt
carries a placeholder naming its length where it rode, so the trace is in
no row anywhere.

### Runtime error feed

Most of what an agent learns about its running game arrives as text, and
this is the channel. It was, until 2026-09-12, *all* of it: DeepSeek rejected
every image content shape, so a screenshot could not have been sent even if
we had had one. V4.1 takes pictures, and the **shot** below rides this same
road — but a picture says what the game looked like, not what it said, and a
stack trace does not photograph. The two are complements, not replacements.

The **reporter** is a small script that runs inside the game — not a file in
the working tree, not a tag in the game's markup. The games listener serves
the project's own `index.html` with it injected at a reserved path,
`/<slug>/_studio.html` (§6), and the studio's preview iframe points there;
that document is the **wrapper**. Nothing else uses it — the public plays
`/<slug>/`, whose bytes are exactly what is on disk.

The studio can't inject the script from the browser: `contentDocument` is
null across origins, and anything letting the studio reach into the frame
would let the frame reach back into the studio (§7). Server-side injection
is the only place this can happen — and turns out to be the better place
anyway: no game is edited, none can lose it, no agent has to know it
exists, and every game that predates the feature reports without being
touched.

Inside the game the reporter catches uncaught errors, failed resource loads
(capture phase — a `<script>` that 404s never reaches `window` otherwise)
and `console.error`, posting each distinct one to `window.parent`. It
reports only when framed, never throws, and sends each distinct problem
once per page load, capped at 20 — a game throwing inside its animation
loop would otherwise report sixty times a second. One message it drops on
purpose: Chrome's `ResizeObserver loop completed with undelivered
notifications`, the browser saying the rest is delivered next frame. The
screens library trips it twice by design and it settles, so it is never a
game's fault — and as a problem row it sent a kid to the builder to fix
nothing (2026-09-07).

Each report carries the **version the wrapper was built from**, which files
a problem against the code that actually caused it rather than whatever
HEAD is when the report lands: `POST /errors` drops any report whose
version isn't current, since the preview is already reloading and anything
still broken will say so again. The wrapper reads HEAD *before*
`index.html`, so a commit landing in between makes the version older than
the bytes — losing a report, which is safe, rather than mislabelling one,
which isn't.

The version is HEAD's sha, or — while the project's *pending commit* is
open (§5) — `<sha>:<n>` for the n-th save on top of it, so a preview's
bytes always have a name whether or not they're committed. When the window
lands, rows filed under its last stamp are re-keyed to the commit they
became, and a report still carrying that stamp is taken as HEAD's until the
next save opens a new window. ⚠️ Without this, a run of saves landing would
leave every problem the preview reported belonging to a version that no
longer existed.

The studio page checks the sender's origin against the games origin and the
message's slug against the open project, batches for 500 ms, and posts. The
list is broadcast as `game.errors` and painted under the preview **without
a re-render** — rebuilding the tree rebuilds the preview iframe, restarting
the game, which reports its problems again in a loop that never settles
(the same reason a streaming reply mutates its nodes). The panel renders
whether or not the preview is folded away, since problems from before it
was folded still answer why the game is broken.

The same reporter forwards the game's **moments** — what `Moments.say()`
dispatches on the window (§4). It listens for the `moment` event, hearing
every one without knowing the library exists, and posts the latest value
per name a few times a second, at most fifty names a batch. The studio
keeps them per game for the session and paints a chip per name under the
problems panel, **in place, never through `render()`**, for the same reason
as the problems: a moment said at startup would otherwise restart the game
and say it again. The point is the *achievements editor*, which offers the
names a game has been seen to say. A moment reaches the studio page only —
never an agent's context (talk about the work, not the work) — and the
games origin never sees one, only the unlock a rule made of it (§3, §6).

Two things the wrapper doesn't cover: a game that navigates its frame to a
second page leaves the wrapper behind and stops reporting until it
returns, and what the studio previews differs from what the public plays by
exactly one injected script.

⚠️ Everything in this feed is text from LLM-written game code, arriving over
`postMessage` from a public origin — capped, stripped of control
characters, only ever rendered as text. It does reach an agent's context,
so a game can put words in front of its own helpers, but it could already
do that by writing a file, so this adds reach, not a new capability.

### Tools

Offered whenever `file_tools = 1`. No model gating is needed — there is one
model and it supports function calling, including parallel calls in a single
turn (§14), so an agent can write several files at once and cut loop
iterations.

| tool | args | behaviour |
|---|---|---|
| `write_file` | `path, content` | create or overwrite, whole file |
| `patch_file` | `path, old_text, new_text` | exact replace; errors unless `old_text` occurs exactly once |
| `read_file` | `path` | a file the byte cap dropped, or one at an older commit |
| `look_at` | `path` | the picture itself: PNG, JPEG, GIF, WebP |
| `look_at_game` | — | the last frame of the running game somebody was watching |
| `delete_file` | `path` | remove; recoverable from git |

Every tool validates its path per §4 and returns an error string to the
model on violation rather than throwing — a confused agent gets a
correction, not a dead turn.

`look_at` is the one tool that hands back something other than a sentence:
a label and the picture as DeepSeek's content parts, on the `role: 'tool'`
result. ⚠️ It has to be there rather than in the file block, because an
image on a system message is a 400 (§14) and the file block is the system
prompt's. The block still names every picture by path and size; this shows
one. Two consequences worth keeping:

- **A picture costs nothing until an agent asks.** ~200 tokens when it does,
  and it caches like anything else (§14).
- ⚠️ **A picture weighs what it costs, not what it measures.** A data URI is
  hundreds of kilobytes of base64 for ~200 tokens, so `weigh()` counts an
  image part at a flat 4 KB against `LOOP_GROWTH_BYTES` rather than at its
  length. Counted by its bytes, the second look in a fire would end it.
- ⚠️ **The receipt keeps a placeholder, never the picture** — the way it does
  for a reasoning trace (§12). A receipt is a row in SQLite that
  `npm run backup` copies, and the bytes are already on disk under the name
  printed beside the placeholder.

Refusals are sentences a helper can act on: an SVG or a `.js` is answered
with *read_file gives you all of it*, a `.wav` with what can be looked at, a
missing file and a bad path with what they are. Nothing reaches the API that
the API would reject, because a rejection there is a dead turn.

### The shot: seeing the game run

`look_at_game` is the other half, and the one that closes the debugging loop —
*"the ship is stuck in the wall"* is about what somebody can see, and until
now the only thing an agent had was the code and the error feed.

The road is the reporter's (§7). The studio asks the preview frame for a
frame; the reporter draws the biggest canvas into a 768px JPEG and posts it
back; the page PUTs it to `/api/projects/:slug/shot`; one row per project
(`project_shots`), replaced, never a file and never a commit — a **shot** is
like a score.

⚠️ **It is taken when somebody sends a message**, and at no other time. That
makes the picture the one they were looking at as they typed, which is the
whole value of it, and it means nothing is captured while a game is merely
being played. The client waits at most 500 ms for it, behind a message bubble
that is already painted.

Three limits, each said plainly to the agent rather than hidden:

- ⚠️ **The preview runs in a person's browser, not on the server.** There is a
  picture only if somebody has the game open. A server-side capture would mean
  a headless browser, which is a runtime dependency this studio does not take.
- ⚠️ **Canvas only.** A game built out of DOM — every visual novel — has
  nothing to photograph without a library. It says so rather than sending
  something misleading.
- ⚠️ A WebGL canvas made without `preserveDrawingBuffer` reads back blank
  once its frame has been presented, and nothing can tell that from a game
  that really is black.

⚠️ The bytes arrive from inside a frame running LLM-written game code on
another origin, so nothing about them is believed: the data URI's claimed type
is checked against the three the API will look at, the base64 is decoded
server-side, and the result is capped at `MAX_SHOT_BYTES` (`server/shots.js`).

Bounded loop: at most 24 assistant turns, 40 tool calls, and
`LOOP_GROWTH_BYTES` of appended messages per fire, ending with a `'system'`
banner on any of the three. Both numbers are runaway guards, not a work
allowance — the daily token budget caps cost. The original 8/12 proved too
tight: the "stopped after 8 turns" banner became routine, since DeepSeek
usually emits one or two calls per turn (so turns bind first) while a whole
small game needs more than eight. The preamble states both numbers so the
model can batch its calls and wrap up rather than being cut off mid-file.

The byte guard bounds the request itself. Everything else in the context is
capped once per fire; the loop is what grows as it runs — 40 reads at
128 KB each, plus every file it writes echoed back in the assistant turn
that wrote it, the only route by which a single fire could walk the
model's window. On hitting it the loop stops rather than dropping earlier
messages, since a dropped message orphans a `tool_call_id`; the recovery is
a continuation, which rebuilds its context from disk and starts light
again.

Running out of turns isn't the end of the reply: the agent may **continue**
itself up to 3 times, counted from the last human message and reset by the
next one, so a half-built game finishes without a human typing "keep
going". A continuation is armed by posting the `'system'` banner and
setting `response_pending` again — a `'system'` row enters the transcript
as a user turn (§8, Context), giving the next fire something to answer,
without which the agent's own reply would be the newest turn and the fire
would no-op. The daily token budget is rechecked before each one.

`max_tokens` is set to the full 65536 ceiling, not a lower cost guard,
because **`completion_tokens` counts the reasoning trace along with the
reply and tool call arguments** — a cap below the ceiling mostly rations
thinking and leaves the files whatever's left over. Measured on "make me a
tank game" (`deepseek-v4-flash`): at 32768, 25,004 tokens went to
reasoning and the fifth `write_file` was cut off mid-arguments; the same
prompt at 65536 spent 38,590 on reasoning and finished all eight files.

The HTTP client's timeout is an **idle guard**, re-armed on every byte
rather than a deadline on the whole request: it fires only after two
minutes of silence, surfacing as an `LlmError` naming the stall. It used to
be a hard ten-minute ceiling, which is exactly how long a healthy big turn
can stream, so it aborted real replies mid-flight. It's safe to re-arm by
bytes rather than content only because the stream carries no keep-alive
frames — measured, since a comment frame every few seconds would hold the
guard open forever (§14).

Truncation is detected and now recovered from rather than only reported. A
tool call cut off mid-arguments writes **nothing** (the JSON never parsed),
but the model's reply says it wrote the file — so the orchestrator feeds it
a note that the call was cut and nothing was saved, and the loop continues
so it can retry in smaller pieces. Only a cut still outstanding when the
loop ends produces the `'system'` banner; one a later turn rewrote
successfully isn't reported. Non-streaming truncation drops the tool call
entirely; the streaming path can deliver partial fragments, so both cases
are handled.

A stream that dies mid-fire is salvaged rather than discarded: whatever was
said is persisted, files already written are committed and credited to it,
and a `'system'` banner says the helper was cut off. No automatic
continuation — retrying a dead upstream can loop on the failure, so
carrying on is the human's call. Only a fire with nothing said and nothing
written ends as a bare `agent.stream.end {error: true}` with no message
row; once a row lands, the end event carries its id and no error flag,
since the client treats an error after `message.new` as a fresh live entry
nothing would ever clear.

⚠️ **A fault that is not the stream ends the fire the same way.** Anything
thrown between the start and end events — a git commit that can't take the
lock, a database that won't write, a full disk — used to end as a console
line with the browser stuck on "Thinking…" forever, since the start event
had already gone out. A `catch` around the whole fire now emits
`agent.stream.end {error: true}` (only if a start event went out, since an
error end with nothing live would create that same ghost entry) and posts
a `'system'` banner, end event first, since that's the part that can't
fail while the database is the candidate for what just broke.

The other silence it closes: a fire that ends cleanly having produced no
prose, no files and no limit used to emit a bare end event that took the
live entry away with no word behind it. That gets a `'system'` banner too —
nothing an agent does should remove the row without replacing it with a
sentence.

A long chain **sheds** its reasoning pile. DeepSeek re-attaches everything
it has said in the current tool-call chain — reasoning included — to every
continuation, billed as cached input (§14), so a marathon fire pays the hit
price on an ever-growing pile each request. When carrying that pile a few
more rounds (`SHED_HORIZON_ROUNDS`) would cost more than re-paying the
visible tail once, the loop appends a one-line `[studio]` note as a user
turn, closing the chain and dropping the pile from billing. A floor
(`SHED_FLOOR_TOKENS`, 8k) keeps short fires from ever shedding; the note is
never persisted, and the receipt counts the sheds.

Every persisted reply also leaves a **receipt** (`message_receipts`, §3):
the context half is captured in `buildContext` (bytes per system-prompt
part, files sent whole and left out, transcript size and trim), and the
fire adds per-request usage and the loop's appended bytes. The prompt is
captured at the top of each turn, before the request is made, so what's
stored is exactly what the last request carried. It's rendered as labelled
plain text, never the JSON body, and carries no reasoning trace, since a
trace is never in a request to begin with. The UI opens this from the
token note under the bubble; cached tokens count a thirtieth and output
three times there too, so the lines visibly sum to the note.

### Budget

`studio_state.tokens_used_today` accumulates, in miss-priced tokens,

```
prompt_cache_miss_tokens
  + ceil(prompt_cache_hit_tokens / 50)
  + 4 × completion_tokens
```

The weights are DeepSeek's own price list, read 2026-09-10 (§14): a cache
hit is a fiftieth of a miss and output is four times a miss, in the peak and
the off-peak window alike. V4.1 moved both — the retired V4-Flash's hit was a
thirty-first and its output three times — and the direction is that the cache
got cheaper while thinking got relatively dearer. Before either, a hit counted
a tenth and output counted one, which overcharged remembered tokens threefold
and undercharged thinking threefold — and thinking is output. Note that
`prompt_tokens` already includes the cached ones, so summing it with the hit
count would double-charge — the miss/hit split is the correct input (§14).

`completion_tokens` includes `completion_tokens_details.reasoning_tokens`; the
trace is discarded but it was still billed, so it is still counted, at the
output weight: a trace of 6,886 tokens shows as the 21 K new tokens it
costs. ⚠️ 6,886 was a V4-Flash `'low'` trace; on V4.1 (§14) that size of
trace is a runaway rather than a working turn, so it is what a *capped* fire
bills, not a typical one. The per-person allowance defaults (§10) were sized
under the old weights and want re-measuring.

If `budget_reset_at` has passed, the counter resets to 0 and the timestamp
advances to the next UTC midnight. Over budget: a `'system'` banner per failed
check, no API call.
