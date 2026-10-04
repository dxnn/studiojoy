// Game Design (spec/ §6, ideas/dreams.md §2): a new game born undecided —
// type 'design', its Humans only room and no Building, a blank page — whose
// cards the studio asks before anything is built, every answer a section of
// SPEC.md. Make it then makes it into a game, once: the one place a game's
// type changes after creation, and it changes one way, from 'design' to a
// template's key or to null for a game with none.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAt } from './files/tree.js';
import { copyTemplate } from './files/templates.js';
import { installMissing } from './files/library.js';
import { schemeSeed, CONTROLS_FILE } from './files/schemes.js';

export const DESIGN_TYPE = 'design';
const SPEC_FILE = 'SPEC.md';

// The template's own spec under the person's: every heading one level down,
// so its `# The quiz` becomes one section after the answers rather than a
// second title.
const nested = (spec) => spec.replace(/^(#+) /gm, '#$1 ');

// What Make it writes, uncommitted, as the paths it wrote. In creation's
// order: the control scheme's seed over config/controls.js, the extras, then
// the template over the blank page — so a template that ships a controls.js
// of its own still has the last word, as it does at creation — and last
// SPEC.md, the answers over the template's own.
export async function makeTree(dir, publicDir, { template, scheme, libraries }) {
  const written = new Set();
  const answers = await fs.promises.readFile(path.join(dir, SPEC_FILE), 'utf8').catch(() => null);

  const seed = schemeSeed(publicDir, scheme)[CONTROLS_FILE];
  if (seed) {
    await writeFileAt(
      path.join(dir, CONTROLS_FILE),
      await fs.promises.readFile(path.join(publicDir, ...seed.split('/').filter(Boolean))),
    );
    written.add(CONTROLS_FILE);
  }
  const held = await installMissing(dir, publicDir, { want: libraries });
  for (const p of held?.written ?? []) written.add(p);
  if (template) for (const p of await copyTemplate(dir, publicDir, template)) written.add(p);

  if (answers !== null && written.has(SPEC_FILE)) {
    const theirs = await fs.promises.readFile(path.join(dir, SPEC_FILE), 'utf8');
    await writeFileAt(path.join(dir, SPEC_FILE), `${answers.trimEnd()}\n\n${nested(theirs)}`);
  }
  return [...written].sort();
}
