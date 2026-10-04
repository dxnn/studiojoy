# Moving the existing games onto State

Decided 2026-10-04: every game made before State existed is moved onto it
by hand, one commit in each game's own repo, rather than by asking each kid's
builder. This page is the runbook for landing those commits, and the ledger
of what each game got.

**Pushed 2026-10-04 — all but eight archived games' libraries.** The sweep
skips archived games, so the eight archived ones that took the migration went
up loading a `studio/state.js` they did not have: bloop-s-quest,
bloop-s-quest-two-the-questening, elijah-racer, fight,
link-s-amazing-adventure, racer-oyz, the-life-of-link, vroom-vroom. Archived
games stay playable, so their pages stopped at the first `State`. Repaired in
the mirrors with the sweep's own code — one studio-authored library commit
each, byte for byte the `studio/` the throwaway tested them on — and waiting
on `deploy/sync-games.sh user@host push`. (which-letter-are-you, archived
too, was swept by accident on the laptop and is fine.)

All 58 game pages in `games/` load State:
56 games moved, and the two untouched blank pages given the tag. Every repo is
clean, and no commit touches `studio/`. Every game boots in the throwaway with
no page error and no State warning, and every one was played, pinned, played
on and put back.

Riding the same push, each its own commit on top of the migration (Dann,
2026-10-04): five old bugs fixed — math-blaster, doki-doki-monster-run-chase,
math-conqueror, flip-for-what, floof-forest-forever — and the template's
robot taught to the eleven games still matching their template — the four
stock stories, 3d-ball-game, llama-calculus, which-letter-are-you, fight,
knock-down, run, yunobo-dance. So a game is one or two commits ahead.

## Look at these first

Where a migration made a judgement call, or changed more than the move:

- **flip-for-what** — rebuilt around its coin toss and draft; a page game,
  checked by reading the page rather than by feel.
- **math-guided-assault** — its overlays are rebuilt from State; a Back into
  a battle replays the battle.
- **floof-forest-forever** — the forest's beat now stops when the game's loop
  does, which a kid will feel.
- **baking-blam** — three clock deadlines became countdowns.
- **mipha-beefa** — restructured most; its stars stay in localStorage, so a
  Back and the stars can disagree.
- **asterogueoids** — bucks and the next sky stay in localStorage.
- **math-conqueror** — Back to a fall posts that run's score again (preview
  only).
- **please-don-t-bomb-me** — its own `State` object is gone.
- **wee-ooh-wee-ooh** — one change beyond the move, in its track listener.

Bugs that were already there and that a kid will meet, found along the way.
Fixed, one line each: math-blaster's boss rounds scored NaN;
doki-doki-monster-run-chase's Krill round threw every frame (and would then
have kept a red bump flash up); math-conqueror crashed on towers 6–7 now and
then; flip-for-what threw on every part placed; floof-forest-forever's
"Acorn saver" could never be earned. Still there: bloop-s-quest's dialogue
panel never draws, a second jam in jam-jamboree starts with the pickers
stuck, and about half the games ask for sounds that do not exist.

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

1. On the laptop, deploy the studio: `git push oci-studio main`.
2. **On the server**, `npm run sweep`. Every game should say `added state`,
   some with library raises beside it. ⚠️ Not on the laptop: there it finds
   the retired `gamestudio.db` and sweeps whichever mirrors in `./games` that
   lists.
3. **On the server**, `npm run unarchive` with no slug, which lists the
   archived games. The sweep skips those, so they would get the commit
   without the library. (What happened instead, above: they went up, and were
   given the library from the mirrors after.)
4. Here, `deploy/sync-games.sh user@host pull`. Every migrated game reports
   `diverged (1 behind, 1 ahead)` — the server's sweep commit and the
   migration — or 2 ahead where a fix or a robot rides with it. `3d-ball-game` and `knock-down` have no remote here: `pull`
   links each one the server has, and one it does not have was only ever
   local, so its commit simply stays here.
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
| math-blaster | arcade, by hand | the run, and the boss's numbers still to fall | every boss round scored NaN (`WORLD.BOSS_OPS.length` of an object) — fixed in its own commit. `hurt()` is never called, so lives never drop — old. No sounds |
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
| flip-for-what | builder | its `S` became State; the draft and the note added | ⚠️ the biggest page-game change: rebuilt around the coin toss and the draft, checked by reading the page, not by feel. Every part placed threw "reading 'name'" (`lastOf()` had no `type`) — fixed in its own commit |
| a-puzzle-game-for-grandma | builder | the puzzle: picture, pieces, won — its own `State` object is gone | piece positions are pixels and never rescale with the window — old, so a moment loaded at another size looks shifted |
| math-conqueror | builder | the tower run, the princess | ⚠️ Back to a fall beat posts that run's score again (inside the preview only). `exactNamesOf` reassigned a `const` and threw on towers 6–7 after 300 failed draws — fixed in its own commit |
| amazing | builder | the whole hunt, about 32 KB a save | one config change: the mouse's speed is read from `world.speed`, so a tweak reaches it live |
| monsters-vs-monkeys | builder | monke, monsters, coconuts, allies, lives | the allies' gap and colours moved to a `const ALLY_TRAITS`. All three lives go in 4 s with no input; the world is 3,600 wide on a 960 canvas with no camera, so 4 of 11 monster lanes are never on screen — old |
| ktest-game | builder | the chess game: position, moves, clocks, the move waiting on promotion | the widest rewrite of its batch: `pendingPromotion` now holds the move, so a Back reopens the chooser. The move list reads "1. 1. e4 e5" — old |
| the-best-game | builder | its `Game` became State; the jokes on screen too | a load onto a title or game-over moment reopens that screen, never posting again |
| fun-slide | builder | the whole sitting: slides, gems, coins, power-ups | the game never saves on purpose, so its progress is the run and a Back rewinds it |
| doki-doki-monster-run-chase | builder | everything a round changes, both halves; the Krill's age as a countdown | each round resets only its own half, as before. `BE_KRILL_EYE_GLOW` was not in config, so every Krill frame threw (hidden by the game's own catch) and the Krill round lost its chips, world bar and banner; and `bumpT` was never reset for it — both fixed in their own commit |
| hehehe | builder | its lowercase `state` became State; `playing` added | small change: after a Back to before Start, the pets make their cheerful noise under the title. The drone music only plays in the first garden; a hunter straight below a hedge never moves — old |
| math-guided-assault | builder | the climb, the boss path as an index, and which overlay is up | ⚠️ the biggest restructure of its batch: overlays rebuilt from `State.scene`, their timers cancelled on a load. A Back into a battle replays it from its start, sounds and all. The boss path is drawn from the whole sheet whatever the tower — old |
| asteriskoids | builder | the run, the ship, bullets, rocks, sparks, the upgrade cards on offer | the objects keep their methods, their data moved to State. A laser firing as a level clears stays frozen behind the chooser — old, and comes back the same after a Back |
| asterogueoids | builder | as asteriskoids, plus the companions, the risk bar and which sky | ⚠️ judgement calls: bucks, purchases and the next sky stay in localStorage (so a Back and a second finish banks twice — preview only); `State.level` added so a Back across a fly-on shows the right sky; a load reopens its title or game-over screen without posting. Never played through a long natural run |
| vroom-vroom | builder | its `G` became State: the run, the ship, the robots, bullets, rocks | the objects keep their methods, their data moved to State. The bank is localStorage, so going back past a level clear and clearing again banks twice — preview only. One robot is always built, hidden, even unowned; a laser can stay drawn behind the title — old |
| vroooooooom | builder | as vroom-vroom, plus its poison mist and the Trash Can | one more change: a companion no longer carries its config object, which would have gone into every save |
| aliens | builder | the apple and the worm, the race | the win's pause was a clock reading, now a State countdown. No `assets/` at all, so it plays silent — old |
| scary | builder | its lowercase `state` became State | music turned on or off by a load is new, and unheard: the music file is missing. No `assets/` — old. The hunting pet's turn to face you never applies (`p.fx` on the player) — old |
| redwolf-radness | builder | the player, the NPCs, the caption | all of it inline in index.html. A "Space: …" bubble shows from 4.5 tiles but Space works from 3 — old |
| space-racer | builder | the whole session — menu, unlocks, prizes, the race | play again is not a reset: unlocks and prizes carry across races, as before. A load lays the track out at the saved screen size. Rivals sway on `performance.now()`, so a Back is not an exact replay of them. Never driven three real laps |
| the-trails-of-redwolf | builder | its lowercase `state` became State | four play `setTimeout`s became a State countdown list. Sized by devicePixelRatio but placed in device pixels, so things land off-screen on a retina screen — old (the copy fixed it) |
| the-trails-of-redwolf-copy | builder | the same move as the original | |
| floof-forest-forever | builder | `World`'s data; running; the forest's beat as a countdown | ⚠️ moved the most, and felt in play: the forest's beat now stops when the loop does (a hidden tab, the preview's pause) — before, belly and trees went on. Back to a "Forest spread!" moment offers a restart from level 1. The "Acorn saver" achievement waited for "saved" but the game says "kept" — fixed in its own commit |
| mipha-beefa | builder | where the reader is, the page's cards as dealt, the tip | ⚠️ restructured most: its progress stays in localStorage, so after a Back the moment and the stars can disagree. "← shelf" right after a right word gets pulled back into the book — old |
