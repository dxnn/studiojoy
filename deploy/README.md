# Deploying

Behind a reverse proxy that terminates TLS, with pm2 keeping the process up
and a bare repo taking pushes.

## One app, two hostnames

`server/index.js` binds both listeners itself: the studio on `PORT` and the
public games origin on `GAMES_PORT`, in one process, deliberately separate
origins (spec.md §7). So there is **one bare repo, one remote, one pm2 app**.
A deployment guide written for a single-listener service will tell you to make
two of each; don't.

```
games.example.com   ─proxy→  localhost:GAMES_PORT
studio.example.com  ─proxy→  localhost:PORT
```

Caddy, for example:

```caddyfile
games.example.com {
    reverse_proxy localhost:3001
    encode zstd gzip
}
studio.example.com {
    reverse_proxy localhost:3005
    encode zstd gzip
}
```

## Layout

Code is disposable and force-checked-out on every push. Data is not, and lives
outside the work tree so a `git clean` in a future hook can never reach it.

```
~/apps/studio.git          bare repo, receives pushes
~/apps/studio              work tree — checked out from it
~/apps/studio.env          the key and the ports; chmod 600, never committed
~/apps/studio-data/db      SQLite: accounts and chats, the only unrecoverable thing
~/apps/studio-data/games   one git repo per game
```

## Setup

Node ≥ 24 and `git` on the server. No build step, no `node_modules`.

```sh
mkdir -p ~/apps/studio.git ~/apps/studio ~/apps/studio-data/games
git -C ~/apps/studio.git init --bare
```

Push once so `deploy/` exists on the box, then install the hook from it. The
hook is not there yet, so that first push checks nothing out — do it by hand:

```sh
# on your machine
git remote add prod user@host:apps/studio.git
git push prod main

# on the server — once, by hand; the hook does this on every push after
git --work-tree=$HOME/apps/studio --git-dir=$HOME/apps/studio.git checkout -f main

cp ~/apps/studio/deploy/studio.env.example ~/apps/studio.env
chmod 600 ~/apps/studio.env
$EDITOR ~/apps/studio.env          # the key, the ports, GAMES_URL, the paths

cp ~/apps/studio/deploy/post-receive ~/apps/studio.git/hooks/post-receive
chmod +x ~/apps/studio.git/hooks/post-receive
$EDITOR ~/apps/studio.git/hooks/post-receive   # fix PATH, see the file

pm2 start ~/apps/studio/deploy/ecosystem.cjs
pm2 save && pm2 startup        # survives a reboot
```

Every push after that deploys.

## Accounts

There is no signup route — presence in the `users` table is the whole
permission model, and it exists only because you put someone in it.

```sh
cd ~/apps/studio
DB_PATH=$HOME/apps/studio-data/db node bin/adduser.js you@example.com "Your Name"
```

## Backups

The game trees recover themselves from git. The chats and accounts only live
in SQLite, and `VACUUM INTO` is safe while the studio is running.

```sh
cd ~/apps/studio
DB_PATH=$HOME/apps/studio-data/db node bin/backup.js ~/backups/studio-$(date +%F).db
```

## Environment

`deploy/ecosystem.cjs` reads `~/apps/studio.env` and hands the values to this
process alone. Nothing is exported to the shell, to other pm2 apps, or to
anything else sharing the box.

`deploy/studio.env.example` documents every variable; spec.md §13 is the full
table. The two that only matter once there is a proxy in front:

- ⚠️ **`GAMES_URL`** — the games origin exactly: scheme, no trailing slash.
  Wrong and the preview's error reporting stops silently (its `postMessage`
  origin check is against this). Needed only because the listeners are on
  separate hostnames; on one hostname and two ports it derives itself.
- **`TRUST_PROXY=1`** — without it the login lockout and the scoreboard
  limiter see the proxy's address for every visitor and bucket them together,
  which is ten score posts a minute for the whole studio. Never set it
  unproxied: the header is then whatever the client claims.

## After the first deploy

- Sign in over https and confirm the connection pill does **not** appear. It
  is driven by the SSE stream (`server/routes/stream.js`), the one long-lived
  response, and it is what a proxy misconfigured for streaming breaks first.
  Caddy sets `flush_interval -1` for `text/event-stream` on its own; if the
  studio reads as disconnected while the process is plainly up, exclude that
  content type from `encode`.
- Open a game's preview, break it on purpose, and confirm the problems panel
  fills. That exercises `GAMES_URL` end to end.
