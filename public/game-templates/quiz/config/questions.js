// The questions, asked in order. Every answer counts toward one of the
// endings in RESULTS below — the ending with the most answers wins.
const QUESTIONS = [
  {
    ask: "It's a rainy Saturday. What are you doing?",
    answers: [
      { say: "Building a pillow fort", result: "dragon" },
      { say: "Reading under a blanket", result: "owl" },
      { say: "Splashing in the puddles", result: "otter" },
    ],
  },
  {
    ask: "Pick a snack.",
    answers: [
      { say: "Something spicy", result: "dragon" },
      { say: "Something crunchy", result: "owl" },
      { say: "Anything, as long as there's lots of it", result: "otter" },
    ],
  },
  {
    ask: "Your friend is sad. What do you do?",
    answers: [
      { say: "Defend them fiercely", result: "dragon" },
      { say: "Listen very carefully", result: "owl" },
      { say: "Make them laugh", result: "otter" },
    ],
  },
];

// The endings. A tie goes to the one listed first.
const RESULTS = {
  dragon: {
    name: "A Dragon",
    tell: "Bold, warm, and a little dangerous around curtains.",
  },
  owl: {
    name: "An Owl",
    tell: "Quiet, clever, and secretly running everything.",
  },
  otter: {
    name: "An Otter",
    tell: "The fun starts when you arrive.",
  },
};
