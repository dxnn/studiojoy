// What a player can earn in this game. Whoever earns one keeps it forever.
//
// Each achievement is a rule over a moment the game says with
// Moments.say("name", value). `when` names the moment and, if it needs one,
// one test on it:
//
//   when: { moment: "cleared" }               // the first time it is said at all
//   when: { moment: "cleared", atMost: 1 }    // the number is 1 or less
//   when: { moment: "pop", times: 3 }         // said 3 times in one play
//
// Leave `when` out and only Achievements.unlock("id") in the game's own code
// grants it. A name is up to 60 characters, `how` up to 200, the icon one
// emoji, and there are up to 50 achievements. ⚠️ The id never changes: the
// players who have earned it are keyed by it, so renaming one takes it away
// from everybody.
//
// The studio opens this file as the achievements editor, so keep the shape —
// id, name, how, icon, when — exactly.
//
// The moments this game says, to write rules against:
//   "shot"     a shot fired, with how many have gone
//   "crash"    two things met hard
//   "pop"      a target knocked down, with how many are down
//   "cleared"  every target is down, with the shots it took
//   "score"    the score the level earned

const ACHIEVEMENTS = [
  {
    id: "first-pop",
    name: "Down it goes",
    how: "Knock down your first target",
    icon: "🎯",
    when: { moment: "pop" },
  },
  {
    id: "cleared",
    name: "Nothing standing",
    how: "Knock every target down",
    icon: "💥",
    when: { moment: "cleared" },
  },
  {
    id: "one-shot",
    name: "One shot",
    how: "Knock every target down with a single shot",
    icon: "🏆",
    when: { moment: "cleared", atMost: 1 },
  },
  {
    id: "wrecker",
    name: "Wrecker",
    how: "Make twenty crashes in one game",
    icon: "🧱",
    when: { moment: "crash", times: 20 },
  },
];
