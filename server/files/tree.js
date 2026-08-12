import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from '../http/respond.js';
import { mimeForPath, isTextPath, OCTET_STREAM } from '../http/static.js';
import { checkProjectPath, resolveInside } from './paths.js';

// Caps from spec.md §4. A personal studio, not a CDN.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 200 * 1024 * 1024;
export const MAX_PROJECT_FILES = 500;

// Walk a working tree. `.git` is skipped here as well as being unreachable
// through path validation — the listing should never advertise it, and a
// second guard costs one comparison.
export async function listTree(dir) {
  const files = [];
  let totalBytes = 0;

  async function walk(relDir) {
    const absDir = relDir ? path.join(dir, relDir) : dir;
    let entries;
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(rel);
        continue;
      }
      // Only regular files. A symlink is not followed anywhere in this app.
      if (!entry.isFile()) continue;
      // A file already on disk that the validator would refuse is reported
      // but flagged, so the UI can show it and no tool can touch it.
      const valid = checkProjectPath(rel).ok;
      const st = await fs.promises.stat(path.join(dir, rel));
      totalBytes += st.size;
      files.push({
        path: rel,
        size: st.size,
        mime: mimeForPath(rel) ?? OCTET_STREAM,
        text: isTextPath(rel),
        modified_at: st.mtime.toISOString(),
        ...(valid ? {} : { unreachable: true }),
      });
    }
  }

  await walk('');
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, totalBytes, count: files.length };
}

export function etagFor(buffer) {
  return `"${crypto.createHash('sha256').update(buffer).digest('hex')}"`;
}

export async function readFileAt(absPath) {
  try {
    const st = await fs.promises.lstat(absPath);
    if (!st.isFile()) return null;
    return await fs.promises.readFile(absPath);
  } catch {
    return null;
  }
}

// Enforce the per-project caps before a write lands. `replacingBytes` is the
// size of the file being overwritten, so editing a large file in place isn't
// charged twice against the project total.
export async function assertCapacity(dir, { addingBytes, isNewFile }) {
  if (addingBytes > MAX_FILE_BYTES) {
    throw new HttpError(413, `a file may not exceed ${MAX_FILE_BYTES} bytes`);
  }
  const { totalBytes, count } = await listTree(dir);
  if (isNewFile && count + 1 > MAX_PROJECT_FILES) {
    throw new HttpError(409, `a project may not exceed ${MAX_PROJECT_FILES} files`);
  }
  if (totalBytes + addingBytes > MAX_PROJECT_BYTES) {
    throw new HttpError(409, `a project may not exceed ${MAX_PROJECT_BYTES} bytes`);
  }
}

export async function writeFileAt(absPath, buffer) {
  await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
  await fs.promises.writeFile(absPath, buffer);
}

// Remove the file and any directories it leaves empty, so deleting the last
// sprite doesn't leave an empty `assets/` in the tree. Stops at the project
// root. Git tracks files rather than directories, so this only tidies the
// working tree.
export async function removeFileAt(dir, rel) {
  const abs = resolveInside(dir, rel);
  if (abs === null) throw new HttpError(400, 'path escapes the project directory');
  await fs.promises.rm(abs, { force: true });
  let parent = path.dirname(abs);
  const root = path.resolve(dir);
  while (parent !== root && parent.startsWith(root + path.sep)) {
    const remaining = await fs.promises.readdir(parent);
    if (remaining.length > 0) break;
    await fs.promises.rmdir(parent);
    parent = path.dirname(parent);
  }
}
