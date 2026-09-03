// The Controls panel's model layer: config/controls.js in, a plain model out.
// Reading goes through the config reader — the file is never executed — and
// writing is a splice of one value at a time, so every comment, blank line
// and bit of alignment in the file survives. Unlike the quiz editor this is
// not the only surface: the file is hand-edited by people and by helpers, and
// regenerating it would throw away notes somebody wrote beside a binding.
//
// ⚠️ Changing the shape changes the word and nothing else — not the notes
// above it, which came from the shape the game was seeded with and will read
// as that one afterwards. Deliberate for now: the notes are prose somebody
// may have added to, and the panel shows the current shape's own words in the
// interface, so only a helper reading the raw file can be misled — which is
// why the preamble tells it to read `SCHEME` rather than the prose. Whether
// the panel should swap them is a TODO line.
//
// ⚠️ Verb names are read-only here. `left`, `thrust`, `boost` are the game's
// own words and `Input.held("thrust")` is somewhere in its code, so renaming
// one in a form is a silent code break.

import { parseConfigFile, spliceValue } from './config-file.js';

export const CONTROLS_FILE = 'config/controls.js';
export const isControlsPath = (p) => p === CONTROLS_FILE;

// The declarations this panel knows. Anything else in the file is left alone
// and said out loud at the foot of the panel, because config/controls.js is
// old enough to have grown things in a few games.
const KNOWN = ['SCHEME', 'CONTROLS', 'BUTTON_SIDE', 'STICK_DEADZONE', 'HIDDEN'];

// The kinds of binding, by their prefix. `raw` keeps whatever was written, so
// a token this does not understand can still be shown and removed.
export const KINDS = ['key', 'pad', 'touch', 'toggle', 'stick', 'swipe'];

// What each shape can actually use, mirroring what input.js installs for it
// (studio-lib/input/input.js, and the table in ideas/control-schemes.md).
// Everything drawn or gestural is off unless the shape draws it, which is
// what lets the panel say "the swipe-tap shape has no stick" rather than
// leaving a binding that quietly never fires. Pinned by test/controls-editor.
export const USABLE = {
  none: ['key', 'pad'],
  buttons: ['key', 'pad', 'touch', 'toggle'],
  'stick-buttons': ['key', 'pad', 'touch', 'toggle', 'stick'],
  'dual-stick': ['key', 'pad', 'touch', 'toggle', 'stick'],
  'one-button': ['key', 'pad', 'touch'],
  'swipe-tap': ['key', 'pad', 'swipe'],
  // No SCHEME at all draws the buttons shape, so it can use what that can.
  '': ['key', 'pad', 'touch', 'toggle'],
};

// The stick names each shape has a zone for: one stick, two, or none. A
// stick:aim-left in a game with no aim stick is as dead as a stick in a game
// with none.
const STICKS = {
  'stick-buttons': ['move'],
  'dual-stick': ['move', 'aim'],
};

// The one touch name the whole-screen shapes answer to.
const WHOLE_SCREEN = { 'one-button': 'screen' };

// Which knobs a shape has. BUTTON_SIDE mirrors any drawn layout, sticks
// included; STICK_DEADZONE is read for the controller's sticks in every shape
// but only worth showing where a thumb works one too.
export const hasSide = (shape) => (USABLE[shape] ?? USABLE['']).some(
  (k) => k === 'touch' || k === 'stick',
);
export const hasDeadzone = (shape) => (STICKS[shape] ?? []).length > 0;

// A controller in the standard layout, and its sticks: the same names
// input.js reads, which test/controls-editor.test.js holds it to.
export const PAD_NAMES = [
  'a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'l3', 'r3',
  'up', 'down', 'left', 'right',
  'stick-left', 'stick-right', 'stick-up', 'stick-down',
  'stick2-left', 'stick2-right', 'stick2-up', 'stick2-down',
];

// A pressed key as config/controls.js writes it: the friendly name where
// input.js has one, so the file says key:space rather than a space nobody
// can see. The inverse of that file's KEY_NAMES.
const KEY_NAMES = {
  arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down',
  ' ': 'space', escape: 'esc', control: 'ctrl',
};

export function keyNameFor(pressed) {
  if (typeof pressed !== 'string' || pressed === '') return null;
  const key = pressed.toLowerCase();
  const named = KEY_NAMES[key];
  if (named) return named;
  // A name with a space in it would read as two bindings; nothing else can.
  return /\s/.test(key) ? null : key;
}

// What a shape offers to put on the screen, in the words the panel shows. A
// drawn button carries a name, so its value is the prefix alone and the name
// comes from the verb; everything else is the whole binding.
export function screenOptions(shape) {
  const usable = USABLE[shape] ?? USABLE[''];
  const only = WHOLE_SCREEN[shape];
  if (only !== undefined) return [{ value: `touch:${only}`, label: 'a tap or a click anywhere' }];
  const out = [];
  if (usable.includes('swipe')) {
    for (const way of ['left', 'right', 'up', 'down']) {
      out.push({ value: `swipe:${way}`, label: `a flick ${way}` });
    }
    out.push({ value: 'swipe:tap', label: 'a tap' });
  }
  for (const which of STICKS[shape] ?? []) {
    const prefix = which === 'aim' ? 'aim-' : '';
    const whose = (STICKS[shape] ?? []).length > 1 ? `the ${which} stick` : 'the stick';
    for (const way of ['left', 'right', 'up', 'down']) {
      out.push({ value: `stick:${prefix}${way}`, label: `${whose} pushed ${way}` });
    }
    out.push({ value: `stick:${which}`, label: `${whose} pushed at all` });
  }
  if (usable.includes('touch')) {
    for (const way of ['left', 'right', 'up', 'down']) {
      out.push({ value: `touch:${way}`, label: `the ${way} arrow` });
    }
    out.push({ value: 'touch:', label: 'a drawn button with a name on it' });
  }
  return out;
}

// A drawn direction: input.js draws these four as the arrow pair or the arrow
// pad rather than as a button with a word on it, so they have no name to
// change and nothing to latch.
export const isArrow = (name) => ['left', 'right', 'up', 'down'].includes(name);

// One binding in plain words, for the row it sits on.
export function sayBinding(b) {
  if (b.kind === 'key') {
    if (b.name === 'space') return 'the space bar';
    return b.name.length === 1 ? `the ${b.name.toUpperCase()} key` : `the ${b.name} key`;
  }
  if (b.kind === 'pad') {
    if (b.name.startsWith('stick')) {
      const [stick, way] = b.name.split('-');
      const whose = stick === 'stick2' ? 'right stick' : 'left stick';
      return `the controller's ${whose} pushed ${way}`;
    }
    if (isArrow(b.name)) return `the controller's pad, ${b.name}`;
    return `the controller's ${b.name.toUpperCase()} button`;
  }
  if (b.kind === 'swipe') return b.name === 'tap' ? 'a tap' : `a flick ${b.name}`;
  if (b.kind === 'stick') {
    const aim = b.name.startsWith('aim');
    const way = b.name.replace('aim-', '');
    const whose = aim ? 'the aim stick' : 'the stick';
    return way === 'move' || way === 'aim' ? `${whose} pushed at all` : `${whose} pushed ${way}`;
  }
  if (b.kind === 'touch' || b.kind === 'toggle') {
    if (b.name === 'screen') return 'a tap or a click anywhere';
    if (isArrow(b.name)) return `the ${b.name} arrow, drawn on the screen`;
    return b.kind === 'toggle' ? 'a drawn button that latches' : 'a drawn button';
  }
  return 'nothing reads this';
}

function binding(raw) {
  const at = raw.indexOf(':');
  const kind = at === -1 ? null : raw.slice(0, at);
  if (at === -1 || !KINDS.includes(kind)) return { kind: null, name: raw, raw };
  return { kind, name: raw.slice(at + 1), raw };
}

// Why this binding does nothing in this shape, in words, or null when it
// works. Said per binding rather than per file: the answer is different for
// stick:left and stick:aim-left in the same game.
export function deadReason(shape, b) {
  if (b.kind === null) return `${b.raw} is not a kind of binding, so nothing reads it.`;
  const usable = USABLE[shape] ?? USABLE[''];
  if (!usable.includes(b.kind)) {
    if (b.kind === 'swipe') return 'This shape has no swipes.';
    if (b.kind === 'stick') return 'This shape has no stick on the screen.';
    if (shape === 'none') return 'This shape draws nothing on the screen.';
    return 'This shape has no drawn buttons.';
  }
  if (b.kind === 'stick') {
    const which = b.name.startsWith('aim-') || b.name === 'aim' ? 'aim' : 'move';
    if (!(STICKS[shape] ?? []).includes(which)) {
      return which === 'aim'
        ? 'This shape has one stick, and it is the one you move with.'
        : 'This shape has no stick on the screen.';
    }
  }
  const only = WHOLE_SCREEN[shape];
  if (only !== undefined && (b.kind === 'touch' || b.kind === 'toggle') && b.name !== only) {
    return `In this shape the whole screen is the button, so only touch:${only} is read.`;
  }
  return null;
}

const str = (node) => (node && node.kind === 'string' ? node.value : null);

// Every binding on one line, split up. A list is refused rather than read:
// input.js accepts one, but a panel that showed a list and wrote back a
// string would quietly reshape somebody's file.
function bindingsOf(node) {
  const line = str(node);
  if (line === null) return null;
  return line.split(/\s+/).filter(Boolean).map(binding);
}

export function controlsModel(text) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const decl = (name) => parsed.decls.find((d) => d.name === name)?.node ?? null;

  const controls = decl('CONTROLS');
  if (!controls) {
    return { ok: false, reason: 'this file does not say what the controls are' };
  }
  if (controls.kind !== 'object') {
    return { ok: false, reason: 'CONTROLS is not a group of players' };
  }

  const players = [];
  for (const who of controls.props) {
    if (who.node.kind !== 'object') {
      return { ok: false, reason: `${who.key} is not a group of things to do` };
    }
    const verbs = [];
    for (const verb of who.node.props) {
      const bindings = bindingsOf(verb.node);
      if (bindings === null) {
        return { ok: false, reason: `${who.key}'s ${verb.key} is not written as one line of bindings` };
      }
      verbs.push({ verb: verb.key, bindings, comment: verb.node.comment });
    }
    players.push({ who: who.key, verbs });
  }

  const scheme = decl('SCHEME');
  if (scheme !== null && scheme.kind !== 'string') {
    return { ok: false, reason: 'SCHEME is not one word in quotes' };
  }
  const side = decl('BUTTON_SIDE');
  const deadzone = decl('STICK_DEADZONE');
  const hidden = decl('HIDDEN');

  return {
    ok: true,
    // '' is a game from before the word, which draws the buttons shape.
    scheme: scheme === null ? '' : scheme.value,
    declared: scheme !== null,
    players,
    side: side?.kind === 'string' ? side.value : null,
    deadzone: deadzone?.kind === 'number' ? deadzone.value : null,
    hidden: hidden?.kind === 'array' ? hidden.value.filter((v) => typeof v === 'string') : [],
    // Anything the panel does not show, so it can say so rather than hide it.
    extra: parsed.decls.map((d) => d.name).filter((n) => !KNOWN.includes(n)),
  };
}

// Everything in the file that this shape cannot use: one entry per binding,
// with the words for why. What explicit declaration was for — a file claiming
// swipe-tap while binding six drawn buttons has left its shape, and the panel
// is where that gets said.
export function deadBindings(model, shape = model.scheme) {
  const out = [];
  for (const player of model.players) {
    for (const { verb, bindings } of player.verbs) {
      for (const b of bindings) {
        const why = deadReason(shape, b);
        if (why) out.push({ who: player.who, verb, binding: b, why });
      }
    }
  }
  return out;
}

// The kinds of binding a finger can reach, per shape. Nothing for the null
// controller: the game's own buttons are what a finger reaches there.
const FINGER = {
  none: [],
  buttons: ['touch', 'toggle'],
  'stick-buttons': ['touch', 'toggle', 'stick'],
  'dual-stick': ['stick'],
  'one-button': ['touch'],
  'swipe-tap': ['swipe'],
  '': ['touch', 'toggle'],
};

// What the whole file says that no single row can. There is one thing worth
// saying: a shape that draws something, and bindings that never name it, is a
// game nobody can play on a phone — and picking a shape is exactly when that
// happens, because the bindings are deliberately left alone.
export function controlsChecks(model, shape = model.scheme) {
  const want = FINGER[shape] ?? FINGER[''];
  if (want.length === 0) return [];
  const reached = model.players.some(
    (p) => p.verbs.some(
      (v) => v.bindings.some((b) => want.includes(b.kind) && !deadReason(shape, b)),
    ),
  );
  if (reached) return [];
  return ['Nothing here is bound to the screen, so on a phone or a tablet this game '
    + 'cannot be played at all. Give the things a player does something this shape draws.'];
}

/* Writing ------------------------------------------------------------------ */

// One value replaced, by the path the model read it at. The file is re-parsed
// here rather than the nodes being kept, because every splice moves the
// offsets after it (the same bargain as the generic config form).
function setValue(text, name, keys, literal) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return null;
  let node = parsed.decls.find((d) => d.name === name)?.node;
  for (const key of keys) {
    node = node?.props?.find((p) => p.key === key)?.node;
  }
  return node ? spliceValue(text, node, literal) : null;
}

export function setBindings(text, who, verb, bindings) {
  return setValue(text, 'CONTROLS', [who, verb], JSON.stringify(bindings.join(' ')));
}

// A knob the shape has and the file has not: appended with its comment,
// because a panel offering BUTTON_SIDE on a file that never declared it has
// to write the declaration the first time it is used.
const KNOBS = {
  BUTTON_SIDE: [
    '// Which corner the drawn buttons sit in: "right" or "left". Whatever',
    '// moves the player takes the other thumb.',
  ],
  STICK_DEADZONE: [
    "// How far a stick has to lean before it counts as pushed — the controller's",
    '// and the one on the screen both. A small number here means the game drifts',
    '// on its own; a big one means the stick feels stiff.',
  ],
};

export function setKnob(text, name, literal) {
  const spliced = setValue(text, name, [], literal);
  if (spliced !== null) return spliced;
  if (!KNOBS[name]) return null;
  const end = text.endsWith('\n') ? text : `${text}\n`;
  return `${end}\n${KNOBS[name].join('\n')}\nconst ${name} = ${literal};\n`;
}

// The shape changed. The bindings are left exactly as they are — replacing
// them with the new shape's preset would take the game's own verbs away, and
// its code asks for those by name. What the new shape cannot use is said in
// the panel instead.
export function setScheme(text, scheme) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return null;
  const declared = parsed.decls.find((d) => d.name === 'SCHEME');
  const literal = JSON.stringify(scheme);
  if (declared) return spliceValue(text, declared.node, literal);
  // A game from before the word. The declaration goes in above the first one
  // there is, which is where every preset keeps it, and takes the blank line
  // between them with it.
  const at = parsed.decls[0].node.start;
  const above = text.slice(0, at).replace(/[^\n]*$/, '');
  return `${above}// The shape of the game on a screen — what hands do.\n`
    + `const SCHEME = ${literal};\n\n${text.slice(above.length)}`;
}
