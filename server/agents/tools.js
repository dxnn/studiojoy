import path from 'node:path';
import { checkProjectPath, resolveInside, isLibraryPath } from '../files/paths.js';
import { isTextPath } from '../http/static.js';
import {
  readFileAt, writeFileAt, removeFileAt, assertCapacity, MAX_FILE_BYTES,
} from '../files/tree.js';
import { currentSha, treeAtCommit, showFile } from '../files/git.js';
import { parseConfigFile, isConfigPath } from '../../public/config-file.js';

// A config file is what a person tunes as a form, and the form opens only
// while every value is a plain one (public/config-file.js). The preamble says
// so, and a builder still wrote a computed lap count into one, which closed
// that game's form with nothing anywhere saying why. So a write that takes a
// file the form opens to one it cannot is refused, with the parser's reason
// and where the logic goes instead. A file already past the form is left
// writable: refusing it too would freeze a broken file rather than let it be
// fixed.
function configRefusal(rel, after, before) {
  if (!isConfigPath(rel)) return null;
  const now = parseConfigFile(after);
  if (now.ok || (before !== null && !parseConfigFile(before).ok)) return null;
  return `refused: ${rel} would no longer open as a form in the studio — ${now.reason}. `
    + 'A config file holds plain values only: `const NAME = value;` with numbers, words, true/false '
    + 'and lists or groups of those, and no maths, no calls and no other value\'s name. Keep the '
    + 'plain values here and work anything else out in the js/ file that reads them.';
}

// Cap on what read_file hands back, so one call can't blow the context.
const MAX_READ_BYTES = 128 * 1024;

// What DeepSeek will look at (spec.md §14, measured 2026-09-12) — and nothing
// by extension alone that it would reject, because a refusal from the API is a
// dead turn where a refusal from here is a sentence the helper can act on.
// ⚠️ Not SVG: the API rejects it, and an SVG is text, so `read_file` gives a
// helper more of one than a picture of it ever could.
const LOOKABLE = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

// A picture costs at most 1,024 prompt tokens whatever its size (§14), so this
// is not a context guard — it is a guard on the request body, which has its
// own ceiling, and on a game that keeps a 20 MB photo somebody dropped in.
// The studio's own pixel editor never makes anything near it: MAX_SIDE is
// 1024 and a PNG that size is tens of kilobytes.
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;

// Tool definitions in the OpenAI function-calling shape DeepSeek accepts.
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create a file or replace its entire contents. Prefer patch_file for '
        + 'edits to an existing file — it is cheaper and cannot lose the parts '
        + 'you did not mean to change.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'project-relative path, / separated' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_file',
      description:
        'Replace one exact snippet in a file. old_text must appear exactly '
        + 'once; include surrounding lines to make it unique.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_text: { type: 'string' },
          new_text: { type: 'string' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a file that was not included in your context, for example one '
        + 'the size cap left out.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'look_at',
      description:
        'Look at a picture in this game — a PNG, JPEG, GIF or WebP. Use it '
        + 'when what the picture shows matters: whether a sprite reads at its '
        + 'size, what colours it uses, which way it faces, whether two pictures '
        + 'go together. read_file cannot read one; this can.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'project-relative path, / separated' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'look_at_game',
      description:
        'Look at the game as it is running: the last frame the person you are '
        + 'talking to was watching. Use it when they say something looks wrong, '
        + 'or before and after changing anything about how the game looks.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file. Recoverable from version history.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
];

// Every tool returns a string for the model. Failures are returned, never
// thrown: a confused agent should get a correction it can act on, not a dead
// turn. That is also why path validation hands back its reason verbatim.
//
// A person's saves still waiting for their commit land before any write here
// (files/pending.js): a helper's bytes must never ride into history under a
// person's name, nor a person's under a helper's.
export function createToolset({ dir, mutex, slug, pending = null, shot = null }) {
  // path -> {action, bytes}. The orchestrator commits these once per turn.
  const changes = new Map();
  const settlePending = () => (pending ? pending.settleLocked(slug) : null);
  // HEAD as it stood when this fire first touched each path, a person's saves
  // landed first: Cancel compares against it to find a path somebody saved
  // while the fire ran.
  const bases = new Map();
  const settleFor = async (rel) => {
    await settlePending();
    if (!bases.has(rel)) bases.set(rel, await currentSha(dir));
  };

  function resolve(input) {
    const checked = checkProjectPath(input);
    if (!checked.ok) return { error: `invalid path: ${checked.reason}` };
    const abs = resolveInside(dir, checked.path);
    if (abs === null) return { error: 'invalid path: escapes the project directory' };
    return { rel: checked.path, abs };
  }

  // The library is the studio's, not the game's. An agent reads it — it has to,
  // to call what it provides — and cannot write it, so an engine shared by every
  // game cannot be quietly forked into one of them. Installing and updating is a
  // person's move, from the studio.
  function resolveForWrite(input) {
    const target = resolve(input);
    if (target.error) return target;
    if (isLibraryPath(target.rel)) {
      return {
        error: `refused: ${target.rel} belongs to the studio library. You can read it and call what it `
          + 'provides, but not change it. If it needs to be different, say so and ask for it to be updated.',
      };
    }
    return target;
  }

  function record(rel, action, bytes) {
    const existing = changes.get(rel);
    // A file created and then edited in the same turn is still a create.
    const merged = existing?.action === 'create' && action === 'update'
      ? 'create'
      : action;
    changes.set(rel, { action: merged, bytes });
  }

  async function writeFile({ path: p, content }) {
    const target = resolveForWrite(p);
    if (target.error) return target.error;
    if (typeof content !== 'string') return 'content must be a string';
    const buffer = Buffer.from(content, 'utf8');
    if (buffer.length > MAX_FILE_BYTES) {
      return `refused: ${buffer.length} bytes exceeds the ${MAX_FILE_BYTES} byte limit`;
    }
    return mutex.run(slug, async () => {
      await settleFor(target.rel);
      const existing = await readFileAt(target.abs);
      const existed = existing !== null;
      const refusal = configRefusal(target.rel, content, existed ? existing.toString('utf8') : null);
      if (refusal) return refusal;
      try {
        await assertCapacity(dir, { addingBytes: buffer.length, isNewFile: !existed });
      } catch (err) {
        return `refused: ${err.message}`;
      }
      await writeFileAt(target.abs, buffer);
      record(target.rel, existed ? 'update' : 'create', buffer.length);
      return `${existed ? 'updated' : 'created'} ${target.rel} (${buffer.length} bytes)`;
    });
  }

  async function patchFile({ path: p, old_text: oldText, new_text: newText }) {
    const target = resolveForWrite(p);
    if (target.error) return target.error;
    if (typeof oldText !== 'string' || oldText === '') {
      return 'old_text must be a non-empty string';
    }
    if (typeof newText !== 'string') return 'new_text must be a string';

    return mutex.run(slug, async () => {
      await settleFor(target.rel);
      const buffer = await readFileAt(target.abs);
      if (buffer === null) return `no such file: ${target.rel}`;
      if (!isTextPath(target.rel)) return `${target.rel} is not a text file`;
      const before = buffer.toString('utf8');

      const first = before.indexOf(oldText);
      if (first === -1) {
        return `old_text does not appear in ${target.rel}; read the file and copy the snippet exactly`;
      }
      if (before.indexOf(oldText, first + oldText.length) !== -1) {
        const count = before.split(oldText).length - 1;
        return `old_text appears ${count} times in ${target.rel}; include more surrounding lines to make it unique`;
      }

      const after = before.slice(0, first) + newText + before.slice(first + oldText.length);
      const refusal = configRefusal(target.rel, after, before);
      if (refusal) return refusal;
      const out = Buffer.from(after, 'utf8');
      if (out.length > MAX_FILE_BYTES) {
        return `refused: the result would be ${out.length} bytes, over the limit`;
      }
      await writeFileAt(target.abs, out);
      record(target.rel, 'update', out.length);
      const delta = out.length - buffer.length;
      const sign = delta >= 0 ? '+' : '';
      return `patched ${target.rel} (${sign}${delta} bytes)`;
    });
  }

  async function readFile({ path: p }) {
    const target = resolve(p);
    if (target.error) return target.error;
    const buffer = await readFileAt(target.abs);
    if (buffer === null) return `no such file: ${target.rel}`;
    if (!isTextPath(target.rel)) {
      return `${target.rel} is a binary file of ${buffer.length} bytes; its contents cannot be read as text`;
    }
    if (buffer.length > MAX_READ_BYTES) {
      return `${target.rel} (first ${MAX_READ_BYTES} of ${buffer.length} bytes)\n`
        + buffer.subarray(0, MAX_READ_BYTES).toString('utf8');
    }
    return `${target.rel} (${buffer.length} bytes)\n${buffer.toString('utf8')}`;
  }

  // The one tool that hands back something other than a sentence: a label and
  // the picture itself, as the content parts DeepSeek takes on a tool result
  // (spec.md §14). ⚠️ Images are refused on a system message, so the ambient
  // file block cannot carry one — it names the picture, this shows it.
  //
  // Read-only, and through the same `resolve` as everything else: the library
  // holds no pictures today, and if it ever does, looking at one is reading.
  async function lookAt({ path: p }) {
    const target = resolve(p);
    if (target.error) return target.error;
    const ext = path.extname(target.rel).toLowerCase();
    const mime = LOOKABLE.get(ext);
    if (!mime) {
      return isTextPath(target.rel)
        ? `${target.rel} is text, not a picture — read_file gives you all of it`
        : `${target.rel} cannot be looked at: only PNG, JPEG, GIF and WebP can`;
    }
    const buffer = await readFileAt(target.abs);
    if (buffer === null) return `no such file: ${target.rel}`;
    if (buffer.length > MAX_PICTURE_BYTES) {
      return `${target.rel} is ${buffer.length} bytes, over the ${MAX_PICTURE_BYTES} `
        + 'byte limit for looking at a picture';
    }
    return [
      { type: 'text', text: `${target.rel} (${buffer.length} bytes)` },
      {
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` },
      },
    ];
  }

  // The game as somebody was watching it (server/shots.js). ⚠️ It arrives
  // from a person's own browser, so there is one only while somebody has the
  // game open in the studio — which is the honest answer to give when there is
  // not.
  async function lookAtGame() {
    const latest = shot?.();
    if (!latest) {
      return 'nobody has the game open at the moment, so there is no picture of it. '
        + 'Ask them to open Play and play for a second, then look again.';
    }
    const age = Math.round((Date.now() - Date.parse(latest.at)) / 1000);
    // ⚠️ Buffer.from, not the row's own value: node:sqlite hands a BLOB back
    // as a Uint8Array, whose toString ignores its argument and joins the
    // bytes with commas — a data URI that looks right and is not.
    const base64 = Buffer.from(latest.bytes).toString('base64');
    return [
      { type: 'text', text: `the game as it looked ${age} seconds ago` },
      { type: 'image_url', image_url: { url: `data:${latest.mime};base64,${base64}` } },
    ];
  }

  async function deleteFile({ path: p }) {
    const target = resolveForWrite(p);
    if (target.error) return target.error;
    return mutex.run(slug, async () => {
      await settleFor(target.rel);
      if ((await readFileAt(target.abs)) === null) return `no such file: ${target.rel}`;
      await removeFileAt(dir, target.rel);
      record(target.rel, 'delete', 0);
      return `deleted ${target.rel}`;
    });
  }

  const handlers = {
    write_file: writeFile,
    patch_file: patchFile,
    read_file: readFile,
    look_at: lookAt,
    look_at_game: lookAtGame,
    delete_file: deleteFile,
  };

  return {
    definitions: TOOL_DEFINITIONS,
    changes,
    // Paths whose contents changed on disk, for the commit and for
    // files.changed. read_file is absent by construction.
    changedPaths() {
      return [...changes.keys()];
    },
    // Cancel (spec.md §8): every path this fire changed goes back to HEAD's
    // bytes, or away when HEAD has none. HEAD is the tree as it was before
    // the fire touched them — its own writes are committed only at its end,
    // and each one settled a person's saves first — so nothing is committed
    // here, and the fire leaves nothing in history. A person's save of the
    // same file lands as theirs first, and is what comes back — with whatever
    // of the fire's bytes they saved along with their own, since nothing can
    // tell the two apart. So the paths that HEAD changed under since the fire
    // first touched them are answered as `kept`, for the notice to name
    // rather than claim they went back. Answers every path it put back.
    async putBack() {
      const paths = [...changes.keys()];
      const kept = [];
      if (paths.length === 0) return { paths, kept };
      await mutex.run(slug, async () => {
        await settlePending();
        const sha = await currentSha(dir);
        const held = new Set((await treeAtCommit(dir, sha)).map((e) => e.path));
        const at = (commit, rel) => showFile(dir, commit, rel).catch(() => null);
        for (const rel of paths) {
          const base = bases.get(rel);
          if (base && base !== sha) {
            const [was, is] = await Promise.all([at(base, rel), at(sha, rel)]);
            if (was === null ? is !== null : is === null || !was.equals(is)) kept.push(rel);
          }
          if (held.has(rel)) await writeFileAt(resolveInside(dir, rel), await showFile(dir, sha, rel));
          else await removeFileAt(dir, rel);
        }
      });
      changes.clear();
      return { paths, kept };
    },
    async run(name, input) {
      const handler = handlers[name];
      if (!handler) return `no such tool: ${name}`;
      if (input === null || typeof input !== 'object') {
        return `${name} expects an object of arguments`;
      }
      try {
        return await handler(input);
      } catch (err) {
        // A genuine fault, not a misuse. Tell the model plainly so it can try
        // something else rather than repeating the same call.
        return `${name} failed: ${err.message}`;
      }
    },
  };
}
