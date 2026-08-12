import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './respond.js';

// Content types come from the extension and nothing else — never from a
// client-supplied header (spec.md §4). An extension we don't know is still
// served, but as an opaque download rather than something a browser will try
// to interpret.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export const OCTET_STREAM = 'application/octet-stream';

// Extensions whose bytes an agent can usefully read as text (spec.md §8).
// Everything else is described by name and size only.
const TEXT_EXTS = new Set([
  '.html', '.css', '.js', '.mjs', '.json', '.txt', '.md', '.csv', '.svg',
]);

export function mimeForPath(p) {
  return MIME[path.extname(p).toLowerCase()] ?? null;
}

export function isTextPath(p) {
  return TEXT_EXTS.has(path.extname(p).toLowerCase());
}

export async function serveFile(req, res, absPath, extraHeaders = {}) {
  let st;
  try {
    // lstat, not stat: a symlink must not be followed. The app never creates
    // one, so its presence means someone edited the tree by hand, and
    // following it would be a way out of the project directory.
    st = await fs.promises.lstat(absPath);
  } catch {
    throw new HttpError(404, 'not found');
  }
  if (!st.isFile()) throw new HttpError(404, 'not found');

  const mime = mimeForPath(absPath);
  const headers = {
    'Content-Type': mime ?? OCTET_STREAM,
    'Content-Length': String(st.size),
    ...extraHeaders,
  };
  if (!mime) {
    const safeName = path.basename(absPath).replace(/["\\\r\n]/g, '');
    headers['Content-Disposition'] = `attachment; filename="${safeName}"`;
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();

  await new Promise((resolve) => {
    const stream = fs.createReadStream(absPath);
    // Headers are already out, so a mid-stream read failure can only be
    // signalled by hanging up. Nothing useful to say at this point.
    stream.on('error', () => {
      res.destroy();
      resolve();
    });
    res.on('close', resolve);
    stream.pipe(res);
    res.on('finish', resolve);
  });
}
