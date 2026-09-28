// The levels, in the order they are played, each from above: one character
// a square, the top row the far end. Roll into the goal and the next one
// starts; the last one's goal is the end of the run.
//   #  a wall          .  floor          (a space)  a hole — fall in, start again
//   S  where the ball starts   G  the goal   o  a coin on the floor
// and any kind of square in SQUARES, below. Paint them in the studio's level
// editor rather than typing: pick what a square is, then click or drag.
const LEVELS = [
  [
    "############",
    "#G....#...o#",
    "#.##..#.##.#",
    "#.o#......o#",
    "#..#  ###..#",
    "#..#  #o...#",
    "#......#.#.#",
    "###.o..#...#",
    "#....#...o.#",
    "#S...#.....#",
    "############",
  ],
  [
    "##########",
    "#G.  ...o#",
    "##.#  #..#",
    "#..#  #.##",
    "#o.......#",
    "#.## ##..#",
    "#S..o....#",
    "##########",
  ],
];

// Kinds of square this game has made up, beyond those six: the letter each
// is painted as, what it is called, its colour, and whether the ball bumps
// into it like a wall (solid) or rolls over it. js/roll.js draws each one in
// its colour, and ON_SQUARE there is what one does when the ball rolls on.
const SQUARES = {};
