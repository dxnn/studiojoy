// Plays the sounds in assets/sounds/ with one call, and never breaks the game
// over a sound: a missing file or a not-yet-allowed autoplay is a quiet
// console warning, not an error.
//
//   Sound.play("laser");        // plays assets/sounds/laser.wav
//   Sound.play("laser", 0.5);   // quieter — volume runs 0 to 1
//   Sound.loop("engine");       // keeps going until stopped
//   Sound.stop("engine");       // stops that sound, loop and overlaps alike
//   Sound.mute();               // everything silent; call again to unmute
//
// A plain name is a file in assets/sounds/ without the ending: "laser" plays
// assets/sounds/laser.wav — the files "+ Make a sound" and "+ Upload" put
// there. A name with a dot or a slash in it is used as a path, so
// "assets/boom.mp3" works too.
//
// The same sound played twice quickly overlaps instead of cutting itself off
// or being dropped — every shot gets a free player. Calling loop() every
// frame is fine: a loop that is already going is left alone. Browsers keep a
// page silent until the player has clicked or pressed something once; sounds
// asked for before that are skipped quietly, so start music on a key press
// or a button and it will always be heard.
//
// Those four calls are the whole of it. There is no init, unlock, preload or
// register and none is ever needed — the first play() does everything — and
// there is no list of sounds to declare: the name is the file. Replacing a
// hand-rolled sound.js means deleting it and its script tag and changing
// each call to the matching file's name in assets/sounds/.

const Sound = (function () {
  "use strict";

  // name -> { pool: [Audio], loop: Audio | null, warned: false }
  const banks = new Map();
  // Enough overlap for a fast gun; past it the oldest shot restarts rather
  // than the pool growing forever.
  const OVERLAP = 8;
  let muted = false;

  const srcFor = (name) =>
    name.includes("/") || name.includes(".")
      ? name
      : "assets/sounds/" + name + ".wav";

  // One warning per name, ever: a missing file fired every frame would bury
  // the console the game's own problems are reported in.
  function warnOnce(bank, name) {
    if (bank.warned) return;
    bank.warned = true;
    console.warn('Sound: could not play "' + name + '" (' + srcFor(name) + ")");
  }

  function bankFor(name) {
    let bank = banks.get(name);
    if (!bank) {
      bank = { pool: [], loop: null, warned: false };
      banks.set(name, bank);
    }
    return bank;
  }

  function makeAudio(name, bank) {
    const audio = new Audio(srcFor(name));
    audio.addEventListener("error", function () { warnOnce(bank, name); });
    return audio;
  }

  function everything(bank) {
    return bank.loop ? bank.pool.concat([bank.loop]) : bank.pool;
  }

  function start(audio, bank, name, volume, loop) {
    try {
      audio.loop = loop;
      audio.muted = muted;
      audio.volume = volume > 1 ? 1 : volume < 0 ? 0 : volume;
      // Rewinding an element that has not loaded yet can throw; a shot that
      // cannot rewind should still play, not be dropped.
      try { audio.currentTime = 0; } catch (err) { /* plays from the start anyway */ }
      const playing = audio.play();
      if (playing && playing.catch) {
        playing.catch(function () { warnOnce(bank, name); });
      }
    } catch (err) {
      warnOnce(bank, name);
    }
  }

  return {
    // One shot. A finished player is reused, otherwise a fresh one is made,
    // so rapid fire overlaps instead of skipping or cutting itself off.
    play(name, volume) {
      const bank = bankFor(name);
      let audio = null;
      for (let i = 0; i < bank.pool.length; i += 1) {
        if (bank.pool[i].paused || bank.pool[i].ended) { audio = bank.pool[i]; break; }
      }
      if (!audio) {
        if (bank.pool.length >= OVERLAP) {
          audio = bank.pool[0];
        } else {
          audio = makeAudio(name, bank);
          bank.pool.push(audio);
        }
      }
      start(audio, bank, name, volume === undefined ? 1 : volume, false);
    },

    // Keeps the sound going until stop(). One loop per name, and starting a
    // loop that is already going leaves it alone — call it every frame if
    // that is easier.
    loop(name, volume) {
      const bank = bankFor(name);
      if (!bank.loop) bank.loop = makeAudio(name, bank);
      if (!bank.loop.paused && !bank.loop.ended) return;
      start(bank.loop, bank, name, volume === undefined ? 1 : volume, true);
    },

    // Stops everything with that name: the loop and any overlapping shots.
    stop(name) {
      const bank = banks.get(name);
      if (!bank) return;
      const all = everything(bank);
      for (let i = 0; i < all.length; i += 1) {
        try { all[i].pause(); } catch (err) { /* already unusable */ }
      }
    },

    // With no argument, flips; with one, sets. Returns whether sound is off.
    // Muting keeps everything playing silently, so unmuting mid-game brings
    // the engine noise back where it should be rather than from the top.
    mute(on) {
      muted = on === undefined ? !muted : !!on;
      banks.forEach(function (bank) {
        const all = everything(bank);
        for (let i = 0; i < all.length; i += 1) all[i].muted = muted;
      });
      return muted;
    },
  };
}());

window.Sound = Sound;
