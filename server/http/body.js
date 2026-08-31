import { HttpError } from './respond.js';

const MAX_JSON_BYTES = 64 * 1024;
// Transport ceiling only. The per-file limit that actually matters lives with
// the other project caps in files/tree.js, and callers pass it explicitly.
const MAX_RAW_BYTES = 16 * 1024 * 1024;

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
  // ⚠️ This check is the preflight barrier, not pedantry. Two ports on one
  // hostname are one *site*, so a game on the games origin can POST here with
  // the operator's cookie attached — and a body sent as text/plain (or with no
  // Content-Type at all) is CORS-safelisted, so the browser sends it without
  // asking. Requiring application/json makes every such POST need a preflight,
  // which the studio never grants (spec.md §7). Checked before the body is
  // read: a refused request costs nothing.
  const declared = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (declared !== 'application/json') {
    throw new HttpError(415, 'expected content-type: application/json');
  }
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
