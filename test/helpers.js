import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');

// Scratch space for tests that need a real filesystem. Nothing here is ever
// deleted: project policy is that tmp/ belongs to the operator, so runs
// accumulate directories and are cleared by hand.
export function scratchDir(label = 'case') {
  const dir = path.join(
    ROOT, 'tmp', 'test', `${label}-${crypto.randomBytes(4).toString('hex')}`,
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
    await new Promise((resolve) => server.close(resolve));
  }
}
