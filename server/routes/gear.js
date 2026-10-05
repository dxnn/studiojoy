import { json, HttpError } from '../http/respond.js';
import { readJson, readRaw } from '../http/body.js';
import { requireAuth } from '../auth.js';
import {
  GEAR_PRICE, MAKES_A_WEEK, MAX_GEAR_BYTES,
  avatarOf, buyGear, gearBytes, listGear, madeThisWeek, makeGear, wearGear,
} from '../gear.js';
import { joyOf } from '../joy.js';

// The wardrobe (server/gear.js, spec.md §6): every piece of gear, making one,
// buying one, and wearing what is yours. Studio routes, so studio accounts
// only — a player earns joy on the games origin and has nowhere to spend it
// yet.
export function gearRoutes(r) {
  r.get('/api/gear', (ctx) => {
    const user = requireAuth(ctx);
    json(ctx.res, 200, {
      gear: listGear(ctx.db, user.id),
      wearing: avatarOf(ctx.db, user.id),
      joy: joyOf(ctx.db, user.id),
      price: GEAR_PRICE,
      made_this_week: madeThisWeek(ctx.db, user.id),
      makes_a_week: MAKES_A_WEEK,
    });
  });

  // One piece's picture. A piece never changes once made, so it is cached
  // for good.
  r.get('/api/gear/:id/picture', (ctx) => {
    requireAuth(ctx);
    const bytes = gearBytes(ctx.db, Number(ctx.params.id));
    if (!bytes) throw new HttpError(404, 'no such gear');
    sendPicture(ctx, bytes);
  });

  // A new piece: the PNG as the body, the slot and name in the address — the
  // studio collection's shape.
  r.post('/api/gear', async (ctx) => {
    const user = requireAuth(ctx);
    const bytes = await readRaw(ctx.req, MAX_GEAR_BYTES);
    json(ctx.res, 201, makeGear(ctx.db, user.id, {
      slot: ctx.query.get('slot'), name: ctx.query.get('name'), bytes,
    }));
  });

  r.post('/api/gear/:id/buy', (ctx) => {
    const user = requireAuth(ctx);
    json(ctx.res, 201, buyGear(ctx.db, user.id, Number(ctx.params.id)));
  });

  // What your avatar wears: `{head, body, legs}`, each a piece you own of that
  // slot or null for the bare shape; a slot left out is left as it is.
  r.put('/api/me/avatar', async (ctx) => {
    const user = requireAuth(ctx);
    json(ctx.res, 200, wearGear(ctx.db, user.id, await readJson(ctx.req, 256)));
  });
}

export function sendPicture(ctx, bytes) {
  ctx.res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': String(bytes.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  if (ctx.req.method === 'HEAD') return ctx.res.end();
  return ctx.res.end(Buffer.from(bytes));
}
