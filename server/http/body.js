import { HttpError } from './respond.js';

export const MAX_JSON_BYTES = 64 * 1024;
// Transport ceiling only. The per-file limit that actually matters lives with
// the other project caps in files/tree.js, and callers pass it explicitly.
export const MAX_RAW_BYTES = 16 * 1024 * 1024;

// Buffer a request body, refusing as soon as the cap is passed rather than
// after the whole thing has arrived — an oversized upload costs us the first
// chunk over the limit and nothing more.
export function readRaw(req, limit = MAX_RAW_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err, { destroy = true } = {}) => {
      if (settled) return;
      settled = true;
      if (destroy) req.destroy();
      reject(err);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        // Pause rather than destroy. Destroying here tears down the socket
        // before the 413 can be written, so the client sees a dropped
        // connection instead of a status it can act on. Paused, the rest of
        // the upload is never read and Node closes the connection once the
        // response is flushed.
        req.pause();
        chunks.length = 0;
        return fail(new HttpError(413, 'body too large'), { destroy: false });
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new HttpError(400, 'request aborted')));
  });
}

export async function readJson(req, limit = MAX_JSON_BYTES) {
  const buf = await readRaw(req, limit);
  if (!buf.length) return Object.create(null);
  let parsed;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid json');
  }
  // Routes destructure the result, so anything that isn't a plain object is
  // a client bug worth naming rather than a confusing undefined later on.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'body must be a json object');
  }
  return parsed;
}
