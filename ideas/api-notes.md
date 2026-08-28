# API notes: a thing's contract in the prompt, never its bytes

The observation (Dann, 2026-08-28): an engine's cost to a helper should be
its contract, not its source. Half true already — `studio/` files are named,
never sent — but the *usage* docs are hardcoded paragraphs in
`orchestrator.js` (the input module's how-to, the scoreboard routes), so
every new library means editing the preamble by hand.

## API note

A short usage block that travels with the thing it documents. The comment
block at the top of `studio-lib/input/input.js` is the model: what it is,
the three calls that matter, one example. Kid-plain, a screenful at most.

## Libraries: assemble the preamble from the manifest

- Each library's note lives with the library — the leading comment block of
  its main file, or a `doc` field in `studio-lib/index.json`.
- `buildContext` assembles the notes for the libraries *this game holds*
  (from `studio/studio.json`), placed right after the preamble's opening
  lines — the most stable prefix region, so the cache never re-pays it
  until a library version bumps.
- The hardcoded input-module and scoreboard paragraphs become the first two
  notes (the scoreboard note stays conditional on `scores_on`).
- `orchestrator.test.js` then asserts the assembly (a held library's note is
  present, an unheld one's absent), not each hardcoded sentence.
- Consequence: a second library teaches every helper about itself with zero
  orchestrator edits. Over time more moves into `studio/` and the game's own
  surface (the 65 KB file block) shrinks toward config plus glue.

## Locked files: the same treatment for a game's own file

A person locks a file; the studio then treats it like a library file:

- Helpers cannot write it. Enforced in the tools (a reason string, like the
  `studio/` rule in `paths.js`) — but the lock list is per-project state, so
  it lives in the DB (a `file_locks` table or similar), not in the tree: a
  lock is an instruction to the studio, not part of the game.
- The ambient block sends its name and its top comment block — its API note
  — instead of its bytes. A file with no comment block is named with its
  size, like a binary.
- `read_file` still works: the lock is a cost-and-safety decision, not a
  capability wall. The refusal message says a person locked it and to ask
  them.
- A pinned locked file still sends only the note: the lock outranks the pin,
  because keeping the bytes out is what the lock is for.
- UI: a small lock control on the file row or the open file's bar; locked
  rows say so. Locking and unlocking changes the file block, so the next
  fire re-pays the cache once — same as any edit.

## Open questions

- Note extraction: leading `//` or `/* */` for js/css, `<!-- -->` for html;
  cap it (a screenful) so a locked file cannot smuggle its whole body back
  in through its comment.
- Does the helper get told *why* files are presented as notes (one preamble
  sentence explaining the shape), or is each note self-evident?
- GLOSSARY entries (**API note**, **locked file**) when this lands.
