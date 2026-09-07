// Who hears about a message, and telling them (spec/ §6,
// ideas/notifications.md). The crypto is server/push.js; this is the part
// that decides.
//
// Every studio account can see every project (§3), which is what the broker
// says too — "there is no membership to filter on". So the audience is the
// studio minus the person who spoke, narrowed to whoever has actually asked
// to be told, which is what having a row here means.
//
// ⚠️ Nothing here asks whether somebody is *looking*. The service worker
// does, because only it can: a connected stream is a tab that exists, not a
// tab anybody is reading, and the two are different rooms of the house. A
// notification the worker suppresses costs one push; one wrongly suppressed
// here is a message nobody hears about.

import { sendOne } from './push.js';

const MAX_BODY = 120;

// The row a browser gets to keep. Nothing else about it is stored, and the
// keys are the browser's own — the studio cannot read its own pushes back.
export function subscribe(db, userId, { endpoint, p256dh, auth }, now = new Date()) {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       created_at = excluded.created_at`,
  ).run(userId, endpoint, p256dh, auth, now.toISOString());
}

// ⚠️ Scoped to the caller, so knowing somebody else's endpoint is not a way
// to switch their notifications off.
export function unsubscribe(db, userId, endpoint) {
  return db
    .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(userId, endpoint).changes;
}

// Everybody still in the studio who has asked, except whoever spoke. A player
// has no studio doors (`studio_access`), and a removed account has none at
// all — belt as well as braces, since removal drops these rows outright.
export function audience(db, exceptUserId) {
  return db.prepare(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s JOIN users u ON u.id = s.user_id
      WHERE u.deleted = 0 AND u.studio_access = 1 AND s.user_id IS NOT ?`,
  ).all(exceptUserId ?? null);
}

// What the browser is told. The same words rung 1 puts together in the
// client, because it is the same notification — and it is the whole message
// this studio will ever send through a push service, which is why it is
// worth encrypting: a game's name and who said what is nobody else's.
export function messageText(db, message) {
  const who = message.user_name
    ?? (message.agent_id === null ? null : db
      .prepare('SELECT name FROM agents WHERE id = ?').get(message.agent_id)?.name)
    ?? 'Somebody';
  const said = (message.body ?? '').trim().replace(/\s+/g, ' ');
  const project = db
    .prepare('SELECT name FROM projects WHERE slug = ?').get(message.project_slug);
  return {
    title: project?.name ?? 'The studio',
    body: `${who}: ${said.length > MAX_BODY ? `${said.slice(0, MAX_BODY - 1)}…` : said}`,
    slug: message.project_slug,
    chat: message.chat_id ?? null,
  };
}

// Tell everybody who asked. Never awaited by a route or a turn: a push
// service being slow must not hold up a reply landing in the thread, and a
// message that is in the thread is the thing that actually matters.
//
// ⚠️ 404 and 410 mean the browser threw the subscription away on its side;
// the row goes with it, or the table grows for ever and every send after
// that is a request nobody will ever read.
export async function tell(db, config, message, fetcher = fetch) {
  if (!config) return 0;
  const rows = audience(db, message.user_id);
  if (rows.length === 0) return 0;
  const payload = JSON.stringify(messageText(db, message));
  let sent = 0;
  await Promise.all(rows.map(async (row) => {
    const status = await sendOne(row, payload, config, fetcher);
    if (status === 404 || status === 410) {
      try {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
      } catch { /* the database may have closed while this was in flight */ }
      return;
    }
    if (status >= 200 && status < 300) sent += 1;
  }));
  return sent;
}
