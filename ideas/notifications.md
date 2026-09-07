# Telling somebody something happened

The studio marks a game, a chat and a pill when somebody speaks in a room you
are not reading (spec/ §3). That works while you are here. Nothing at all
happens when you are not — a helper finishes a game at half past four and you
find out at bedtime, and the two people who share a game find that out about
each other too.

Web push is listed as deferred in spec/ §15 and as a non-goal in §2, both
saying "exists in `new-y`". This is the note that undeferres it.

## What `new-y` has, and what of it transplants

`new-y` runs the whole thing: permission asked from a gesture, the service
worker's `showNotification` (a plain `new Notification` will not fire on an
installed iOS PWA), one per conversation with `tag` and `renotify` so a
burst collapses, and `notificationclick` focusing an open tab and telling it
which conversation to open, or opening a window at that conversation. All of
that transplants as a shape.

One thing does not. `new-y` gets its server half from the `web-push` npm
package, and this studio has **no runtime dependency** — `npm ci --omit=dev`
is the whole install, and that is worth more than the fortnight of work the
package saves. So the sending half is hand-rolled or it is not built.

## Two rungs

The first is a prerequisite for the second, so they are in this order whatever
happens to the second.

### Rung 1 — the app is running

The tab is open behind something else, or the installed PWA is in the
background. A message lands. The studio shows an OS notification, and pressing
it comes back to that conversation.

Everything it needs is already here: `message.new` carries `project_slug`,
`chat_id`, `user_name`, `agent_id` and `body` (§9), and `applyMessage` in
`stream.js` already decides, in one place, that somebody else spoke into a
room you are not reading — that decision *is* the unread mark, and it is
exactly the notification's rule too. So the whole rung is a client change: a
module, a handler in `sw.js`, one call in `stream.js`, and a control.

Only while `document.hidden`. The marks are what the studio says while you are
looking at it, and a notification over the top of them is saying it twice.

The control belongs in the sidebar's `who` row, beside `Sign out`: it is about
you rather than about any game, and that row is the only thing in the studio
that is. Four states, and one of them is not offered at all:

| state | the button |
| --- | --- |
| no `Notification` in this browser | absent — a control that cannot be pressed is left out |
| permission not asked yet | offered; the press is the gesture that asks |
| granted | on/off, remembered per browser |
| denied by the browser | offered, and the press says where to turn it back on |

The last row is the one worth arguing about. The studio's rule is that a
control you cannot press is left out, because the answer to "why is this
grey" is not something a bar can give. Here it can: a denied permission has a
real answer ("this browser is blocking them — turn them back on in its
settings"), and a person who has just pressed a bell twice with nothing
happening deserves to hear it.

### Rung 2 — the app is closed

This is the one that means "for the PWA": a phone in a pocket.

Two pieces of crypto, both `node:crypto` webcrypto, both testable offline
against the RFCs' own vectors, which matters because the alternative is
testing against Google's servers:

- **VAPID** (RFC 8292): an ES256 JWT over the push endpoint's origin, with
  `aud`, `exp` and `sub`, sent as `Authorization: vapid t=<jwt>, k=<key>`.
  About thirty lines. The key pair is generated once by a script and lives in
  `studio.env`; the public half is served to the client so it can subscribe.
- **`aes128gcm`** (RFC 8188, applied by RFC 8291): an ephemeral P-256 pair,
  ECDH against the subscription's `p256dh`, two HKDF-SHA256 passes to a
  content key and a nonce, then AES-128-GCM over the padded payload. The body
  is `salt(16) || rs(4) || idlen(1) || as_public(65) || ciphertext`. About
  seventy lines. RFC 8291 §5 carries a complete worked example, which is the
  test.

This is what buys the message text travelling through Apple's and Google's
push services unreadable by them, which matters here: the studio is a few
people and their kids talking.

Around it:

- `push_subscriptions` (`user_id`, `endpoint` UNIQUE, `p256dh`, `auth`,
  `created_at`), the same shape `new-y` settled on. Endpoint unique means a
  second person signing in on the same browser takes the row over, which is
  right: the first can no longer be reached there.
- Subscribe and unsubscribe routes, and the public key on `/api/me` or its
  own route. Push absent from the environment is a 404 and the client falls
  back to rung 1 silently rather than showing an error about a thing nobody
  asked for.
- Fan-out from the same place rung 1 fires from, server side: everybody in
  the project except the author, minus whoever the broker can see is
  connected. ⚠️ 404 and 410 from the push service mean the browser dropped
  the subscription; the row goes with it, or the table grows for ever.
- `bin/pushkeys.js` to make the pair, and `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` in `deploy/studio.env.example`.

⚠️ Neither rung can be finished from a coding agent's sandbox. Rung 1 needs a
browser with a real permission prompt; rung 2 needs a real push endpoint and
a real phone. What a machine here can check is the crypto against its vectors,
the shape of the request, and the client's own decisions — which is most of
what goes wrong, and none of what is scary.

## Things settled while writing this

- **A notification is never a game's.** It is the studio talking, so it wears
  the studio's icon and not the game's `icon.png`, whatever it is about —
  the same reason the sidebar stays cyan.
- **No count.** A count of unread messages is still deferred (§15), and a
  notification saying "3 new" would build one by the back door.
- **Nothing new is stored for rung 1.** Whether you want them is a browser
  preference, next to the rail width and the open tab — not a column. It is
  per browser because permission is per browser: a row saying yes on a
  laptop that has denied it is a row that lies.
