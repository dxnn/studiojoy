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

- `npm test` — 253 tests. `node:test` against `:memory:` SQLite, a temp
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

## Audience

The studio is used by kids. That shapes the interface, not the engineering:
every technical affordance is present (file tree, versions, diffs, reasoning
traces, model choice), but user-facing strings are plain language and
destructive actions confirm first. The UI says **helper** where the code says
**agent** — see GLOSSARY.md, and don't let "helper" leak into the code.

## Current state

v0 is complete and green at 253 tests. Verified live end to end: a message in
the UI produces a streamed reasoning trace, a `write_file` call, one git
commit authored as the agent, a `files.changed` event, and a reloaded preview
of a playable game on the public origin.

Browser-checked, not just intended: on the games origin `document.cookie` is
empty and `localStorage` works, and the studio cannot read into the preview
iframe.

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
