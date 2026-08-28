# Game templates: start from a shape, not a blank page

New game → "Start from": a blank page, or a template — a starter tree copied
in at creation. First three (Dann, 2026-08-28): a quiz, a point-and-click
adventure, a top-down move-and-collect. Racing, incrementals, etc. later.

**Shipped so far:** the plumbing and the quiz, quiz editor included. The
principle that emerged (Dann): each template deserves its own editor mode
over its config heart where one fits — the quiz needs no helper at all. For
move-and-collect that is likely a map editor over `config/world.js` (paint
tiles on a grid); for the adventure it is the spot picker already in TODO.

## What a template is

A **starter tree**, copied server-side at creation right after the library
scaffold, as one commit ("start from the quiz template"). From then on it is
the game's own code: it drifts freely, has no version, and is never offered
an update — unlike a library, because a kid saying "add a timer to my quiz"
must hit editable code, not the studio/ write-wall. Genre mechanics belong to
the game; libraries stay cross-genre (input, sound, sprites — all three
templates use them, so template index.html ships with the tags in place).

Not a fork: fork copies history and attached agents; a template wants a clean
thread, clean history, current libraries.

## The shape every template follows

- Its **heart is a config file** — the config-form subset — so a kid remixes
  meaningfully before ever seeing code: questions, scenes, or a map.
- A pre-written **BRIEF.md** (the file map) and short **SPEC.md** (genre
  rules, how to remix) — helpers know the structure from the first fire.
- Small game-owned js/ files reading the config; assets/ with placeholder
  art and sounds the kid replaces with the studio's own makers.
- Lives in `public/game-templates/<name>/`. (`public/templates/` is already
  the library seeds — keep the names apart in the glossary.)

## The three

**Quiz** — "answer questions, be pronounced a thing."
`config/questions.js`: `QUESTIONS = [{ ask, answers: [{ say, scores: {fire: 2} }] }]`,
`RESULTS = { fire: { name, tell } }`. `js/quiz.js` asks, tallies, pronounces.
Smallest and most config-pure; ships first, proves the plumbing.

**Move-and-collect** — top-down, trails-of-redwolf-shaped.
`config/world.js`: the map as rows of characters with a commented legend
(wall, floor, item, exit, start); `config/play.js`: speed, win count.
Exercises all three libraries: Input to move, a Sprites strip for the hero,
Sound for the pickup. The template that shows the studio at full strength.

**Point-and-click adventure** — scenes, spots, state.
`config/scenes.js`: per scene a picture and spots — `{x, y, w, h}` plus one
effect each (`go` to a scene, `take` an item, `need` an item, `say` a line,
`flip` a switch). `js/adventure.js` draws, hit-tests, keeps inventory.
⚠️ The constraint that shapes it: helpers cannot see images (spec.md §14), so
spot rectangles are human-authored numbers. Ship it with worked example
scenes; the real ergonomics fix is a follow-up studio affordance — drag a box
on the open picture and it writes the spot into config/scenes.js.

## Mechanism

- `POST /api/projects` gains `template?: <name>`, validated against the
  directory listing; after initRepo + scaffoldLibraries, copy the tree
  (binary-safe, server-side — no client seed limits), one commit.
- New game dialog: a "Start from" choice with one-line kid-plain
  descriptions (from a game-templates index.json, which is also the
  validation list).
- BRIEF.md opens with "This game started from the quiz template" — no
  orchestrator change needed; the brief already rides every fire.
- Build order: plumbing + quiz → collect → adventure → (follow-up) the
  spot picker.

## Open questions

- Template descriptions and names shown to kids — worth wordsmithing.
- Does the picker also appear on fork? (No: fork is "one like that".)
- Adventure state beyond inventory (counters? flags?) — start with items
  and switches only, let helpers grow the rest per game.
- GLOSSARY: **game template** (vs the seed `public/templates/`), when built.
