// The story editor's model layer: what it reads, what it declines, that
// opening the shipped template and saving changes nothing, and the five
// things it knows about the whole story that no single field can say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  storyModel, storyText, storyChecks, storyShape, freshKey, renameScene, isStoryPath,
  renameMood, stageFor, leadingTo, moveLine, startAt,
} from '../public/story-editor.js';

const ROOT = new URL('../public/game-templates/visual-novel/', import.meta.url);
const TEMPLATE = fs.readFileSync(new URL('config/story.js', ROOT), 'utf8');

// Every file the template ships, the way the studio's file list would have it.
const PATHS = ['assets/images', 'assets/sprites', 'assets/sounds'].flatMap(
  (dir) => fs.readdirSync(new URL(`${dir}/`, ROOT)).map((f) => `${dir}/${f}`),
);

test('only config/story.js is a story', () => {
  assert.equal(isStoryPath('config/story.js'), true);
  assert.equal(isStoryPath('config/questions.js'), false);
  assert.equal(isStoryPath('story.js'), false);
});

test('the shipped template reads, and writing it back changes nothing', () => {
  const model = storyModel(TEMPLATE);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(model.scenes.map((s) => s.key), ['porch', 'window', 'hall', 'kitchen', 'tea', 'away']);
  assert.deepEqual(model.cast.map((p) => p.key), ['mila', 'cat']);
  assert.deepEqual(model.cast[0].moods, ['happy', 'worried']);
  // The three exits, one of each.
  assert.equal(model.scenes[0].choices.length, 3);
  assert.equal(model.scenes[2].go, 'kitchen');
  assert.deepEqual(model.scenes[5].choices, []);
  assert.equal(model.scenes[5].go, '');
  // Byte-stable: opening the editor and pressing Save is not an edit.
  assert.equal(storyText(model), TEMPLATE);
});

test('the shipped template has nothing to look at', () => {
  const model = storyModel(TEMPLATE);
  assert.deepEqual(storyChecks(model, PATHS), []);
  assert.deepEqual(storyShape(model), { scenes: 6, endings: 2 });
});

test('edits round-trip, quotes and all', () => {
  const model = storyModel(TEMPLATE);
  model.scenes[0].lines[0].say = 'What\'s "late"?\ttabs too';
  model.cast.push({ key: 'ghost', name: 'A Néw One', moods: [] });
  model.scenes.push({
    key: 'attic', picture: '', sound: '', lines: [{ who: 'ghost', mood: '', say: 'boo' }],
    choices: [], go: '',
  });
  model.scenes[0].choices.push({ say: 'Go up', go: 'attic', set: 'brave', need: 'saw-the-cat' });
  const again = storyModel(storyText(model));
  assert.equal(again.ok, true, again.reason);
  assert.deepEqual(again, { ok: true, cast: model.cast, scenes: model.scenes });
});

test('renaming a scene brings every way in with it', () => {
  const model = storyModel(TEMPLATE);
  renameScene(model, 'hall', 'front_room');
  const text = storyText(model);
  assert.match(text, /go: "front_room"/);
  assert.match(text, /\{ say: "Knock", go: "front_room" \},/);
  assert.ok(!text.includes('"hall"'), 'nothing still points at the old name');
  assert.equal(storyModel(text).ok, true);
});

test('freshKey makes an identifier, and never one already taken', () => {
  assert.equal(freshKey('The Attic!', []), 'the_attic');
  assert.equal(freshKey('The Attic!', ['the_attic']), 'the_attic_2');
  assert.equal(freshKey('', []), 'scene');
  assert.equal(freshKey('', ['scene'], 'person'), 'person');
  assert.equal(freshKey('9 lives', []), '_9_lives');
  assert.equal(freshKey('...', []), 'scene');
});

test('the checks say what one field cannot', () => {
  const model = storyModel(TEMPLATE);
  // A scene nothing leads to, and a mood nobody drew.
  model.scenes.push({
    key: 'attic', picture: 'assets/images/attic.png', sound: '',
    lines: [{ who: 'mila', mood: 'furious', say: 'Hey.' }], choices: [], go: '',
  });
  // A choice pointing at a scene that is gone, and a switch nothing sets.
  model.scenes[0].choices[0].go = 'gone';
  model.scenes[3].choices[0].need = 'never_set';

  const said = storyChecks(model, PATHS).map((c) => `${c.where}: ${c.say}`);
  assert.ok(said.some((s) => s.startsWith('attic: Nothing leads here')));
  assert.ok(said.some((s) => /goes to gone, which is not a scene/.test(s)));
  assert.ok(said.some((s) => /needs the switch never_set/.test(s)));
  assert.ok(said.some((s) => /assets\/images\/attic\.png is not in this game/.test(s)));
  assert.ok(said.some((s) => /mila has no mood called furious/.test(s)));
  // The first scene is where the story starts, so nothing leading to it is
  // not a problem — that one false alarm would fire on every story there is.
  assert.ok(!said.some((s) => s.startsWith('porch: Nothing leads here')));
});

test('a portrait or a sound the game does not have is named', () => {
  const model = storyModel(TEMPLATE);
  const said = storyChecks(model, []).map((c) => c.say);
  assert.ok(said.includes('assets/sprites/mila-happy.png is not in this game.'));
  assert.ok(said.includes('assets/sounds/page.wav is not in this game.'));
  assert.ok(said.includes('assets/images/porch.png is not in this game.'));
  // One line per missing file, however many scenes use it.
  assert.equal(said.filter((s) => s.startsWith('assets/images/kitchen.png')).length, 2,
    'kitchen and tea both use it, and each says so once');
});

test('renaming a mood renames the picture and every line said in it', () => {
  const model = storyModel(TEMPLATE);
  renameMood(model, 'mila', 'happy', 'glad');
  assert.deepEqual(model.cast[0].moods, ['glad', 'worried']);
  const moods = model.scenes.flatMap((s) => s.lines.filter((l) => l.who === 'mila').map((l) => l.mood));
  assert.deepEqual(moods, ['glad', 'worried', 'glad']);
  // Somebody else's mood of the same name is theirs and stays.
  renameMood(model, 'cat', 'happy', 'x');
  assert.deepEqual(model.cast[1].moods, ['there']);
});

// The stage is drawn from the unsaved model, step by step, so it has to say
// exactly what the player would see at each one.
test('the stage shows what the player sees at each step', () => {
  const model = storyModel(TEMPLATE);
  // The scene itself, and its picture and sound rows: the picture alone.
  for (const step of ['scene', 'picture', 'sound']) {
    assert.deepEqual(stageFor(model, 'hall', step), {
      picture: 'assets/images/hall.png', portrait: '', who: '', say: '', choices: [], go: '', end: false,
    });
  }
  // A line: its words, its speaker's name, and the portrait the file names.
  assert.deepEqual(stageFor(model, 'hall', 0), {
    picture: 'assets/images/hall.png',
    portrait: 'assets/sprites/mila-happy.png',
    who: 'Mila',
    say: 'Oh! I thought you had forgotten.',
    choices: [], go: '', end: false,
  });
  // Narration has no speaker and no portrait.
  assert.equal(stageFor(model, 'hall', 1).who, '');
  assert.equal(stageFor(model, 'hall', 1).portrait, '');
  // The exit keeps the last line up and adds what follows: a go here …
  const hall = stageFor(model, 'hall', 'exit');
  assert.equal(hall.say, 'The house smells of toast, at eleven o\'clock at night.');
  assert.equal(hall.go, 'kitchen');
  assert.equal(hall.end, false);
  // … the choices in the porch, need and all …
  const porch = stageFor(model, 'porch', 'exit');
  assert.equal(porch.choices.length, 3);
  assert.equal(porch.choices[1].set, 'saw-the-cat');
  // … and nothing at all after an ending.
  assert.equal(stageFor(model, 'away', 'exit').end, true);
  // A speaker who is not in the cast is still named, by their key.
  model.scenes[2].lines[0].who = 'ghost';
  assert.equal(stageFor(model, 'hall', 0).who, 'ghost');
  assert.equal(stageFor(model, 'hall', 0).portrait, '');
  assert.equal(stageFor(model, 'gone', 0), null);
});

test('leadingTo says every way into a scene', () => {
  const model = storyModel(TEMPLATE);
  assert.deepEqual(leadingTo(model, 'hall'), ['porch', 'window']);
  assert.deepEqual(leadingTo(model, 'kitchen'), ['hall']);
  assert.deepEqual(leadingTo(model, 'away'), ['porch', 'window', 'kitchen']);
  assert.deepEqual(leadingTo(model, 'porch'), []);
});

test('lines move to where they are told, and a scene can be made the start', () => {
  const model = storyModel(TEMPLATE);
  const porch = model.scenes[0];
  porch.lines.push({ who: '', mood: '', say: 'third' });
  moveLine(porch, 0, 2);
  assert.deepEqual(porch.lines.map((l) => l.say.split(',')[0]), [
    'There is a light on somewhere at the back of the house.', 'third', 'It is late',
  ]);
  moveLine(porch, 2, 0);
  assert.equal(porch.lines[0].say.startsWith('It is late'), true);
  // Out of range and no-op moves change nothing.
  const before = porch.lines.map((l) => l.say);
  moveLine(porch, 1, 1);
  moveLine(porch, 7, 0);
  assert.deepEqual(porch.lines.map((l) => l.say), before);

  startAt(model, 'kitchen');
  assert.deepEqual(model.scenes.map((s) => s.key), ['kitchen', 'porch', 'window', 'hall', 'tea', 'away']);
  startAt(model, 'kitchen');
  assert.equal(model.scenes[0].key, 'kitchen');
  // The file still round-trips after both.
  assert.equal(storyModel(storyText(model)).ok, true);
});

test('anything past the shape declines with the grown reason', () => {
  const grown = /grown past/;
  // An extra declaration.
  assert.match(storyModel(`${TEMPLATE}\nconst EXTRA = 1;\n`).reason, grown);
  // A field on a scene the editor does not know.
  assert.match(storyModel(TEMPLATE.replace(
    '    picture: "assets/images/hall.png",',
    '    picture: "assets/images/hall.png",\n    fade: 400,',
  )).reason, grown);
  // Both exits at once: choices and go are the same decision.
  assert.match(storyModel(TEMPLATE.replace(
    '    go: "kitchen",',
    '    go: "kitchen",\n    choices: [{ say: "or not", go: "away" }],',
  )).reason, grown);
  // A choice with no target.
  assert.match(storyModel(TEMPLATE.replace(
    '{ say: "Knock", go: "hall" }', '{ say: "Knock" }',
  )).reason, grown);
  // A scene key the serializer could not write bare.
  assert.match(storyModel(TEMPLATE.replace('  porch: {', '  "front porch": {')).reason, grown);
  // Code is not the grown reason — it is the reader refusing, passed through.
  const code = storyModel('const CAST = window.c;\nconst SCENES = {};\n');
  assert.equal(code.ok, false);
  assert.ok(!grown.test(code.reason), code.reason);
});
