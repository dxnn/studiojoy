// The story editor's model layer: config/story.js in, a plain model out, and
// back to file text again. Reading goes through the config reader — the file
// is never executed — and writing regenerates the whole file with the
// template's standard comments, the same bargain the quiz editor makes: it is
// the authoring surface for this one file, and it adds and removes whole
// scenes rather than splicing one value. Anything the shape does not cover
// makes storyModel decline with a reason, and the file falls back to the
// generic config form, then to the text.
//
// It also knows things a form cannot, because it holds the whole graph and
// the game's file list at once: a scene nothing leads to, a choice pointing
// at a scene that is gone, a switch nothing ever sets, a portrait that is not
// in the game. That is storyChecks, and it is the reason this is an editor
// rather than a longer form.

import { parseConfigFile } from './config-file.js';

export const isStoryPath = (p) => p === 'config/story.js';

// Scene and cast keys are written bare, so they have to be identifiers. A
// scene's key is its name and is shown; a cast member's is wiring, fixed when
// they are made, because their portraits are named after it.
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const str = (node) => (node && node.kind === 'string' ? node.value : null);

const keysOf = (node) => node.props.map((p) => p.key).sort().join(',');

const propNode = (node, key) => node.props.find((p) => p.key === key)?.node;

/* Reading ------------------------------------------------------------------ */

export function storyModel(text) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const grown = {
    ok: false, reason: 'the file has grown past what the story editor understands',
  };

  if (parsed.decls.map((d) => d.name).join(',') !== 'CAST,SCENES') return grown;
  const [castNode, scenesNode] = parsed.decls.map((d) => d.node);
  if (castNode.kind !== 'object' || scenesNode.kind !== 'object') return grown;

  const cast = [];
  for (const prop of castNode.props) {
    if (!KEY.test(prop.key) || prop.node.kind !== 'object') return grown;
    if (keysOf(prop.node) !== 'moods,name') return grown;
    const name = str(propNode(prop.node, 'name'));
    const moodsNode = propNode(prop.node, 'moods');
    if (name === null || !moodsNode || moodsNode.kind !== 'array') return grown;
    const moods = moodsNode.items.map(str);
    if (moods.some((m) => m === null)) return grown;
    cast.push({ key: prop.key, name, moods });
  }

  const scenes = [];
  for (const prop of scenesNode.props) {
    if (!KEY.test(prop.key) || prop.node.kind !== 'object') return grown;
    const held = keysOf(prop.node).split(',').filter(Boolean);
    // The three exits are exclusive: choices branch, go carries straight on,
    // neither is the end. A scene with both is not this shape.
    if (held.includes('choices') && held.includes('go')) return grown;
    if (held.some((k) => !['picture', 'sound', 'lines', 'choices', 'go'].includes(k))) return grown;

    const scene = {
      key: prop.key,
      picture: str(propNode(prop.node, 'picture')) ?? '',
      sound: str(propNode(prop.node, 'sound')) ?? '',
      lines: [],
      choices: [],
      go: str(propNode(prop.node, 'go')) ?? '',
    };
    if (held.includes('picture') && scene.picture === '') return grown;
    if (held.includes('sound') && scene.sound === '') return grown;
    if (held.includes('go') && scene.go === '') return grown;

    const linesNode = propNode(prop.node, 'lines');
    if (linesNode) {
      if (linesNode.kind !== 'array') return grown;
      for (const item of linesNode.items) {
        if (item.kind !== 'object') return grown;
        const keys = keysOf(item);
        if (!['say', 'mood,say,who', 'say,who'].includes(keys)) return grown;
        const say = str(propNode(item, 'say'));
        const who = str(propNode(item, 'who')) ?? '';
        const mood = str(propNode(item, 'mood')) ?? '';
        if (say === null || (keys !== 'say' && who === '')) return grown;
        scene.lines.push({ who, mood, say });
      }
    }

    const choicesNode = propNode(prop.node, 'choices');
    if (choicesNode) {
      if (choicesNode.kind !== 'array') return grown;
      for (const item of choicesNode.items) {
        if (item.kind !== 'object') return grown;
        const keys = keysOf(item).split(',');
        if (!keys.includes('say') || !keys.includes('go')) return grown;
        if (keys.some((k) => !['say', 'go', 'set', 'need'].includes(k))) return grown;
        const say = str(propNode(item, 'say'));
        const go = str(propNode(item, 'go'));
        const set = str(propNode(item, 'set')) ?? '';
        const need = str(propNode(item, 'need')) ?? '';
        if (say === null || go === null) return grown;
        if (keys.includes('set') && set === '') return grown;
        if (keys.includes('need') && need === '') return grown;
        scene.choices.push({ say, go, set, need });
      }
    }

    scenes.push(scene);
  }

  return { ok: true, cast, scenes };
}

/* Writing ------------------------------------------------------------------ */

const CAST_NOTE = [
  '// Who is in the story. A person\'s picture is assets/sprites/<who>-<mood>.png,',
  '// so "mila" looking "happy" is assets/sprites/mila-happy.png. Add a mood here',
  '// and draw a picture with the matching name.',
];

const SCENES_NOTE = [
  '// Every scene. The story starts at the first one listed.',
  '//',
  '// A scene shows its picture, plays its sound if it has one, and says its',
  '// lines one at a time. Then one of three things happens:',
  '//   choices — the player picks one, and it says where to go',
  '//   go      — the story carries straight on to that scene',
  '//   neither — that is the end of the story',
  '//',
  '// A line with no "who" is the story talking rather than a person.',
  '// A choice can "set" a switch, and a choice that "need"s a switch is only',
  '// offered once something has set it.',
];

export function storyText({ cast, scenes }) {
  const s = JSON.stringify;
  const out = [...CAST_NOTE, 'const CAST = {'];
  for (const person of cast) {
    out.push(`  ${person.key}: { name: ${s(person.name)}, `
      + `moods: [${person.moods.map(s).join(', ')}] },`);
  }
  out.push('};', '', ...SCENES_NOTE, 'const SCENES = {');

  scenes.forEach((scene, at) => {
    // A blank line between scenes, so the file reads as a list of places
    // rather than one wall. None before the first.
    if (at > 0) out.push('');
    out.push(`  ${scene.key}: {`);
    if (scene.picture) out.push(`    picture: ${s(scene.picture)},`);
    if (scene.sound) out.push(`    sound: ${s(scene.sound)},`);
    if (scene.lines.length) {
      out.push('    lines: [');
      for (const line of scene.lines) {
        const parts = [];
        if (line.who) parts.push(`who: ${s(line.who)}`);
        if (line.who && line.mood) parts.push(`mood: ${s(line.mood)}`);
        parts.push(`say: ${s(line.say)}`);
        out.push(`      { ${parts.join(', ')} },`);
      }
      out.push('    ],');
    }
    if (scene.choices.length) {
      out.push('    choices: [');
      for (const choice of scene.choices) {
        const parts = [`say: ${s(choice.say)}`, `go: ${s(choice.go)}`];
        if (choice.set) parts.push(`set: ${s(choice.set)}`);
        if (choice.need) parts.push(`need: ${s(choice.need)}`);
        out.push(`      { ${parts.join(', ')} },`);
      }
      out.push('    ],');
    } else if (scene.go) {
      out.push(`    go: ${s(scene.go)},`);
    }
    out.push('  },');
  });

  out.push('};', '');
  return out.join('\n');
}

/* Names -------------------------------------------------------------------- */

// A key from what somebody typed: an identifier, because it is written bare.
// Empty or all punctuation falls back to the prefix, and a collision counts up.
export function freshKey(from, taken, prefix = 'scene') {
  const base = String(from).toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '').replace(/^(?=\d)/, '_') || prefix;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
}

// Renaming a scene moves every way in with it — the one thing a text editor
// cannot do without a find-and-replace that also hits the words of the story.
// A cast member is never renamed this way: their portraits are named after
// their key, so only the name people read changes.
export function renameScene(model, from, to) {
  for (const scene of model.scenes) {
    if (scene.key === from) scene.key = to;
    if (scene.go === from) scene.go = to;
    for (const choice of scene.choices) if (choice.go === from) choice.go = to;
  }
}

// A mood is the tail of a picture's name, so renaming one renames the picture
// the story asks for — and every line said in that mood comes along, the way
// every way into a scene follows a scene rename.
export function renameMood(model, who, from, to) {
  const person = model.cast.find((p) => p.key === who);
  if (!person) return;
  person.moods = person.moods.map((m) => (m === from ? to : m));
  for (const scene of model.scenes) {
    for (const line of scene.lines) if (line.who === who && line.mood === from) line.mood = to;
  }
}

/* The stage ---------------------------------------------------------------- */

// What the player sees at one step of a scene, for the studio to draw from the
// unsaved model. A step is 'scene', 'picture' or 'sound' — the picture alone —
// a line's index — that line, with its speaker and portrait — or 'exit': the
// last line still up, and what follows it. Null for a scene that is gone.
export function stageFor(model, key, step) {
  const scene = model.scenes.find((s) => s.key === key);
  if (!scene) return null;
  const out = {
    picture: scene.picture, portrait: '', who: '', say: '', choices: [], go: '', end: false,
  };
  const at = step === 'exit' ? scene.lines.length - 1 : step;
  const line = Number.isInteger(at) ? scene.lines[at] : null;
  if (line) {
    out.say = line.say;
    const person = model.cast.find((p) => p.key === line.who);
    if (person) {
      out.who = person.name || person.key;
      if (line.mood) out.portrait = `assets/sprites/${line.who}-${line.mood}.png`;
    } else if (line.who) {
      out.who = line.who;
    }
  }
  if (step === 'exit') {
    out.choices = scene.choices;
    out.go = scene.go;
    out.end = scene.choices.length === 0 && !scene.go;
  }
  return out;
}

// Every scene that leads to this one, in story order — by a go or by a choice.
export function leadingTo({ scenes }, key) {
  return scenes
    .filter((s) => s.go === key || s.choices.some((c) => c.go === key))
    .map((s) => s.key);
}

// Move one line so that it ends up at index `to`. ▲ and ▼ are a move of one;
// a drop is a move to the row it landed on.
export function moveLine(scene, from, to) {
  if (from === to || from < 0 || from >= scene.lines.length) return;
  const [line] = scene.lines.splice(from, 1);
  scene.lines.splice(Math.max(0, Math.min(to, scene.lines.length)), 0, line);
}

// Make a scene the one the story starts at. Order decides where the story
// starts and nothing else, so this is the one reordering a scene ever needs.
export function startAt(model, key) {
  const at = model.scenes.findIndex((s) => s.key === key);
  if (at <= 0) return;
  const [scene] = model.scenes.splice(at, 1);
  model.scenes.unshift(scene);
}

/* Checks ------------------------------------------------------------------- */

// What the whole graph says that one field cannot. `paths` is every file in
// the game, so a picture nobody has drawn yet is a thing this can see.
export function storyChecks({ cast, scenes }, paths = []) {
  const has = new Set(paths);
  const keys = new Set(scenes.map((s) => s.key));
  const moodsOf = new Map(cast.map((p) => [p.key, new Set(p.moods)]));

  const reached = new Set(scenes.length ? [scenes[0].key] : []);
  const set = new Set();
  for (const scene of scenes) {
    if (scene.go) reached.add(scene.go);
    for (const choice of scene.choices) {
      reached.add(choice.go);
      if (choice.set) set.add(choice.set);
    }
  }

  const out = [];
  const seen = new Set();
  const flag = (where, say) => {
    const at = `${where} ${say}`;
    if (seen.has(at)) return;
    seen.add(at);
    out.push({ where, say });
  };

  for (const scene of scenes) {
    if (!reached.has(scene.key)) flag(scene.key, 'Nothing leads here.');
    if (scene.go && !keys.has(scene.go)) {
      flag(scene.key, `Goes on to ${scene.go}, which is not a scene any more.`);
    }
    for (const choice of scene.choices) {
      if (!keys.has(choice.go)) {
        flag(scene.key, `“${choice.say}” goes to ${choice.go}, which is not a scene any more.`);
      }
      if (choice.need && !set.has(choice.need)) {
        flag(scene.key, `“${choice.say}” needs the switch ${choice.need}, `
          + 'and nothing in the story sets it — so nobody will ever be offered it.');
      }
    }
    if (scene.picture && !has.has(scene.picture)) {
      flag(scene.key, `${scene.picture} is not in this game.`);
    }
    if (scene.sound && !has.has(`assets/sounds/${scene.sound}.wav`)) {
      flag(scene.key, `assets/sounds/${scene.sound}.wav is not in this game.`);
    }
    for (const line of scene.lines) {
      if (!line.who) continue;
      if (!moodsOf.has(line.who)) {
        flag(scene.key, `${line.who} is not in the cast.`);
      } else if (line.mood && !moodsOf.get(line.who).has(line.mood)) {
        flag(scene.key, `${line.who} has no mood called ${line.mood}.`);
      } else if (line.mood && !has.has(`assets/sprites/${line.who}-${line.mood}.png`)) {
        flag(scene.key, `assets/sprites/${line.who}-${line.mood}.png is not in this game.`);
      }
    }
  }
  return out;
}

// How the story reads as a whole: what a person wants to know before opening
// any one scene.
export function storyShape({ scenes }) {
  const endings = scenes.filter((s) => !s.choices.length && !s.go).length;
  return { scenes: scenes.length, endings };
}
