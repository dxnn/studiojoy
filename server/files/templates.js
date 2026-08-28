// A game template: a starter tree copied into a new game at creation, right
// after the library scaffold, as one commit. From then on the files are the
// game's own — no version recorded, no update ever offered — unlike a
// library, because "add a timer to my quiz" has to land in editable files,
// not behind the studio/ write-wall (spec.md §4). public/game-templates is
// the source; index.json names each template and carries the words the New
// game dialog shows, and doubles as the validation list.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAt } from './tree.js';
import { commitPaths } from './git.js';

export function listTemplates(publicDir) {
  try {
    const index = JSON.parse(
      fs.readFileSync(path.join(publicDir, 'game-templates', 'index.json'), 'utf8'),
    );
    return index.templates ?? {};
  } catch {
    // No template directory — the test fixture, or a stripped deployment.
    return {};
  }
}

export async function scaffoldTemplate(dir, publicDir, name, author) {
  if (!listTemplates(publicDir)[name]) throw new Error(`no such template: ${name}`);
  const root = path.join(publicDir, 'game-templates', name);
  const written = [];
  const walk = async (rel) => {
    const entries = await fs.promises.readdir(
      rel ? path.join(root, rel) : root, { withFileTypes: true },
    );
    for (const entry of entries) {
      const sub = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(sub);
      else {
        await writeFileAt(path.join(dir, sub), await fs.promises.readFile(path.join(root, sub)));
        written.push(sub);
      }
    }
  };
  await walk('');
  if (written.length === 0) return null;
  return commitPaths(dir, written.sort(), `start from the ${name} template`, author);
}
