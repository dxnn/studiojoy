// Who is in the story. A person's picture is assets/sprites/<who>-<mood>.png,
// so "mila" looking "happy" is assets/sprites/mila-happy.png. Add a mood here
// and draw a picture with the matching name. "about" is a line about them for
// the studio; the game never reads it.
const CAST = {
};

// Every scene. The story starts at the first one listed.
//
// A scene shows its picture, loops its music if it has any, and reads its
// lines from the top. Then one of three things happens:
//   choices — the player picks one, and it says where to go
//   go      — the story carries straight on to that scene
//   neither — that is the end of the story
//
// A line with no "who" is the story talking rather than a person, and a line
// that is only { sound: "page" } is a noise: it plays assets/sounds/page.wav
// and carries straight on, so put one wherever something should be heard.
//
// "music" is a whole path, like the picture. It loops behind the scene and
// keeps playing into the next scene that asks for the same track.
//
// A choice can "set" a switch, and a choice that "need"s a switch is only
// offered once something has set it. "about" is a line about the place for
// the studio; the game never reads it.
const SCENES = {
};
