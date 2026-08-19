// The sound maker is arithmetic, not audio hardware, so all of it is checked
// here: the render, the .wav bytes it becomes, and the presets a person picks
// from before touching a single slider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RATE, SOUND_PARAMS, SOUND_PRESETS, DEFAULT_SOUND, WAVES,
  soundFrom, renderSound, randomSound, encodeWav, soundBytes,
} from '../public/sound-maker.js';

const peak = (samples) => samples.reduce((most, s) => Math.max(most, Math.abs(s)), 0);
const text = (bytes, at, length) => String.fromCharCode(...bytes.slice(at, at + length));
const u32 = (bytes, at) => new DataView(bytes.buffer).getUint32(at, true);
const u16 = (bytes, at) => new DataView(bytes.buffer).getUint16(at, true);

test('a sound lasts as long as its three fades say it does', () => {
  const samples = renderSound({ attack: 0.1, sustain: 0.2, decay: 0.3 });
  assert.equal(samples.length, Math.round(0.6 * RATE));
});

test('nothing ever leaves -1 to 1, whatever the numbers say', () => {
  const samples = renderSound({ volume: 1, wave: 'saw', freq: 2000, vibrato: 0.5 });
  assert.equal(peak(samples) <= 1, true);
});

test('every preset makes a sound you can hear', () => {
  for (const name of Object.keys(SOUND_PRESETS)) {
    const samples = renderSound(soundFrom(name));
    assert.equal(peak(samples) > 0.05, true, `${name} is inaudible`);
    assert.equal(samples.every(Number.isFinite), true, `${name} produced a NaN`);
  }
});

test('a preset only names parameters that exist', () => {
  const known = new Set(Object.keys(DEFAULT_SOUND));
  for (const [name, preset] of Object.entries(SOUND_PRESETS)) {
    for (const key of Object.keys(preset)) {
      assert.equal(known.has(key), true, `${name} sets an unknown ${key}`);
    }
    if (preset.wave) assert.equal(WAVES.includes(preset.wave), true, `${name} has no such wave`);
  }
});

test('every slider names a parameter, with room to move it', () => {
  const known = new Set(Object.keys(DEFAULT_SOUND));
  for (const param of SOUND_PARAMS) {
    assert.equal(known.has(param.key), true, `no such parameter: ${param.key}`);
    assert.equal(param.min < param.max, true, `${param.key} has no range`);
    assert.equal(param.comment.length > 0, true, `${param.key} has no comment`);
    const value = DEFAULT_SOUND[param.key];
    assert.equal(value >= param.min && value <= param.max, true, `${param.key} starts outside its slider`);
  }
});

test('silence is silent', () => {
  assert.equal(peak(renderSound({ volume: 0 })), 0);
});

test('it ends on nothing, so it cannot click', () => {
  const samples = renderSound(soundFrom('explosion'));
  assert.equal(samples[samples.length - 1], 0);
});

test('the same seed is the same noise, and a different one is not', () => {
  const a = soundBytes({ wave: 'noise', seed: 5 });
  const b = soundBytes({ wave: 'noise', seed: 5 });
  const c = soundBytes({ wave: 'noise', seed: 6 });
  assert.deepEqual([...a], [...b]);
  assert.notDeepEqual([...a], [...c]);
});

test('a random sound stays inside every slider', () => {
  // A fixed sequence rather than Math.random: a test that fails one run in
  // fifty is a test nobody trusts.
  let n = 0;
  const rolls = [0.01, 0.99, 0.5, 0.2, 0.8, 0.35, 0.65, 0.05, 0.95, 0.45, 0.55, 0.15, 0.85, 0.25, 0.75, 0.4];
  const random = () => rolls[n++ % rolls.length];
  for (let i = 0; i < 40; i += 1) {
    const sound = randomSound(random);
    for (const param of SOUND_PARAMS) {
      const value = sound[param.key];
      assert.equal(value >= param.min && value <= param.max, true,
        `${param.key} came out at ${value}`);
    }
    assert.equal(peak(renderSound(sound)) <= 1, true);
  }
});

test('the wav header says what the file actually is', () => {
  const samples = renderSound({ sustain: 0.05, decay: 0.05 });
  const bytes = encodeWav(samples, RATE);
  assert.equal(bytes.length, 44 + samples.length * 2);
  assert.equal(text(bytes, 0, 4), 'RIFF');
  assert.equal(u32(bytes, 4), bytes.length - 8);
  assert.equal(text(bytes, 8, 4), 'WAVE');
  assert.equal(text(bytes, 12, 4), 'fmt ');
  assert.equal(u32(bytes, 16), 16);
  assert.equal(u16(bytes, 20), 1, 'uncompressed PCM');
  assert.equal(u16(bytes, 22), 1, 'one channel');
  assert.equal(u32(bytes, 24), RATE);
  assert.equal(u32(bytes, 28), RATE * 2);
  assert.equal(u16(bytes, 32), 2);
  assert.equal(u16(bytes, 34), 16);
  assert.equal(text(bytes, 36, 4), 'data');
  assert.equal(u32(bytes, 40), samples.length * 2);
});

test('the samples survive the trip into 16 bits', () => {
  const bytes = encodeWav(Float32Array.from([0, 0.5, -0.5, 1, -1]), RATE);
  const view = new DataView(bytes.buffer);
  const back = [0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true));
  assert.deepEqual(back, [0, 16384, -16384, 32767, -32768]);
});
