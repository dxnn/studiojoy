# Game Studio

A private studio where a few trusted people and DeepSeek-backed agents build
browser games together. Each **game project** is a chat thread plus a
versioned working tree of files under `games/<slug>/`. Agents read the tree
and edit it with tools; every edit is a git commit. Games are publicly
playable, the studio needs a login.

## Source of truth

`spec.md` is the v0 design-of-record: data model, routes, SSE events, limits,
accepted tradeoffs, invariants. Read it before any non-trivial change. §14 is
DeepSeek's API behaviour as *measured*, not assumed — don't re-guess it.

`GLOSSARY.md` is the naming authority. `TODO.md` is the build order.

## Commands

- `npm test` — 279 tests. `node:test` against `:memory:` SQLite, a temp
  `GAMES_DIR`, and a scripted fake LLM. No network, no API key.
- `npm start` — needs `DEEPSEEK_API_KEY`; fails fast without it.
- `npm run smoke` — one live DeepSeek round trip; needs the key, not in `npm test`.
- `npm run adduser -- <email> "<Name>"` — the only way accounts exist.

Ports default to 8100 (studio) and 8101 (games). 8090 is deliberately left
alone: `new-y` defaults to it and is expected to be running at the same time.

Running locally in this sandbox, both gotchas below apply at once:

```sh
export GS=$TMPDIR/gamestudio-dev
echo hunter2 | DB_PATH=$GS/db node bin/adduser.js you@example.com "You"
NODE_OPTIONS=--use-env-proxy DEEPSEEK_API_KEY=$(cat tmp/deepseek.key) \
  DB_PATH=$GS/db GAMES_DIR=$GS/games npm start
```

No build step, no linter, no dependencies. Node ≥ 24, ESM.

## Invariants worth keeping

- `server/files/paths.js` is the security boundary. Everything touching a file
  goes through it. It returns a reason for tools, throws a 400 for routes.
- Every git command except `init` is pinned with `--git-dir`/`--work-tree`.
  Unpinned, git walks upward and finds whatever repo encloses `GAMES_DIR` —
  in development that's this checkout.
- The games listener never reads a cookie and serves nothing but static files
  from a project directory. It exists to be a separate origin (spec.md §7).
- Write-and-commit is serialised per project through `files/mutex.js`.
- A reasoning trace is never persisted and never replayed into a later request.

## Dev-environment gotchas

- **`GAMES_DIR` must live outside this checkout when running locally.** The
  sandbox refuses writes to any `.git` directory beneath the project root, so
  `git init` inside `./games/` fails with EPERM. Use
  `GAMES_DIR=$TMPDIR/gamestudio-games`. Deployed, `./games` is fine.
- Outbound network goes through a CONNECT proxy and DNS does not resolve.
  `curl` reads `$https_proxy` on its own; Node's `fetch` needs
  `node --use-env-proxy`. `npm run smoke` carries the flag; `npm test` never
  needs it; **`npm start` needs `NODE_OPTIONS=--use-env-proxy`** or every
  agent reply fails with ENOTFOUND, because the server is the one calling
  DeepSeek. Deployed, none of this applies.
- `node:sqlite` has no `db.transaction()` and rejects a nested `BEGIN`; use
  `tx()` from `server/db.js`, which guards against nesting.
- **The sandbox denies `kill`**, and each Bash call is a fresh shell, so a
  server backgrounded with `&` in one call cannot be stopped in a later one —
  it squats on its port until the operator kills it. Don't background
  long-lived servers. For a browser check, start it on an unused port, report
  the PID immediately, and expect to hand cleanup over. `pkill -f` also
  matches against the *relative* command line (`server/index.js`), so a
  pattern containing the full path silently matches nothing.

## Audience

The studio is used by kids. That shapes the interface, not the engineering:
every technical affordance is present (file tree, versions, diffs, reasoning
traces, model choice), but user-facing strings are plain language and
destructive actions confirm first. The UI says **helper** where the code says
**agent** — see GLOSSARY.md, and don't let "helper" leak into the code.

## Current state

v0 is complete and green at 295 tests. Verified live end to end: a message in
the UI produces a streamed reasoning trace, a `write_file` call, one git
commit authored as the agent, a `files.changed` event, and a reloaded preview
of a playable game on the public origin.

Since v0: a project is a game or a **chat** (`projects.kind`). A chat has no
working tree and nothing on disk, so every file route, the games origin, and
the agent's tools and context all refuse or omit it.

Browser-checked, not just intended: on the games origin `document.cookie` is
empty and `localStorage` works, and the studio cannot read into the preview
iframe. ⚠️ Read that first one narrowly — `document.cookie` is empty because
the session is `HttpOnly`, not because the browser withheld it. On two ports of
one hostname the cookie *is* sent to the games origin; see spec.md §7.

Play and preview links are derived per request from `Host` (same hostname,
`GAMES_PORT`), so no hostname is configured anywhere. `GAMES_URL` overrides it
for the separate-hostname deployment and is normally unset.

Helpers can now see the game break. The preview iframe loads
`/<slug>/_studio.html` — the **wrapper**: that game's own `index.html` with the
**reporter** and the current commit injected by the games listener. Nothing is
added to any working tree, no agent is told about it, and every game already
has it. The reporter posts uncaught errors, failed loads and `console.error`
to the studio page, which files them against the commit the wrapper was built
from; a report whose version is no longer HEAD is dropped rather than
mislabelled (spec.md §8). Browser-checked end to end, including that the public
page is byte-identical to the file on disk.

Two traps worth remembering. Rendering rebuilds the preview iframe, which
restarts the game, which reports again — so the problems panel is painted in
place, never through `render()`. And the studio cannot inject anything into the
frame from the browser; that it has to happen server-side is the boundary
working, not an obstacle.

What a reply cost is on `messages.tokens` and under the bubble.

Every part of a request is now bounded, and nothing is dropped in silence: the
brief is cut at 32 KB with a note, a pin is priority rather than exemption so
the file block cannot exceed `AMBIENT_BYTES`, the tool loop stops at 512 KB of
appended messages and continues from a fresh context, and a trimmed transcript
carries a `[studio]` marker saying how many messages are missing. Still bytes,
not tokens — spec.md §8 has the table that shows the sum cannot reach the
window.

Prompt caching, measured (`tmp/probe-cache.mjs`): 99% hit between the turns of
one fire, **0% between fires**, because the file block rides behind the whole
transcript. In the system prompt it would be 100% / 0-on-change. Not moved yet
(spec.md §15).

Deferred by choice: spec.md §15. Typing previews are permanently out (§2).

## Git policy (overrides global)
You manage git directly in this project. The global "manual git" rule does
NOT apply here. `git push` remains denied at the permission layer; the user
handles pushing.

Workflow:
- Commit after each meaningful change passes its tests. One logical change
  per commit.
- Stage only the files relevant to the change. Use `git add <paths>`, not
  `git add .` or `git add -A`. Do not sweep up unrelated edits.
- Before committing, run `git diff --staged` and verify the diff is exactly
  what you intend. If something unintended is staged, `git restore --staged
  <path>` to unstage.
- Conventional commit messages: feat:, fix:, refactor:, docs:, test:, chore:.
  First line under 72 chars. Body if useful, omitted if not.
- Never commit on red. If a test was passing and now isn't, fix the test or
  the code before committing — do not commit broken state.
- Do not include AI attribution in commit messages.
