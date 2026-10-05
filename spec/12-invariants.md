## 12. Invariants

Tests enforce each of these.

- Every path accepted by the API resolves inside its project directory, and no
  path with a `.git`-prefixed segment is ever read, written, or served. ⚠️
- The games listener never reads the `session` cookie — the `player` cookie
  is the only one, it resolves only `player_sessions`, and neither origin's
  token means anything to the other. It serves nothing but a project's own
  files, the catalog, the wrapper — that project's own `index.html` with a
  script in front of it — a live listing of its `assets/`, the scoreboard
  and achievements, and the pictures of gear (`/_gear/:id`, for the makers'
  avatars on the catalog); its writes are
  scoreboard, personal-best, achievement and waiting-list rows: bounded
  tables, never a working tree. ⚠️
- The games origin never says an account's `display_name` — only its
  `alias`, on every board, page and answer about a person — and has no route
  that changes either (§3, §7). ⚠️
- The preview is never on a board: the preview player answers a score or an
  achievement posted with `fetch` or `sendBeacon` inside the page, and those
  requests never reach the games origin (§6).
- Joy is made in one place: the first time somebody earns an achievement of a
  published game they are not an editor of, in the transaction that writes
  the `achievements` row, as much as the chips on it. Chips are made in one
  place: the weekly grant, into a stash that never passes 50. Both are
  `ledger` rows and nothing else — no file holds either (§3). ⚠️
- The robot plays only in the preview: a game's `js/robot.js` is put on the
  page by the preview's wrapper alone, never by a game's own `index.html`
  served to a player, and its rolling savepoints never replace the person's
  pin (§6).
- An `achievements` row is never deleted by any route, and the definitions
  behind it live only in the game's `config/achievements.js`, read per request
  and never in a table: removing a definition hides its rows, it does not drop
  them. ⚠️
- A `signups` row is never an account and never deleted: only an admin's
  approval makes the account, with game access only, and a decision is
  columns on the row. ⚠️
- No HTTP response reports a successful file mutation before its bytes are on
  disk, and none but a save's before its git commit has landed. A save's
  commit is the project's *pending commit* (§5): it lands on the idle timer,
  on the client leaving, and always before any other author's commit, any
  helper's fire, and any move, restore, rollback, fork or archive — so no
  commit ever carries another person's uncommitted work, and no history read
  that writes misses one.
- At most one write+commit runs at a time per project.
- Taking somebody out of the studio deletes no row. Their sessions go — both
  kinds — and `users.deleted` is set; every path that grants access minds
  that bit, and every rendered name does not, so the removal is undone by
  clearing it. `studio_access` is read on the same access-only line. ⚠️
- A `messages` row never has both `user_id` and `agent_id` set.
- No reasoning trace is ever written to `messages.body`, to a receipt, or
  replayed into a later fire. Within one fire a capped trace is handed on
  once, as text on a user turn — to the same turn's retry, or to the sizing
  call — and the receipt's prompt keeps a placeholder where it rode (§8).
- No picture's bytes are ever written to a receipt either: `look_at` and
  `look_at_game` put one on a `role: 'tool'` result inside a fire, and the
  receipt's prompt keeps a placeholder beside the label it rode with (§8, §14).
- A **shot** commits nothing. Like a score, it is a row — one per project,
  replaced — so seeing the game never moves a version, restarts a preview or
  enters history (§3, §8).
- An image never rides the system prompt. The API refuses one there (§14), so
  the ambient file block names a picture and `look_at` shows it.
- Every room in a game is the humans' or a builder room, and a builder room
  holds the builder and nobody else: one rule, `takesHelpers`, refuses every
  other helper there at the attach route and at a mention alike; no route
  puts the builder in a chat project or takes it out of its room, and nothing
  edits or deletes its row. A chat project's helper has no tools, so tools
  are the builder's by construction (§3, §8).
- An agent message never makes an agent eligible to respond.
- An agent whose `cooldown_until` is in the future cannot post a message.
- `studio_state.tokens_used_today` is monotone non-decreasing within a UTC day,
  and `budget_reset_at` is always strictly in the future of the value used to
  compute it.
- An archived project rejects every write with 409, while its game stays
  publicly served. Only its originator can archive it, never while it is
  published, and only its originator can unarchive it (`npm run unarchive`
  is for the game whose originator has been removed).
- A project's git repository has at least one commit from the moment the
  project exists.
- A game's `type` is written at creation and changed once after, by Make it,
  from `'design'` — never by a file write. A game in Game Design has no
  builder room until then, and a restart does not give it one (§3, §6).
- The sweep adds a core library a game lacks and raises every one it holds,
  and never adds an extra; an extra reaches a game only from its template's
  `libraries` at creation or `POST /api/projects/:slug/libraries`, named by
  key against the studio's own index, the bytes always the studio's.
- A chat has nothing on disk: no directory is created for it, every route that
  would reach one answers 409, and the games origin answers 404 for its slug
  even if a directory with that name exists.
