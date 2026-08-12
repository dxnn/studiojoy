import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Fixtures live in the OS temp directory, not the repo. Two reasons: a test
// run shouldn't leave anything in the working tree, and the development
// sandbox refuses writes to any `.git` directory beneath the project root —
// which every git test needs to create. Nothing here is ever deleted; the OS
// reclaims it.
const SCRATCH_ROOT = path.join(
  process.env.TMPDIR ?? os.tmpdir(), 'gamestudio-test',
);

export function scratchDir(label = 'case') {
  const dir = path.join(
    SCRATCH_ROOT, `${label}-${crypto.randomBytes(4).toString('hex')}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Bind a handler to an ephemeral port and hand its base URL to `fn`.
// 127.0.0.1 is in NO_PROXY, so fetch reaches it without proxy configuration.
export async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    // fetch leaves the socket in its keep-alive pool, and close() waits for
    // idle connections — without this each server costs the keep-alive
    // timeout (~3s) before the test finishes.
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
