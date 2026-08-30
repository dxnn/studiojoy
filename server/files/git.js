import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);

// Field separator for --format output. A unit separator can't appear in a
// commit subject or an author name, so splitting on it is unambiguous.
const US = String.fromCharCode(31);
const RS = String.fromCharCode(30);

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
// ⚠️ core.quotePath=false: by default git escapes any non-ASCII byte in a path
// it prints, so `café.png` comes back from `log --name-only` as
// `"caf\303\251.png"` — a name that matches nothing in the file listing, which
// is read from the filesystem. A studio used by kids will have those names.
// Off, git prints the path as it is, and the two agree.
async function git(dir, args, { author = null, pinned = true } = {}) {
  const pin = pinned
    ? [`--git-dir=${path.join(dir, '.git')}`, `--work-tree=${dir}`]
    : [];
  const full = [
    '-C', dir, ...pin, '-c', 'core.quotePath=false', ...identityArgs(author), ...args,
  ];
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

// `paths` comes from --name-only in the same process rather than a `show` per
// commit: the list is what tells the client a version touched a picture, and
// fifty extra git invocations to find that out would be worse than the feature.
// Each commit is prefixed with a record separator, so a commit's own paths are
// whatever follows it up to the next one.
const LOG_FMT = ['%x1e%H', '%h', '%an', '%ae', '%aI', '%s'].join('%x1f');

function parseLog(out) {
  return out
    .split(RS)
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const [head, ...rest] = record.split('\n');
      const [sha, short, author, email, at, subject] = head.split(US);
      return {
        sha,
        short,
        author,
        email,
        at,
        subject: subject ?? '',
        // A merge shows no names and the first commit shows all of them; both
        // are just a list, and an empty one is honest about saying nothing.
        // ⚠️ Not trimmed: a name is allowed to start or end with a space, and
        // this list is matched against the file listing and against the patch,
        // so a tidied-up name matches neither.
        paths: rest.filter((line) => line.length > 0),
      };
    });
}

export async function logCommits(dir, { path: filePath = null, limit = 50 } = {}) {
  const args = [
    'log', `--max-count=${Number(limit) || 50}`, `--format=${LOG_FMT}`, '--name-only',
  ];
  if (filePath) args.push('--', filePath);
  const commits = parseLog((await git(dir, args)).toString('utf8'));

  // A pathspec selects the commits *and* filters the names, which would leave
  // a filtered log unable to say a commit touched anything else — and a
  // version's own size is what the client needs to offer the rest of it, or to
  // say nothing when there is no rest. So the names come back unfiltered:
  // whichever file the caller asked about, `paths` is always the whole commit,
  // and narrowing it is the reader's business. One call over the page's shas
  // rather than one per commit; `--` so a file named like a sha cannot be read
  // as a path.
  if (filePath && commits.length > 0) {
    const whole = parseLog((await git(dir, [
      'log', '--no-walk', `--format=${LOG_FMT}`, '--name-only',
      ...commits.map((c) => c.sha), '--',
    ])).toString('utf8'));
    const byCommit = new Map(whole.map((c) => [c.sha, c.paths]));
    for (const commit of commits) commit.paths = byCommit.get(commit.sha) ?? commit.paths;
  }
  return commits;
}

// How many versions there are, whether or not they all fit in a page of them.
// One number rather than a longer log: the file's own bar says "12 versions"
// before anybody opens the list, and a count that stopped at the page size
// would be a number that quietly means "or more".
export async function countCommits(dir, filePath = null) {
  const args = ['rev-list', '--count', 'HEAD'];
  if (filePath) args.push('--', filePath);
  const out = (await git(dir, args)).toString('utf8').trim();
  return Number(out) || 0;
}

// Raw bytes of a path at a commit. Buffer, not string, because a project can
// hold images.
export async function showFile(dir, sha, filePath) {
  return git(dir, ['show', `${requireSha(sha)}:${filePath}`]);
}

// The whole commit, every time. Showing one file's changes is a narrowing the
// reader does — see the diff route.
export async function diffCommit(dir, sha) {
  const out = await git(dir, ['show', '--format=', '--patch', requireSha(sha)]);
  return out.toString('utf8');
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
// reply and to label a history entry. Whole commit, like the patch beside it,
// so the two cannot disagree about what a version is.
export async function commitPathsTouched(dir, sha) {
  const out = await git(dir, ['show', '--name-only', '--format=', requireSha(sha)]);
  return out.toString('utf8').split('\n').filter((l) => l.length > 0);
}
