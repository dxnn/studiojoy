This game started from the knock-it-down template: a sling, a pile of
crates and stone, and targets somewhere in it, with the pile the thing a
person changes first. The world is built, not typed: the studio opens
config/bodies.js as the world editor, the World tab beside the chats.

- config/bodies.js — the world: every box, block, ball and target, where
  its middle is, how big it is and how far it is turned, and where the sling
  sits. ⚠️ Nobody types the places: they are dragged in the world editor.
  Tune the numbers in play.js; leave the places to the person.
- config/play.js — how it feels: shots, gravity, bounce, grip, how hard the
  sling throws, how hard a target has to be hit, what scores.
- config/words.js — every word the player sees.
- config/look.js — the four colours the game and the studio both wear, the
  colours of each kind of thing, and the game's size, 960 by 600, which is
  also the world the world editor draws in.
- config/controls.js — the keys for aiming without a pointer. Its scheme is
  `none`: the sling itself is the control, pulled with a finger or a mouse,
  so nothing is drawn on a phone.
- config/achievements.js — what a player can earn, as rules over the moments
  the game says: shot, crash, pop, cleared, score.
- js/knock.js — the whole game: the level built from the bodies, one loop,
  the sling, what counts as knocked down, and the end.
- css/style.css — the page around the canvas. No width on the game: the
  screens library sizes it.
- assets/sounds/ — hit.wav, pop.wav and fling.wav, all from the studio's own
  sound maker, so each opens in it to change.
- assets/sprites/target.png — draw one and every target wears it; until then
  a target is a round face in the game's colour.

It holds the physics library, an extra: studio/planck.min.js is planck.js
(Box2D, MIT) and studio/physics.js the studio's way in to it. The game never
works out a fall or a bounce itself — Physics.build makes the bodies from
config/bodies.js, Physics.step moves them, and Physics.onHit says how hard
two met. A block is the one kind that never moves; the game tells the
physics so when it builds the level.

It uses every other studio library too: Input for the keys (`Input.update()`
first in every frame), Screens for how big the game is, the HUD chips, the
title and end screens and the scoreboard, Sound for the noises, Moments to
say what happened, Achievements to hand out what the rules earn. Sprites is
loaded and unused: a target's picture is drawn by the game so it can turn.
