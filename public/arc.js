// The arc of a game: the stamps it collects, in the order its type sets, and
// the checks the studio can tick for each from what it already holds (spec.md
// §6, ideas/doneness.md). Pure data and two pure functions, read by the client
// for the card at the top of Building and by the server for the one line the
// preamble carries — the same shape as achievement-shape.js, and for the same
// reason: one truth, two readers.
//
// A stamp is the person's call. The checks are hints, never gates: a kid who
// says "it feels good" with no sound in the game is making a decision, and the
// studio's job was to have said what a sound would do.
//
// ⚠️ Checks read names, not contents: the file list and the project row. A
// check that would need a file's bytes is not here (ideas/doneness.md, "The
// checks' reach").

const has = (files, test) => files.some((f) => test(f.path ?? f));
const under = (dir) => (p) => p.startsWith(`${dir}/`);
const is = (path) => (p) => p === path;

// One stamp: what to call it, the principle in a kid's words, what makers say
// about it, the checks, and the asks — each a short label and the request a
// press drops into the composer.
const stamp = (id, name, principle, makers, checks, asks) => ({
  id, name, principle, makers, checks, asks,
});
const ask = (label, text) => ({ label, text });

// The stamps every arc shares.
const LOOKS = stamp(
  'looks', 'It looks like something',
  'A name, a look, a face. What is this, and who are you in it?',
  'Theme is what a player remembers; the rules are what they do.',
  [
    { text: 'the words in config/words.js', test: (f) => has(f.files, is('config/words.js')) },
    { text: 'the colours in config/look.js', test: (f) => has(f.files, is('config/look.js')) },
    { text: 'an icon.png beside the name', test: (f) => has(f.files, is('icon.png')) },
    { text: 'a hero.png over the chat and on the front page', test: (f) => has(f.files, is('hero.png')) },
  ],
  [
    ask('A title screen', 'Give it a title screen with the name and one line about the game.'),
    ask('Its own colours', 'Pick four colours for config/look.js that suit what the game is about.'),
  ],
);
const PLAYED = stamp(
  'played', 'Someone else played it',
  'Watch a friend play and say nothing. Write down where they got stuck.',
  'The only test that counts is somebody who is not you, and the rule is to shut up and watch.',
  [],
  [ask('A how-to-play line', 'Put a one-line how-to-play on the title screen so a friend knows what to press.')],
);
const OUT = stamp(
  'out', 'It’s out',
  'Publish it, send the link, watch the board.',
  'Finished beats perfect.',
  [
    { text: 'published', test: (f) => f.project.published === true },
    { text: 'the scoreboard on', test: (f) => f.project.scores_on === true },
  ],
  [ask('Score on the board', 'Put the score on the scoreboard when a run ends.')],
);

// What a blank game asks first: the sentence a template would have answered.
const WHAT = stamp(
  'what', 'Step 1: What is this game?',
  'Try to describe it in one sentence: you are an X, and you do Y!',
  'Change the SPEC.md file after it is made, so it matches what you want.',
  [{ text: 'Goal: a SPEC.md file that describes the game', test: (f) => has(f.files, is('SPEC.md')) }],
  [ask('Write the spec', 'Write SPEC.md from this one sentence about the game: ')],
);

export const ARCS = {
  arcade: [
    stamp(
      'moves', 'Step 2: It moves!',
      'Make a toy before you make the full game: get one thing working and feeling good.',
      "“Find the fun first.” -- if the basic game loop isn't fun, more features won't save it.",
      [
        { text: 'a script in js/', test: (f) => has(f.files, under('js')) },
        { text: 'the controls in config/controls.js', test: (f) => has(f.files, is('config/controls.js')) },
      ],
      [
        ask('Make it move', 'Make just the basic game loop, none of the extra features. Just a little toy to test out the movements.'),
      ],
    ),
    stamp(
      'loops', 'Step 3: It loops!',
      'Something to gain, something to lose, and a reason to go again.',
      '"A game is a series of interesting decisions" -- and the loop makes the second play different from the first.',
      [{ text: 'the numbers in config/play.js', test: (f) => has(f.files, is('config/play.js')) }],
      [
        ask('Score and lives', 'Add a score and lives, and end the run when the lives are gone.'),
        ask('Levels', 'Add levels that get a little harder each time.'),
      ],
    ),
    LOOKS,
    stamp(
      'feels', 'It feels good',
      'Every action answers back: a sound, a flash, a shake.',
      'Juice: the same game with a sound and a flash on every hit feels twice as good and plays exactly the same.',
      [
        { text: 'a sound in assets/sounds/', test: (f) => has(f.files, under('assets/sounds')) },
        { text: 'a picture in assets/sprites/', test: (f) => has(f.files, under('assets/sprites')) },
      ],
      [
        ask('Sound and flash', 'Play a sound and flash the screen when something is hit.'),
        ask('A shake', 'Shake the screen a little when I lose a life.'),
      ],
    ),
    stamp(
      'fair', 'It’s fair',
      'Easy for the first thirty seconds, harder after. Play it five times and change one number.',
      'Difficulty is a curve, not a wall, and the first thirty seconds decide whether anyone stays.',
      [],
      [
        ask('A gentler start', 'Make the start slower and the ramp gentler.'),
        ask('Numbers into config', 'Move every number that changes how the game feels into config/play.js.'),
      ],
    ),
    PLAYED,
    OUT,
  ],
  'visual-novel': [
    stamp(
      'somebody', 'Somebody, somewhere',
      'A main character and a place to start.',
      'Every story is somebody wanting something, somewhere.',
      [
        { text: 'a face in assets/sprites/', test: (f) => has(f.files, under('assets/sprites')) },
        { text: 'a place in assets/images/', test: (f) => has(f.files, under('assets/images')) },
      ],
      [ask('The first scene', 'Write the first scene from one sentence about what happens: ')],
    ),
    stamp(
      'ends', 'It ends',
      'Every path reaches an ending.',
      'A story that trails off was never a story.',
      [],
      [ask('An ending', 'Give the story an ending for every path a reader can take.')],
    ),
    stamp(
      'choices', 'Choices that matter',
      'A choice that changes what happens later, not only what is said next.',
      'Choice is what makes a story a game.',
      [],
      [ask('A switch', 'Add a switch that one choice sets and a later scene needs.')],
    ),
    LOOKS,
    stamp(
      'sounds', 'It sounds like something',
      'Music behind a scene, a noise on a moment.',
      'Music tells the reader how to feel before a word is read.',
      [
        { text: 'a track in assets/music/', test: (f) => has(f.files, under('assets/music')) },
        { text: 'a sound in assets/sounds/', test: (f) => has(f.files, under('assets/sounds')) },
      ],
      [ask('Music', 'Put music behind the first scene.')],
    ),
    stamp(
      'aloud', 'Read it aloud',
      'Read every line out loud. Cut anything you stumbled on.',
      'If it cannot be said, it cannot be read.',
      [],
      [ask('Shorter lines', 'Shorten every line that runs past two sentences.')],
    ),
    PLAYED,
    OUT,
  ],
  quiz: [
    stamp(
      'questions', 'Ten good questions',
      'Ask things that split people, not things with a right answer.',
      'A quiz is a mirror: every answer says who you are.',
      [{ text: 'the questions in config/questions.js', test: (f) => has(f.files, is('config/questions.js')) }],
      [ask('Ten questions', 'Write ten questions that sort people into the endings.')],
    ),
    stamp(
      'endings', 'Every ending is somebody',
      'Each result is a kind of person a player would be pleased to be.',
      'Nobody wants to be told they are the boring one.',
      [],
      [ask('Kinder endings', 'Give every ending a name and two lines that make that kind of person sound good.')],
    ),
    LOOKS,
    PLAYED,
    OUT,
  ],
};

// A type's arc. A game with no type takes the arcade's with "What is it?" in
// front, since the one thing a template would have answered is what it is.
export const arcFor = (type) => ARCS[type] ?? [WHAT, ...ARCS.arcade];

// One stamp's checks against what the studio holds: `files` is the tree's
// list (paths or `{path}` rows) and `project` the row the client already has.
export const checks = (stampOf, facts) => stampOf.checks.map((c) => ({
  text: c.text, ok: Boolean(c.test(facts)),
}));
