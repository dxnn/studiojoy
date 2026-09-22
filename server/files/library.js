// The studio library, copied into a working tree. public/studio-lib is the
// source: index.json names each library's files, seeds and version. Two
// installs share one rule — fill what is missing, never touch what is the
// game's own. scaffoldLibraries runs once when a game is created, so every
// game is born holding the core set and its template's extras (spec.md §4).
// sweepLibraries brings an
// existing game forward — libraries it lacks added, held copies raised to
// the current version, seeds written only where none exist — safe because
// of the compatibility law in spec.md §4: a version bump must run every
// game the old version ran.

import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY_DIR, LIBRARY_MANIFEST } from './paths.js';
import { writeFileAt } from './tree.js';
import { commitPaths } from './git.js';

// Fill the gaps between what the game holds and what the studio offers.
// Returns what was written, or null when the game is already current.
//
// `seedFrom` is how a choice made at creation picks a different starting file
// for one seed — the *control scheme* is the only one today. It maps a seed's
// destination to the studio-origin path it comes from, and the path is the
// studio's own (server/files/schemes.js), never anything off a request.
//
// Which libraries: every *core* one (`core: true` in the index), every one the
// game already holds, and the *extras* named in `want` — a template's
// `libraries` at creation, or the one a person adds. The sweep passes no
// `want`, so it raises what a game holds and never hands a quiz an engine.
async function installMissing(dir, publicDir, { seedFrom = {}, want = [] } = {}) {
  const read = (...parts) => fs.promises.readFile(path.join(publicDir, ...parts));
  const index = JSON.parse(await read('studio-lib', 'index.json'));

  // No manifest, or one that cannot be read, means install everything: a
  // game from before the library existed.
  let held = {};
  try {
    const parsed = JSON.parse(
      await fs.promises.readFile(path.join(dir, LIBRARY_MANIFEST), 'utf8'),
    );
    if (parsed && typeof parsed === 'object') held = parsed;
  } catch {
    held = {};
  }

  const written = [];
  const added = [];
  const updated = [];
  for (const [name, library] of Object.entries(index.libraries ?? {})) {
    const has = held[name];
    if (has === undefined && !library.core && !want.includes(name)) continue;
    if (has === library.version) continue;
    // A copy newer than the studio's own is a rolled-back studio, not a
    // game to fix — leave it alone.
    if (typeof has === 'number' && has > library.version) continue;
    for (const file of library.files ?? []) {
      const rel = `${LIBRARY_DIR}/${file}`;
      await writeFileAt(path.join(dir, rel), await read('studio-lib', name, file));
      written.push(rel);
    }
    // A seed's `from` is the studio-origin URL the client fetches; on disk
    // that is the same path under public/. A seed is the game's own file,
    // written once and never replaced.
    for (const seed of library.seeds ?? []) {
      if (fs.existsSync(path.join(dir, seed.to))) continue;
      const from = seedFrom[seed.to] ?? seed.from;
      await writeFileAt(
        path.join(dir, seed.to), await read(...from.split('/').filter(Boolean)),
      );
      written.push(seed.to);
    }
    if (has === undefined) added.push(name);
    else updated.push({ name, from: has, to: library.version });
    held[name] = library.version;
  }
  if (written.length === 0) return null;

  await writeFileAt(path.join(dir, LIBRARY_MANIFEST), `${JSON.stringify(held, null, 2)}\n`);
  written.push(LIBRARY_MANIFEST);
  return { written, added, updated };
}

export async function scaffoldLibraries(dir, publicDir, author, { seedFrom = {}, want = [] } = {}) {
  const result = await installMissing(dir, publicDir, { seedFrom, want });
  if (!result) return null;
  return commitPaths(dir, result.written, 'set up the studio library', author);
}

// The extras: libraries a game holds only because a template or a person
// asked for one. What the "add a library" dialog lists.
export function listExtras(publicDir) {
  const index = JSON.parse(
    fs.readFileSync(path.join(publicDir, 'studio-lib', 'index.json'), 'utf8'),
  );
  return Object.fromEntries(
    Object.entries(index.libraries ?? {}).filter(([, l]) => !l.core),
  );
}

// One extra into an existing game, as its own commit. Anything else the game
// is behind on comes along — the same rule the sweep keeps — so the commit
// may say more than the one library. Null when the game already holds it.
export async function addLibrary(dir, publicDir, name, author) {
  const result = await installMissing(dir, publicDir, { want: [name] });
  if (!result) return null;
  const sha = await commitPaths(dir, result.written, `added the ${name} library`, author);
  return { ...result, sha };
}

export async function sweepLibraries(dir, publicDir, author) {
  const result = await installMissing(dir, publicDir);
  if (!result) return null;
  const sha = await commitPaths(
    dir, result.written, 'brought the studio library up to date', author,
  );
  return { added: result.added, updated: result.updated, sha };
}
