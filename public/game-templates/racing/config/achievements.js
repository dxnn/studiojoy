// What a player can earn in this game. Whoever earns one keeps it forever.
//
// Each achievement is a rule over a moment the game says with
// Moments.say("name", value). `when` names the moment and, if it needs one,
// one test on it:
//
//   when: { moment: "finished" }               // the first time it is said at all
//   when: { moment: "place", atMost: 1 }       // the number is 1 or less
//   when: { moment: "finished", atMost: 45 }   // the number is 45 or less
//   when: { moment: "bash", times: 10 }        // said 10 times in one play
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
//   "lap"       a lap completed, with the lap number
//   "bash"      you hit a rock
//   "boost"     you drove over a boost pad
//   "finished"  the race is over, with your time in seconds
//   "place"     where you came, as a number — 1 is first
//   "score"     the score the race earned

const ACHIEVEMENTS = [
  {
    id: "first-race",
    name: "Over the line",
    how: "Finish your first race",
    icon: "🏁",
    when: { moment: "finished" },
  },
  {
    id: "winner",
    name: "Winner",
    how: "Come first",
    icon: "🏆",
    when: { moment: "place", atMost: 1 },
  },
  {
    id: "quick",
    name: "Quick",
    how: "Finish the race in under 45 seconds",
    icon: "⏱️",
    when: { moment: "finished", atMost: 45 },
  },
  {
    id: "basher",
    name: "Rock basher",
    how: "Hit ten rocks in one race",
    icon: "🪨",
    when: { moment: "bash", times: 10 },
  },
];
