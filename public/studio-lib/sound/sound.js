// Plays the game's sounds by name, and never breaks the game over one.
//
//   Sound.play("laser");        // assets/sounds/laser.wav
//   Sound.play("laser", 0.5);   // volume 0 to 1
//   Sound.loop("engine");       // until stopped; calling it every frame is fine
//   Sound.loop("assets/music/theme.mp3", 0.4);  // a track, quieter, under it all
//   Sound.stop("engine");       // that sound, loop and overlaps alike
//   Sound.mute();               // everything; again to unmute
//
// A name with a dot or a slash is a path. A sound played twice overlaps. A
// missing file, or a sound asked for before the player's first click or key —
// browsers keep a page silent until then — is a quiet console warning, so
// start music on a press. play, loop, stop and mute are the whole of it: no
// init, unlock, preload or list of sounds.

const Sound = (function () {
  "use strict";

  // A shot and a loop are played two different ways, on purpose.
  //
  // ⚠️ A shot is a Web Audio buffer: the file is fetched and decoded once,
  // and every play after that is a cheap source node. It used to be an
  // <audio> element per overlapping shot — each new one loading its file
  // again, each play() a trip through the media stack — which is what iOS is
  // known to stall on. On an older iPad a game that pours stars froze for a
  // tenth of a second per pickup, worst when several came at once
  // (2026-09-29; seen, not profiled).
  //
  // A loop stays one <audio> element, streamed: it is music more often than
  // not, and a three-minute track decoded into memory is tens of megabytes.
  //
  // Where there is no Web Audio at all, a shot falls back to the old pool.

  // name -> { pool: [Audio], loop: Audio | null, warned: false,
  //           buffer, loading, pending, shots: Set of source nodes }
  const banks = new Map();
  // Enough overlap for a fast gun; past it the oldest shot restarts rather
  // than the pool growing forever.
  const OVERLAP = 8;
  let muted = false;

  const srcFor = (name) =>
    name.includes("/") || name.includes(".")
      ? name
      : "assets/sounds/" + name + ".wav";

  const clamp = (volume) => (volume > 1 ? 1 : volume < 0 ? 0 : volume);

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
      bank = { pool: [], loop: null, warned: false, buffer: null, loading: false, pending: null, shots: new Set() };
      banks.set(name, bank);
    }
    return bank;
  }

  /* Web Audio, for shots --------------------------------------------------- */

  const Context = typeof window.AudioContext === "function" ? window.AudioContext
    : typeof window.webkitAudioContext === "function" ? window.webkitAudioContext : null;
  let context = null;
  let master = null; // every shot goes through it, so mute is one number

  function audio() {
    if (context || !Context) return context;
    try {
      context = new Context();
      master = context.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(context.destination);
    } catch (err) {
      context = null;
    }
    return context;
  }

  // Web Audio on iOS goes quiet in silent mode and <audio> does not; saying
  // "playback" keeps a game sounding the way it always has.
  try {
    if (window.navigator && window.navigator.audioSession) window.navigator.audioSession.type = "playback";
  } catch (err) { /* an older Safari has no say in it */ }

  // A browser starts Web Audio only from inside a press, and a game plays its
  // sounds from the frame loop, so every press wakes it. A silent frame is
  // played as well, which is what an older iPad needs to count it as started.
  // Cheap once it is running: one comparison.
  function wake() {
    const c = audio();
    if (!c || c.state === "running") return;
    try {
      const resumed = c.resume && c.resume();
      if (resumed && resumed.catch) resumed.catch(function () {});
      const blank = c.createBufferSource();
      blank.buffer = c.createBuffer(1, 1, 22050);
      blank.connect(c.destination);
      blank.start(0);
    } catch (err) { /* the next press tries again */ }
  }
  if (Context && typeof window.addEventListener === "function") {
    ["pointerdown", "pointerup", "touchend", "mousedown", "keydown", "click"].forEach(function (name) {
      window.addEventListener(name, wake, true);
    });
  }

  // Fetched and decoded on the first play, once. A file that cannot be had is
  // never asked for again: a missing sound played every frame would otherwise
  // be a request every frame.
  function load(name, bank) {
    if (bank.loading) return;
    bank.loading = true;
    fetch(srcFor(name))
      .then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        return res.arrayBuffer();
      })
      .then(function (data) {
        // The callback form, because an older Safari has no other; a newer
        // one returns a promise too, caught here so it is never an unhandled
        // rejection the studio would report as the game's.
        return new Promise(function (ok, no) {
          const decoding = context.decodeAudioData(data, ok, no);
          if (decoding && decoding.catch) decoding.catch(no);
        });
      })
      .then(function (buffer) {
        bank.buffer = buffer;
        if (bank.pending !== null) fire(bank, bank.pending);
        bank.pending = null;
      })
      .catch(function () { warnOnce(bank, name); });
  }

  function hush(source) {
    try { source.stop(0); } catch (err) { /* already finished */ }
  }

  function fire(bank, volume) {
    if (context.state !== "running") return; // skipped quietly, like autoplay
    if (bank.shots.size >= OVERLAP) {
      const oldest = bank.shots.values().next().value;
      bank.shots.delete(oldest);
      hush(oldest);
    }
    try {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = bank.buffer;
      gain.gain.value = clamp(volume);
      source.connect(gain);
      gain.connect(master);
      source.onended = function () { bank.shots.delete(source); };
      bank.shots.add(source);
      source.start(0);
    } catch (err) { /* never break the game over a sound */ }
  }

  /* <audio>, for loops and where Web Audio is missing ---------------------- */

  function makeAudio(name, bank) {
    const player = new Audio(srcFor(name));
    player.addEventListener("error", function () { warnOnce(bank, name); });
    return player;
  }

  function everything(bank) {
    return bank.loop ? bank.pool.concat([bank.loop]) : bank.pool;
  }

  function start(player, bank, name, volume, loop) {
    try {
      player.loop = loop;
      player.muted = muted;
      player.volume = clamp(volume);
      // Rewinding an element that has not loaded yet can throw; a shot that
      // cannot rewind should still play, not be dropped.
      try { player.currentTime = 0; } catch (err) { /* plays from the start anyway */ }
      const playing = player.play();
      if (playing && playing.catch) {
        playing.catch(function () { warnOnce(bank, name); });
      }
    } catch (err) {
      warnOnce(bank, name);
    }
  }

  // The old way to play a shot: a finished player is reused, otherwise a
  // fresh one is made, so rapid fire overlaps instead of skipping.
  function playElement(name, bank, volume) {
    let player = null;
    for (let i = 0; i < bank.pool.length; i += 1) {
      if (bank.pool[i].paused || bank.pool[i].ended) { player = bank.pool[i]; break; }
    }
    if (!player) {
      if (bank.pool.length >= OVERLAP) {
        player = bank.pool[0];
      } else {
        player = makeAudio(name, bank);
        bank.pool.push(player);
      }
    }
    start(player, bank, name, volume, false);
  }

  return {
    // One shot. Until the file has arrived, the latest ask waits for it and
    // plays when it does, so a sound asked for once is never lost.
    play(name, volume) {
      const bank = bankFor(name);
      const v = volume === undefined ? 1 : volume;
      if (!audio()) {
        playElement(name, bank, v);
        return;
      }
      if (bank.buffer) {
        fire(bank, v);
        return;
      }
      bank.pending = v;
      load(name, bank);
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
      bank.pending = null;
      bank.shots.forEach(hush);
      bank.shots.clear();
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
      if (master) master.gain.value = muted ? 0 : 1;
      banks.forEach(function (bank) {
        const all = everything(bank);
        for (let i = 0; i < all.length; i += 1) all[i].muted = muted;
      });
      return muted;
    },
  };
}());

window.Sound = Sound;
