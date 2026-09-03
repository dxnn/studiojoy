// The control schemes: which `config/controls.js` a new game is seeded with.
// public/templates/index.json is the source — one entry per scheme, with the
// words New game shows and the seed file it starts from — and it doubles as
// the validation list, the way game-templates/index.json does for templates
// (spec.md §4).
//
// A scheme is a file rather than a column, unlike a game's type: `input.js`
// reads `SCHEME` inside the running game, which is also why it stays
// changeable afterwards where the type does not.
//
// ⚠️ A request names a scheme by key and never by path. The path comes from
// here and is held against a plain-name pattern before it is joined, so a
// made-up scheme is a 400 rather than a read of some other file.

import fs from 'node:fs';
import path from 'node:path';

// Where the seed lands inside the game. The same string as the input
// library's `seeds[].to` in studio-lib/index.json, which is the one place
// that could disagree with this one; test/schemes.test.js holds them
// together.
export const CONTROLS_FILE = 'config/controls.js';

const SEED_NAME = /^[a-z0-9-]+\.js$/;

function index(publicDir) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(publicDir, 'templates', 'index.json'), 'utf8'),
    );
  } catch {
    // No templates directory — the test fixture, or a stripped deployment.
    // Every caller then behaves as if nobody had picked anything.
    return {};
  }
}

export function listSchemes(publicDir) {
  return index(publicDir).schemes ?? {};
}

export function defaultScheme(publicDir) {
  const { default: fallback, schemes } = index(publicDir);
  return schemes?.[fallback] ? fallback : null;
}

// The seed override for one scheme, in the shape library.js reads it: where
// the file lands in the game, to the studio-origin path it is copied from.
// Empty for an unknown scheme or a missing index, which leaves the library's
// own seed to write the default.
export function schemeSeed(publicDir, scheme) {
  const seed = listSchemes(publicDir)[scheme]?.seed;
  if (typeof seed !== 'string' || !SEED_NAME.test(seed)) return {};
  return { [CONTROLS_FILE]: `/templates/${seed}` };
}
