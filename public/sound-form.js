// The sound editor: a .wav as the numbers that made it — a preset to start
// from, a shape, and a row of sliders with a comment on each. The same surface
// makes a new sound and changes an old one, because the numbers ride inside
// the file (see soundNote in sound-maker.js), so there is nothing for the
// studio to remember between one visit and the next.
//
// Painted in place rather than through render(), which would rebuild the
// slider under the thumb dragging it — the same trap as the pixel editor's
// canvas and the problems panel.

import { h } from './dom.js';
import {
  SOUND_PARAMS, SOUND_PRESETS, WAVES, soundFrom, randomSound, soundBytes,
} from './sound-maker.js';

// Plain words for the four shapes, with the real name kept: a ten-year-old
// picks "buzzy", and the one who wants to know what a square wave is can see
// it. Same bargain as helper/agent.
const WAVE_WORDS = {
  square: 'Buzzy (square)', saw: 'Sharp (saw)', sine: 'Smooth (sine)', noise: 'Noisy (noise)',
};

export const SOUND_WORDS = {
  pickup: 'Pick up', laser: 'Laser', explosion: 'Explosion', powerup: 'Power up',
  hit: 'Hit', jump: 'Jump', blip: 'Blip',
};

let soundUrl = null;

// The bytes played are the bytes that would be saved, so there is no way to
// hear one thing and keep another. The last URL is let go on the next play
// rather than on a timer: an object URL held forever is a leak, and one
// revoked too early is a sound that will not play twice.
export function playSound(params) {
  if (soundUrl) URL.revokeObjectURL(soundUrl);
  soundUrl = URL.createObjectURL(new Blob([soundBytes(params)], { type: 'audio/wav' }));
  new Audio(soundUrl).play().catch(() => { /* a browser that will not autoplay */ });
}

// `sound` is changed in place — it is the open file's numbers, and the pane
// holding it is what says whether they have been saved. `changed` is called
// after every edit, and `renamed` after a preset when the caller has a name to
// keep in step with it (the dialog does, the pane does not).
export function renderSoundForm(sound, changed, renamed = null) {
  const sliders = new Map();
  const readouts = new Map();

  const wave = h('select', {
    onchange: (e) => {
      sound.wave = e.currentTarget.value;
      changed();
      playSound(sound);
    },
  }, WAVES.map((w) => h('option', { value: w, text: WAVE_WORDS[w] })));

  const shown = (p) => (p.step >= 1 ? String(Math.round(sound[p.key])) : sound[p.key].toFixed(2));

  const paint = () => {
    for (const p of SOUND_PARAMS) {
      sliders.get(p.key).value = sound[p.key];
      readouts.get(p.key).textContent = shown(p);
    }
    wave.value = sound.wave;
  };

  const knobs = h('div', { class: 'knobs' }, SOUND_PARAMS.map((p) => {
    const readout = h('span', { class: 'knob-value mono' });
    const slider = h('input', {
      type: 'range', min: p.min, max: p.max, step: p.step,
      // Dragging moves the number beside it; letting go is what plays the
      // sound, so a slow drag is not forty overlapping sounds.
      oninput: (e) => {
        sound[p.key] = Number(e.currentTarget.value);
        readout.textContent = shown(p);
        changed();
      },
      onchange: () => playSound(sound),
    });
    sliders.set(p.key, slider);
    readouts.set(p.key, readout);
    return h('label', { class: 'knob' },
      h('span', { class: 'knob-name', text: p.label }),
      slider,
      readout,
      h('span', { class: 'knob-note hint muted', text: p.comment }));
  }));

  // A preset replaces every number rather than the object: the file's sound is
  // what the pane and the save both hold, so it has to stay the same object.
  const load = (from, called) => {
    Object.assign(sound, from);
    if (called && renamed) renamed(called);
    paint();
    changed();
    playSound(sound);
  };
  paint();

  return [
    h('div', { class: 'row wrap' },
      Object.keys(SOUND_PRESETS).map((n) => h('button', {
        class: 'quiet tiny', text: SOUND_WORDS[n] ?? n, onclick: () => load(soundFrom(n), n),
      })),
      h('button', { class: 'quiet tiny', text: 'Surprise me', onclick: () => load(randomSound()) })),
    // The shape is a row like the numbers are, so the pane is one list rather
    // than a field and then a list of sliders.
    h('div', { class: 'knobs' },
      h('label', { class: 'knob' },
        h('span', { class: 'knob-name', text: 'Shape' }),
        wave,
        h('span', { class: 'knob-value' }),
        h('span', { class: 'knob-note hint muted', text: 'what it is made of' }))),
    knobs,
  ];
}
