// The level, from above: one character a square, the top row the far end.
//   #  a wall          .  floor          (a space)  a hole — fall in, start again
//   S  where the ball starts   G  the goal   o  a coin on the floor
// Paint it in the studio's level editor rather than typing: pick what a
// square is, then click or drag across the grid.
const LEVEL = [
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
];
