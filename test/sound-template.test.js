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

test('a plain name is a wav in assets/, a path is itself', () => {
  const { Sound, made } = boot();
  Sound.play('laser');
  Sound.play('assets/boom.mp3');
  Sound.play('music.ogg');
  assert.deepEqual(made.map((a) => a.src), ['assets/laser.wav', 'assets/boom.mp3', 'music.ogg']);
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
  assert.match(warnings[0], /assets\/ghost\.wav/);

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
