# Meteor Run

Rules, as shipped:

- You hold the bottom of the screen. Left and right slide you along, thrust
  lifts you and gravity takes it back, fire sends a bolt straight up.
- Meteors fall. A bolt breaks one for `ROCK_POINTS`; every `LEVEL_EVERY` of
  them is a new level, worth `LEVEL_POINTS`, and every level makes them fall
  faster and arrive closer together.
- A meteor that hits you, or reaches the floor behind you, costs a life. The
  run ends when the lives do, and the score goes on the scoreboard.
- Breaking meteors fills the charge meter. A full one becomes a shield that
  takes the next hit for you and lasts `SHIELD_SECONDS`. `CHARGE_FULL: 0`
  turns the whole idea off, chip and all.

The moments it says, which achievements are written against: `rock-broken`
(each one), `level` (the number reached), `shield-saved` (a hit the bubble
took), `run-over` (the score).

Ways to remix without code: the numbers in config/play.js, the words, the
colours, the achievements, the controls. Ways that need js/game.js: a second
kind of meteor, something to catch rather than break, a boss at level ten,
two players sharing the screen.
