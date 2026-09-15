This game started from the racing template: laps around a closed track
against rivals, with the track the thing a person changes first. The track
is drawn, not typed: the studio opens config/track.js as the track editor,
the Track tab beside the chats.

- config/track.js — the track: the points the road passes through, how wide
  it is, where the start line is, and the things on it (rocks, boost pads,
  puddles). ⚠️ Nobody types the points: they are dragged in the track editor.
  Tune the numbers in play.js; leave the points to the person.
- config/play.js — how it feels: turn, thrust, drag, top speed, boost, the
  rivals' speed, laps to win, the countdown, what scores.
- config/words.js — every word the player sees, and the names of the places.
- config/look.js — the four colours the game and the studio both wear, the
  colours of the road and what is on it, and the game's size, 960 by 600,
  which is also the world the track editor draws in.
- config/controls.js — which keys, buttons and screen controls do what. Its
  scheme is `buttons`: left and right under one thumb, GO and a latching
  BOOST under the other.
- config/achievements.js — what a player can earn, as rules over the moments
  the game says: lap, bash, boost, finished, place, score.
- js/race.js — the whole game: the road measured once, one loop, the car,
  the rivals, the things, laps and the finish.
- css/style.css — the page around the canvas. No width on the game: the
  screens library sizes it.
- assets/sounds/ — engine.wav (looped while GO is held), bash.wav, boost.wav
  and lap.wav, all from the studio's own sound maker, so each opens in it to
  change.
- assets/sprites/car.png — draw one and your car wears it; until then it is
  a triangle in the game's colour.

It uses every studio library: Input for the controls (`Input.update()` first
in every frame), Screens for how big the game is, the HUD chips, the title
and finish screens and the scoreboard, Sound for the noises, Moments to say
what happened, Achievements to hand out what the rules earn. Sprites is
loaded and unused: the car is drawn by the game so it can turn.

The road is the closed line through the points, stroked as wide as `width`;
a car is on the road when it is within half that of the nearest segment, and
that one distance test is the whole physics of "off the track" — the same
test the editor's checks use to say a rock is off the road.
