## 11. Auth details

- Passwords: `scrypt` (`node:crypto`), 16-byte salt, N=16384, r=8, p=1,
  64-byte key, stored as `scrypt$<N>$<r>$<p>$<salt_b64>$<key_b64>`.
- Sessions: 32 random bytes base64url in a `session` cookie — `HttpOnly`,
  `SameSite=Lax`, `Path=/`, `Secure` iff `NODE_ENV=production`, `Max-Age` 400
  days (the most a browser keeps a cookie), re-issued on every `GET /api/me`
  so the days count from the last visit. ⚠️ It had no `Max-Age` once, which
  makes a cookie a *browser-session* cookie — gone when the browser closes —
  so everybody signed in again every time they opened the studio. The row
  behind it still never expires; only the cookie's life changed.
- Player sessions: the same shape in a `player` cookie on the games origin,
  with a 90-day `Max-Age` and a matching row-age check (§3). The two never
  cross: each origin resolves only its own table, so neither token is worth
  anything to the other side.
- The waiting list: `POST /_signup` validates and hashes up front, writes a
  `signups` row, and answers the same 202 whether or not it wrote — a public
  form does not disclose what an address is to this studio. Approval and
  refusal are admin routes on the studio origin (§6); approval makes a
  player account with the password chosen at sign-up.
- Constant-time login: an unknown email is still verified against a cached
  dummy hash so timing doesn't disclose existence.
- Account creation: `npm run adduser -- <email> "<Display Name>"` prompts for
  a password on stdin with echo off, and the admin panel does the same thing
  from a browser.
- ⚠️ Account **removal** is a terminal job and only a terminal job — no route,
  no button (§3 has why). `npm run deluser -- <email>` sets `users.deleted = 1`
  and drops their sessions, never a DELETE; `npm run restoreuser -- <email>`
  puts them back, and with no email it lists who is out. `deluser` refuses the
  last admin, the same wall the panel keeps against demoting one.
- A removed account takes the unknown-email path at login: the same 401, the
  same dummy-hash derivation, so the form does not say who was taken out. A
  player account takes it at the *studio* door for the same reason — which
  kind of account an address carries is not the form's to say. On the games
  origin both kinds sign in, and a removed account neither.

### Who may change what

The studio has exactly one role: `users.admin`, which is about running the
studio — accounts, names, passwords, allowances, the studio-wide budget — and
nothing about games. An admin has no more right to somebody's game than
anybody else; authorship is a separate question with a separate answer.

**Studio access** — `users.studio_access`, which every account had implicitly
before the bit existed — gets you into the studio and lets you **read** all
of it: every game, every version, every conversation, every file. That is
deliberate — the studio's people are a handful who know each other, and a
studio where you cannot see how somebody's game works is not a studio. A
player account has none of that: it is a name on scoreboards and a games-
origin login, and inside the studio it exists only as a row in the admin
panel, where the toggle can make it either kind.

**Changing** a game takes being one of its **authors** — the person who made
it, plus anyone an author has added — or the game being **open**, which its
authors set when they want the whole studio in it. `canEdit` in
`server/authors.js` is the whole rule, and `requireProject({ write: true })`
in `routes/helpers.js` is the one place it is applied: a route says it writes,
and saying so is what makes it refuse. A route that means to be an exception
says `anyone: true` and takes the check itself.

Two exceptions, both on purpose:

- ⚠️ **The human-only chat of every game is everyone's.** Anyone in the studio
  may post in it, whoever's game it is. Talking to the people here is not
  editing their game, and a game you can see but cannot say a word about is a
  strange thing to be able to see. Every other chat takes the game's own rule.
- ⚠️ **The author list is authors-only, even when the game is open.** Open
  means anybody may work on it, not that anybody may decide who does — so
  `POST /authors`, `DELETE /authors/:id` and `POST /open` all require
  authorship rather than editability. Without that, "open" would be a door
  anybody could lock behind them.

**Forking is not editing.** A copy takes nothing from the original, so anyone
who can read a game can copy it; the copy belongs to whoever made it, and is
not open even if the original was.

**Archiving is the originator's alone, and one way.** `projects.created_by` —
the person who made the game, display-only until now — is the one account
`POST /archive` accepts, whoever else may edit and however open the game is:
taking a game out is about the game, not about editing it. A published game
cannot be archived; it comes out of the games list first, in the same menu.
And nothing over the wire unarchives: `npm run unarchive -- <slug>` is the
way back, at a terminal, the way `restoreuser` is for an account — rare,
deliberate, and never a button somebody is tempted to press. An originator
who has been *removed* leaves a game nobody can archive from the studio; the
terminal still can, by hand.

The client mirrors the rule rather than enforcing it: `frozen()` in `main.js`
is `archived || !can_edit`, and every control that was disabled for an
archived game is disabled for somebody else's. The server is what refuses.

### Accepted security tradeoffs (v0)

- **No CSRF token.** `SameSite=Lax` plus the `readJson` content-type guard
  (§7), which bounds a cross-site forgery to `POST /api/logout`.
- **Lockout state is in-memory.** A restart clears all lockouts.
- **Studio sessions never expire.** No rotation, and no expiry on the row: a
  session lasts until a removal, a password change, or the studio-access
  toggle deletes its row, or the browser loses the cookie — which, with a
  400-day `Max-Age` refreshed on every load, it does only after more than a
  year away. Expiry and rotation are deferred to v1 (§15) and belong to the
  same gate as the rest of this list. Player sessions are the exception, 90
  days, because their door is public.
- **No rate limiting outside login, the scoreboard and the sign-up.** An
  authenticated user can flood message posts and file writes on a game they
  may change; bounded only by the token budget and size caps. The trust
  boundary here is the account list, which the operator and the admins
  control by hand — the waiting list widens who can *ask*, never who gets
  in. The public writes are rate limited because their writers are the
  public, not the account list (§6, §10).
- **`.svg` is served to the public.** On the games origin that's harmless —
  scripts inside it can't reach the studio origin or its cookie.
- **Binary files are trusted by extension.** No magic-number validation;
  `nosniff` plus the extension-derived Content-Type covers the obvious cases.
- **Agents can delete files.** `delete_file` is offered because git makes it
  recoverable. A misbehaving prompt can still empty a working tree, and
  recovery is a manual `restore` per path.
- **The whole working tree goes to DeepSeek on every fire.** Ambient context
  (§8) means anything committed to a project — including a stray file with
  something private in it — is sent to a third-party API. The mitigation is
  scope, not code: projects hold game source, nothing else.
