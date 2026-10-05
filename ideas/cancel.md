# Cancel

From somebody using the studio: "it would be nice if there was a button in
the chats that would automatically cancel whatever the builder was doing and
undo it."

Today nothing stops a fire once it has started. A message sent mid-plan
pauses the plan *after* the running piece finishes; "stop" sets it aside at
the next sizing; Recall's Rollback puts a whole tree back to a version. None
of them stops the thing happening now, and none puts back what it was halfway
through writing.

## What it does (decided 2026-10-05)

**Cancel** stops the running *fire* and puts every file that fire wrote back
to how it was when the fire began. That is all it undoes: in a plan, the
pieces already done have their own versions and stay; undoing a whole plan
is a different button, later. The word is the same in the interface and the
code.

What the request called a *turn* is the code's *fire* — one piece, one small
ask, one helper's reply. A *turn* in the code is one request of the tool loop,
several to a fire. ⚠️ A press of Build it is one `fireAgent` running every
piece in turn, each its own fire as far as this is concerned: Cancel takes
back the piece that is running, not the ones before it.

## Why the undo is small

Two things already true make it nearly free:

- `fireAgent` settles a person's pending saves before the fire starts, and
  every write tool settles them again, inside the mutex, before it writes
  (`createToolset`).
- A fire's own writes are not committed until `persistReply`, at its end.

So at the moment of a press, HEAD holds every path this fire touched exactly
as it was before the fire touched it. The undo, inside the mutex: settle
pending (a person's saves land as theirs, as everything that commits must),
then for each path in `toolset.changes` write HEAD's bytes back, or remove it
if HEAD has none. Nothing is committed — the tree now matches HEAD on those
paths, so the fire leaves nothing in Recall at all. Then `files.changed`, and
the preview reloads the game as it was.

A person who saved the same file mid-fire keeps their save: it lands as their
own version first, and that version is what the undo puts back.

## How it stops

- An `AbortController` per running fire, held beside `firing`
  (`chat_agents.id` → controller), its signal handed to `llm.stream`, which
  links it to the idle-guard controller it already has (`deepseek.js`).
- `runLoop` checks it after each stream and before each tool call, so no tool
  starts after the press. A write already inside the mutex finishes; the undo
  comes after it, under the same mutex.
- The outcome comes back `cancelled`, and each caller — `openFire`,
  `builderFire`'s small ask, `runPieces` — undoes, charges and ends instead of
  persisting.

## What it leaves behind

- No reply row. A studio notice in its place (`kind = 'system'`, so the
  sidebar says *Studio:*): "Cancelled — everything it changed is back how it
  was."
- The tokens spent until the press, charged as usual. A stream nobody let
  finish sends no usage, so it is estimated from what streamed, the way the
  thinking cap's abandoned trace already is.
- `response_pending` cleared and no continuation scheduled: Cancel means stop,
  and the next message fires as normal.
- A piece: back to not done, and the plan **paused** — the banner and *Carry
  on* that already exist — so carrying on runs it again from the top.

## The button

**Cancel** on the live reply (`renderLive`), wherever it is drawn — at the foot
of the thread or on its piece's line on the plan card. For anybody who can
write in that room. `POST /api/projects/:slug/chats/:chatId/cancel`, which
aborts whatever is firing in that chat and answers 409 when nothing is.

## Tests

A fake LLM stream that waits on the signal. A fire that updated one file,
created one and deleted one, cancelled: the tree equals HEAD, no commit was
added, the notice is there, the tokens are charged, nothing is scheduled. The
same for a piece: the plan paused, that piece not done, the pieces before it
still committed. A person's save of the same file mid-fire survives the undo.

## Questions

1. **Confirm first?** The studio confirms what is destructive. What Cancel
   throws away is the builder's unfinished work, which no version ever held
   and asking again remakes; a dialog open while the builder keeps writing is
   also a race. Recommended: no confirm.
2. **Only the builder, or any helper?** The mechanics are the same in
   `openFire`; a person's helper lives in a chat project with no tree, so
   there Cancel only stops. Recommended: any live reply.
