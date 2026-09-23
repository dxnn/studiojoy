// What a player can earn in this game. Whoever earns one keeps it forever.
//
// Each achievement is a rule over a moment the game says with
// Moments.say("name", value). `when` names the moment and, if it needs one,
// one test on it:
//
//   when: { moment: "goal" }                // the first time it is said at all
//   when: { moment: "goal", atMost: 30 }    // the number is 30 or less
//   when: { moment: "coin", atLeast: 6 }    // the number is 6 or more
//   when: { moment: "fall", times: 3 }      // said 3 times since the page opened
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
//   "coin"    a coin picked up, with how many so far
//   "fall"    the ball fell down a hole
//   "goal"    the goal reached, with the time in seconds
//   "score"   the score the level earned

const ACHIEVEMENTS = [
  {
    id: "made-it",
    name: "Made it",
    how: "Roll the ball to the goal",
    icon: "🏁",
    when: { moment: "goal" },
  },
  {
    id: "collector",
    name: "Collector",
    how: "Pick up six coins in one go",
    icon: "🪙",
    // "coin" says how many this run has, so six is six in one go — `times`
    // would count coins across every run since the page opened.
    when: { moment: "coin", atLeast: 6 },
  },
  {
    id: "speedy",
    name: "Speedy",
    how: "Reach the goal in 30 seconds or less",
    icon: "⚡",
    when: { moment: "goal", atMost: 30 },
  },
  {
    id: "oops",
    name: "Oops",
    how: "Fall down a hole",
    icon: "🕳️",
    when: { moment: "fall" },
  },
];
