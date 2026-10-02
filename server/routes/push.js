import { json, noContent, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { subscribe, unsubscribe } from '../notify.js';

// Web push (spec/ §6, ideas/notifications.md rung 2): three small routes so a
// browser can say where to reach it. The crypto is server/push.js and the
// deciding is server/notify.js; nothing here does either.
//
// ⚠️ Push absent from the environment is a **404**, not an error: a studio
// with no VAPID keys is a studio where nobody set push up, and the client
// reads that as "rung 1 only" and says nothing. A 500 here would be the
// studio complaining about a thing nobody asked for.

const MAX_ENDPOINT = 2048;
const MAX_KEY = 256;

const short = (value, max) => typeof value === 'string'
  && value.length > 0
  && Buffer.byteLength(value, 'utf8') <= max;

export function pushRoutes(r) {
  // The key a browser needs before it can subscribe at all. Public by
  // definition — it is what the push service checks our signature against —
  // but behind the session like everything else here, because a studio that
  // needs a login should not answer questions about itself unasked.
  r.get('/api/push/key', (ctx) => {
    requireAuth(ctx);
    if (!ctx.push) throw new HttpError(404, 'push is not set up here');
    json(ctx.res, 200, { public_key: ctx.push.publicKey });
  });

  r.post('/api/push/subscribe', async (ctx) => {
    const user = requireAuth(ctx);
    if (!ctx.push) throw new HttpError(404, 'push is not set up here');
    const body = await readJson(ctx.req);
    const { endpoint, keys } = body ?? {};
    if (!short(endpoint, MAX_ENDPOINT)) throw new HttpError(400, 'endpoint is required');
    if (!short(keys?.p256dh, MAX_KEY) || !short(keys?.auth, MAX_KEY)) {
      throw new HttpError(400, 'keys.p256dh and keys.auth are required');
    }
    // A bell that is off keeps the browser for the announcements alone.
    subscribe(ctx.db, user.id, {
      endpoint, p256dh: keys.p256dh, auth: keys.auth,
      announcementsOnly: body.announcements_only === true,
    });
    noContent(ctx.res);
  });

  // Answers the same whether there was a row or not: whether this browser was
  // subscribed is not a question worth a different status, and turning
  // something off should never fail.
  r.post('/api/push/unsubscribe', async (ctx) => {
    const user = requireAuth(ctx);
    const body = await readJson(ctx.req);
    const endpoint = body?.endpoint;
    if (!short(endpoint, MAX_ENDPOINT)) throw new HttpError(400, 'endpoint is required');
    unsubscribe(ctx.db, user.id, endpoint);
    noContent(ctx.res);
  });
}
