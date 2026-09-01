// Who is in the story. A person's picture is assets/sprites/<who>-<mood>.png,
// so "mila" looking "happy" is assets/sprites/mila-happy.png. Add a mood here
// and draw a picture with the matching name.
const CAST = {
  mila: { name: "Mila", moods: ["happy", "worried"] },
  cat: { name: "The cat", moods: ["there"] },
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
// offered once something has set it.
const SCENES = {
  porch: {
    picture: "assets/images/porch.png",
    lines: [
      { say: "It is late, and Mila's front door is shut." },
      { say: "There is a light on somewhere at the back of the house." },
    ],
    choices: [
      { say: "Knock", go: "hall" },
      { say: "Peek through the window", go: "window", set: "saw-the-cat" },
      { say: "Go home", go: "away" },
    ],
  },

  window: {
    picture: "assets/images/porch.png",
    lines: [
      { say: "A cat is sitting on the kitchen counter." },
      { say: "It stares back at you without blinking once." },
    ],
    choices: [
      { say: "Knock after all", go: "hall" },
      { say: "Go home", go: "away" },
    ],
  },

  hall: {
    picture: "assets/images/hall.png",
    sound: "page",
    lines: [
      { who: "mila", mood: "happy", say: "Oh! I thought you had forgotten." },
      { say: "The house smells of toast, at eleven o'clock at night." },
    ],
    go: "kitchen",
  },

  kitchen: {
    picture: "assets/images/kitchen.png",
    lines: [
      { who: "cat", mood: "there", say: "…" },
      { who: "mila", mood: "worried", say: "Don't mind her. She has been like that all week." },
    ],
    choices: [
      { say: "Ask why the cat is staring", go: "tea", need: "saw-the-cat" },
      { say: "Ask for a cup of tea", go: "tea" },
      { say: "Say goodnight", go: "away" },
    ],
  },

  tea: {
    picture: "assets/images/kitchen.png",
    lines: [
      { who: "mila", mood: "happy", say: "Two sugars?" },
      { say: "The cat closes one eye. That is as much of an answer as you are getting tonight." },
    ],
  },

  away: {
    picture: "assets/images/porch.png",
    lines: [
      { say: "You go home." },
      { say: "The lamp in the window stays on for a while after you turn the corner." },
    ],
  },
};
