// One file's part of a commit's patch.
//
// The server sends the whole commit — it has no idea which file is being read,
// and a patch it had already cut down could not say how big the version was.
// Narrowing is the reader's job, and this is it.
//
// A unified diff starts each file with `diff --git a/<old> b/<new>`, and
// everything up to the next such line belongs to it. Both sides are matched,
// because a rename is one section under two names: `a/game.js b/js/game.js`
// belongs to the version list of either one, and which name the list is
// filtered by depends on whether you are reading the file's history from
// before or after the move.
//
// The name is there as itself — a space and anything non-ASCII are printed
// literally, the second because every git call passes `core.quotePath=false`
// (spec.md §5). A path with a `"` in it would still be quoted and escaped, and
// its section simply is not found; the drawer says there is nothing to show,
// which is wrong but harmless, and no name in this studio has ever had one.

const SECTION = /^diff --git /;

export function patchFor(patch, path) {
  if (!patch) return '';
  const after = ` b/${path}`;
  const before = ` a/${path} b/`;
  const lines = [];
  let keep = false;
  for (const line of patch.split('\n')) {
    if (SECTION.test(line)) keep = line.endsWith(after) || line.includes(before);
    if (keep) lines.push(line);
  }
  return lines.join('\n');
}

// Where a file went, for a section that is a rename. A rename of an unchanged
// file has no hunk in it and no picture to show, so without this the drawer
// has nothing to say about the one kind of version that most needs explaining.
export function renameIn(patch) {
  const to = patch.split('\n').find((line) => line.startsWith('rename to '));
  return to ? to.slice('rename to '.length) : null;
}

// Whether a patch has anything to show. The diff of a picture is the sentence
// "Binary files differ", which is git talking about itself rather than about
// the game, so a hunk header is what counts as changes worth rendering.
export function hasHunks(patch) {
  return /^@@/m.test(patch);
}
