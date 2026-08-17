import path from 'node:path';
import { checkProjectPath, resolveInside } from '../files/paths.js';
import { isTextPath } from '../http/static.js';
import {
  readFileAt, writeFileAt, removeFileAt, assertCapacity, MAX_FILE_BYTES,
} from '../files/tree.js';

// Cap on what read_file hands back, so one call can't blow the context.
const MAX_READ_BYTES = 128 * 1024;

// Tool definitions in the OpenAI function-calling shape DeepSeek accepts.
export const TOOL_DEFINITIONS = [
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

export const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.function.name));

// Every tool returns a string for the model. Failures are returned, never
// thrown: a confused agent should get a correction it can act on, not a dead
// turn. That is also why path validation hands back its reason verbatim.
export function createToolset({ dir, mutex, slug }) {
  // path -> {action, bytes}. The orchestrator commits these once per turn.
  const changes = new Map();

  function resolve(input) {
    const checked = checkProjectPath(input);
    if (!checked.ok) return { error: `invalid path: ${checked.reason}` };
    const abs = resolveInside(dir, checked.path);
    if (abs === null) return { error: 'invalid path: escapes the project directory' };
    return { rel: checked.path, abs };
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
    const target = resolve(p);
    if (target.error) return target.error;
    if (typeof content !== 'string') return 'content must be a string';
    const buffer = Buffer.from(content, 'utf8');
    if (buffer.length > MAX_FILE_BYTES) {
      return `refused: ${buffer.length} bytes exceeds the ${MAX_FILE_BYTES} byte limit`;
    }
    return mutex.run(slug, async () => {
      const existed = (await readFileAt(target.abs)) !== null;
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
    const target = resolve(p);
    if (target.error) return target.error;
    if (typeof oldText !== 'string' || oldText === '') {
      return 'old_text must be a non-empty string';
    }
    if (typeof newText !== 'string') return 'new_text must be a string';

    return mutex.run(slug, async () => {
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

  async function deleteFile({ path: p }) {
    const target = resolve(p);
    if (target.error) return target.error;
    return mutex.run(slug, async () => {
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

export { MAX_READ_BYTES };
