// The studio library, copied into a working tree. public/studio-lib is the
// source: index.json names each library's files, seeds and version, and the
// client installs and updates from the same files over HTTP (installLibrary
// in main.js). This is the server's own copy of that install, run once when
// a game is created, so every game is born holding the library (spec.md §4).
// It only ever writes into a fresh tree — updating a game that has drifted
// stays the client's job, where what will change is said before it happens.

import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY_DIR, LIBRARY_MANIFEST } from './paths.js';
import { writeFileAt } from './tree.js';
import { commitPaths } from './git.js';

export async function scaffoldLibraries(dir, publicDir, author) {
  const read = (...parts) => fs.promises.readFile(path.join(publicDir, ...parts));
  const index = JSON.parse(await read('studio-lib', 'index.json'));

  const held = {};
  const written = [];
  for (const [name, library] of Object.entries(index.libraries ?? {})) {
    for (const file of library.files ?? []) {
      const rel = `${LIBRARY_DIR}/${file}`;
      await writeFileAt(path.join(dir, rel), await read('studio-lib', name, file));
      written.push(rel);
    }
    // A seed's `from` is the studio-origin URL the client fetches; on disk
    // that is the same path under public/.
    for (const seed of library.seeds ?? []) {
      await writeFileAt(
        path.join(dir, seed.to), await read(...seed.from.split('/').filter(Boolean)),
      );
      written.push(seed.to);
    }
    held[name] = library.version;
  }
  if (written.length === 0) return null;

  await writeFileAt(path.join(dir, LIBRARY_MANIFEST), `${JSON.stringify(held, null, 2)}\n`);
  written.push(LIBRARY_MANIFEST);
  return commitPaths(dir, written, 'set up the studio library', author);
}
