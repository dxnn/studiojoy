// Every scene: one picture with spots on it. The adventure starts at the
// first one listed, and a scene with no spots at all is the end.
//
// A spot is a box on the picture — at: [x, y, width, height], in the
// picture's own pixels — and one thing it does when it is clicked:
//   go: "garden"          the player walks through to that scene
//   say: "It is locked."  a line in the box; a list of lines is read one at
//                         a time
//   take: "key"           the thing goes into what the player carries, and
//                         its picture is assets/sprites/key.png. Taking it
//                         remembers a switch called "key", and the spot is
//                         gone once taken — unless it says keep: true
// Any spot may also have need: "key" (it only works once that switch is
// remembered), set: "door_open" (it remembers a switch when it is used) and
// sound: "creak" (it plays assets/sounds/creak.wav). Two spots on the same box
// with different needs are how a door is locked and then not: the first one
// whose need is met wins, top to bottom.
//
// Draw the boxes in the studio's adventure editor rather than typing the
// numbers. "about" is a line about the place for the studio; the game never
// reads it.
const SCENES = {
  porch: {
    about: "The front porch of the house at the end of the lane, very late",
    picture: "assets/images/porch.png",
    spots: [
      { at: [200, 105, 80, 105], go: "hall", need: "key" },
      { at: [200, 105, 80, 105], say: "The door is locked." },
      { at: [297, 120, 55, 47], take: "key", say: "A little brass key, left on the window ledge." },
      { at: [365, 35, 55, 30], say: ["The moon.", "It is very late to be out."] },
    ],
  },

  hall: {
    about: "A dark hall with a lamp and two doorways",
    picture: "assets/images/hall.png",
    spots: [
      { at: [40, 40, 90, 170], go: "kitchen" },
      { at: [355, 75, 85, 110], go: "porch" },
      { at: [220, 10, 45, 45], say: "A lamp, humming to itself." },
    ],
  },

  kitchen: {
    about: "A kitchen with a table, a little box and a painting",
    picture: "assets/images/kitchen.png",
    spots: [
      { at: [228, 150, 30, 35], take: "cake", say: "A little cake, still warm." },
      { at: [300, 60, 120, 90], say: "A painting of the moon." },
      { at: [60, 90, 130, 90], go: "morning", need: "cake" },
      { at: [60, 90, 130, 90], say: "A table. It would be a good place to eat something." },
    ],
  },

  morning: {
    about: "The sky at dawn: the adventure is over",
    picture: "assets/images/dawn-sky.png",
  },
};
