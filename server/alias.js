import { HttpError } from './http/respond.js';
import { tx } from './db.js';
import { forbiddenCharKind } from './util/text.js';

// An account's alias: the name every scoreboard shows, and the only name the
// games origin ever says (spec/ §3, §7). The account's own name stays the
// studio's — its chats, its crew list, its mentions — and never crosses.
//
// Every account has one from the moment it is made — `Alias <id>`, written by
// fillDefaultAliases in db.js — until the person picks their own in the studio
// or an admin sets one. Ids are never reused (AUTOINCREMENT, and an account is
// never deleted), so the starting alias is unique by construction, and the
// pattern is kept for its own account so a typed alias can never take
// somebody's starting one from under them.

export const MAX_ALIAS_CHARS = 24; // a scoreboard row's width

const fold = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
// fillDefaultAliases' words, folded.
const startingAlias = (id) => `alias ${id}`;

// Why `alias` cannot be `user`'s, said so a kid can act on it, or null.
export function aliasProblem(db, user, alias) {
  if (!alias) return 'an alias needs at least one letter';
  if (alias.length > MAX_ALIAS_CHARS) return `an alias stops at ${MAX_ALIAS_CHARS} characters`;
  if (forbiddenCharKind(alias)) return 'that alias has characters that will not print';
  const said = fold(alias);
  // The point of an alias is that the name stays in the studio, so the name
  // itself and its first word are refused — a guard, not a wall: "Sam123"
  // still goes through.
  const name = fold(user.display_name);
  if (said === name || said === name.split(' ')[0]) {
    return 'that is a real name — an alias is what everybody else sees instead';
  }
  if (/^alias \d+$/.test(said) && said !== startingAlias(user.id)) {
    return '“Alias” and a number is kept for each account’s starting alias';
  }
  // NOCASE folds ASCII only, which is the same reach as the unique index.
  const taken = db.prepare('SELECT id FROM users WHERE alias = ? COLLATE NOCASE AND id != ?')
    .get(alias, user.id);
  if (taken) return 'somebody already has that alias';
  return null;
}

// The one place an alias changes. Each board row keeps a copy of its
// poster's alias, so a game's top ten is one read; the copies follow here.
export function setAlias(db, user, raw) {
  const alias = String(raw ?? '').trim();
  const problem = aliasProblem(db, user, alias);
  if (problem) throw new HttpError(400, problem);
  tx(db, () => {
    db.prepare('UPDATE users SET alias = ? WHERE id = ?').run(alias, user.id);
    db.prepare('UPDATE scores SET name = ? WHERE user_id = ?').run(alias, user.id);
  });
  return alias;
}
