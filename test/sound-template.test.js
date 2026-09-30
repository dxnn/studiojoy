// The sound player every game gets a copy of. Browser code, so it runs here
// in a vm with a fake Audio: enough to check what a game depends on — that
// rapid fire overlaps instead of dropping shots, that a loop is one loop,
// and that a missing file is a single warning rather than an error. What it
// sounds like needs a real browser and ears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SOUND = fs.readFileSync(
  new URL('../public/studio-lib/sound/sound.js', import.meta.url), 'utf8',
);

function boot() {
  const made = [];
  const warnings = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.paused = true;
      this.ended = false;
      this.loop = false;
      this.muted = false;
      this.volume = 1;
      this.currentTime = 0;
      this.plays = 0;
      this.handlers = new Map();
      made.push(this);
    }

    addEventListener(name, fn) {
      if (!this.handlers.has(name)) this.handlers.set(name, []);
      this.handlers.get(name).push(fn);
    }

    play() {
      this.paused = false;
      this.ended = false;
      this.plays += 1;
      return { catch: (fn) => { this.reject = fn; } };
    }

    pause() { this.paused = true; }

    // Test-side: the clip ran out on its own.
    finish() { this.paused = true; this.ended = true; }

    // Test-side: the browser could not load the file.
    fail() { (this.handlers.get('error') ?? []).forEach((fn) => fn()); }
  }

  const sandbox = { Audio: FakeAudio, console: { warn: (msg) => warnings.push(msg) } };
  sandbox.window = sandbox;
  vm.runInContext(SOUND, vm.createContext(sandbox));
  return { Sound: sandbox.Sound, made, warnings };
}

test('a plain name is a wav in assets/sounds/, a path is itself', () => {
  const { Sound, made } = boot();
  Sound.play('laser');
  Sound.play('assets/boom.mp3');
  Sound.play('music.ogg');
  assert.deepEqual(made.map((a) => a.src), ['assets/sounds/laser.wav', 'assets/boom.mp3', 'music.ogg']);
});

test('rapid fire overlaps: every shot plays, none are dropped or cut', () => {
  const { Sound, made } = boot();
  Sound.play('laser');
  Sound.play('laser');
  Sound.play('laser');
  assert.equal(made.length, 3, 'three shots, three players');
  assert.deepEqual(made.map((a) => a.plays), [1, 1, 1]);
  assert.ok(made.every((a) => !a.paused));

  // A finished player is reused before a fourth is made.
  made[1].finish();
  Sound.play('laser');
  assert.equal(made.length, 3);
  assert.equal(made[1].plays, 2);
});

test('the pool is capped: past the overlap limit the oldest restarts', () => {
  const { Sound, made } = boot();
  for (let i = 0; i < 10; i += 1) Sound.play('laser');
  assert.equal(made.length, 8, 'the pool stops growing');
  assert.equal(made[0].plays, 3, 'shots nine and ten restarted the oldest');
});

test('a loop is one loop, however often it is asked for', () => {
  const { Sound, made } = boot();
  Sound.loop('engine');
  Sound.loop('engine');
  Sound.loop('engine');
  assert.equal(made.length, 1);
  assert.equal(made[0].plays, 1, 'a running loop is left alone');
  assert.equal(made[0].loop, true);

  Sound.stop('engine');
  assert.equal(made[0].paused, true);
  Sound.loop('engine');
  assert.equal(made[0].plays, 2, 'stopped means startable again');
});

test('stop silences the loop and the overlapping shots alike', () => {
  const { Sound, made } = boot();
  Sound.play('siren');
  Sound.play('siren');
  Sound.loop('siren');
  Sound.stop('siren');
  assert.ok(made.every((a) => a.paused));
});

test('mute flips everything, including what is already playing', () => {
  const { Sound, made } = boot();
  Sound.loop('engine');
  assert.equal(Sound.mute(), true);
  assert.ok(made.every((a) => a.muted));
  Sound.play('laser');
  assert.equal(made.at(-1).muted, true, 'new sounds are born muted');
  assert.equal(Sound.mute(), false);
  assert.ok(made.every((a) => !a.muted));
  assert.equal(Sound.mute(true), true, 'an argument sets rather than flips');
});

test('a sound that cannot play warns once and never throws', () => {
  const { Sound, made, warnings } = boot();
  Sound.play('ghost');
  made[0].fail();
  made[0].fail();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ghost/);
  assert.match(warnings[0], /assets\/sounds\/ghost\.wav/);

  // A rejected play() — autoplay before the first click — is the same quiet
  // warning, and the once-guard covers both paths together.
  Sound.play('ghost');
  made.at(-1).reject();
  assert.equal(warnings.length, 1);
});

test('volume is clamped to what an ear can take', () => {
  const { Sound, made } = boot();
  Sound.play('laser', 5);
  Sound.play('laser', -3);
  assert.equal(made[0].volume, 1);
  assert.equal(made[1].volume, 0);
});

// Where the browser has Web Audio, a shot is a buffer rather than an <audio>
// element: on an older iPad each new element loaded its file again and each
// play() stalled the page. Everything above is the fallback where it has none.
function bootWeb({ missing = [] } = {}) {
  const booted = { fetched: [], contexts: [], handlers: new Map() };
  class FakeContext {
    constructor() {
      this.state = 'suspended';
      this.sources = [];
      this.destination = {};
      this.master = null;
      booted.contexts.push(this);
    }

    resume() { this.state = 'running'; return Promise.resolve(); }

    createGain() {
      const gain = { gain: { value: 1 }, connect() {} };
      if (!this.master) this.master = gain;
      return gain;
    }

    createBuffer() { return {}; }

    createBufferSource() {
      const source = {
        buffer: null, starts: 0, stopped: false, connect() {},
        start() { source.starts += 1; },
        stop() { source.stopped = true; source.onended?.(); },
      };
      this.sources.push(source);
      return source;
    }

    decodeAudioData(data, ok) { ok({ decoded: data }); }
  }
  booted.warnings = [];
  const made = [];
  const sandbox = {
    AudioContext: FakeContext,
    Audio: class {
      constructor(src) { this.src = src; this.paused = true; made.push(this); }
      addEventListener() {}
      play() { this.paused = false; }
      pause() { this.paused = true; }
    },
    console: { warn: (msg) => booted.warnings.push(msg) },
  };
  sandbox.fetch = (url) => {
    booted.fetched.push(url);
    const gone = missing.some((m) => url.includes(m));
    return Promise.resolve({ ok: !gone, status: gone ? 404 : 200, arrayBuffer: () => Promise.resolve(url) });
  };
  sandbox.addEventListener = (name, fn) => booted.handlers.set(name, fn);
  sandbox.window = sandbox;
  vm.runInContext(SOUND, vm.createContext(sandbox));
  booted.Sound = sandbox.Sound;
  booted.made = made;
  booted.press = () => booted.handlers.get('pointerdown')({});
  // The shots that are the sound itself, not the silent frame a press plays.
  booted.shots = () => booted.contexts[0].sources.filter((s) => s.buffer?.decoded);
  return booted;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('with Web Audio, a shot is fetched and decoded once however often it plays', async () => {
  const g = bootWeb();
  g.press();
  for (let i = 0; i < 5; i += 1) g.Sound.play('collect');
  await settle();
  assert.deepEqual(g.fetched, ['assets/sounds/collect.wav']);
  assert.equal(g.shots().length, 1, 'the asks before the file arrived are one shot, not five');
  for (let i = 0; i < 3; i += 1) g.Sound.play('collect');
  assert.equal(g.shots().length, 4, 'every later ask is a shot of its own');
  assert.equal(g.fetched.length, 1);
  assert.equal(g.made.length, 0, 'and no <audio> element is made for a shot');
});

test('with Web Audio, nothing is heard before the first press, and a press wakes it', async () => {
  const g = bootWeb();
  g.Sound.play('collect');
  await settle();
  assert.equal(g.shots().length, 0, 'skipped quietly, like autoplay');
  g.press();
  assert.equal(g.contexts[0].state, 'running');
  g.Sound.play('collect');
  assert.equal(g.shots().length, 1);
});

test('with Web Audio, overlap is capped and the oldest shot stops', async () => {
  const g = bootWeb();
  g.press();
  g.Sound.play('laser');
  await settle();
  for (let i = 0; i < 10; i += 1) g.Sound.play('laser');
  const shots = g.shots();
  assert.equal(shots.filter((s) => !s.stopped).length, 8);
  assert.ok(shots[0].stopped, 'the first one made room');
});

test('with Web Audio, stop and mute reach the shots, and a loop is still one <audio>', async () => {
  const g = bootWeb();
  g.press();
  g.Sound.play('siren');
  await settle();
  g.Sound.play('siren');
  g.Sound.loop('engine');
  assert.equal(g.made.length, 1, 'the loop streams from an element');
  g.Sound.stop('siren');
  assert.ok(g.shots().every((s) => s.stopped));
  g.Sound.mute(true);
  assert.equal(g.contexts[0].master.gain.value, 0);
  g.Sound.mute(false);
  assert.equal(g.contexts[0].master.gain.value, 1);
});

test('with Web Audio, a missing file warns once and is never asked for again', async () => {
  const g = bootWeb({ missing: ['ghost'] });
  g.press();
  g.Sound.play('ghost');
  await settle();
  g.Sound.play('ghost');
  g.Sound.play('ghost');
  await settle();
  assert.equal(g.fetched.length, 1);
  assert.equal(g.warnings.length, 1);
  assert.match(g.warnings[0], /ghost/);
});
