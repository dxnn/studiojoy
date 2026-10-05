// Gear: the pieces an avatar is made of (ideas/dreams.md §6, spec.md §3).
//
// An avatar is a head, a body and legs, one piece of gear each — or the bare
// shape where nothing is worn. Everybody with studio access draws gear: up to
// MAKES_A_WEEK new pieces a week, each inside its slot's shape
// (public/gear-shapes.js), and owns what they make for nothing. Everything
// anybody has made is in the wardrobe for everybody else at one price, paid in
// joy, which is simply spent — it goes to nobody (Dann, 2026-10-04). No
// approval: a piece is in the wardrobe the moment it is made.
//
// The shape is the drawing tool's to keep: the server checks a piece is a PNG
// of its slot's size, and trusts the pixels, as it trusts every other picture
// a person here draws.

import { HttpError } from './http/respond.js';
import { tx } from './db.js';
import { pngSize } from './collection.js';
import { forbiddenCharKind } from './util/text.js';
import { SIZES, SLOTS, isSlot } from '../public/gear-shapes.js';
import { joyOf, weekOf } from './joy.js';

export const MAKES_A_WEEK = 3;
export const GEAR_PRICE = 20;
export const NAME_CHARS = 40;
// A 32-pixel picture is a few hundred bytes; anything near this is not one.
export const MAX_GEAR_BYTES = 64 * 1024;

const WEAR = { head: 'wear_head', body: 'wear_body', legs: 'wear_legs' };

const studioPerson = (db, userId) => {
  const user = db.prepare('SELECT studio_access, deleted FROM users WHERE id = ?').get(userId);
  return Boolean(user && user.studio_access === 1 && user.deleted === 0);
};

// How many pieces this person has made since Monday (UTC).
export function madeThisWeek(db, userId, now = new Date()) {
  return Number(db
    .prepare('SELECT COUNT(*) AS n FROM gear WHERE made_by = ? AND created_at >= ?')
    .get(userId, `${weekOf(now)}T00:00:00.000Z`).n);
}

// What one person is wearing: a gear id a slot, or null.
export function avatarOf(db, userId) {
  const row = db.prepare('SELECT wear_head, wear_body, wear_legs FROM users WHERE id = ?').get(userId);
  return {
    head: row?.wear_head ?? null,
    body: row?.wear_body ?? null,
    legs: row?.wear_legs ?? null,
  };
}

// The wardrobe: every piece, newest first, with who made it and whether this
// person owns it. Everything but the bytes, which each piece's own address
// serves.
export function listGear(db, userId) {
  const owned = new Set(db
    .prepare('SELECT gear_id FROM gear_owned WHERE user_id = ?')
    .all(userId)
    .map((r) => r.gear_id));
  return db
    .prepare(
      `SELECT g.id, g.slot, g.name, g.made_by, u.display_name AS maker, g.created_at
         FROM gear g JOIN users u ON u.id = g.made_by
        ORDER BY g.id DESC`,
    )
    .all()
    .map((g) => ({ ...g, owned: owned.has(g.id), mine: g.made_by === userId }));
}

export const gearBytes = (db, id) => db.prepare('SELECT bytes FROM gear WHERE id = ?').get(id)?.bytes ?? null;

// A new piece, made by somebody in the studio: theirs at once, and in the
// wardrobe for everybody else.
export function makeGear(db, userId, { slot, name, bytes }, now = new Date()) {
  if (!studioPerson(db, userId)) throw new HttpError(403, 'gear is made in the studio');
  if (!isSlot(slot)) throw new HttpError(400, `slot must be one of ${SLOTS.join(', ')}`);
  const label = typeof name === 'string' ? name.trim().slice(0, NAME_CHARS) : '';
  if (!label) throw new HttpError(400, 'give it a name');
  if (forbiddenCharKind(label)) throw new HttpError(400, 'that name has a character the studio does not take');
  if (!bytes?.length) throw new HttpError(400, 'there is nothing to make');
  if (bytes.length > MAX_GEAR_BYTES) throw new HttpError(413, 'that picture is far too big for gear');
  const size = pngSize(bytes);
  const want = SIZES[slot];
  if (!size || size.width !== want.width || size.height !== want.height) {
    throw new HttpError(400, `${slot} gear is a ${want.width} by ${want.height} picture`);
  }
  return tx(db, () => {
    if (madeThisWeek(db, userId, now) >= MAKES_A_WEEK) {
      throw new HttpError(409, `you have made ${MAKES_A_WEEK} pieces this week — more on Monday`);
    }
    const at = now.toISOString();
    const { lastInsertRowid } = db
      .prepare('INSERT INTO gear (slot, name, bytes, made_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(slot, label, bytes, userId, at);
    const id = Number(lastInsertRowid);
    db.prepare('INSERT INTO gear_owned (user_id, gear_id, created_at) VALUES (?, ?, ?)').run(userId, id, at);
    return { id, slot, name: label };
  });
}

// A piece bought, for good: the joy is spent, and goes to nobody.
export function buyGear(db, userId, gearId, now = new Date()) {
  const gear = db.prepare('SELECT id FROM gear WHERE id = ?').get(gearId);
  if (!gear) throw new HttpError(404, 'no such gear');
  return tx(db, () => {
    const owned = db.prepare('SELECT 1 FROM gear_owned WHERE user_id = ? AND gear_id = ?').get(userId, gearId);
    if (owned) throw new HttpError(409, 'that is yours already');
    const joy = joyOf(db, userId);
    if (joy < GEAR_PRICE) throw new HttpError(409, `it is ${GEAR_PRICE} joy, and you have ${joy}`);
    const at = now.toISOString();
    db.prepare(
      `INSERT INTO ledger (user_id, currency, delta, why, gear_id, created_at)
       VALUES (?, 'joy', ?, 'bought', ?, ?)`,
    ).run(userId, -GEAR_PRICE, gearId, at);
    db.prepare('INSERT INTO gear_owned (user_id, gear_id, created_at) VALUES (?, ?, ?)').run(userId, gearId, at);
    return { joy: joy - GEAR_PRICE };
  });
}

// What to wear: a piece of gear a slot that this person owns and that is
// that slot's, or null for the bare shape. Only the slots named change.
export function wearGear(db, userId, wanted) {
  for (const slot of SLOTS) {
    if (!(slot in (wanted ?? {}))) continue;
    const id = wanted[slot];
    if (id === null) {
      db.prepare(`UPDATE users SET ${WEAR[slot]} = NULL WHERE id = ?`).run(userId);
      continue;
    }
    if (!Number.isInteger(id)) throw new HttpError(400, `${slot} must be a piece of gear or null`);
    const piece = db
      .prepare(
        `SELECT g.slot FROM gear g JOIN gear_owned o ON o.gear_id = g.id
          WHERE g.id = ? AND o.user_id = ?`,
      )
      .get(id, userId);
    if (!piece) throw new HttpError(404, 'you do not have that piece');
    if (piece.slot !== slot) throw new HttpError(400, `that piece is ${piece.slot} gear`);
    db.prepare(`UPDATE users SET ${WEAR[slot]} = ? WHERE id = ?`).run(id, userId);
  }
  return avatarOf(db, userId);
}
