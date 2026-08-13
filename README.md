# Game Studio

A small private studio where a few people and DeepSeek-backed agents build
browser games together.

Each **game project** is a chat thread plus a versioned working tree of files.
Agents see the project's files, can be handed specific ones to look at, and
edit them with tools. Every edit is a git commit, so nothing is unrecoverable.
Finished games are publicly playable; everything else needs a login.

See [spec.md](./spec.md) for the design of record — data model, routes, SSE
events, limits, invariants, and the accepted tradeoffs. §14 records DeepSeek's
API behaviour as measured against the live service.

## Run

No dependencies and no build step. Node 24 or newer.

```sh
npm run adduser -- you@example.com "Your Name"
DEEPSEEK_API_KEY=sk-... npm start
```

The studio comes up on <http://localhost:8100> and games on
<http://localhost:8101>. (8090 is left alone deliberately — hyper-y, the
project this one is modelled on, defaults to it, and both are expected to run
at the same time.)

There is no signup route by design: accounts exist only because the operator
made them, and presence in the `users` table is the whole permission model.
Every account can edit every game, agent, and file.

```sh
npm test          # 263 tests, no network and no API key required
npm run smoke     # one live round trip against DeepSeek; needs the key
```

## Two ports on purpose

⚠️ Game code is written by an LLM and served to the public. On the studio's
origin its JavaScript could call `/api/*` with your session cookie and delete
every project. The games listener is a separate origin so the browser refuses
to carry the cookie there — and games keep a working `localStorage`, which a
CSP sandbox would have cost them.

In production put the two behind separate hostnames and point `GAMES_URL` at
the games one.

## Configuration

| variable | default | notes |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | required; the server exits without it |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | |
| `PORT` | `8100` | studio |
| `GAMES_PORT` | `8101` | public games |
| `GAMES_URL` | `http://localhost:<GAMES_PORT>` | used for play and preview links |
| `DB_PATH` | `gamestudio.db` | |
| `GAMES_DIR` | `games` | one directory and one git repo per project |
| `DAILY_TOKEN_BUDGET` | `5000000` | studio-wide, resets at UTC midnight |
| `TRUST_PROXY` | unset | set to `1` behind a reverse proxy |

## Using it

Make a game, then make a **helper** — a named agent with a personality, a
model, and permission to edit files or not. Add the helper to a game and it
will answer. Helpers set to "always answers" reply to everything; the others
wait to be called with `@` and their name.

Pin a file with the checkbox in the file list to point a helper at it. Helpers
see the whole project either way — pinning is emphasis, not access.

`BRIEF.md` at a project's root, if it exists, is injected into every helper's
context. It is the place for standing instructions about the game.

Every change is a version. The Versions tab shows what changed and can bring
any earlier version of a file back, as a new version rather than by rewriting
history.
