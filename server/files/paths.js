import path from 'node:path';
import { HttpError } from '../http/respond.js';
import { forbiddenCharKind } from '../util/text.js';

// ⚠️ This module is the security boundary described in spec.md §4. Every
// read, write, delete, move, and public serve routes through it. Agents are
// LLMs and will occasionally emit `../../etc/passwd`; the contract is that
// such a path comes back as a refusal string, never as a filesystem access.

export const MAX_PATH_CHARS = 200;
export const MAX_SEGMENTS = 8;
export const MAX_SLUG_CHARS = 40;

// Reserved: the studio's own libraries, copied into every game that asks for one
// (spec.md §4). Real files on disk, so a game's repository is complete on its
// own and the games origin serves them with no route of its own — and so a game
// still runs when it is cloned or published somewhere else, which a symlink or a
// submodule would not survive.
//
// The rule that makes it a library rather than just a folder: an agent may read
// it and may not write it. A person may, because that is how it is installed and
// updated, and because it is their tree.
export const LIBRARY_DIR = 'studio';
export const LIBRARY_MANIFEST = `${LIBRARY_DIR}/studio.json`;

export const isLibraryPath = (rel) => rel === LIBRARY_DIR || rel.startsWith(`${LIBRARY_DIR}/`);

// The control and format characters a path refuses are `forbiddenCharKind`
// in util/text.js — shared with account names, which refuse them for the
// same spoofing reason.

const bad = (reason) => ({ ok: false, reason });

// Returns {ok: true, path} or {ok: false, reason}. Tools hand the reason
// straight back to the model as a correction; routes convert it to a 400.
export function checkProjectPath(input) {
  if (typeof input !== 'string') return bad('path must be a string');
  if (input === '') return bad('path is empty');
  if (input.length > MAX_PATH_CHARS) {
    return bad(`path is longer than ${MAX_PATH_CHARS} characters`);
  }
  const forbidden = forbiddenCharKind(input);
  if (forbidden) return bad(`path contains ${forbidden}`);
  if (input.includes('\\')) {
    return bad('path contains a backslash; use / as the separator');
  }
  if (input.startsWith('/')) return bad('path must be relative, not absolute');

  const segments = input.split('/');
  if (segments.length > MAX_SEGMENTS) {
    return bad(`path is deeper than ${MAX_SEGMENTS} segments`);
  }
  for (const seg of segments) {
    if (seg === '') return bad('path has an empty segment');
    if (seg === '.' || seg === '..') return bad(`path contains a '${seg}' segment`);
    // Exactly `.git`, case-insensitively — the repository's own metadata.
    // `.gitignore` and friends are ordinary files and stay allowed.
    if (seg.toLowerCase() === '.git') return bad('path touches git metadata');
    if (seg !== seg.trim()) {
      return bad('path segment has leading or trailing whitespace');
    }
  }
  return { ok: true, path: segments.join('/') };
}

// Throwing wrapper for route handlers.
function requireProjectPath(input) {
  const res = checkProjectPath(input);
  if (!res.ok) throw new HttpError(400, res.reason);
  return res.path;
}

// Second, independent check: even a path that passed validation must resolve
// inside the project directory. Belt and braces on purpose — the two checks
// fail for different reasons, and this one is what catches a mistake in the
// one above. Returns null when the result escapes.
export function resolveInside(rootDir, projectPath) {
  const root = path.resolve(rootDir);
  const abs = path.resolve(root, projectPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

// Validate and resolve in one step. Throws on either failure.
export function resolveProjectPath(rootDir, input) {
  const rel = requireProjectPath(input);
  const abs = resolveInside(rootDir, rel);
  if (abs === null) throw new HttpError(400, 'path escapes the project directory');
  return { rel, abs };
}

// A slug becomes a directory name and a public URL segment, so it gets the
// strictest rule in the app: it must start alphanumeric, which rules out '.',
// '..', '-flag', and every dotfile in one clause.
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function checkSlug(input) {
  if (typeof input !== 'string') return bad('slug must be a string');
  if (input === '') return bad('slug is empty');
  if (input.length > MAX_SLUG_CHARS) {
    return bad(`slug is longer than ${MAX_SLUG_CHARS} characters`);
  }
  if (!SLUG_RE.test(input)) {
    return bad(
      'slug must be lowercase letters, digits, and dashes, starting with a letter or digit',
    );
  }
  return { ok: true, slug: input };
}

export function requireSlug(input) {
  const res = checkSlug(input);
  if (!res.ok) throw new HttpError(400, res.reason);
  return res.slug;
}

// Best-effort slug from a project name. May return '' — callers fall back to
// asking for an explicit slug rather than inventing one.
export function slugify(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // Drop combining marks left behind by the decomposition, so 'Über'
    // becomes 'uber' rather than 'u-ber'. \p{M} keeps this file ASCII.
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, '');
}
