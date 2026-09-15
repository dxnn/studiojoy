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
};
