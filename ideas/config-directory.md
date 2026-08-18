# Factoring a game so a kid can change it

Sketch, not a decision. The question: how should a game be laid out so that a
kid can change how it feels and what it says without reading code?

## What is already true

Two of the four games invented most of this on their own, unprompted.

`space-racer/js/settings.js` opens with `// ---------- SETTINGS (tweak these!)
----------`, one commented constant per line, then data tables as plain object
literals:

```js
const TURN_SPEED = 0.025;  // how fast the ship turns (halved — smoother)
const LAPS_TO_WIN = 3;     // laps to finish the race
const PRIZES = [
  { name: "GOLD SHIP", color: "#fc0", turn: 0.015, note: "TURN +" },
  ...
```

`flip-for-what/js/settings.js` does the same with a `const SETTINGS = {…}`
object, a comment per value, and a human's instruction recorded in a comment
("Persistence is DISABLED right now (per Daddy)").

Both load as **classic scripts in order** — `<script src="js/settings.js">`
first, then state, draw, run, main — not as ES modules. No imports, no async
boot, load order visible in `index.html`.

So the format question is mostly settled by precedent, and settled well. Three
things are actually missing:

1. **The strings are not extracted.** `"GOLD SHIP"`, `"TURN +"`, and every bit
   of on-screen text live inside the code or the data tables. Changing what a
   game *says* is the single most satisfying edit a kid can make, and it is the
   one edit that cannot break the physics.
2. **`settings.js` is one file for everything.** Fine at 60 lines, not at 300.
3. **Nothing protects a human's edit.** An agent that rewrites `settings.js`
   whole loses the number a kid changed by hand ten minutes ago.

## Proposal: `config/`, in the syntax the games already use

```
config/
  play.js      speeds, sizes, gravity, timings
  world.js     level/track/board data tables
  words.js     every string the player sees
  look.js      colours, fonts, sizes
```

- One batch per file, a comment per value, loaded before everything else.
- Same classic-script model already in use. No `fetch`, no `await`, no module
  scope, nothing new to explain to a kid or an agent.
- A syntax error gives `config/play.js:4 SyntaxError` in the console, which the
  reporter already forwards to the studio and files against the commit — so a
  helper can fix a kid's broken config and say what was wrong (spec.md §8).
- Small files, so smallest-first ambient selection always puts them in an
  agent's context. Tuning a number becomes `patch_file` on 200 bytes instead of
  a rewrite of a 40 KB game file — cheaper, and it cannot lose the rest.
- Rule for agents: **never rewrite a config file whole.** Patch the one value.
  A person may have edited it since.

`words.js` is the part with no engineering cost and the most obvious payoff.

## The friendly-format idea, costed

The proposal on the table was a lightweight YAML-ish `config/*.conf`, converted
to JSON by the games listener the way the wrapper injects the reporter. What it
buys, precisely: **you cannot make a syntax error that stops the game**, if the
parser is lenient. That is a real thing to want for an eight-year-old.

What it costs:

- **A parser we own.** Zero dependencies is a project rule, so a YAML subset is
  ours to write, test, and keep — and dialects grow.
- **A derived path.** `config/play.conf` on disk, `config/play.json` in the URL:
  a second derived resource after `_studio.html`, and a name in the file tree
  that does not match the name the game fetches. Both the kid and the agent have
  to hold that mapping.
- **Async boot, in every game.** JSON has to be fetched, so the first frame now
  waits on a promise. Today's games are synchronous top to bottom. This is the
  biggest cost and it lands squarely on the kid-facing code.
- **No good answer for a parse failure on the public origin.** A 500 is a broken
  game with no explanation; a lenient parse is a game that silently ignores what
  the kid wrote. `/​<slug>/` has no reporter, so nothing can explain it there.

Plain `config/*.json` avoids the parser but keeps the async boot and adds JSON's
hostility — quotes on every key, commas, no comments. Strictly worse than the JS
literal the agents already write.

## Better place for the friendliness: the studio, not the file

A `.conf` dialect makes the *file* friendly. A form in the studio makes the
*editing* friendly — and a form cannot be broken by a typo, which is more than
any lenient parser can promise.

If a config file contains only literal exports, the studio can render it as
fields: a number box for `TURN_SPEED`, a colour swatch for `"#fc0"`, a text box
for each line in `words.js`, and write the file back with the comments intact.
The kid never sees syntax at all. The format stays plain JS, so the game, the
agents, and git are all unaffected.

Two rules that make it safe:

- Strict subset: numbers, strings, booleans, and arrays/objects of those, one
  level deep. Anything else and the form **refuses to render** and falls back to
  the text editor — never a partial form that drops what it could not parse.
- Round-trip by patching, not regenerating: change the one value in place so
  comments and layout survive.

## Recommendation

1. **Now, prompt only:** add `config/` to the layout the preamble asks for, with
   `words.js` called out, plus the never-rewrite-a-config-file rule. Zero code,
   and it formalises what the agents already do well.
2. **Next, in the studio:** the form view over literal-only config files. This is
   where kid-friendliness actually lands.
3. **Only if 2 turns out impossible:** the lenient `.conf` → JSON rewrite, with
   the four costs above accepted deliberately.

## Open questions

- File names: `play.js` / `world.js` / `words.js` / `look.js`, or something a kid
  would pick? Nothing is in GLOSSARY.md yet.
- Should the studio's file tree pin `config/` and the project documents to the
  top, above `js/`? Cheap, and it makes the tree read as "here are the knobs".
- Do the four existing games get migrated, or is this new-games-only? Migrating
  `space-racer` is nearly free — `settings.js` is already the file, it just moves
  and splits.
