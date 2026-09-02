// Who is in the story. A person's picture is assets/sprites/<who>-<mood>.png,
// so "mila" looking "happy" is assets/sprites/mila-happy.png. Add a mood here
// and draw a picture with the matching name. "about" is a line about them for
// the studio; the game never reads it.
const CAST = {
};

// Every scene. The story starts at the first one listed.
//
// A scene shows its picture, plays its sound if it has one, and says its
// lines one at a time. Then one of three things happens:
//   choices — the player picks one, and it says where to go
//   go      — the story carries straight on to that scene
//   neither — that is the end of the story
//
// A line with no "who" is the story talking rather than a person.
// A choice can "set" a switch, and a choice that "need"s a switch is only
// offered once something has set it. "about" is a line about the place for
// the studio; the game never reads it.
const SCENES = {
};
