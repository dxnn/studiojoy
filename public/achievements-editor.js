// The achievements editor's model layer: config/achievements.js in, a plain
// model out, and back to file text again. Reading goes through the config
// reader — the file is never executed — and writing regenerates the whole
// file with the seed's own comments, because this editor adds and removes
// whole achievements and is the authoring surface for this one file. Anything
// the shape does not cover — a second declaration, a stray key, two tests on
// one rule — makes achievementsModel decline with a reason, and the file
// falls back to the generic form or the text.
//
// The editor's shape is one notch looser than the game's: an entry with no
// name yet has an empty id and name while it is being written, which the
// library and the server skip and the checks below flag. The id is derived
// from the name the first time one is given and never again (freshId).

import { parseConfigFile } from './config-file.js';
import { readAchievements } from './achievement-shape.js';

export const ACHIEVEMENTS_FILE = 'config/achievements.js';
export const isAchievementsPath = (p) => p === ACHIEVEMENTS_FILE;

// The tests a rule can carry, with the words the form uses for them.
export const TESTS = [
  ['any', 'happens at all'],
  ['atLeast', 'is at least'],
  ['atMost', 'is at most'],
  ['is', 'is exactly'],
  ['times', 'has happened … times'],
];

const GROWN = 'the file has grown past what the achievements editor understands';
const str = (node) => (node && node.kind === 'string' ? node.value : null);

function whenModel(node) {
  if (node.kind !== 'object') return null;
  const keys = node.props.map((p) => p.key);
  if (!keys.includes('moment') || new Set(keys).size !== keys.length) return null;
  const moment = str(node.props.find((p) => p.key === 'moment').node);
  if (moment === null) return null;
  const tests = keys.filter((k) => k !== 'moment');
  if (tests.length === 0) return { moment, test: 'any', value: undefined };
  if (tests.length > 1) return null;
  const [test] = tests;
  const value = node.props.find((p) => p.key === test).node;
  if (test === 'is') {
    if (value.kind !== 'string' && value.kind !== 'number') return null;
  } else if (!['atLeast', 'atMost', 'times'].includes(test) || value.kind !== 'number') {
    return null;
  }
  return { moment, test, value: value.value };
}

export function achievementsModel(text) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const grown = { ok: false, reason: GROWN };
  if (parsed.decls.map((d) => d.name).join(',') !== 'ACHIEVEMENTS') return grown;
  const list = parsed.decls[0].node;
  if (list.kind !== 'array') return grown;

  const entries = [];
  for (const item of list.items) {
    if (item.kind !== 'object') return grown;
    const keys = item.props.map((p) => p.key);
    if (new Set(keys).size !== keys.length) return grown;
    if (keys.some((k) => !['id', 'name', 'how', 'icon', 'when'].includes(k))) return grown;
    if (!keys.includes('id') || !keys.includes('name')) return grown;
    const get = (k) => item.props.find((p) => p.key === k)?.node;
    const id = str(get('id'));
    const name = str(get('name'));
    const how = keys.includes('how') ? str(get('how')) : '';
    const icon = keys.includes('icon') ? str(get('icon')) : '';
    if (id === null || name === null || how === null || icon === null) return grown;
    let when = null;
    if (keys.includes('when')) {
      when = whenModel(get('when'));
      if (when === null) return grown;
    }
    entries.push({ id, name, how, icon, when });
  }
  return { ok: true, entries };
}

// The seed's own header, so a game born with the empty file and a game whose
// list has been emptied again hold the same bytes.
const HEADER = [
  '// What a player can earn in this game. Whoever earns one keeps it forever.',
  '//',
  '// Each achievement is a rule over a moment the game says with',
  '// Moments.say("name", value). `when` names the moment and, if it needs one,',
  '// one test on it:',
  '//',
  '//   when: { moment: "run-over" }               // the first time it is said at all',
  '//   when: { moment: "level", atLeast: 5 }      // the number is 5 or more',
  '//   when: { moment: "time", atMost: 30 }       // the number is 30 or less',
  '//   when: { moment: "ending", is: "good" }     // the value is exactly this',
  '//   when: { moment: "answered", times: 10 }    // said 10 times in one play',
  '//',
  '// Leave `when` out and only Achievements.unlock("id") in the game\'s own code',
  '// grants it. A name is up to 60 characters, `how` up to 200, the icon one',
  '// emoji, and there are up to 50 achievements. ⚠️ The id never changes: the',
  '// players who have earned it are keyed by it, so renaming one takes it away',
  '// from everybody.',
  '//',
  '// The studio opens this file as the achievements editor, so keep the shape —',
  '// id, name, how, icon, when — exactly. One looks like this:',
  '//',
  '//   {',
  '//     id: "first-run",              // never changes',
  '//     name: "First run",            // what it is called',
  '//     how: "Finish your first run", // how to get it, in the player\'s words',
  '//     icon: "🚀",                   // optional',
  '//     when: { moment: "run-over" }, // earned the first time the game says this',
  '//   },',
  '',
  '// The list, in the order the trophy screen shows them.',
];

export function achievementsText({ entries }) {
  const s = JSON.stringify;
  const lines = [...HEADER];
  if (entries.length === 0) {
    lines.push('const ACHIEVEMENTS = [];');
  } else {
    lines.push('const ACHIEVEMENTS = [');
    for (const a of entries) {
      lines.push('  {');
      lines.push(`    id: ${s(a.id)},`);
      lines.push(`    name: ${s(a.name)},`);
      lines.push(`    how: ${s(a.how)},`);
      if (a.icon) lines.push(`    icon: ${s(a.icon)},`);
      if (a.when) {
        const test = a.when.test === 'any' ? '' : `, ${a.when.test}: ${s(a.when.value)}`;
        lines.push(`    when: { moment: ${s(a.when.moment)}${test} },`);
      }
      lines.push('  },');
    }
    lines.push('];');
  }
  lines.push('');
  return lines.join('\n');
}

// What the whole list says that one field cannot: which entries the game will
// not count and why, and a rule waiting on a moment the game has never been
// heard to say — only once it has been heard to say anything, or every rule
// in a game nobody has played this session would be flagged, and never once a
// real player already holds it, since that proves the rule fires.
export function achievementChecks({ entries }, heard = new Map(), counts = new Map()) {
  const out = [];
  const label = (a) => (a.name ? `“${a.name}”` : 'an achievement with no name yet');
  const { skipped } = readAchievements(entries.map((a) => ({
    ...a,
    icon: a.icon || undefined,
    when: a.when ? whenValue(a.when) : undefined,
  })));
  for (const { index, why } of skipped) {
    const a = entries[index];
    if (!a) continue;
    if (!a.name) out.push('An achievement with no name yet is not in the game until it has one.');
    else out.push(`${label(a)} is not in the game: ${why}.`);
  }
  if (heard.size > 0) {
    for (const a of entries) {
      if (a.when && !heard.has(a.when.moment) && !counts.get(a.id)) {
        out.push(`${label(a)} waits for “${a.when.moment}”, which the game has not been heard to say.`);
      }
    }
  }
  return out;
}

// The rule as the file writes it, from the form's {moment, test, value}.
export function whenValue(when) {
  return when.test === 'any' ? { moment: when.moment } : { moment: when.moment, [when.test]: when.value };
}

// An id from a name, once: lowercase letters, digits and dashes, unique among
// the entries there are. Never shown as editable — the players who hold an
// achievement are keyed by it.
export function freshId(name, entries) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'achievement';
  const taken = new Set(entries.map((a) => a.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}
