import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);

// Field separator for --format output. A unit separator can't appear in a
// commit subject or an author name, so splitting on it is unambiguous.
const US = String.fromCharCode(31);

const MAX_GIT_OUTPUT = 32 * 1024 * 1024;

export class GitError extends Error {
  constructor(message, { code, stderr, args }) {
    super(message);
    this.name = 'GitError';
    this.code = code;
    this.stderr = stderr;
    this.args = args;
  }
}

// The app must behave the same on any machine, so the host's git
// configuration is excluded rather than merely overridden: global and system
// config are pointed at /dev/null, and every GIT_* variable that could
// redirect the repository or inject config is dropped. This sandbox sets
// GIT_CONFIG_PARAMETERS, which is exactly the kind of ambient influence that
// would otherwise leak into commits.
function gitEnv() {
  const env = { ...process.env };
  for (const key of [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_EDITOR',
  ]) {
    delete env[key];
  }
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_OPTIONAL_LOCKS = '0';
  return env;
}

// Identity is passed per invocation rather than written into the repo, so a
// project directory carries no committer state of its own (spec.md §5).
function identityArgs(author) {
  if (!author) return [];
  return [
    '-c', `user.name=${author.name}`,
    '-c', `user.email=${author.email}`,
  ];
}

// Every command except `init` is pinned to this project's own repository with
// explicit --git-dir/--work-tree. Without that, git walks upward looking for
// a repo, so an operation on a project directory that hadn't been initialised
// yet would silently act on whatever repository encloses GAMES_DIR — in
// development, the gamestudio checkout itself. Pinning turns that into an
// error instead of a commit in the wrong place.
async function git(dir, args, { author = null, pinned = true } = {}) {
  const pin = pinned
    ? [`--git-dir=${path.join(dir, '.git')}`, `--work-tree=${dir}`]
    : [];
  const full = ['-C', dir, ...pin, ...identityArgs(author), ...args];
  try {
    const { stdout } = await run('git', full, {
      env: gitEnv(),
      maxBuffer: MAX_GIT_OUTPUT,
      encoding: 'buffer',
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const stderr = Buffer.isBuffer(err.stderr)
      ? err.stderr.toString('utf8')
      : String(err.stderr ?? '');
    throw new GitError(
      `git ${args[0]} failed: ${stderr.trim() || err.message}`,
      { code: err.code, stderr: stderr.trim(), args },
    );
  }
}

const SHA_RE = /^[0-9a-f]{7,40}$/;

// A revision reaches git as part of `<sha>:<path>`, so a value starting with
// '-' would be read as an option. Only hex is ever accepted.
export function isSha(value) {
  return typeof value === 'string' && SHA_RE.test(value);
}

function requireSha(value) {
  if (!isSha(value)) throw new GitError('not a commit id', { code: 400, args: [] });
  return value;
}

export async function initRepo(dir, { author, slug }) {
  await fs.promises.mkdir(dir, { recursive: true });
  // --template= (empty) copies no hooks or config from the host's git
  // templates. That keeps a project repo reproducible, avoids a directory of
  // .sample files nobody asked for, and means a hook installed system-wide
  // can never run against studio content.
  await git(dir, ['init', '-q', '-b', 'main', '--template='], { pinned: false });
  // An empty initial commit means `git log` works on a project that has no
  // files yet — one of the invariants in spec.md §12.
  await git(dir, ['commit', '-q', '--allow-empty', '-m', `init ${slug}`], { author });
  return currentSha(dir);
}

// True only when `dir` is itself the root of a repository. A bare
// --is-inside-work-tree would answer true for any directory nested inside
// some other repo, which is the failure this guards against.
export async function isRepo(dir) {
  try {
    const out = await git(dir, ['rev-parse', '--absolute-git-dir']);
    // Compare realpaths: git resolves symlinks, and on macOS /tmp is a link
    // to /private/tmp, so a lexical comparison disagrees with itself.
    const [reported, expected] = await Promise.all([
      fs.promises.realpath(out.toString('utf8').trim()),
      fs.promises.realpath(path.join(dir, '.git')),
    ]);
    return reported === expected;
  } catch {
    return false;
  }
}

// Copy a project's whole repository into a new directory: the working tree
// and every commit behind it, so a fork can still answer "where did this come
// from". --no-hardlinks because the two projects must be independent on disk;
// the default would share object files with the original.
//
// The clone's `origin` remote is removed straight away. It would point at
// another project's directory, and nothing in the studio should hold a path
// into a sibling working tree.
export async function forkRepo(src, dst) {
  await fs.promises.mkdir(dst, { recursive: true });
  await git(dst, ['clone', '--no-hardlinks', '--', src, '.'], { pinned: false });
  await git(dst, ['remote', 'remove', 'origin']);
  return currentSha(dst);
}

export async function currentSha(dir) {
  return (await git(dir, ['rev-parse', 'HEAD'])).toString('utf8').trim();
}

// Stage the named paths and commit them as one commit. Returns the new sha,
// or null when nothing actually changed — a write of identical bytes is a
// no-op, not an error.
//
// `add -f` because the app is the authority on what belongs in the tree: a
// .gitignore a user or agent dropped in should not silently prevent a file
// they just asked for from being committed.
export async function commitPaths(dir, paths, message, author) {
  if (!paths.length) return null;
  await git(dir, ['add', '-f', '--', ...paths]);
  const staged = await git(dir, ['diff', '--cached', '--name-only']);
  if (staged.toString('utf8').trim() === '') return null;
  await git(dir, ['commit', '-q', '-m', message], { author });
  return currentSha(dir);
}

export async function movePath(dir, from, to, message, author) {
  await fs.promises.mkdir(path.dirname(path.join(dir, to)), { recursive: true });
  await git(dir, ['mv', '--', from, to]);
  await git(dir, ['commit', '-q', '-m', message], { author });
  return currentSha(dir);
}

export async function logCommits(dir, { path: filePath = null, limit = 50 } = {}) {
  const fmt = ['%H', '%h', '%an', '%ae', '%aI', '%s'].join('%x1f');
  const args = ['log', `--max-count=${Number(limit) || 50}`, `--format=${fmt}`];
  if (filePath) args.push('--', filePath);
  const out = (await git(dir, args)).toString('utf8');
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha, short, author, email, at, subject] = line.split(US);
      return { sha, short, author, email, at, subject: subject ?? '' };
    });
}

// Raw bytes of a path at a commit. Buffer, not string, because a project can
// hold images.
export async function showFile(dir, sha, filePath) {
  return git(dir, ['show', `${requireSha(sha)}:${filePath}`]);
}

export async function diffCommit(dir, sha, filePath = null) {
  const args = ['show', '--format=', '--patch', requireSha(sha)];
  if (filePath) args.push('--', filePath);
  return (await git(dir, args)).toString('utf8');
}

// Every blob in a commit's tree, with its size. -z because a path may hold
// anything but NUL, and -l for the size so the project caps can be checked
// before a rollback writes anything.
export async function treeAtCommit(dir, sha) {
  const out = await git(dir, ['ls-tree', '-r', '-l', '-z', requireSha(sha)]);
  const entries = [];
  for (const entry of out.toString('utf8').split('\0')) {
    if (entry.length === 0) continue;
    // "<mode> <type> <sha> <size>\t<path>"
    const tab = entry.indexOf('\t');
    const [, type, , size] = entry.slice(0, tab).split(/\s+/);
    if (type !== 'blob') continue;
    entries.push({ path: entry.slice(tab + 1), size: Number(size) });
  }
  return entries;
}

// Write every file in a commit back into the working tree. One git call rather
// than a blob read per path, and git cannot write outside the pinned work tree.
// Paths in the commit that path validation would now refuse come back too, and
// land in the same "listed, unreachable, untouchable" state as any other such
// file (spec.md §4) — losing them silently would be worse.
export async function restoreTree(dir, sha) {
  await git(dir, ['checkout', requireSha(sha), '--', '.']);
}

// Paths touched by a commit, used to render the file chips under an agent
// reply and to label a history entry.
export async function commitPathsTouched(dir, sha) {
  const out = await git(dir, [
    'show', '--name-only', '--format=', requireSha(sha),
  ]);
  return out.toString('utf8').split('\n').filter((l) => l.length > 0);
}
