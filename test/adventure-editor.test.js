// The adventure editor's model layer: what it reads, what it declines, that
// opening the shipped template or the example and saving changes nothing, the
// things it knows about the whole adventure that no single field can say, the
// hit test the stage uses, and the guide's questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  adventureModel, adventureText, adventureChecks, adventureShape, isAdventurePath,
  renameScene, addScene, sceneCalled, duplicateScene, startAt, addSpot, moveSpot,
  leadingTo, itemsOf, switchesOf, emptyAdventure, spotLabel, spotAt, nextQuestion,
  itemPath, picturePath, ADVENTURE_FILE,
} from '../public/adventure-editor.js';

const PUBLIC = new URL('../public/', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, PUBLIC), 'utf8');

const TEMPLATE = read('game-templates/adventure/config/scenes.js');
const ART = JSON.parse(read('story-art/index.json'));
const EXAMPLE = read(`story-art/${ART.examples.key.scenes}`);
const LANDS = { backgrounds: 'assets/images', portraits: 'assets/sprites', sounds: 'assets/sounds' };
const landing = (f) => `${LANDS[f.split('/')[0]]}/${f.split('/').pop()}`;
// The example's pictures, and the plain cards the guide draws for its items.
const PATHS = [...ART.examples.key.uses.map(landing), ...ART.examples.key.items.map(itemPath)];

const example = () => {
  const m = adventureModel(EXAMPLE);
  assert.equal(m.ok, true, m.reason);
  return { scenes: m.scenes };
};

test('only config/scenes.js is an adventure', () => {
  assert.equal(isAdventurePath(ADVENTURE_FILE), true);
  assert.equal(isAdventurePath('config/story.js'), false);
});

test('the template ships empty, reads, and writes back byte for byte', () => {
  const model = adventureModel(TEMPLATE);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(model.scenes, []);
  assert.equal(emptyAdventure(model), true);
  assert.deepEqual(adventureChecks(model, []), []);
  assert.deepEqual(adventureShape(model), {
    scenes: 0, spots: 0, items: 0, endings: 0,
  });
  assert.equal(adventureText(model), TEMPLATE);
});

test('the example reads, has nothing to look at, and writes back byte for byte', () => {
  const model = example();
  assert.deepEqual(model.scenes.map((s) => s.key), ['porch', 'hall', 'kitchen', 'morning']);
  // A locked door and then an open one: two spots on one box, different needs.
  const [open, locked] = model.scenes[0].spots;
  assert.deepEqual(open.at, locked.at);
  assert.equal(open.kind, 'go');
  assert.equal(open.need, 'key');
  assert.equal(locked.kind, 'say');
  assert.equal(locked.need, '');
  // A take that speaks as it does, and a say of several lines.
  assert.equal(model.scenes[0].spots[2].kind, 'take');
  assert.equal(model.scenes[0].spots[2].take, 'key');
  assert.equal(model.scenes[0].spots[2].say.length, 1);
  assert.deepEqual(model.scenes[0].spots[3].say, ['The moon.', 'It is very late to be out.']);
  // The end is a scene with nothing to click on.
  assert.deepEqual(model.scenes[3].spots, []);
  assert.deepEqual(itemsOf(model), ['key', 'cake']);
  assert.deepEqual(switchesOf(model), ['cake', 'key']);
  assert.equal(adventureText(model), EXAMPLE);
  assert.deepEqual(adventureChecks(model, PATHS), []);
  assert.deepEqual(adventureShape(model), {
    scenes: 4, spots: 11, items: 2, endings: 1,
  });
  assert.equal(emptyAdventure(model), false);
});

test('the example uses only pictures the standard set lists', () => {
  const listed = new Set(ART.art.map((a) => a.file));
  for (const used of ART.examples.key.uses) assert.ok(listed.has(used), used);
  assert.ok(fs.existsSync(new URL(`story-art/${ART.examples.key.scenes}`, PUBLIC)));
});

test('edits round-trip, quotes, keep, set and sound and all', () => {
  const model = example();
  model.scenes[1].spots.push({
    at: [1, 2, 3, 4], kind: 'take', go: '', say: ['A "thing"', 'with\ttabs'], take: 'lamp', need: 'key', set: 'lit', sound: 'click', keep: true,
  });
  model.scenes[1].spots.push({
    at: [0, 0, 10, 10], kind: 'go', go: 'porch', say: [], take: '', need: '', set: 'went_back', sound: '', keep: false,
  });
  model.scenes.push({
    key: 'attic', about: '', picture: '', spots: [],
  });
  const again = adventureModel(adventureText(model));
  assert.equal(again.ok, true, again.reason);
  assert.deepEqual(again, { ok: true, scenes: model.scenes });
  // keep is only ever written as true, and only on a take.
  assert.ok(!adventureText(model).includes('keep: false'));
});

test('the shape is held: anything else declines with a reason', () => {
  const grown = (text) => {
    const m = adventureModel(text);
    assert.equal(m.ok, false);
    return m.reason;
  };
  const spot = (body) => `const SCENES = {\n  a: { spots: [ { ${body} } ] },\n};\n`;
  // A spot that walks and speaks, or walks and takes, is two spots.
  assert.match(grown(spot('at: [0, 0, 1, 1], go: "b", say: "hi"')), /grown/);
  assert.match(grown(spot('at: [0, 0, 1, 1], go: "b", take: "x"')), /grown/);
  // A box is four whole numbers.
  assert.match(grown(spot('at: [0, 0, 1], say: "hi"')), /grown/);
  assert.match(grown(spot('at: [0, 0, 1.5, 1], say: "hi"')), /grown/);
  // keep belongs to a take, and is only ever true.
  assert.match(grown(spot('at: [0, 0, 1, 1], say: "hi", keep: true')), /grown/);
  assert.match(grown(spot('at: [0, 0, 1, 1], take: "x", keep: false')), /grown/);
  // A key the shape does not know.
  assert.match(grown(spot('at: [0, 0, 1, 1], say: "hi", flip: "x"')), /grown/);
  assert.match(grown('const SCENES = {\n  a: { music: "x" },\n};\n'), /grown/);
  // Two declarations is somebody else's file.
  assert.match(grown('const SCENES = {};\nconst ITEMS = {};\n'), /grown/);
});

test('renaming a scene brings every way in with it', () => {
  const model = example();
  renameScene(model, 'hall', 'front_room');
  const text = adventureText(model);
  assert.match(text, /go: "front_room"/);
  assert.ok(!text.includes('"hall"'), 'nothing still points at the old name');
  assert.deepEqual(leadingTo(model, 'front_room'), ['porch']);
  assert.deepEqual(leadingTo(model, 'porch'), ['front_room']);
});

test('making, copying and reordering scenes and spots', () => {
  const model = example();
  assert.equal(addScene(model, 'The Attic!'), 'the_attic');
  assert.equal(sceneCalled(model, 'the attic'), 'the_attic', 'the one already called that');
  assert.equal(sceneCalled(model, 'cellar'), 'cellar', 'or a new one');
  const copy = duplicateScene(model, 'porch');
  assert.equal(copy, 'porch_2');
  assert.equal(model.scenes[1].key, 'porch_2');
  assert.deepEqual(model.scenes[1].spots, model.scenes[0].spots);
  assert.notEqual(model.scenes[1].spots[0], model.scenes[0].spots[0], 'its own spots');
  startAt(model, 'kitchen');
  assert.equal(model.scenes[0].key, 'kitchen');

  const scene = model.scenes.find((s) => s.key === 'hall');
  const i = addSpot(scene, [10.4, 20.6, 30, 40]);
  assert.equal(i, 3);
  assert.deepEqual(scene.spots[3].at, [10, 21, 30, 40], 'whole pixels');
  assert.equal(scene.spots[3].kind, 'say');
  moveSpot(scene, 3, 0);
  assert.deepEqual(scene.spots[0].at, [10, 21, 30, 40]);
  assert.equal(spotLabel(scene.spots[1]), '→ kitchen');
  assert.equal(spotLabel(model.scenes.find((s) => s.key === 'porch').spots[2]), 'take key');
  assert.equal(spotLabel(scene.spots[0]), '…');
});

test('the checks say what one field cannot', () => {
  const model = example();
  model.scenes.push({
    key: 'attic',
    about: '',
    picture: 'assets/images/attic.png',
    spots: [
      { at: [0, 0, 50, 50], kind: 'go', go: 'gone', say: [], take: '', need: 'never_set', set: '', sound: 'creak', keep: false },
      // Under the first and asking for the same thing.
      { at: [10, 10, 10, 10], kind: 'say', go: '', say: ['hi'], take: '', need: 'never_set', set: '', sound: '', keep: false },
      // Off the edge of a 480 × 270 picture.
      { at: [400, 200, 100, 100], kind: 'say', go: '', say: ['edge'], take: '', need: '', set: '', sound: '', keep: false },
    ],
  });
  const sizes = new Map([['assets/images/attic.png', { width: 480, height: 270 }]]);
  const said = adventureChecks(model, PATHS, sizes).map((c) => `${c.where}: ${c.say}`);
  assert.ok(said.some((s) => s.startsWith('attic: Nothing leads here')));
  assert.ok(said.some((s) => /goes to gone, which is not a scene/.test(s)));
  assert.ok(said.some((s) => /needs the switch never_set/.test(s)));
  assert.ok(said.some((s) => /assets\/images\/attic\.png is not in this game/.test(s)));
  assert.ok(said.some((s) => /assets\/sounds\/creak\.wav is not in this game/.test(s)));
  assert.ok(said.some((s) => /Spot 2 sits under spot 1/.test(s)));
  assert.ok(said.some((s) => /Spot 3 is off the edge/.test(s)));
  // The first scene is where the adventure starts, and the locked door under
  // the open one asks for something different: neither is a problem.
  assert.ok(!said.some((s) => s.startsWith('porch:')));
  // A thing with no picture is said once, by the path it wants.
  const bare = adventureChecks(example(), ART.examples.key.uses.map(landing)).map((c) => c.say);
  assert.ok(bare.includes('assets/sprites/key.png is not in this game, so the key is shown as a word.'));
});

test('the stage picks the smallest spot under a point', () => {
  const scene = example().scenes[0];
  // The door: two spots on one box, the first of them.
  assert.equal(spotAt(scene, 240, 150), 0);
  // The window ledge, the moon, and nothing.
  assert.equal(spotAt(scene, 300, 130), 2);
  assert.equal(spotAt(scene, 380, 40), 3);
  assert.equal(spotAt(scene, 5, 5), -1);
  scene.spots.push({
    at: [230, 140, 10, 10], kind: 'say', go: '', say: ['knob'], take: '', need: '', set: '', sound: '', keep: false,
  });
  assert.equal(spotAt(scene, 235, 145), 4, 'the small one inside the big one');
});

// The guide asks for the adventure in the order one is made, and only for
// what is missing.
test('the guide asks the next thing the adventure is missing', () => {
  const model = { scenes: [] };
  assert.equal(nextQuestion(model).id, 'scene-first');
  addScene(model, 'porch');
  let q = nextQuestion(model, []);
  assert.equal(q.id, 'picture:porch');
  assert.equal(q.path, picturePath('porch'));
  model.scenes[0].picture = 'assets/images/porch.png';
  q = nextQuestion(model, ['assets/images/porch.png']);
  assert.equal(q.id, 'spots:porch');
  assert.equal(q.later, 'The adventure ends here');
  assert.equal(nextQuestion(model, ['assets/images/porch.png'], new Set(['spots:porch'])), null, 'set aside');
  addSpot(model.scenes[0], [0, 0, 10, 10]);
  Object.assign(model.scenes[0].spots[0], { kind: 'go', go: 'hall', say: [] });
  q = nextQuestion(model, ['assets/images/porch.png']);
  assert.equal(q.id, 'make:porch:hall');
  assert.match(q.ask, /leads to hall, which is not a scene yet/);
  addScene(model, 'hall');
  model.scenes[1].picture = 'assets/images/hall.png';
  addSpot(model.scenes[1], [0, 0, 10, 10]);
  Object.assign(model.scenes[1].spots[0], { kind: 'take', take: 'key', say: [] });
  q = nextQuestion(model, ['assets/images/porch.png', 'assets/images/hall.png']);
  assert.equal(q.id, 'item:key');
  assert.equal(q.path, itemPath('key'));
  assert.equal(nextQuestion(model, ['assets/images/porch.png', 'assets/images/hall.png', itemPath('key')]), null);
  // The whole example wants nothing once its files are there and its ending
  // is marked as meant — which is what putting the example in does, the way
  // the story's example sets its endings aside.
  assert.equal(nextQuestion(example(), PATHS).id, 'spots:morning');
  assert.equal(nextQuestion(example(), PATHS, new Set(['spots:morning'])), null);
});
