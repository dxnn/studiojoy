// Orphaned work, landed at startup (spec.md §5).
//
// ⚠️ A game's working tree should hold nothing uncommitted while the studio is
// down. A person's saves land on a clean shutdown, and a helper's turn commits
// at the end of its own turn — so anything still sitting here was left by
// something that ran neither: a hard kill, or a commit that threw before the
// orchestrator learned to catch one. Nothing else will ever pick it up, because
// every other commit the studio makes names its own paths, so no later save,
// turn or sweep touches a path nobody recorded.
//
// It commits as the studio rather than guessing at a name. The window that knew
// whose work it was is gone with the process, and an honest "left uncommitted"
// under the studio's name is better in Versions than somebody else's.
import fs from 'node:fs';
import path from 'node:path';
import { isRepo, commitEverything } from './git.js';

export const STUDIO = { name: 'Unbridled Joy', email: 'studio@gamestudio.local' };

const SUBJECT = 'work left uncommitted when the studio stopped';

// Runs before the listeners open, so nothing else is writing and the mutex is
// belt and braces rather than the thing keeping this safe. One game that
// cannot be read or committed must not stop the rest: the others are still
// worth landing, and the failure is worth seeing.
export async function reconcileTrees({ gamesDir, mutex, author = STUDIO }) {
  let slugs;
  try {
    slugs = await fs.promises.readdir(gamesDir);
  } catch {
    return [];
  }

  const landed = [];
  for (const slug of slugs.sort()) {
    const dir = path.join(gamesDir, slug);
    try {
      if (!(await isRepo(dir))) continue;
      const result = mutex
        ? await mutex.run(slug, () => commitEverything(dir, SUBJECT, author))
        : await commitEverything(dir, SUBJECT, author);
      if (!result) continue;
      landed.push({ slug, ...result });
      console.warn(
        `${slug}: landed ${result.paths.length} file(s) left uncommitted — ${result.sha.slice(0, 7)}`,
      );
    } catch (err) {
      console.error(`${slug}: could not land what its tree was holding`, err);
    }
  }
  return landed;
}
