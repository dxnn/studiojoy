// The adventure editor's model layer: config/scenes.js in, a plain model out,
// and back to file text again. Reading goes through the config reader — the
// file is never executed — and writing regenerates the whole file with the
// template's standard comments, the same bargain the story editor makes: it
// is the authoring surface for this one file, and it adds and removes whole
// scenes and spots rather than splicing one value. Anything the shape does
// not cover makes adventureModel decline with a reason, and the file falls
// back to the generic config form, then to the text.
//
// It shares the story's vocabulary on purpose (spec/ §4): a **scene** is one
// screen with a picture; a **switch** is one-way, set by one spot and needed
// by another. What it adds is the **spot** — a box on the picture that does
// one thing — and the **item**, which is a switch with a picture. It also
// knows things a form cannot, because it holds the whole graph and the
// game's file list at once: a scene nothing leads to, a spot whose go names
// a scene that is gone, a switch nothing sets, a spot off the edge of its
// picture. That is adventureChecks, and it is the reason this is an editor
// rather than a longer form.

import { parseConfigFile } from './config-file.js';
import { freshKey } from './story-editor.js';

export const ADVENTURE_FILE = 'config/scenes.js';
export const isAdventurePath = (p) => p === ADVENTURE_FILE;

export const itemPath = (item) => `assets/sprites/${item}.png`;
export const picturePath = (key) => `assets/images/${key}.png`;

// Scene keys are written bare, so they have to be identifiers.
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
// What a spot may do, and the one it does when it says nothing else.
export const KINDS = ['go', 'say', 'take'];

const str = (node) => (node && node.kind === 'string' ? node.value : null);
const keysOf = (node) => node.props.map((p) => p.key).sort().join(',');
const propNode = (node, key) => node.props.find((p) => p.key === key)?.node;

// A box is four whole numbers, in the picture's own pixels.
const boxOf = (node) => {
  if (!node || node.kind !== 'array' || node.items.length !== 4) return null;
  const at = node.items.map((n) => (n.kind === 'number' ? n.value : null));
  if (at.some((n) => n === null || !Number.isInteger(n))) return null;
  return at;
};

// One line or a list of them, either way a list here.
const linesOf = (node) => {
  if (!node) return [];
  if (node.kind === 'string') return node.value === '' ? null : [node.value];
  if (node.kind !== 'array' || !node.items.length) return null;
  const lines = node.items.map(str);
  return lines.some((l) => l === null || l === '') ? null : lines;
};

export const blankSpot = (at) => ({
  at, kind: 'say', go: '', say: [''], take: '', need: '', set: '', sound: '', keep: false,
});

/* Reading ------------------------------------------------------------------ */

export function adventureModel(text) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const grown = {
    ok: false, reason: 'the file has grown past what the adventure editor understands',
  };
  if (parsed.decls.map((d) => d.name).join(',') !== 'SCENES') return grown;
  const [scenesNode] = parsed.decls.map((d) => d.node);
  if (scenesNode.kind !== 'object') return grown;

  const scenes = [];
  for (const prop of scenesNode.props) {
    if (!KEY.test(prop.key) || prop.node.kind !== 'object') return grown;
    const held = keysOf(prop.node).split(',').filter(Boolean);
    if (held.some((k) => !['about', 'picture', 'spots'].includes(k))) return grown;
    const scene = {
      key: prop.key,
      about: str(propNode(prop.node, 'about')) ?? '',
      picture: str(propNode(prop.node, 'picture')) ?? '',
      spots: [],
    };
    if (held.includes('about') && scene.about === '') return grown;
    if (held.includes('picture') && scene.picture === '') return grown;

    const spotsNode = propNode(prop.node, 'spots');
    if (spotsNode) {
      if (spotsNode.kind !== 'array') return grown;
      for (const item of spotsNode.items) {
        if (item.kind !== 'object') return grown;
        const keys = keysOf(item).split(',');
        if (keys.some((k) => !['at', 'go', 'say', 'take', 'need', 'set', 'sound', 'keep'].includes(k))) return grown;
        const at = boxOf(propNode(item, 'at'));
        if (!at) return grown;
        const go = str(propNode(item, 'go')) ?? '';
        const take = str(propNode(item, 'take')) ?? '';
        const say = linesOf(propNode(item, 'say'));
        if (say === null) return grown;
        if (keys.includes('go') && go === '') return grown;
        if (keys.includes('take') && take === '') return grown;
        // One thing each: a go walks, a say speaks, a take picks up and may
        // speak as it does. A spot that both walks and speaks, or walks and
        // takes, is not this shape.
        let kind;
        if (take) { if (go) return grown; kind = 'take'; } else if (go) { if (say.length) return grown; kind = 'go'; } else if (say.length) kind = 'say';
        else return grown;
        const need = str(propNode(item, 'need')) ?? '';
        const set = str(propNode(item, 'set')) ?? '';
        const sound = str(propNode(item, 'sound')) ?? '';
        for (const [k, v] of [['need', need], ['set', set], ['sound', sound]]) {
          if (keys.includes(k) && v === '') return grown;
        }
        const keepNode = propNode(item, 'keep');
        if (keepNode && (keepNode.kind !== 'boolean' || keepNode.value !== true || !take)) return grown;
        scene.spots.push({
          at, kind, go, say: kind === 'go' ? [] : say, take, need, set, sound, keep: Boolean(keepNode),
        });
      }
    }
    scenes.push(scene);
  }
  return { ok: true, scenes };
}

/* Writing ------------------------------------------------------------------ */

const SCENES_NOTE = [
  '// Every scene: one picture with spots on it. The adventure starts at the',
  '// first one listed, and a scene with no spots at all is the end.',
  '//',
  '// A spot is a box on the picture — at: [x, y, width, height], in the',
  '// picture\'s own pixels — and one thing it does when it is clicked:',
  '//   go: "garden"          the player walks through to that scene',
  '//   say: "It is locked."  a line in the box; a list of lines is read one at',
  '//                         a time',
  '//   take: "key"           the thing goes into what the player carries, and',
  '//                         its picture is assets/sprites/key.png. Taking it',
  '//                         remembers a switch called "key", and the spot is',
  '//                         gone once taken — unless it says keep: true',
  '// Any spot may also have need: "key" (it only works once that switch is',
  '// remembered), set: "door_open" (it remembers a switch when it is used) and',
  '// sound: "creak" (it plays assets/sounds/creak.wav). Two spots on the same box',
  '// with different needs are how a door is locked and then not: the first one',
  '// whose need is met wins, top to bottom.',
  '//',
  '// Draw the boxes in the studio\'s adventure editor rather than typing the',
  '// numbers. "about" is a line about the place for the studio; the game never',
  '// reads it.',
];

export function adventureText({ scenes }) {
  const s = JSON.stringify;
  const out = [...SCENES_NOTE, 'const SCENES = {'];
  scenes.forEach((scene, at) => {
    // A blank line between scenes, so the file reads as a list of places
    // rather than one wall. None before the first.
    if (at > 0) out.push('');
    out.push(`  ${scene.key}: {`);
    if (scene.about) out.push(`    about: ${s(scene.about)},`);
    if (scene.picture) out.push(`    picture: ${s(scene.picture)},`);
    if (scene.spots.length) {
      out.push('    spots: [');
      for (const spot of scene.spots) {
        const parts = [`at: [${spot.at.join(', ')}]`];
        if (spot.kind === 'go') parts.push(`go: ${s(spot.go)}`);
        if (spot.kind === 'take') parts.push(`take: ${s(spot.take)}`);
        // A say that is written stays one line while it is one line.
        if (spot.kind !== 'go' && spot.say.length) {
          parts.push(`say: ${spot.say.length === 1 ? s(spot.say[0]) : `[${spot.say.map(s).join(', ')}]`}`);
        }
        if (spot.need) parts.push(`need: ${s(spot.need)}`);
        if (spot.set) parts.push(`set: ${s(spot.set)}`);
        if (spot.sound) parts.push(`sound: ${s(spot.sound)}`);
        if (spot.kind === 'take' && spot.keep) parts.push('keep: true');
        out.push(`      { ${parts.join(', ')} },`);
      }
      out.push('    ],');
    }
    out.push('  },');
  });
  out.push('};', '');
  return out.join('\n');
}

/* Names and making things ------------------------------------------------- */

export { freshKey };

// Renaming a scene moves every way in with it.
export function renameScene(model, from, to) {
  for (const scene of model.scenes) {
    if (scene.key === from) scene.key = to;
    for (const spot of scene.spots) if (spot.kind === 'go' && spot.go === from) spot.go = to;
  }
}

export function addScene(model, name) {
  const key = freshKey(name, model.scenes.map((s) => s.key));
  model.scenes.push({
    key, about: '', picture: '', spots: [],
  });
  return key;
}

// A place by the name somebody typed: the scene already called that, else a
// new one.
export function sceneCalled(model, name) {
  const want = freshKey(name, []);
  const found = model.scenes.find((s) => s.key === want || s.key === name.trim());
  return found ? found.key : addScene(model, name);
}

export function duplicateScene(model, key) {
  const at = model.scenes.findIndex((s) => s.key === key);
  if (at < 0) return null;
  const scene = model.scenes[at];
  const copy = {
    ...scene,
    key: freshKey(scene.key, model.scenes.map((s) => s.key)),
    spots: scene.spots.map((sp) => ({ ...sp, at: [...sp.at], say: [...sp.say] })),
  };
  model.scenes.splice(at + 1, 0, copy);
  return copy.key;
}

// Make a scene the one the adventure starts at. Order decides where it starts
// and nothing else.
export function startAt(model, key) {
  const at = model.scenes.findIndex((s) => s.key === key);
  if (at <= 0) return;
  const [scene] = model.scenes.splice(at, 1);
  model.scenes.unshift(scene);
}

// A new spot on a scene, at a box somebody drew, saying nothing yet. Answers
// its index, which is what the editor opens.
export function addSpot(scene, at) {
  scene.spots.push(blankSpot(at.map((n) => Math.round(n))));
  return scene.spots.length - 1;
}

export function moveSpot(scene, from, to) {
  if (from === to || from < 0 || from >= scene.spots.length) return;
  const [spot] = scene.spots.splice(from, 1);
  scene.spots.splice(Math.max(0, Math.min(to, scene.spots.length)), 0, spot);
}

// Every scene that leads to this one, in order.
export function leadingTo({ scenes }, key) {
  return scenes
    .filter((s) => s.spots.some((sp) => sp.kind === 'go' && sp.go === key))
    .map((s) => s.key);
}

// Every thing that can be taken, in the order it first appears.
export const itemsOf = ({ scenes }) => [...new Set(
  scenes.flatMap((s) => s.spots.filter((sp) => sp.kind === 'take').map((sp) => sp.take)),
)];

// Every switch anything sets: a set, or a thing taken.
export const switchesOf = ({ scenes }) => [...new Set(
  scenes.flatMap((s) => s.spots.flatMap((sp) => [sp.set, sp.kind === 'take' ? sp.take : ''])).filter(Boolean),
)].sort();

// Nothing in it yet: what the template ships, and when the example is offered.
export const emptyAdventure = ({ scenes }) => scenes.every((s) => !s.picture && !s.spots.length);

// What a spot does, in a few words, for a row and for the box drawn on the
// stage.
export function spotLabel(spot) {
  if (spot.kind === 'go') return `→ ${spot.go || '…'}`;
  if (spot.kind === 'take') return `take ${spot.take || '…'}`;
  return spot.say[0] ? `“${spot.say[0]}”` : '…';
}

// The smallest spot holding a point — so a small box inside a big one can
// still be picked up off the stage. Its index, or -1.
export function spotAt(scene, x, y) {
  let best = -1;
  let area = Infinity;
  scene.spots.forEach((sp, i) => {
    const [sx, sy, w, h] = sp.at;
    if (x < sx || y < sy || x >= sx + w || y >= sy + h) return;
    if (w * h < area) { area = w * h; best = i; }
  });
  return best;
}

const contains = (outer, inner) => inner[0] >= outer[0] && inner[1] >= outer[1]
  && inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3];

/* Checks ------------------------------------------------------------------- */

// What the whole graph says that one field cannot. `paths` is every file in
// the game, so a picture nobody has drawn yet is a thing this can see;
// `sizes` is what the editor knows of the pictures it has drawn — path to
// {width, height} — so a spot off the edge of a picture that shrank is too.
export function adventureChecks({ scenes }, paths = [], sizes = new Map()) {
  const has = new Set(paths);
  const keys = new Set(scenes.map((s) => s.key));
  const set = new Set(switchesOf({ scenes }));
  const reached = new Set(scenes.length ? [scenes[0].key] : []);
  for (const scene of scenes) {
    for (const spot of scene.spots) if (spot.kind === 'go') reached.add(spot.go);
  }

  const out = [];
  const seen = new Set();
  const flag = (where, say) => {
    const at = `${where} ${say}`;
    if (seen.has(at)) return;
    seen.add(at);
    out.push({ where, say });
  };

  for (const scene of scenes) {
    if (!reached.has(scene.key)) flag(scene.key, 'Nothing leads here.');
    if (scene.picture && !has.has(scene.picture)) flag(scene.key, `${scene.picture} is not in this game.`);
    const size = sizes.get(scene.picture);
    scene.spots.forEach((spot, i) => {
      const n = i + 1;
      if (spot.kind === 'go' && !keys.has(spot.go)) {
        flag(scene.key, `Spot ${n} goes to ${spot.go}, which is not a scene any more.`);
      }
      if (spot.need && !set.has(spot.need)) {
        flag(scene.key, `Spot ${n} needs the switch ${spot.need}, and nothing sets it — so it can never be clicked.`);
      }
      if (spot.kind === 'take' && !has.has(itemPath(spot.take))) {
        flag(scene.key, `${itemPath(spot.take)} is not in this game, so the ${spot.take} is shown as a word.`);
      }
      if (spot.sound && !has.has(`assets/sounds/${spot.sound}.wav`)) {
        flag(scene.key, `assets/sounds/${spot.sound}.wav is not in this game.`);
      }
      if (size && (spot.at[0] < 0 || spot.at[1] < 0
        || spot.at[0] + spot.at[2] > size.width || spot.at[1] + spot.at[3] > size.height)) {
        flag(scene.key, `Spot ${n} is off the edge of the picture.`);
      }
      // Under an earlier spot asking for the same thing, the first wins every
      // time and this one can never be clicked. Different needs are the
      // locked-and-unlocked door, and fine.
      const over = scene.spots.findIndex((o, j) => j < i && o.need === spot.need && contains(o.at, spot.at));
      if (over >= 0) {
        flag(scene.key, `Spot ${n} sits under spot ${over + 1}, which asks for the same thing — so it can never be clicked.`);
      }
    });
  }
  return out;
}

// How the adventure reads as a whole.
export function adventureShape({ scenes }) {
  return {
    scenes: scenes.length,
    spots: scenes.reduce((n, s) => n + s.spots.length, 0),
    items: itemsOf({ scenes }).length,
    endings: scenes.filter((s) => !s.spots.length).length,
  };
}

/* The guide ---------------------------------------------------------------- */

const leadIn = (model, scene) => {
  const from = leadingTo(model, scene.key)[0];
  return from ? `From ${from} you reach ${scene.key}. ` : '';
};

// The guide's next question: the first thing the adventure is missing, in the
// order an adventure is made — where it starts, what that looks like, what is
// there to click on, then every place a spot leads to but nobody has made,
// then a picture for each thing that can be carried. A function of the
// adventure and the game's files, with no state of its own beyond the
// questions the author has set aside. Null when nothing is missing.
export function nextQuestion(model, paths = [], skipped = new Set()) {
  const has = new Set(paths);
  const { scenes } = model;
  const ask = (id, q) => (skipped.has(id) ? null : { id, ...q });

  if (scenes.length === 0) return { id: 'scene-first', kind: 'name', ask: 'Where does the adventure start?' };
  for (const [at, scene] of scenes.entries()) {
    if (!scene.picture || !has.has(scene.picture)) {
      const q = ask(`picture:${scene.key}`, {
        kind: 'picture',
        path: scene.picture || picturePath(scene.key),
        scene: scene.key,
        ask: `${leadIn(model, scene)}What does ${scene.key} look like?`,
      });
      if (q) return q;
    }
    if (scene.spots.length === 0) {
      const q = ask(`spots:${scene.key}`, {
        kind: 'spots',
        scene: scene.key,
        ask: at === 0
          ? 'What is there to click on? Drag a box around it on the picture.'
          : `${leadIn(model, scene)}What is there to click on in ${scene.key}?`,
        later: 'The adventure ends here',
      });
      if (q) return q;
    }
  }
  const keys = new Set(scenes.map((s) => s.key));
  for (const scene of scenes) {
    for (const spot of scene.spots) {
      if (spot.kind !== 'go' || keys.has(spot.go)) continue;
      const q = ask(`make:${scene.key}:${spot.go}`, {
        kind: 'make',
        scene: scene.key,
        target: spot.go,
        ask: `A spot in ${scene.key} leads to ${spot.go}, which is not a scene yet. Make it?`,
      });
      if (q) return q;
    }
  }
  for (const item of itemsOf(model)) {
    if (has.has(itemPath(item))) continue;
    const q = ask(`item:${item}`, {
      kind: 'item', item, path: itemPath(item), ask: `What does the ${item} look like?`,
    });
    if (q) return q;
  }
  return null;
}
