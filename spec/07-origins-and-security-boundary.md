## 7. Origins and the game-code security boundary

⚠️ Game code is written by an LLM and served to the public. If it ran on the
studio's origin, its JavaScript could call `/api/*` with the operator's
session cookie and delete every project.

So the studio and the games are served on **separate origins** by two
listeners in the same process. `localhost:8100` and `localhost:8101` are
distinct origins to the browser: `fetch('/api/…')` from a game hits the games
server (which has no such route), each origin gets its own `localStorage` — so
games keep working save state, which a `CSP: sandbox` approach would have cost
— and no studio response is *readable* from a game, because the studio sends
no `Access-Control-Allow-Origin`. There is no CORS configuration here to
loosen, and adding one is what would turn a blind write into a read.

⚠️ What two ports on one hostname do **not** buy is a withheld cookie.
Cookies are not port-scoped (RFC 6265 §8.5), so a session set for `localhost`
is sent to `localhost:8101` as well; and `SameSite` keys on scheme plus
registrable domain while ignoring port, so `:8101` → `:8100` counts as
same-site and `Lax` does not restrain it. Game code therefore cannot read the
studio API, but it can reach it with the operator's session attached. Three
things bound that today: the games listener has no route that reads the
`session` cookie — the one cookie it reads is its own `player` cookie, which
resolves only `player_sessions` — so a replayed studio session drives nothing
there (tested); `readJson` answers 415 to
any body not declared `application/json` (tested), so a forged `POST` either
carries a CORS-safelisted type like `text/plain` — sent without preflight,
bounced before its handler runs — or declares JSON and needs a preflight the
studio never grants; and every other write method (`PUT`, `PATCH`, `DELETE`)
preflights regardless of its declared type. What a page on another origin can
still drive is `POST /api/logout`, the one `POST` that reads no body — a
forged one costs the operator a sign-in and nothing else. Separate hostnames
in production remove the shared cookie domain that makes even that reachable.

⚠️ Player sign-in put a password form on the origin that serves LLM-written
code, and that is the new edge of this boundary. A game is same-origin with
the catalog, so left alone it could iframe `/` — or script a window it
opened onto it — and read the form as it is typed, and for a studio person
the password typed there is the studio password. Two headers on the catalog
close both hands: `Content-Security-Policy: frame-ancestors 'none'` (the
studio frames games, never the catalog, so nothing legitimate breaks) and
`Cross-Origin-Opener-Policy: same-origin`, which severs the opener handle so
`window.open('/')` from a game hands back a window it cannot touch. What a
game *can* still do is drive the three authenticated routes with its
player's cookie — post a score as them, read their alias at `/_me`,
log them out — which is the accepted floor: a game already speaks for its
player, and the token opens nothing anywhere else. The player cookie is
`HttpOnly`, `SameSite=Lax`, `Secure` in production, `Max-Age` 90 days, like
the studio's but expiring (§11).

⚠️ **The games origin never says an account's name — only its alias** (§3).
The boundary is drawn in the data rather than in each page: what this origin
knows of a signed-in player is an id and an alias (`playerForToken`), board
rows hold the alias, and the players page joins aliases, so there is no name
here for a page or a game to leak. The studio says the name, as it always
did. The floor above is also why an alias is changed only on the studio
origin: a route here would be one more door every game could drive with its
player's cookie, and *rename this player* is not a door to leave a game. A
test walks every answer this origin gives about people and looks for the
name in each (`test/alias.test.js`). `robots.txt` asks every crawler to stay
out, since an unlinked hostname is in certificate logs all the same.

⚠️ Nor is the cookie scoped to the game that is open. Every game shares this
origin, so game A can post to game B's board as its player — and no credential
kept in the browser could have been scoped either, since game A could as well
have asked for game B's token. The row names the player, not the game's
author; the answers are clearing that board under Share — whole, since one
row has no route (§6) — and `npm run deluser -- <email> --scores` for the
player, and the only real scoping would be an origin per game, a deployment
change nobody has needed (ideas/scoreboard-trust.md).

In production the two listeners sit behind separate hostnames
(`studio.example.com`, `games.example.com`), and `GAMES_URL` names the games
one. Left unset — the default — the studio derives the games origin from each
request's own `Host`: same hostname, `GAMES_PORT` in place of `PORT`. So no
hostname is configured anywhere and the studio answers correctly at every name
it can be reached by; reached at `chunk.local:8100`, it plays games at
`chunk.local:8101`. Only the hostname is taken from `Host` — the scheme is
always `http`, the port is always `GAMES_PORT` — and a `Host` that is not a
plausible hostname yields no games origin at all, making `play_url` `null`
rather than a URL built around a guess.

Header posture:

- Studio origin: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, no `X-Powered-By`.
- Games origin: `nosniff` and `Referrer-Policy: no-referrer` only —
  deliberately **not** `X-Frame-Options`, because the studio embeds the game
  in a preview iframe. The catalog page alone adds `frame-ancestors 'none'`
  and `COOP: same-origin`, for the password form above.

No CSRF token in v0: the session cookie is `HttpOnly`, `SameSite=Lax`,
`Secure` when `NODE_ENV=production`. The content-type guard above stands in
for it — a token would close the logout residue and nothing else.

Each origin is also its own installable PWA — a manifest and service worker
are scoped per-origin, so one studio person installing the studio and the
catalog gets two distinct home-screen apps, named "Unbridled Joy Studio" and
"Unbridled Joy". The studio's live at `/manifest.json` and `/sw.js`; the
games origin's at the underscore-prefixed `/_manifest.json` and `/_sw.js`
(plus `/_icons/*`), following the same can't-collide-with-a-slug convention
as `/_players` and the rest. Neither service worker caches anything —
`fetch` is a no-op in both — since there is no build step or filename hashing
to make a cache-first strategy safe, and the catalog is personalized per
request (sign-in state, live scores) so it must never be served stale. The
games origin's does nothing else at all. The studio's has one more job:
showing a *notification* and handling a press on one (§6), because a plain
`new Notification` never fires on an installed iOS PWA — so even a page in
the foreground has to go through its registration. `playersPage()` stays scriptless as before: it carries the
manifest `<link>` but does not register the service worker, which
`catalogPage()` already does for the whole origin.
