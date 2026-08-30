// Making a sound effect out of a few numbers, rather than finding a file of
// one. A blip is a pitch, a shape, and how it fades — this turns that into
// samples and then into the bytes of a .wav.
//
// Nothing here touches the DOM or the Web Audio API: the whole render is plain
// arithmetic over a Float32Array, so the same code makes the sound in the
// studio and can be checked without a browser. What you hear is the file that
// gets saved, because the studio plays the encoded bytes rather than a
// separate live version of them.

export const RATE = 44100;

// The one place a parameter is described. The dialog builds a slider per entry
// with its comment beside it — the same bargain as a config file, where the
// comment is the point.
export const SOUND_PARAMS = [
  { key: 'freq', label: 'Pitch', min: 40, max: 3000, step: 1, comment: 'high or low' },
  { key: 'slide', label: 'Slide', min: -6, max: 6, step: 0.05, comment: 'octaves it climbs or falls each second' },
  { key: 'attack', label: 'Fade in', min: 0, max: 0.4, step: 0.005, comment: 'how long it takes to get loud' },
  { key: 'sustain', label: 'Hold', min: 0, max: 1, step: 0.01, comment: 'how long it stays loud' },
  { key: 'decay', label: 'Fade out', min: 0, max: 1.5, step: 0.01, comment: 'how long it takes to die away' },
  { key: 'jump', label: 'Jump', min: -0.7, max: 2, step: 0.05, comment: 'a step up or down partway through' },
  { key: 'jumpAt', label: 'Jump when', min: 0.05, max: 0.95, step: 0.01, comment: 'how far in the step happens' },
  { key: 'vibrato', label: 'Wobble', min: 0, max: 0.5, step: 0.01, comment: 'how far the pitch wobbles' },
  { key: 'vibratoRate', label: 'Wobble speed', min: 0, max: 40, step: 0.5, comment: 'how fast it wobbles' },
  { key: 'duty', label: 'Buzz', min: 0.05, max: 0.95, step: 0.01, comment: 'thin or fat — only the square' },
  { key: 'repeat', label: 'Repeat', min: 0, max: 20, step: 0.5, comment: 'times a second it starts over' },
  { key: 'lowPass', label: 'Softness', min: 200, max: 12000, step: 50, comment: 'takes the sharp edges off' },
  { key: 'volume', label: 'Loudness', min: 0, max: 1, step: 0.01, comment: 'how loud' },
];

export const WAVES = ['square', 'saw', 'sine', 'noise'];

export const DEFAULT_SOUND = {
  wave: 'square',
  freq: 600,
  slide: 0,
  attack: 0,
  sustain: 0.05,
  decay: 0.2,
  jump: 0,
  jumpAt: 0.5,
  vibrato: 0,
  vibratoRate: 8,
  duty: 0.5,
  repeat: 0,
  lowPass: 12000,
  volume: 0.5,
  // Noise is random, but the same sound twice has to be the same file, so the
  // randomness is a number you can keep rather than one nobody can get back.
  seed: 1,
};

// The seven a game actually asks for. Each is a nudge away from the default
// rather than a full set, so a new parameter gets a sensible value everywhere.
export const SOUND_PRESETS = {
  pickup: { wave: 'square', freq: 700, slide: 1.2, sustain: 0.03, decay: 0.12, jump: 0.6, jumpAt: 0.35, volume: 0.45 },
  laser: { wave: 'saw', freq: 950, slide: -3, sustain: 0.04, decay: 0.14, lowPass: 6000, volume: 0.4 },
  explosion: { wave: 'noise', freq: 320, slide: -1.6, sustain: 0.14, decay: 0.5, lowPass: 1800, volume: 0.7, seed: 7 },
  powerup: { wave: 'square', freq: 300, slide: 2.2, sustain: 0.18, decay: 0.22, vibrato: 0.06, vibratoRate: 14, volume: 0.45 },
  hit: { wave: 'noise', freq: 500, slide: -2, sustain: 0.02, decay: 0.12, lowPass: 3000, volume: 0.55, seed: 3 },
  jump: { wave: 'square', freq: 340, slide: 2, sustain: 0.05, decay: 0.1, duty: 0.35, volume: 0.45 },
  blip: { wave: 'square', freq: 900, sustain: 0.02, decay: 0.04, duty: 0.5, volume: 0.4 },
};

export const soundFrom = (name) => ({ ...DEFAULT_SOUND, ...(SOUND_PRESETS[name] ?? {}) });

// xorshift32. Small, and the only thing it has to be is the same every time
// for the same seed.
function randomiser(seed) {
  let x = (seed | 0) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function renderSound(params, rate = RATE) {
  const p = { ...DEFAULT_SOUND, ...params };
  const length = Math.max(0.02, p.attack + p.sustain + p.decay);
  const count = Math.max(1, Math.round(length * rate));
  const out = new Float32Array(count);
  const noise = randomiser(p.seed);

  // Repeating restarts the pitch — the slide and the jump run again — while
  // the fade keeps going over the whole sound. That is what makes a repeat
  // sound like an engine rather than like the same clip played twice.
  const span = p.repeat > 0 ? 1 / p.repeat : length;

  // One-pole low pass, the cheapest thing that takes the fizz off noise.
  const smoothing = Math.exp((-2 * Math.PI * p.lowPass) / rate);
  let filtered = 0;
  let phase = 0;
  let noiseValue = 0;
  let noiseHold = 0;

  for (let i = 0; i < count; i += 1) {
    const t = i / rate;
    const u = p.repeat > 0 ? t % span : t;

    let freq = p.freq * (2 ** (p.slide * u));
    if (u / span >= p.jumpAt) freq *= 1 + p.jump;
    if (p.vibrato > 0) freq *= 1 + p.vibrato * Math.sin(2 * Math.PI * p.vibratoRate * t);
    // Below 20 Hz there is nothing to hear, and above half the sample rate a
    // wave turns into a different, lower one.
    freq = clamp(freq, 20, rate / 2);

    let sample;
    if (p.wave === 'noise') {
      // Held for one wavelength, so pitch still means something: a low noise
      // is a rumble and a high one is a hiss.
      noiseHold -= freq / rate;
      if (noiseHold <= 0) {
        noiseValue = noise() * 2 - 1;
        noiseHold += 1;
      }
      sample = noiseValue;
    } else {
      phase += freq / rate;
      phase -= Math.floor(phase);
      if (p.wave === 'sine') sample = Math.sin(2 * Math.PI * phase);
      else if (p.wave === 'saw') sample = 2 * phase - 1;
      else sample = phase < p.duty ? 1 : -1;
    }

    filtered = filtered * smoothing + sample * (1 - smoothing);

    let envelope;
    if (t < p.attack) envelope = p.attack > 0 ? t / p.attack : 1;
    else if (t < p.attack + p.sustain) envelope = 1;
    else envelope = p.decay > 0 ? Math.max(0, 1 - (t - p.attack - p.sustain) / p.decay) : 0;

    out[i] = clamp(filtered * envelope * p.volume, -1, 1);
  }

  // A wave cut off mid-swing is a click, and a click is the one thing that
  // makes a sound effect sound broken.
  const tail = Math.min(count, Math.round(0.004 * rate));
  for (let i = 0; i < tail; i += 1) out[count - 1 - i] *= i / tail;
  return out;
}

// A nudge rather than a reroll: a random number in every slot is noise, and a
// preset moved a little is still a sound effect.
export function randomSound(random = Math.random) {
  const names = Object.keys(SOUND_PRESETS);
  const sound = soundFrom(names[Math.floor(random() * names.length)]);
  for (const param of SOUND_PARAMS) {
    const reach = (param.max - param.min) * 0.3;
    const moved = sound[param.key] + (random() * 2 - 1) * reach;
    const stepped = Math.round(moved / param.step) * param.step;
    sound[param.key] = Number(clamp(stepped, param.min, param.max).toFixed(4));
  }
  sound.seed = 1 + Math.floor(random() * 60000);
  return sound;
}

/* The file ---------------------------------------------------------------- */

const ascii = (view, at, text) => {
  for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
};

// 16-bit mono PCM: the plainest thing every browser and every game engine can
// already play, and the only audio format worth hand-writing. A `note` rides
// in front of the samples as a comment chunk; without one the file is the same
// 44 bytes of header it always was.
export function encodeWav(samples, rate = RATE, note = '') {
  // A comment is stored with its terminator, and every chunk is padded to an
  // even length.
  const text = note ? `${note}\0` : '';
  const pad = text.length % 2;
  const list = note ? 20 + text.length + pad : 0;
  const bytes = new Uint8Array(44 + list + samples.length * 2);
  const view = new DataView(bytes.buffer);
  ascii(view, 0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // rest of this chunk
  view.setUint16(20, 1, true);           // PCM, uncompressed
  view.setUint16(22, 1, true);           // one channel
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);    // bytes per second
  view.setUint16(32, 2, true);           // bytes per sample, all channels
  view.setUint16(34, 16, true);          // bits per sample
  let at = 36;
  if (note) {
    ascii(view, at, 'LIST');
    view.setUint32(at + 4, 12 + text.length + pad, true);
    ascii(view, at + 8, 'INFO');
    ascii(view, at + 12, 'ICMT');
    view.setUint32(at + 16, text.length, true);
    ascii(view, at + 20, text);
    at += 20 + text.length + pad;
  }
  ascii(view, at, 'data');
  view.setUint32(at + 4, samples.length * 2, true);
  const first = at + 8;
  for (let i = 0; i < samples.length; i += 1) {
    const value = clamp(samples[i], -1, 1);
    // Negative has one more step than positive in two's complement, so the
    // two directions are scaled by their own limit rather than one of them
    // wrapping at full volume.
    view.setInt16(first + i * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
  }
  return bytes;
}

/* The numbers, kept ------------------------------------------------------- */

// A sound is worth changing a week later, and the numbers that made it are the
// only way to do that — samples cannot be turned back into sliders. So they
// ride inside the file they made: RIFF is a list of chunks and a player skips
// every chunk it does not know, so this is a comment in the documented place
// for one, LIST/INFO/ICMT, which an audio editor shows rather than drops. A
// file beside the .wav would have been less to write and would have come apart
// the first time somebody renamed or copied the sound.
//
// The version is what a note has to say before it is read at all, so a later
// shape can be told from this one rather than half-understood.
const NOTE_VERSION = 1;

export const soundNote = (params) => JSON.stringify({
  studio: NOTE_VERSION, sound: { ...DEFAULT_SOUND, ...params },
});

const say4 = (view, at) => String.fromCharCode(
  view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3),
);

// Walking the chunks is the only way in: `data` sits at a fixed offset only
// while nothing else is in the file. A length that runs off the end stops the
// walk rather than the reader — these bytes come from whatever somebody
// uploaded.
function commentIn(bytes) {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (say4(view, 0) !== 'RIFF' || say4(view, 8) !== 'WAVE') return null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (say4(view, at) === 'LIST' && body + 4 <= bytes.length && say4(view, body) === 'INFO') {
      const end = Math.min(body + size, bytes.length);
      let sub = body + 4;
      while (sub + 8 <= end) {
        const held = view.getUint32(sub + 4, true);
        if (say4(view, sub) === 'ICMT') {
          const text = bytes.subarray(sub + 8, Math.min(sub + 8 + held, end));
          return new TextDecoder().decode(text).replace(/\0+$/, '');
        }
        sub += 8 + held + (held % 2);
      }
    }
    at = body + size + (size % 2);
  }
  return null;
}

// The sliders a .wav came off, or null when it carries nothing the studio
// wrote — an uploaded sound, or one made before the studio kept its numbers.
// Nothing here trusts the file: a value that is not a number the sliders could
// have produced is the default instead.
export function soundIn(bytes) {
  const note = commentIn(bytes);
  if (!note) return null;
  let held;
  try { held = JSON.parse(note); } catch { return null; }
  if (held?.studio !== NOTE_VERSION || !held.sound || typeof held.sound !== 'object') return null;
  const sound = { ...DEFAULT_SOUND };
  if (WAVES.includes(held.sound.wave)) sound.wave = held.sound.wave;
  for (const param of SOUND_PARAMS) {
    const value = held.sound[param.key];
    if (Number.isFinite(value)) sound[param.key] = clamp(value, param.min, param.max);
  }
  const { seed } = held.sound;
  if (Number.isInteger(seed) && seed > 0) sound.seed = seed;
  return sound;
}

export const soundBytes = (params, rate = RATE) => encodeWav(
  renderSound(params, rate), rate, soundNote(params),
);
