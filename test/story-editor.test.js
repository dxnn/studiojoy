// The story editor's model layer: what it reads, what it declines, that
// opening the shipped template or the example and saving changes nothing, the
// five things it knows about the whole story that no single field can say,
// the stage's arithmetic, and the guide's questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  storyModel, storyText, storyChecks, storyShape, freshKey, renameScene, isStoryPath,
  renameMood, stageFor, leadingTo, moveLine, startAt,
  addPerson, addScene, sceneCalled, emptyStory, nextQuestion, wayInto, DEFAULT_MOOD,
  isSoundStep, soundStep, saidIn,
} from '../public/story-editor.js';

const PUBLIC = new URL('../public/', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, PUBLIC), 'utf8');

// The template ships empty; the story that used to be it is the example in
// the standard set's home, with the art it uses beside it.
const TEMPLATE = read('game-templates/visual-novel/config/story.js');
const ART = JSON.parse(read('story-art/index.json'));
const EXAMPLE = read(`story-art/${ART.examples.mila.story}`);
// Where each kind lands in a game, as the guide copies it (story-guide.js).
const LANDS = { backgrounds: 'assets/images', portraits: 'assets/sprites', sounds: 'assets/sounds' };
const landing = (f) => `${LANDS[f.split('/')[0]]}/${f.split('/').pop()}`;
const PATHS = ART.examples.mila.uses.map(landing);

const example = () => {
  const m = storyModel(EXAMPLE);
  assert.equal(m.ok, true, m.reason);
  return { cast: m.cast, scenes: m.scenes };
};

test('only config/story.js is a story', () => {
  assert.equal(isStoryPath('config/story.js'), true);
  assert.equal(isStoryPath('config/questions.js'), false);
  assert.equal(isStoryPath('story.js'), false);
});

// Nobody and nowhere: the first thing an author meets is the guide's first
// question, and the first place is theirs to name rather than a scene called
// "start" to rename.
test('the template ships empty, reads, and writes back byte for byte', () => {
  const model = storyModel(TEMPLATE);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(model.cast, []);
  assert.deepEqual(model.scenes, []);
  assert.equal(emptyStory(model), true);
  assert.deepEqual(storyChecks(model, []), []);
  assert.deepEqual(storyShape(model), { scenes: 0, endings: 0 });
  assert.equal(storyText(model), TEMPLATE);
});

test('the example reads, has nothing to look at, and writes back byte for byte', () => {
  const model = storyModel(EXAMPLE);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(model.scenes.map((s) => s.key), ['porch', 'window', 'hall', 'kitchen', 'tea', 'away']);
  assert.deepEqual(model.cast.map((p) => p.key), ['mila', 'cat']);
  assert.deepEqual(model.cast[0].moods, ['happy', 'worried']);
  // The two lines about, for the studio: one on a person, one on a place.
  assert.match(model.cast[0].about, /end of the lane/);
  assert.match(model.scenes[0].about, /front porch/);
  assert.equal(model.scenes[1].about, '');
  // The three exits, one of each.
  assert.equal(model.scenes[0].choices.length, 3);
  assert.equal(model.scenes[2].go, 'kitchen');
  assert.deepEqual(model.scenes[5].choices, []);
  assert.equal(model.scenes[5].go, '');
  // Byte-stable: opening the editor and pressing Save is not an edit.
  assert.equal(storyText(model), EXAMPLE);
  assert.deepEqual(storyChecks(model, PATHS), []);
  assert.deepEqual(storyShape(model), { scenes: 6, endings: 2 });
  assert.equal(emptyStory(model), false);
});

test('the standard set lists files that exist, and the example uses only those', () => {
  for (const entry of ART.art) {
    assert.ok(fs.existsSync(new URL(`story-art/${entry.file}`, PUBLIC)), entry.file);
    assert.ok(entry.kind && entry.name && entry.licence, `${entry.file} is described`);
    assert.ok(LANDS[entry.file.split('/')[0]], `${entry.file} has somewhere to land`);
  }
  const listed = new Set(ART.art.map((a) => a.file));
  for (const used of ART.examples.mila.uses) assert.ok(listed.has(used), used);
});

test('edits round-trip, quotes, about and all', () => {
  const model = example();
  model.scenes[0].lines[0].say = 'What\'s "late"?\ttabs too';
  model.cast.push({
    key: 'ghost', name: 'A Néw One', about: 'Only "there" at night.', moods: [],
  });
  model.scenes.push({
    key: 'attic',
    about: '',
    picture: '',
    music: 'assets/music/attic.ogg',
    lines: [
      { who: 'ghost', mood: '', say: 'boo', sound: '' },
      soundStep('page'),
    ],
    choices: [],
    go: '',
  });
  model.scenes[0].choices.push({ say: 'Go up', go: 'attic', set: 'brave', need: 'saw-the-cat' });
  const again = storyModel(storyText(model));
  assert.equal(again.ok, true, again.reason);
  assert.deepEqual(again, { ok: true, cast: model.cast, scenes: model.scenes });
  // An empty about writes nothing, so a story without them stays as it was.
  assert.ok(!storyText(model).includes('about: ""'));
});

test('renaming a scene brings every way in with it', () => {
  const model = example();
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
  const model = example();
  // A scene nothing leads to, and a mood nobody drew.
  model.scenes.push({
    key: 'attic',
    about: '',
    picture: 'assets/images/attic.png',
    music: 'assets/music/nobody-wrote-this.mp3',
    lines: [{
      who: 'mila', mood: 'furious', say: 'Hey.', sound: '',
    }],
    choices: [],
    go: '',
  });
  // A choice pointing at a scene that is gone, and a switch nothing sets.
  model.scenes[0].choices[0].go = 'gone';
  model.scenes[3].choices[0].need = 'never_set';

  const said = storyChecks(model, PATHS).map((c) => `${c.where}: ${c.say}`);
  assert.ok(said.some((s) => s.startsWith('attic: Nothing leads here')));
  assert.ok(said.some((s) => /goes to gone, which is not a scene/.test(s)));
  assert.ok(said.some((s) => /needs the switch never_set/.test(s)));
  assert.ok(said.some((s) => /assets\/images\/attic\.png is not in this game/.test(s)));
  assert.ok(said.some((s) => /assets\/music\/nobody-wrote-this\.mp3 is not in this game/.test(s)));
  assert.ok(said.some((s) => /mila has no mood called furious/.test(s)));
  // The first scene is where the story starts, so nothing leading to it is
  // not a problem — that one false alarm would fire on every story there is.
  assert.ok(!said.some((s) => s.startsWith('porch: Nothing leads here')));
});

test('a portrait or a sound the game does not have is named', () => {
  const said = storyChecks(example(), []).map((c) => c.say);
  assert.ok(said.includes('assets/sprites/mila-happy.png is not in this game.'));
  assert.ok(said.includes('assets/sounds/page.wav is not in this game.'));
  assert.ok(said.includes('assets/images/porch.png is not in this game.'));
  // One line per missing file, however many scenes use it.
  assert.equal(said.filter((s) => s.startsWith('assets/images/kitchen.png')).length, 2,
    'kitchen and tea both use it, and each says so once');
});

test('renaming a mood renames the picture and every line said in it', () => {
  const model = example();
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
  const model = example();
  // The scene itself, and its picture and music rows: the picture alone.
  for (const step of ['scene', 'picture', 'music']) {
    assert.deepEqual(stageFor(model, 'hall', step), {
      picture: 'assets/images/hall.png',
      portrait: '',
      who: '',
      say: '',
      sound: '',
      choices: [],
      go: '',
      end: false,
    });
  }
  // hall opens with a noise, so its said lines are 1 and 2.
  // A line: its words, its speaker's name, and the portrait the file names.
  assert.deepEqual(stageFor(model, 'hall', 1), {
    picture: 'assets/images/hall.png',
    portrait: 'assets/sprites/mila-happy.png',
    who: 'Mila',
    say: 'Oh! I thought you had forgotten.',
    sound: '',
    choices: [], go: '', end: false,
  });
  // Narration has no speaker and no portrait.
  assert.equal(stageFor(model, 'hall', 2).who, '');
  assert.equal(stageFor(model, 'hall', 2).portrait, '');
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
  model.scenes[2].lines[1].who = 'ghost';
  assert.equal(stageFor(model, 'hall', 1).who, 'ghost');
  assert.equal(stageFor(model, 'hall', 1).portrait, '');
  assert.equal(stageFor(model, 'gone', 0), null);
});

// A noise has nothing of its own to show, so the stage keeps the words that
// are still on screen and names the sound beside them.
test('a sound step keeps the last words up and names itself', () => {
  const model = example();
  const first = stageFor(model, 'hall', 0);
  assert.equal(first.sound, 'page');
  // Nothing said before it yet, so the box is empty — but the picture is not.
  assert.equal(first.say, '');
  assert.equal(first.picture, 'assets/images/hall.png');

  // A noise after two lines keeps the second one up.
  const hall = model.scenes[2];
  hall.lines.push(soundStep('page'));
  const after = stageFor(model, 'hall', hall.lines.length - 1);
  assert.equal(after.sound, 'page');
  assert.equal(after.say, 'The house smells of toast, at eleven o\'clock at night.');
  assert.equal(after.who, '');
  // And the exit still reads the last thing said, not the noise after it.
  assert.equal(stageFor(model, 'hall', 'exit').say, after.say);
});

test('a sound step is a step, not a line anybody says', () => {
  const model = example();
  const hall = model.scenes[2];
  assert.equal(isSoundStep(hall.lines[0]), true);
  assert.equal(isSoundStep(hall.lines[1]), false);
  // What the guide counts: a scene of nothing but noise has not been written.
  assert.equal(saidIn(hall), 2);
  assert.equal(saidIn({ lines: [soundStep('page')] }), 0);
  // A noise carries nothing else, and writes as one key.
  assert.deepEqual(soundStep('page'), {
    who: '', mood: '', say: '', sound: 'page',
  });
  assert.match(storyText(model), /\{ sound: "page" \},/);
});

// ⚠️ The shape before a sound could happen part way through a scene: read as
// a noise in front of the lines, and never written back that way, so opening
// an old story and saving it moves the sound into the timeline.
test('a scene-level sound is read as a sound step and never written back', () => {
  const old = [
    'const CAST = {',
    '};',
    '',
    'const SCENES = {',
    '  hall: {',
    '    sound: "page",',
    '    lines: [',
    '      { say: "Somebody is in." },',
    '    ],',
    '  },',
    '};',
    '',
  ].join('\n');
  const model = storyModel(old);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(model.scenes[0].lines, [
    soundStep('page'),
    {
      who: '', mood: '', say: 'Somebody is in.', sound: '',
    },
  ]);
  assert.equal(model.scenes[0].music, '');
  const written = storyText(model);
  assert.ok(!/^\s*sound: "page",$/m.test(written), 'the old key is gone');
  assert.match(written, /\{ sound: "page" \},/);
  // And reading what was written gives the same thing back.
  const again = storyModel(written);
  assert.deepEqual(again.scenes[0].lines, model.scenes[0].lines);
});

test('leadingTo and wayInto say how a scene is reached', () => {
  const model = example();
  assert.deepEqual(leadingTo(model, 'hall'), ['porch', 'window']);
  assert.deepEqual(leadingTo(model, 'kitchen'), ['hall']);
  assert.deepEqual(leadingTo(model, 'away'), ['porch', 'window', 'kitchen']);
  assert.deepEqual(leadingTo(model, 'porch'), []);
  assert.deepEqual(wayInto(model, 'hall'), { from: 'porch', say: 'Knock' });
  assert.deepEqual(wayInto(model, 'kitchen'), { from: 'hall', say: '' });
  assert.equal(wayInto(model, 'porch'), null);
});

test('lines move to where they are told, and a scene can be made the start', () => {
  const model = example();
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

test('a person or a place by name: made once, found after', () => {
  const model = storyModel(TEMPLATE);
  assert.equal(addPerson(model, 'Mila Blue'), 'mila_blue');
  assert.deepEqual(model.cast[0], {
    key: 'mila_blue', name: 'Mila Blue', about: '', moods: [DEFAULT_MOOD],
  });
  assert.equal(addScene(model, 'The Hall'), 'the_hall');
  assert.equal(model.scenes.length, 1);
  // Asked for again by any spelling that tidies to the same key, it is the
  // same scene; a new name is a new scene.
  assert.equal(sceneCalled(model, 'the hall!'), 'the_hall');
  assert.equal(sceneCalled(model, 'Kitchen'), 'kitchen');
  assert.equal(sceneCalled(model, 'kitchen'), 'kitchen');
  assert.deepEqual(model.scenes.map((s) => s.key), ['the_hall', 'kitchen']);
  assert.equal(storyModel(storyText(model)).ok, true);
});

// The guide is the checks asked as questions: a function of the story and
// the game's files, so this walks a story from nothing to ready by answering
// each one the way the card would.
test('the guide asks for what the story is missing, in the order a story is told', () => {
  const model = storyModel(TEMPLATE);
  const files = [];
  const skipped = new Set();
  const q = () => nextQuestion(model, files, skipped);

  assert.equal(q().id, 'cast-first');
  assert.equal(q().kind, 'name');
  addPerson(model, 'Mila');
  // Her face, before anywhere: a story starts with somebody.
  assert.deepEqual(q(), {
    id: 'portrait:mila:normal', kind: 'picture', path: 'assets/sprites/mila-normal.png',
    who: 'mila', mood: 'normal', ask: 'How does Mila usually look?',
  });
  files.push('assets/sprites/mila-normal.png');
  // Then where it starts, and what that looks like.
  assert.deepEqual(q(), { id: 'scene-first', kind: 'name', ask: 'Where does the story start?' });
  assert.equal(addScene(model, 'The porch'), 'the_porch');
  assert.equal(q().id, 'picture:the_porch');
  assert.equal(q().path, 'assets/images/the_porch.png');
  assert.equal(q().ask, 'What does the_porch look like?');
  model.scenes[0].picture = 'assets/images/the_porch.png';
  files.push('assets/images/the_porch.png');
  assert.equal(q().id, 'lines:the_porch');
  assert.equal(q().ask, 'What happens first?');
  model.scenes[0].lines.push({ who: '', mood: '', say: 'It is late.' });
  // With one person and a first scene told, who else.
  assert.equal(q().id, 'cast-more');
  assert.equal(q().later, 'Nobody yet');
  skipped.add('cast-more');
  // Then where the first scene leads.
  assert.equal(q().id, 'exit:the_porch');
  assert.equal(q().ask, 'Then what?');
  model.scenes[0].choices.push({ say: 'Knock', go: sceneCalled(model, 'Hall'), set: '', need: '' });
  // The new scene comes round as its own questions, saying how it is reached.
  assert.equal(q().id, 'picture:hall');
  assert.equal(q().ask, '“Knock” leads to hall. What does hall look like?');
  skipped.add('picture:hall');
  assert.equal(q().id, 'lines:hall');
  assert.equal(q().ask, '“Knock” leads to hall. What happens there?');
  model.scenes[1].lines.push({ who: 'mila', mood: 'normal', say: 'Oh!' });
  assert.equal(q().id, 'exit:hall');
  assert.equal(q().ask, 'After hall, then what?');
  // "The story ends here" is the answer that sets an exit question aside.
  skipped.add('exit:hall');
  assert.equal(q(), null, 'nothing left to ask');
  // Asked again, the set-aside ones come back — and only they do.
  skipped.clear();
  assert.equal(q().id, 'picture:hall');
  assert.equal(storyModel(storyText(model)).ok, true);
});

test('the guide has nothing to ask of the example but its endings, and names what is dangling', () => {
  const model = example();
  assert.equal(nextQuestion(model, PATHS).id, 'exit:tea');
  assert.equal(nextQuestion(model, PATHS, new Set(['exit:tea'])).id, 'exit:away');
  assert.equal(nextQuestion(model, PATHS, new Set(['exit:tea', 'exit:away'])), null);
  // Without its files, the faces come before the places.
  assert.equal(nextQuestion(model, []).id, 'portrait:mila:happy');
  assert.equal(nextQuestion(model, []).ask, 'How does Mila look when happy?');
  // A way out to a scene that is not there yet is offered to be made.
  model.scenes[0].choices[0].go = 'attic';
  const q = nextQuestion(model, PATHS, new Set(['exit:tea', 'exit:away']));
  assert.deepEqual(q, {
    id: 'make:porch:attic', kind: 'make', scene: 'porch', target: 'attic',
    ask: '“Knock” leads to attic, which is not a scene yet. Make it?',
  });
  // A scene led to by a go says so.
  model.scenes[0].choices[0].go = 'hall';
  model.scenes[2].go = 'pantry';
  assert.equal(nextQuestion(model, PATHS, new Set(['exit:tea', 'exit:away'])).ask,
    'hall goes on to pantry, which is not a scene yet. Make it?');
});

test('anything past the shape declines with the grown reason', () => {
  const grown = /grown past/;
  // An extra declaration.
  assert.match(storyModel(`${EXAMPLE}\nconst EXTRA = 1;\n`).reason, grown);
  // A field on a scene the editor does not know.
  assert.match(storyModel(EXAMPLE.replace(
    '    picture: "assets/images/hall.png",',
    '    picture: "assets/images/hall.png",\n    fade: 400,',
  )).reason, grown);
  // An empty about is not the shape either: absent writes nothing.
  assert.match(storyModel(EXAMPLE.replace(
    '    picture: "assets/images/hall.png",',
    '    about: "",\n    picture: "assets/images/hall.png",',
  )).reason, grown);
  // Both exits at once: choices and go are the same decision.
  assert.match(storyModel(EXAMPLE.replace(
    '    go: "kitchen",',
    '    go: "kitchen",\n    choices: [{ say: "or not", go: "away" }],',
  )).reason, grown);
  // A choice with no target.
  assert.match(storyModel(EXAMPLE.replace(
    '{ say: "Knock", go: "hall" }', '{ say: "Knock" }',
  )).reason, grown);
  // A scene key the serializer could not write bare.
  assert.match(storyModel(EXAMPLE.replace('  porch: {', '  "front porch": {')).reason, grown);
  // Code is not the grown reason — it is the reader refusing, passed through.
  const code = storyModel('const CAST = window.c;\nconst SCENES = {};\n');
  assert.equal(code.ok, false);
  assert.ok(!grown.test(code.reason), code.reason);
});
