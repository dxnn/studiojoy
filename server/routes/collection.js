import { json, noContent, HttpError } from '../http/respond.js';
import { readRaw } from '../http/body.js';
import { requireAuth } from '../auth.js';
import {
  addArt, listArt, one, artBytes, removeArt, MAX_BYTES,
} from '../collection.js';

// The studio collection (spec.md §6): art people here have added, listed
// beside the shipped standard set on the same shelf. Every account may add
// and every account may see; taking one out belongs to whoever put it in, or
// to an admin.
//
// The bytes arrive raw, like a file PUT, with everything else in the query —
// a picture is not a JSON field, and base64 in a body would cost a third
// again for nothing.
export function collectionRoutes(r) {
  r.get('/api/collection', (ctx) => {
    const user = requireAuth(ctx);
    json(ctx.res, 200, { art: listArt(ctx.db, user) });
  });

  r.post('/api/collection', async (ctx) => {
    const user = requireAuth(ctx);
    const q = ctx.query;
    // readRaw answers a 413 of its own past the cap, so an oversized picture
    // is refused before anything is measured or written.
    const bytes = await readRaw(ctx.req, MAX_BYTES);
    const added = addArt(ctx.db, user, {
      kind: q.get('kind'),
      name: q.get('name'),
      who: q.get('who'),
      mood: q.get('mood'),
      bytes,
    });
    // Everyone's shelf grows, not just the adder's.
    ctx.broker.broadcast('collection.changed', {});
    json(ctx.res, 201, added);
  });

  // The bytes. A row's bytes never change — an edit is a new row — so this
  // one thing in the studio may be cached hard, unlike a game's files.
  r.get('/api/collection/:id', (ctx) => {
    requireAuth(ctx);
    const found = artBytes(ctx.db, Number(ctx.params.id));
    if (!found) throw new HttpError(404, 'no such picture');
    ctx.res.writeHead(200, {
      'Content-Type': found.mime,
      'Content-Length': String(found.bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    if (ctx.req.method === 'HEAD') return ctx.res.end();
    return ctx.res.end(Buffer.from(found.bytes));
  });

  r.delete('/api/collection/:id', (ctx) => {
    const user = requireAuth(ctx);
    const id = Number(ctx.params.id);
    if (!one(ctx.db, id)) throw new HttpError(404, 'no such picture');
    removeArt(ctx.db, user, id);
    ctx.broker.broadcast('collection.changed', {});
    noContent(ctx.res);
  });
}
