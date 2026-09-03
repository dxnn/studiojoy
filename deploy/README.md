# Deploying

Behind a reverse proxy that terminates TLS, with pm2 keeping the process up
and a bare repo taking pushes.

## One app, two hostnames

`server/index.js` binds both listeners itself: the studio on `PORT` and the
public games origin on `GAMES_PORT`, in one process, deliberately separate
origins (spec/ §7). So there is **one bare repo, one remote, one pm2 app**.
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

`encode` renames a strong ETag per encoding (`"<sha>"` becomes `"<sha>-zstd"`)
and strips its suffix from `If-None-Match` only — never from `If-Match`, which
is what the editor's save sends. The studio's `If-Match` check compares the
sha inside the tag rather than the exact string, so compression can stay on
for the whole site; nothing here needs excluding from `encode`.

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

pm2 start ~/apps/studio/deploy/ecosystem.config.cjs
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

Skip this entirely if you are moving an existing studio: accounts travel in
the database, password hashes included.

After the first account, adding people is easier from the admin panel in the
browser. ⚠️ Taking somebody out is not there and never will be — it is a soft
delete, one bit and their sessions with nothing thrown away, and it only
happens here:

```sh
DB_PATH=$HOME/apps/studio-data/db node bin/deluser.js them@example.com
DB_PATH=$HOME/apps/studio-data/db node bin/restoreuser.js            # who is out
DB_PATH=$HOME/apps/studio-data/db node bin/restoreuser.js them@example.com
```

⚠️ Their address stays theirs while they are out, so `adduser` will refuse it
and tell you to restore instead — which is what you want, since a second row
would split their messages and their games across two people.

## Moving an existing studio onto the server

Two things move, and they have to agree: the database, and the game trees.
A project row without its directory is a game whose files 404; a directory
without its row is not public at all. Chats have no directory, so nothing on
disk corresponds to them.

⚠️ Copy the database with `bin/backup.js`, never by copying `gamestudio.db`.
The studio runs in WAL mode, so recent writes live in `gamestudio.db-wal`
until a checkpoint — the `.db` file on its own can be hours stale.
`VACUUM INTO` folds the WAL in and reads a consistent snapshot even mid-write.

Stop the old studio first. Not for safety — the snapshot is safe against a
live database — but because it is the cut-over: anything written after the
snapshot stays behind, and there is no merge path back.

```sh
# on the old machine, studio stopped
node bin/backup.js tmp/migrate.db
scp tmp/migrate.db user@host:/tmp/migrate.db
rsync -av --exclude='.claude' games/ user@host:apps/studio-data/games/
```

`rsync` carries each game's `.git` with it, which is the history. Don't run
it under `sudo`: git refuses to operate on a repository owned by another
user, and the files need to belong to whoever pm2 runs as.

```sh
# on the server
pm2 stop studio

# the empty database the first boot created — moved aside, not deleted,
# and with it the WAL and shared-memory files that belong to it
cd ~/apps/studio-data
for f in db db-wal db-shm; do [ -e "$f" ] && mv "$f" "$f.empty"; done

mv /tmp/migrate.db ~/apps/studio-data/db
pm2 start studio
pm2 logs studio --lines 20
```

The "no accounts yet" line not appearing is the confirmation: the database
that came up is the one that travelled.

From then on the server is authoritative. Running the old studio again edits
a tree the server never sees, and the two have no way to reconcile.

## Working on the games from your laptop

Each game is its own git repository and the server's copy is the one people are
editing, so a local copy is a clone rather than a fork: point it at the server
and the two stay one history. This is the way to make a change that no helper
should have to make — a sweep across every game, a rename that has to land in
ten places at once — with the tools on your own machine.

```sh
deploy/sync-games.sh user@host link     # add the remote, clone what is missing
deploy/sync-games.sh user@host status   # behind / ahead / uncommitted, per game
deploy/sync-games.sh user@host pull     # fast-forward only; refuses if diverged
deploy/sync-games.sh user@host push     # send local commits back
```

⚠️ `push` needs one thing on the server, and it is worth doing once rather than
once per game: a game repo there has its branch checked out, and git refuses to
push into that by default.

```sh
git config --global \
  "includeIf.gitdir:/home/ubuntu/apps/studio-data/games/.path" \
  /home/ubuntu/.gitconfig-games

git config --file /home/ubuntu/.gitconfig-games \
  receive.denyCurrentBranch updateInstead
```

A conditional include covers every repo under that directory, including games
the studio has not created yet: the setting is read by `receive-pack` at push
time, so the `git init` that makes a new game never needs to know about it.
Setting it per repo works too, and is the trap — it comes apart on the first
game made after somebody last ran the loop, silently, months later. Scoping it
this way rather than setting `receive.denyCurrentBranch` globally also keeps it
off every other repo on the account; `studio.git` is bare, where the setting is
inert either way.

⚠️ Three ways to get it wrong, all of them silent. The **trailing slash** is
what makes it mean "anything under here" — without it nothing matches. The
pattern is compared against the **resolved** path, so write out what `readlink
-f ~/apps/studio-data/games` prints rather than assuming. And let `git config`
write the file: the `includeIf` subsection quoting is the part that is easy to
break by hand.

Check that it took, before pushing anything:

```sh
git -C ~/apps/studio-data/games/asteriskoids config --get receive.denyCurrentBranch
```

Empty means the include is not matching, and the trailing slash is the first
thing to look at.

`updateInstead` is the mechanism rather than a workaround: it moves the
server's **working tree**, which is what the studio reads and what the games
origin serves, so the push is the deploy. It refuses if that tree has
uncommitted changes in it, which is the safety worth having.

Three things to know:

- **The studio does not hear a push.** A commit made through the studio
  broadcasts `files.changed` and every open browser follows it; a push arrives
  behind the studio's back. The files are right immediately — everything is
  read from disk per request — but a browser already looking at that game shows
  what it last fetched until it is reloaded.
- **Push when nobody is mid-turn on that game.** A helper's write and its
  commit are one step apart, and a push landing exactly between them is
  refused rather than merged. Rare, and harmless when it happens.
- **Never force.** If the server moved too, the push is refused because
  somebody's work is on the other side of it: pull, rebase, push again.

## Backups

The game trees recover themselves from git. The chats and accounts only live
in SQLite, and `VACUUM INTO` is safe while the studio is running.

```sh
cd ~/apps/studio
DB_PATH=$HOME/apps/studio-data/db node bin/backup.js ~/backups/studio-$(date +%F).db
```

## Environment

`deploy/ecosystem.config.cjs` reads `~/apps/studio.env` and hands the values to
this process alone. ⚠️ The `.config.cjs` ending is load-bearing: pm2 decides
whether a file is a process definition or a script to execute by matching its
name, and anything else — `ecosystem.cjs` included — is run as a script and
comes up under the wrong name doing nothing. Nothing is exported to the shell, to other pm2 apps, or to
anything else sharing the box.

`deploy/studio.env.example` documents every variable; spec/ §13 is the full
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
- Open a game's preview, add a `console.error('reporter check')` to any source
  file, and confirm the problems panel fills and the tab reads `Play ⚠`.
  ⚠️ This is the only check that catches a **redirecting** `GAMES_URL`. Name a
  hostname that 301s to another — `www.` when the certificate is on the apex,
  say — and the preview still plays the game, but the frame now posts from the
  origin it was redirected to while the studio compares against the one it was
  configured with, so every report is dropped in silence (`public/main.js`).
  A game that can never report a problem is a helper that can never be told
  about one.
