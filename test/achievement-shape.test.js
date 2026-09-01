// The shape of config/achievements.js as one module, and the promise that the
// library copied into every game reads it the same way: the server refuses an
// unlock for an id the library would not have awarded, and the editor flags
// exactly the entries the library skips. Both are held here against one list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  readAchievements, readAchievement, readWhen, isMomentName,
  MAX_ACHIEVEMENTS, MAX_ACHIEVEMENT_ICON_BYTES,
} from '../public/achievement-shape.js';

const LIBRARY = fs.readFileSync(
  new URL('../public/studio-lib/achievements/achievements.js', import.meta.url), 'utf8',
);

// Every way an entry can be wrong, one good one, and too many.
const MIXED = [
  { id: 'Bad Id', name: 'x', when: { moment: 'm' } },
  { id: 'no-name', when: { moment: 'm' } },
  { id: 'long-name', name: 'n'.repeat(61), when: { moment: 'm' } },
  { id: 'long-how', name: 'x', how: 'h'.repeat(201), when: { moment: 'm' } },
  { id: 'big-icon', name: 'x', icon: '🚀'.repeat(9), when: { moment: 'm' } },
  { id: 'bad-moment', name: 'x', when: { moment: 'Not A Slug' } },
  { id: 'bad-test', name: 'x', when: { moment: 'm', atLeast: 'five' } },
  { id: 'bad-is', name: 'x', when: { moment: 'm', is: {} } },
  { id: 'twice', name: 'x', when: { moment: 'other' } },
  { id: 'twice', name: 'y', when: { moment: 'other' } },
  'not an object',
  { id: 'fine', name: 'Fine', how: '', icon: '', when: { moment: 'm', atLeast: 1, atMost: 3 } },
  { id: 'by-hand', name: 'By hand' },
  ...Array.from({ length: 52 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, when: { moment: 'other' } })),
];

test('readAchievements keeps the entries in the shape and says why the rest are out', () => {
  const { ok, skipped } = readAchievements(MIXED);
  assert.equal(ok.length, MAX_ACHIEVEMENTS);
  assert.deepEqual(ok.slice(0, 3).map((a) => a.id), ['twice', 'fine', 'by-hand']);
  assert.deepEqual(ok[1], {
    id: 'fine', name: 'Fine', how: '', icon: null, when: { moment: 'm', atLeast: 1, atMost: 3 },
  });
  assert.equal(ok[2].when, null, 'no when is unlock() only');
  assert.deepEqual(skipped.map((s) => s.index), [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, ...[60, 61, 62, 63, 64]]);
  assert.match(skipped[0].why, /^its id is not a short slug/);
  assert.equal(skipped[0].id, 'Bad Id');
  assert.match(skipped[1].why, /name is missing/);
  assert.match(skipped[4].why, /not one emoji/);
  assert.match(skipped[8].why, /already used/);
  assert.equal(skipped[9].id, null);
  assert.match(skipped[9].why, /not an object/);
  assert.match(skipped[10].why, /more than 50/);
});

test('a list that is not a list is one skip and nothing kept', () => {
  for (const bad of [undefined, null, 'x', { id: 'x' }, 7]) {
    const { ok, skipped } = readAchievements(bad);
    assert.deepEqual(ok, []);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].index, -1);
  }
  assert.deepEqual(readAchievements([]), { ok: [], skipped: [] });
});

test('readWhen takes a moment and any of the four tests, typed', () => {
  assert.deepEqual(readWhen({ moment: 'run-over' }), { moment: 'run-over' });
  assert.deepEqual(readWhen({ moment: 'level', atLeast: 5 }), { moment: 'level', atLeast: 5 });
  assert.deepEqual(readWhen({ moment: 'roll', is: 7 }), { moment: 'roll', is: 7 });
  assert.deepEqual(readWhen({ moment: 'e', is: 'good', times: 2 }), { moment: 'e', is: 'good', times: 2 });
  assert.equal(readWhen({ moment: 'e', extra: 1 }).extra, undefined, 'a key it does not know is dropped');
  for (const bad of [null, 'level', {}, { moment: 'Level' }, { moment: 'l', atMost: NaN },
    { moment: 'l', times: '3' }, { moment: 'l', is: true }]) {
    assert.equal(readWhen(bad), null, JSON.stringify(bad));
  }
});

test('an icon is one emoji by bytes, whatever it is made of', () => {
  assert.ok(readAchievement({ id: 'a', name: 'A', icon: '👨‍👩‍👧‍👦' }).ok, 'a family is one emoji of 25 bytes');
  assert.ok(readAchievement({ id: 'a', name: 'A', icon: 'ab' }).ok, 'letters are allowed too');
  const bytes = MAX_ACHIEVEMENT_ICON_BYTES;
  assert.ok(readAchievement({ id: 'a', name: 'A', icon: 'x'.repeat(bytes) }).ok);
  assert.ok(readAchievement({ id: 'a', name: 'A', icon: 'x'.repeat(bytes + 1) }).why);
  assert.equal(isMomentName('run-over'), true);
  assert.equal(isMomentName('run over'), false);
});

// ⚠️ The library carries its own copy of these rules. Run it over the same
// list and the ids it would award must be the ids this module keeps.
test('the library in a game reads the shape exactly as this module does', async () => {
  const sandbox = {
    console: { warn() {} },
    location: { pathname: '/' }, // no slug, so no network is asked
    setTimeout: () => 0,
    addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const ACHIEVEMENTS = ${JSON.stringify(MIXED)};\n${LIBRARY}`, sandbox);
  // Array.from here, so what is compared was built in this realm and not the
  // vm's — a strict deep compare rejects the other realm's Array.prototype.
  const mine = await sandbox.Achievements.mine();
  assert.deepEqual(Array.from(mine, (a) => a.id), readAchievements(MIXED).ok.map((a) => a.id));
  assert.deepEqual(
    Array.from(mine, (a) => [a.name, a.how, a.icon]),
    readAchievements(MIXED).ok.map((a) => [a.name, a.how, a.icon]),
  );
});
