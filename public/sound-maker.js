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
// already play, and the only audio format worth hand-writing.
export function encodeWav(samples, rate = RATE) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  ascii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // rest of this chunk
  view.setUint16(20, 1, true);           // PCM, uncompressed
  view.setUint16(22, 1, true);           // one channel
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);    // bytes per second
  view.setUint16(32, 2, true);           // bytes per sample, all channels
  view.setUint16(34, 16, true);          // bits per sample
  ascii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const value = clamp(samples[i], -1, 1);
    // Negative has one more step than positive in two's complement, so the
    // two directions are scaled by their own limit rather than one of them
    // wrapping at full volume.
    view.setInt16(44 + i * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
  }
  return bytes;
}

export const soundBytes = (params, rate = RATE) => encodeWav(renderSound(params, rate), rate);
