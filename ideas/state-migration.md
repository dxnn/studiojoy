# Moving the existing games onto State

Decided 2026-10-04: every game made before State existed is moved onto it
by hand, one commit in each game's own repo, rather than by asking each kid's
builder. This page is the runbook for landing those commits, and the ledger
of what each game got.

## What a migration is

- One commit in `games/<slug>/`, authored like the earlier hand commits
  there, touching **only the game's own files** — `index.html` and its code.
  Never `studio/`: the sweep brings `studio/state.js`, and a hand edit there
  diverges from every later sweep.
- `index.html` loads `studio/state.js` after `studio/input.js` (or, where a
  game loads no input library, ahead of its own first script).
- What changes while the game is played moves into `State` as plain data:
  `State.reset(...)` where a run starts, `State.x` wherever the code read
  its own variable. What is only a picture of that — canvases, meshes, DOM
  nodes, loaded images, a particle flourish nobody would miss — stays out,
  and a `State.loaded(...)` handler rebuilds it from State after a load.
- A template's game that still matched its template byte for byte took the
  current template's code whole, since only the State commits had touched it
  since. Every other game was read and moved by hand.
- No game takes a way in from its own address any more (`?scene=`,
  `?level=`): the studio's *Try* goes through State instead.
- Checked in a throwaway studio holding a copy of every game, swept as
  production will be: the game starts, its run moves through State, a save
  taken mid-run loads back, and nothing throws.

## ⚠️ The order, when you are back

The commits need `studio/state.js` in each game, which only the sweep on the
server puts there. **A game pushed before the sweep stops at its first
`State`** — the story never starts, the canvas never draws.

1. Deploy the studio as usual: `git push prod main`.
2. On the server, `npm run sweep`. Every game should say `added state`,
   some with library raises beside it.
3. On the server, `npm run unarchive` with no slug, which lists the archived
   games. The sweep skips those, so they would get the commit without the
   library. Tell me the list, and I move their commit onto a side branch
   (`state-migration`) so the push leaves them alone; they get it when they
   are reopened, with a sweep after.
4. Here, `deploy/sync-games.sh user@host pull`. Every migrated game reports
   `diverged (1 behind, 1 ahead)` — the server's sweep commit and the
   migration — and `3d-ball-game`, which has no remote here, gets linked.
5. Put each migration on top of the sweep. Either ask me to, or in fish:

   ```fish
   for d in games/*/; git -C $d rebase server/main; end
   ```

   The sweep touches only `studio/` and no migration does, so no rebase
   should stop on a conflict. A game that was only behind fast-forwards.
6. `deploy/sync-games.sh user@host push`.
7. Open two or three in the studio — a story, a canvas game, a builder game —
   and Pin, play on, Back.

## Ledger

`from` is the template a game was born from, or *builder* for a blank page
the builder wrote. *stock* means it took the current template's code whole.

| game | from | what State holds | notes |
| --- | --- | --- | --- |
| bloop-s-quest-two-the-questening | visual novel, stock | scene, line, switches | |
| link-s-amazing-adventure | visual novel, stock | scene, line, switches | |
| my-life-as-a-birch-tree | visual novel, stock | scene, line, switches | |
| the-life-of-link | visual novel, stock | scene, line, switches | |
| qiby-fam-days | visual novel, by hand | scene, line, switches | kept its row of faces, flash and film steps, glitch ending, mingled title. Its flash and video steps keep it out of the story editor, so no *Try this scene* (TODO line). Asks for `song_of_the_sea-run.png`, which does not exist |
| 3d-ball-game | rollball, stock | the run: level, ball, coins, hidden squares, clock | no `server` remote here |
| llama-calculus | quiz, stock | question, tally | |
| which-letter-are-you | quiz, stock | question, tally | |
| fight | arcade, stock | the run | |
| knock-down | knockdown, stock | the run, and the physics bodies as a part | |
| run | racing, stock | the race | |
| yunobo-dance | racing, stock | the race | |
| miku | blank, untouched | nothing yet | the page only loads State, like a new game's first page, so whatever gets built there starts on it |
| palword | blank, untouched | nothing yet | the same |
| qiby-is-rizzing-at-you | quiz, by hand | question, tally | Back to the ending shows it again without posting a second score |
| cookie-numb-numb | quiz, by hand | question, tally | its localStorage play count is counted once per run, as before. "Played most" always reads "Nothing here yet": `/_runs/<slug>` does not exist — old |
| math-blaster | arcade, by hand | the run, and the boss's numbers still to fall | ⚠️ every boss round scores NaN (`WORLD.BOSS_OPS.length` of an object) — old, a one-line fix; State saves NaN as null, so after a Back past a boss the total is a number again. `hurt()` is never called, so lives never drop — old. No sounds |
| knock | knockdown, by hand | the level, the shot, the score; the bodies as the physics part | its `Physics.tune` line waits for the sweep's new physics library |
| rolly-polly | rollball before levels, by hand | the template's: level, ball, coins, hidden squares, plus its red trail and score | `?level=` removed; *Try it* checked in the studio. Under Try it the score counts the start square too, preview only |
| elijah-racer | quiz, rewritten as a racer | the race: stage, rivals, score, road, speed, boost, car | Back to a crash shows the start card, not the crash panel (no second post). `boom.wav` missing |
| racer-oyz | quiz, rewritten as a racer | as elijah-racer, plus presents, lives, the finish banner | same Back choice. `boom.wav`, `pick.wav` missing; never had keyboard start |
| racer | quiz, rewritten as a racer | as racer-oyz, plus the delay before racing again | all three racers show a win's points with an "m" after them — old |
| wee-ooh-wee-ooh | racing, by hand | the old `Race`, plus which track | ⚠️ one change beyond the move: the track listener no longer restarts a race already on that track. Back to the finish or caught screen shows the title. `engine.wav` was deleted but is still looped (a warning every race); the police car never catches a car off the centre line — old |
| lemon-lemon | builder | the walk: playing, distance, walker | an endless toy |
| bob | builder | the room, the patches, Bob, the next-room wait | the 1.5 s next-room `setTimeout` became a State countdown — a Back into that gap left an empty room for ever. `mop.wav`, `clean.wav` missing |
| bob-elijah | builder | as bob, plus over | same countdown. Runs under its title screen — old |
| please-don-t-bomb-me | builder | the siege — its own `const State` became the library's | ⚠️ its own State is gone; its two play timers are kept but cancelled on a load. Never shows its sky (painted over) — old; no sounds yet |
| baking-blam | builder | the whole day: phase, money, lives, order, the pan, three countdowns | ⚠️ biggest change: three `performance.now()` deadlines became countdowns. The order re-rolls every 0.9 s while you choose — old, may look like a bug |
| a-card-game-for-grandpa | builder | the hand, the free cell, both sides | a load re-renders the table; Back to a balanced moment replays the fanfare |
| cloud-jumper | builder | the run, a `playing` added as the templates have it | only two of its sounds exist; `START_LIVES` is 0 — old |
| three-legged-race | builder | the racer, the feet, the clock, falls | `racer.png` missing, the painted fallback shows — old |
| bloop-s-quest | builder | the story's place, fans, the ending, `visited` (was a Set) | a loaded ending shows without its fanfare again. ⚠️ its dialogue panel never draws (`roundRect` called with the wrong arguments) — old, and a kid will see it |
| a-new-game | builder | its `G` became State; the floor, the player, the aliens, the run | `over.wav` missing — old |
| elijah-s-new-game | builder | as a-new-game; a Map and a Set became an object and a list | one small change: play again now starts you facing right (it kept the last run's facing). The win sound plays twice; the HUD overlaps itself at 960 wide — old |
| jam-jamboree | builder | `GAME` became State; every phase's own values moved in | a second jam starts with the pickers stuck where the first left them — old, kept on purpose, a one-line fix in `startGame` |
| flip-for-what | builder | its `S` became State; the draft and the note added | ⚠️ the biggest page-game change: rebuilt around the coin toss and the draft, checked by reading the page, not by feel. Every part placed throws "reading 'name'" (`lastOf()` has no `type`) — old |
| a-puzzle-game-for-grandma | builder | the puzzle: picture, pieces, won — its own `State` object is gone | piece positions are pixels and never rescale with the window — old, so a moment loaded at another size looks shifted |
| math-conqueror | builder | the tower run, the princess | ⚠️ Back to a fall beat posts that run's score again (inside the preview only). `exactNamesOf` reassigns a `const` and throws on towers 6–7 after 300 failed draws — old, real, rare |
| amazing | builder | the whole hunt, about 32 KB a save | one config change: the mouse's speed is read from `world.speed`, so a tweak reaches it live |
| monsters-vs-monkeys | builder | monke, monsters, coconuts, allies, lives | the allies' gap and colours moved to a `const ALLY_TRAITS`. All three lives go in 4 s with no input; the world is 3,600 wide on a 960 canvas with no camera, so 4 of 11 monster lanes are never on screen — old |
| aliens | builder | the apple and the worm, the race | the win's pause was a clock reading, now a State countdown. No `assets/` at all, so it plays silent — old |
| scary | builder | its lowercase `state` became State | music turned on or off by a load is new, and unheard: the music file is missing. No `assets/` — old. The hunting pet's turn to face you never applies (`p.fx` on the player) — old |
| redwolf-radness | builder | the player, the NPCs, the caption | all of it inline in index.html. A "Space: …" bubble shows from 4.5 tiles but Space works from 3 — old |
| space-racer | builder | the whole session — menu, unlocks, prizes, the race | play again is not a reset: unlocks and prizes carry across races, as before. A load lays the track out at the saved screen size. Rivals sway on `performance.now()`, so a Back is not an exact replay of them. Never driven three real laps |
| the-trails-of-redwolf | builder | its lowercase `state` became State | four play `setTimeout`s became a State countdown list. Sized by devicePixelRatio but placed in device pixels, so things land off-screen on a retina screen — old (the copy fixed it) |
| the-trails-of-redwolf-copy | builder | the same move as the original | |
| floof-forest-forever | builder | `World`'s data; running; the forest's beat as a countdown | ⚠️ moved the most, and felt in play: the forest's beat now stops when the loop does (a hidden tab, the preview's pause) — before, belly and trees went on. Back to a "Forest spread!" moment offers a restart from level 1. The "Acorn saver" achievement waits for "saved" but the game says "kept", so nobody can earn it — old |
| mipha-beefa | builder | where the reader is, the page's cards as dealt, the tip | ⚠️ restructured most: its progress stays in localStorage, so after a Back the moment and the stars can disagree. "← shelf" right after a right word gets pulled back into the book — old |
