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

import { parseConfigFile, literalFor, spliceValue } from './config-file.js';

export const isStoryPath = (p) => p === 'config/story.js';

// The title screen's words — the big line and the one under it — are
// config/words.js's, not the story's, so the editor reads and writes that file
// the way the config form does: one value spliced in place, every other word
// in it (the End, the buttons, how to play) left as it was. The story editor
// is the authoring surface for story.js alone; here it is a visitor.
export const WORDS_FILE = 'config/words.js';

const wordNode = (text, key) => {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return null;
  const decl = parsed.decls.find((d) => d.name === 'WORDS');
  if (!decl || decl.node.kind !== 'object') return null;
  const node = decl.node.props.find((p) => p.key === key)?.node;
  return node?.kind === 'string' ? node : null;
};

// { title, tagline, start } off the file, or null when it has not got them —
// a words file a helper has reshaped shows no title row rather than a wrong one.
export function titleWords(text) {
  const title = wordNode(text, 'title');
  const tagline = wordNode(text, 'tagline');
  if (!title || !tagline) return null;
  return { title: title.value, tagline: tagline.value, start: wordNode(text, 'start')?.value ?? 'Begin' };
}

// The file with the two lines put back; byte-identical when neither changed.
export function withTitleWords(text, { title, tagline }) {
  let out = text;
  for (const [key, raw] of [['title', title], ['tagline', tagline]]) {
    const node = wordNode(out, key);
    if (!node) return null;
    out = spliceValue(out, node, literalFor('string', raw));
  }
  return out;
}

// Scene and cast keys are written bare, so they have to be identifiers. A
// scene's key is its name and is shown; a cast member's is wiring, fixed when
// they are made, because their portraits are named after it.
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const str = (node) => (node && node.kind === 'string' ? node.value : null);

const keysOf = (node) => node.props.map((p) => p.key).sort().join(',');

const propNode = (node, key) => node.props.find((p) => p.key === key)?.node;

// Every entry in a scene's `lines` is one of two things, and one field tells
// them apart: a **sound step** has `sound` and says nothing, a said line has
// words and no sound. Held in one list rather than two so the editor can drag
// a noise in between two lines the way TyranoBuilder does, and so `moveLine`
// needs to know nothing about either.
export const isSoundStep = (line) => Boolean(line?.sound);

export const soundStep = (sound) => ({
  who: '', mood: '', say: '', sound,
});

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
    // `about` is a line about them for the studio's own use — the fill reads
    // it, the game never does — and optional like a scene's.
    if (!['moods,name', 'about,moods,name'].includes(keysOf(prop.node))) return grown;
    const name = str(propNode(prop.node, 'name'));
    const about = str(propNode(prop.node, 'about')) ?? '';
    const moodsNode = propNode(prop.node, 'moods');
    if (name === null || !moodsNode || moodsNode.kind !== 'array') return grown;
    if (propNode(prop.node, 'about') && about === '') return grown;
    const moods = moodsNode.items.map(str);
    if (moods.some((m) => m === null)) return grown;
    cast.push({
      key: prop.key, name, about, moods,
    });
  }

  const scenes = [];
  for (const prop of scenesNode.props) {
    if (!KEY.test(prop.key) || prop.node.kind !== 'object') return grown;
    const held = keysOf(prop.node).split(',').filter(Boolean);
    // The three exits are exclusive: choices branch, go carries straight on,
    // neither is the end. A scene with both is not this shape.
    if (held.includes('choices') && held.includes('go')) return grown;
    if (held.some((k) => !['about', 'picture', 'music', 'sound', 'lines', 'choices', 'go'].includes(k))) return grown;

    const scene = {
      key: prop.key,
      about: str(propNode(prop.node, 'about')) ?? '',
      picture: str(propNode(prop.node, 'picture')) ?? '',
      // A whole path, like the picture and unlike a sound: music arrives as
      // whatever the file was — .mp3, .ogg, .m4a — so there is no one ending
      // a bare name could be given.
      music: str(propNode(prop.node, 'music')) ?? '',
      lines: [],
      choices: [],
      go: str(propNode(prop.node, 'go')) ?? '',
    };
    // ⚠️ Scene-level `sound:` is the shape before a sound could happen part
    // way through a scene, and it meant "at the start". It is read as exactly
    // that — a sound step in front of the lines — and never written back, so
    // opening an old story in the editor and saving it moves the sound into
    // the timeline where it can be dragged. The template's player still plays
    // the old key, so a story nobody has re-saved is unchanged.
    const wasSound = str(propNode(prop.node, 'sound')) ?? '';
    if (held.includes('sound') && wasSound === '') return grown;
    if (held.includes('about') && scene.about === '') return grown;
    if (held.includes('picture') && scene.picture === '') return grown;
    if (held.includes('music') && scene.music === '') return grown;
    if (held.includes('go') && scene.go === '') return grown;
    if (wasSound) scene.lines.push(soundStep(wasSound));

    const linesNode = propNode(prop.node, 'lines');
    if (linesNode) {
      if (linesNode.kind !== 'array') return grown;
      for (const item of linesNode.items) {
        if (item.kind !== 'object') return grown;
        const keys = keysOf(item);
        // A sound is a step of its own among the lines, and carries nothing
        // else: nobody speaks it and it has no mood.
        if (keys === 'sound') {
          const sound = str(propNode(item, 'sound'));
          if (sound === null || sound === '') return grown;
          scene.lines.push(soundStep(sound));
          continue;
        }
        if (!['say', 'mood,say,who', 'say,who'].includes(keys)) return grown;
        const say = str(propNode(item, 'say'));
        const who = str(propNode(item, 'who')) ?? '';
        const mood = str(propNode(item, 'mood')) ?? '';
        if (say === null || (keys !== 'say' && who === '')) return grown;
        scene.lines.push({
          who, mood, say, sound: '',
        });
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
  '// and draw a picture with the matching name. "about" is a line about them for',
  '// the studio; the game never reads it.',
];

const SCENES_NOTE = [
  '// Every scene. The story starts at the first one listed.',
  '//',
  '// A scene shows its picture, loops its music if it has any, and reads its',
  '// lines from the top. Then one of three things happens:',
  '//   choices — the player picks one, and it says where to go',
  '//   go      — the story carries straight on to that scene',
  '//   neither — that is the end of the story',
  '//',
  '// A line with no "who" is the story talking rather than a person, and a line',
  '// that is only { sound: "page" } is a noise: it plays assets/sounds/page.wav',
  '// and carries straight on, so put one wherever something should be heard.',
  '//',
  '// "music" is a whole path, like the picture. It loops behind the scene and',
  '// keeps playing into the next scene that asks for the same track.',
  '//',
  '// A choice can "set" a switch, and a choice that "need"s a switch is only',
  '// offered once something has set it. "about" is a line about the place for',
  '// the studio; the game never reads it.',
];

export function storyText({ cast, scenes }) {
  const s = JSON.stringify;
  const out = [...CAST_NOTE, 'const CAST = {'];
  for (const person of cast) {
    out.push(`  ${person.key}: { name: ${s(person.name)}, `
      + (person.about ? `about: ${s(person.about)}, ` : '')
      + `moods: [${person.moods.map(s).join(', ')}] },`);
  }
  out.push('};', '', ...SCENES_NOTE, 'const SCENES = {');

  scenes.forEach((scene, at) => {
    // A blank line between scenes, so the file reads as a list of places
    // rather than one wall. None before the first.
    if (at > 0) out.push('');
    out.push(`  ${scene.key}: {`);
    if (scene.about) out.push(`    about: ${s(scene.about)},`);
    if (scene.picture) out.push(`    picture: ${s(scene.picture)},`);
    if (scene.music) out.push(`    music: ${s(scene.music)},`);
    if (scene.lines.length) {
      out.push('    lines: [');
      for (const line of scene.lines) {
        if (isSoundStep(line)) {
          out.push(`      { sound: ${s(line.sound)} },`);
          continue;
        }
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

/* Making things ------------------------------------------------------------ */

// The mood a person starts with — "how do they usually look?" — so a face
// has a file name from the first question on.
export const DEFAULT_MOOD = 'normal';

export const portraitPath = (who, mood) => `assets/sprites/${who}-${mood}.png`;
export const picturePath = (key) => `assets/images/${key}.png`;

export function addPerson(model, name) {
  const key = freshKey(name, model.cast.map((p) => p.key), 'person');
  model.cast.push({
    key, name: name.trim(), about: '', moods: [DEFAULT_MOOD],
  });
  return key;
}

export function addScene(model, name) {
  const key = freshKey(name, model.scenes.map((s) => s.key));
  model.scenes.push({
    key, about: '', picture: '', music: '', lines: [], choices: [], go: '',
  });
  return key;
}

// A copy of a scene, right after it, under the next free name — the same
// picture, music, lines and way out, each its own so editing one never edits
// the other. The shape has no lines after a choice, so a choice that keeps the
// player where they are ("try the door" — it is locked — still in the hall)
// is said with a second scene, and this is how the second scene is made.
export function duplicateScene(model, key) {
  const at = model.scenes.findIndex((s) => s.key === key);
  if (at < 0) return null;
  const scene = model.scenes[at];
  const copy = {
    ...scene,
    key: freshKey(scene.key, model.scenes.map((s) => s.key)),
    lines: scene.lines.map((l) => ({ ...l })),
    choices: scene.choices.map((c) => ({ ...c })),
  };
  model.scenes.splice(at + 1, 0, copy);
  return copy.key;
}

// A place by the name somebody typed: the scene already called that, else a
// new one — so "where does it lead?" can name a scene that exists or one that
// does not yet, without asking which.
export function sceneCalled(model, name) {
  const want = freshKey(name, []);
  const found = model.scenes.find((s) => s.key === want || s.key === name.trim());
  return found ? found.key : addScene(model, name);
}

// Nothing in it yet: what the template ships, and when the example is offered.
export const emptyStory = ({ cast, scenes }) => cast.length === 0
  && scenes.every((s) => !s.picture && !s.music && !s.lines.length
    && !s.choices.length && !s.go);

// How many of a scene's steps are somebody talking. A scene holding nothing
// but a noise has not been written yet, so this is what the guide counts.
export const saidIn = (scene) => scene.lines.filter((l) => !isSoundStep(l)).length;

/* The guide ---------------------------------------------------------------- */

// The first way into a scene — the choice or the go that leads there — so the
// guide can say "“Knock” leads to the hall" rather than only "the hall".
export function wayInto({ scenes }, key) {
  for (const scene of scenes) {
    if (scene.go === key) return { from: scene.key, say: '' };
    const choice = scene.choices.find((c) => c.go === key);
    if (choice) return { from: scene.key, say: choice.say };
  }
  return null;
}

const leadIn = (model, scene) => {
  const way = wayInto(model, scene.key);
  if (!way) return '';
  return way.say ? `“${way.say}” leads to ${scene.key}. ` : `After ${way.from} comes ${scene.key}. `;
};

// The guide's next question: the first thing the story is missing, in the
// order a story is told — who, then how they look, then where, then what it
// looks like, then what happens, then who else, then where each scene leads.
// A function of the story and the game's files, with no state of its own
// beyond the questions the author has set aside, so it works on a new story,
// a half-built one and one hand-edited for a week, and re-asks from the model
// whenever the author ignores it and clicks around. Null when nothing is
// missing. `paths` is every file in the game, as for storyChecks.
export function nextQuestion(model, paths = [], skipped = new Set()) {
  const has = new Set(paths);
  const { cast, scenes } = model;
  const ask = (id, q) => (skipped.has(id) ? null : { id, ...q });

  if (cast.length === 0) return { id: 'cast-first', kind: 'name', ask: 'Who is the main character?' };
  for (const person of cast) {
    const name = person.name || person.key;
    for (const mood of person.moods) {
      const path = portraitPath(person.key, mood);
      if (has.has(path)) continue;
      const q = ask(`portrait:${person.key}:${mood}`, {
        kind: 'picture',
        path,
        who: person.key,
        mood,
        ask: mood === DEFAULT_MOOD
          ? `How does ${name} usually look?`
          : `How does ${name} look when ${mood}?`,
      });
      if (q) return q;
    }
  }

  if (scenes.length === 0) return { id: 'scene-first', kind: 'name', ask: 'Where does the story start?' };
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
    // Said lines, not steps: a scene holding nothing but a door slam still
    // needs somebody to say something.
    if (saidIn(scene) === 0) {
      const q = ask(`lines:${scene.key}`, {
        kind: 'lines',
        scene: scene.key,
        ask: at === 0 ? 'What happens first?' : `${leadIn(model, scene)}What happens there?`,
      });
      if (q) return q;
    }
  }

  if (cast.length === 1) {
    const q = ask('cast-more', { kind: 'name', ask: 'Who else is there?', later: 'Nobody yet' });
    if (q) return q;
  }

  const keys = new Set(scenes.map((s) => s.key));
  for (const scene of scenes) {
    // A way out pointing at a scene that is not there yet.
    for (const target of [scene.go, ...scene.choices.map((c) => c.go)].filter(Boolean)) {
      if (keys.has(target)) continue;
      const choice = scene.choices.find((c) => c.go === target);
      const q = ask(`make:${scene.key}:${target}`, {
        kind: 'make',
        scene: scene.key,
        target,
        ask: choice
          ? `“${choice.say}” leads to ${target}, which is not a scene yet. Make it?`
          : `${scene.key} goes on to ${target}, which is not a scene yet. Make it?`,
      });
      if (q) return q;
    }
    // Lines and no way out. An ending looks the same, so this is asked once
    // per scene, and "the story ends here" is the answer that sets it aside.
    if (saidIn(scene) && !scene.choices.length && !scene.go) {
      const q = ask(`exit:${scene.key}`, {
        kind: 'exit',
        scene: scene.key,
        ask: scenes.length === 1 ? 'Then what?' : `After ${scene.key}, then what?`,
      });
      if (q) return q;
    }
  }
  return null;
}

/* The stage ---------------------------------------------------------------- */

// What the player sees at one step of a scene, for the studio to draw from the
// unsaved model. A step is 'scene', 'picture' or 'music' — the picture alone —
// a line's index — that line, with its speaker and portrait — or 'exit': the
// last line still up, and what follows it. Null for a scene that is gone.
//
// A sound step has nothing of its own to show: the player is still looking at
// the words that came before it, so those are what the stage keeps, with
// `sound` named beside them. Anything else would blank the stage for a noise.
export function stageFor(model, key, step) {
  const scene = model.scenes.find((s) => s.key === key);
  if (!scene) return null;
  const out = {
    picture: scene.picture,
    portrait: '',
    who: '',
    say: '',
    sound: '',
    choices: [],
    go: '',
    end: false,
  };
  const at = step === 'exit' ? scene.lines.length - 1 : step;
  let line = Number.isInteger(at) ? scene.lines[at] : null;
  if (line && isSoundStep(line)) {
    out.sound = line.sound;
    // The last thing actually said before this noise, which is what is still
    // on screen when it plays.
    line = null;
    for (let i = at - 1; i >= 0; i -= 1) {
      if (!isSoundStep(scene.lines[i])) { line = scene.lines[i]; break; }
    }
  }
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
    // Music is a whole path, so it is checked as one; a sound is a bare name
    // under assets/sounds/, the way the sound library resolves it.
    if (scene.music && !has.has(scene.music)) {
      flag(scene.key, `${scene.music} is not in this game.`);
    }
    for (const line of scene.lines) {
      if (isSoundStep(line)) {
        if (!has.has(`assets/sounds/${line.sound}.wav`)) {
          flag(scene.key, `assets/sounds/${line.sound}.wav is not in this game.`);
        }
        continue;
      }
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
