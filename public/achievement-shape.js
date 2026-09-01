// The shape of config/achievements.js, read the same way everywhere the studio
// reads it: the games origin deciding which ids exist, and the achievements
// editor deciding which entries to flag. Pure — a value in, a verdict out —
// so the server can import it from public/ the way it imports config-file.js.
//
// ⚠️ The achievements library (public/studio-lib/achievements/achievements.js)
// carries its own copy of these rules, because it is a classic script copied
// into every game and cannot import anything. The two are held together by a
// test that runs both over one list (test/achievement-shape.test.js). Change a
// cap here, change it there.

export const MAX_ACHIEVEMENTS = 50;
export const MAX_ACHIEVEMENT_NAME = 60;
export const MAX_ACHIEVEMENT_HOW = 200;
// The reaction cap: one emoji, however many code points it takes.
export const MAX_ACHIEVEMENT_ICON_BYTES = 32;
export const ACHIEVEMENT_TESTS = ['atLeast', 'atMost', 'is', 'times'];

const SLUG = /^[a-z0-9-]{1,40}$/;

export const isMomentName = (value) => typeof value === 'string' && SLUG.test(value);

// Node on the server, TextEncoder in the browser.
function utf8Bytes(text) {
  if (typeof Buffer === 'function') return Buffer.byteLength(text, 'utf8');
  return new TextEncoder().encode(text).length;
}

const isCount = (value) => typeof value === 'number' && Number.isFinite(value);

// The rule as it will be read, or null when `when` is outside the shape: a
// moment name and, for each test present, a value of the right kind.
export function readWhen(when) {
  if (typeof when !== 'object' || when === null) return null;
  if (!isMomentName(when.moment)) return null;
  const out = { moment: when.moment };
  for (const test of ['atLeast', 'atMost', 'times']) {
    if (when[test] === undefined) continue;
    if (!isCount(when[test])) return null;
    out[test] = when[test];
  }
  if (when.is !== undefined) {
    if (typeof when.is !== 'string' && typeof when.is !== 'number') return null;
    out.is = when.is;
  }
  return out;
}

// One entry as the rules read it: `{ ok: entry }`, or `{ why }` saying what
// is wrong with it in words the editor can show.
export function readAchievement(entry, seen = new Set()) {
  if (typeof entry !== 'object' || entry === null) return { why: 'it is not an object' };
  if (!isMomentName(entry.id)) {
    return { why: 'its id is not a short slug of lowercase letters, digits and dashes' };
  }
  if (seen.has(entry.id)) return { why: 'that id is already used' };
  if (typeof entry.name !== 'string' || entry.name === '' || entry.name.length > MAX_ACHIEVEMENT_NAME) {
    return { why: `its name is missing or longer than ${MAX_ACHIEVEMENT_NAME} characters` };
  }
  const how = entry.how === undefined ? '' : entry.how;
  if (typeof how !== 'string' || how.length > MAX_ACHIEVEMENT_HOW) {
    return { why: `its how is not text of up to ${MAX_ACHIEVEMENT_HOW} characters` };
  }
  const icon = entry.icon === undefined || entry.icon === '' ? null : entry.icon;
  if (icon !== null && (typeof icon !== 'string' || utf8Bytes(icon) > MAX_ACHIEVEMENT_ICON_BYTES)) {
    return { why: 'its icon is not one emoji' };
  }
  let when = null;
  if (entry.when !== undefined && entry.when !== null) {
    when = readWhen(entry.when);
    if (!when) return { why: 'its when does not name a moment and one test on it' };
  }
  return { ok: { id: entry.id, name: entry.name, how, icon, when } };
}

// The whole list: the entries in the shape, in file order and at most fifty,
// and the ones skipped with the reason and where they were.
export function readAchievements(list) {
  const ok = [];
  const skipped = [];
  if (!Array.isArray(list)) return { ok, skipped: [{ index: -1, id: null, why: 'ACHIEVEMENTS is not a list' }] };
  const seen = new Set();
  list.forEach((entry, index) => {
    const id = entry && typeof entry.id === 'string' ? entry.id : null;
    if (ok.length >= MAX_ACHIEVEMENTS) {
      skipped.push({ index, id, why: `more than ${MAX_ACHIEVEMENTS}: the rest are skipped` });
      return;
    }
    const read = readAchievement(entry, seen);
    if (read.ok) {
      seen.add(read.ok.id);
      ok.push(read.ok);
    } else {
      skipped.push({ index, id, why: read.why });
    }
  });
  return { ok, skipped };
}
