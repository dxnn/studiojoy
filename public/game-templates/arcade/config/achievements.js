// What a player can earn in this game. Whoever earns one keeps it forever.
//
// Each achievement is a rule over a moment the game says with
// Moments.say("name", value). `when` names the moment and, if it needs one,
// one test on it:
//
//   when: { moment: "run-over" }               // the first time it is said at all
//   when: { moment: "level", atLeast: 5 }      // the number is 5 or more
//   when: { moment: "time", atMost: 30 }       // the number is 30 or less
//   when: { moment: "ending", is: "good" }     // the value is exactly this
//   when: { moment: "answered", times: 10 }    // said 10 times in one play
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
//   "rock-broken"  every meteor you break
//   "level"        the level you just reached, as a number
//   "shield-saved" a hit the shield took for you
//   "run-over"     the run ended, with the score as its number

const ACHIEVEMENTS = [
  {
    id: "first-run",
    name: "Off the ground",
    how: "Finish your first run",
    icon: "🚀",
    when: { moment: "run-over" },
  },
  {
    id: "level-five",
    name: "Still standing",
    how: "Reach level 5",
    icon: "🛡️",
    when: { moment: "level", atLeast: 5 },
  },
  {
    id: "hundred-rocks",
    name: "Rock breaker",
    how: "Break 100 meteors in one run",
    icon: "☄️",
    when: { moment: "rock-broken", times: 100 },
  },
];
