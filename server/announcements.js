// The studio's announcements (spec.md §3, §6): one room for the whole studio,
// pinned over everything in the sidebar, where an admin says something every
// account hears — even somebody whose bell is off, as far as their browser
// allows (server/notify.js).
//
// It is a chat project with `announce = 1` rather than a kind of its own, so
// everything a chat already has — the thread, reactions, marks, the composer,
// the stream — it has too. What makes it different is a handful of doors:
// only an admin may write in it or change it (canEdit in authors.js, and the
// message route), nobody may archive it, and its one room takes no helpers
// (`bots = 0`, which is what keeps every helper door shut already).
//
// Made once, the first time there is an admin to have made it — when the
// studio starts, and when its first account is created — and never again:
// renamed by an admin, it is still the announcements, because the flag is
// what says so and not the name.

import { createChat } from './chats.js';

export const ANNOUNCEMENTS = 'Announcements';

export const isAnnouncements = (project) => project?.announce === 1;

export function ensureAnnouncements(db, now = new Date().toISOString()) {
  if (db.prepare('SELECT 1 FROM projects WHERE announce = 1').get()) return null;
  const admin = db
    .prepare('SELECT id FROM users WHERE admin = 1 AND deleted = 0 ORDER BY id LIMIT 1')
    .get();
  if (!admin) return null;
  // A game somebody already called Announcements keeps its slug.
  let slug = 'announcements';
  for (let n = 2; db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug); n += 1) {
    slug = `announcements-${n}`;
  }
  const info = db
    .prepare(
      `INSERT INTO projects (slug, name, kind, created_by, created_at, updated_at, announce)
       VALUES (?, ?, 'chat', ?, ?, ?, 1)`,
    )
    .run(slug, ANNOUNCEMENTS, admin.id, now, now);
  createChat(db, info.lastInsertRowid, { name: ANNOUNCEMENTS, bots: 0, now });
  return slug;
}
