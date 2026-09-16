## 5. Version control

One git repository per project, at the project directory root.

- On create: `git init -q`, then an empty initial commit, so `git log` never
  fails on a fresh project.
- Every mutation is on disk before the HTTP response returns, and every one
  but a **save** is committed by then too. A save — `PUT /files/*path`, which
  is what every editor's autosave and every upload is — opens or joins the
  project's **pending commit** instead: one window per project holding whose
  saves and which paths, landing as one commit when the writer has been quiet
  for 45 s, when their client says it is leaving (`POST /commit`: another
  game, another scene, the tab closing), and ⚠️ always before anybody else
  writes to the tree, before a helper fires, and before anything that reads
  the tree into history or rewrites it — a move, a delete, a duplicate, a
  copy in, a restore, a rollback, a fork, an archive. So a run of saves is one
  version, Versions never shows a person's work under a helper's name, and a
  fork never misses the line typed a moment ago. Reads never land it: a
  version count after every save would be a commit after every save. A
  response says `pending: true` when it opened or joined the window and
  `false` when the bytes were identical and nothing is owed.
- Why: a commit costs a Versions row, a preview restart, and a prompt-cache
  miss for every helper from that file onward (§8), and an editor that saves
  itself would pay all three per line typed. Scores went into SQLite for the
  same reason (§3).
- The pending commit is in memory. A crash inside the window loses the
  *attribution* of one person's last 45 s, never the bytes: the tree still
  holds them, and the next commit to name those paths picks them up. A clean
  shutdown lands every window first.
- ⚠️ Startup lands whatever a game's tree is still holding, before either
  listener binds (`server/files/reconcile.js`). A clean shutdown settles every
  window and a helper's turn commits its own, so a tree dirty at this point was
  left by something that ran neither — a hard kill, or a commit that threw —
  and nothing else would ever name those paths. One commit per game as
  *Unbridled Joy*, subject `work left uncommitted when the studio stopped`:
  the window that knew whose work it was went with the process, and an honest
  name in Versions beats a guessed one. Ignored files stay out, since nothing
  named these paths and `.gitignore` is the only word available on what
  belongs. A game that cannot be landed is logged and the rest still are.
- ⚠️ A commit names its own paths, so a path that exists in neither the working
  tree nor HEAD is dropped before `git add` rather than passed to it. One such
  name — a scratch file a helper wrote and removed inside its own turn — fails
  the *whole* pathspec, and the turn's other writes went down with it: the
  commit threw, the fire ended in its outer catch, and because every commit
  here is path-scoped no later save, turn or sweep ever named those paths
  again. The files stayed in the tree, absent from Versions, and the only
  symptom was `deploy/sync-games.sh push` being refused days later. Measured on
  `a-new-game`, 2026-09-15.
- A commit that fails for any other reason is reported and not thrown: the
  reply's message row is still written, the room is told the change is saved
  but not in Versions, and the fire does not end in the outer catch. The
  bytes are on disk either way; what is at stake is whether anything names
  them.
- A person and a helper writing the same file in the same window is the same
  logical lost update two agents can make (below): the helper's write lands
  the person's window first, so what the tree held is history under the right
  name, and what was overwritten in between is not. Accepted.
- Committer identity is passed per invocation — `git -c user.name=… -c
  user.email=… commit …` — so the app never depends on, or writes to, the
  operator's global git config. Humans commit as their display name and email;
  an agent commits as `<agent name> <slug>@agent.gamestudio.local`.
- Every git subprocess runs with `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_TERMINAL_PROMPT=0` so hooks, templates,
  and credential helpers from the host can't interfere.
- ⚠️ …and with `-c core.quotePath=false`. Git escapes every non-ASCII byte in a
  path it prints, so `café.png` comes back from `log --name-only` as
  `"caf\303\251.png"` — a name that matches nothing in the file listing, which
  is read from the filesystem. A studio used by kids will have those names, and
  the versions list compares the two.
- One commit per agent turn, covering every file that turn wrote — history
  reads as one entry per exchange rather than one per tool call. A person's
  saves are one commit per run of them (above): `create a.txt`, `update 3
  files`.
- Restore never rewrites history: read the old blob, write it to the working
  tree, commit as a new commit.
- **Rollback** is restore one scope up: every file goes back to how it was at
  some commit, anything made since is removed, and the lot lands as one new
  commit. Same rule — history is never rewritten, which is what makes a
  rollback itself undoable by rolling back again. The tree is written with a
  single `git checkout <sha> -- .` rather than a blob read per path; the
  deletions go through `removeFileAt` so they tidy the directories they empty.
  Rolling back to a commit whose tree already matches is a no-op, not an empty
  commit. What it deliberately is *not* is `git revert`: undoing one commit in
  the middle of history can conflict, and a merge conflict has no answer in an
  interface used by kids.

### Serialization

All mutations for a project are serialized through an in-process per-project
promise chain (a `Map<slug, Promise>` mutex). This is what makes concurrent
agents safe: without it, agent A's `git add` could sweep up agent B's
half-written file. Agents still *stream* concurrently — only the write+commit
step is exclusive.

Two agents editing the *same* file in the same turn is a logical lost update:
the second write wins and the first is preserved only in git history. Accepted
in v0.

The database and the git repo are two stores with no transaction between them.
Nothing cross-references, so the failure mode is benign: a crash between write
and commit leaves a file that the next commit picks up. The invariant that
matters (§12) is that no HTTP response reports success before its commit
lands.
