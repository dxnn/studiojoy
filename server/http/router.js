import { HttpError, json } from './respond.js';

// Minimal path router: literal segments, `:name` params, and a trailing
// `*name` that swallows the rest. Enough for spec.md §6 and small enough to
// read in one sitting, which is the whole point of not taking a dependency.

function compile(pattern) {
  if (!pattern.startsWith('/')) {
    throw new Error(`route pattern must start with '/': ${pattern}`);
  }
  const raw = pattern === '/' ? [] : pattern.slice(1).split('/');
  const segs = raw.map((s) => {
    if (s.startsWith('*')) return { kind: 'rest', name: s.slice(1) || 'rest' };
    if (s.startsWith(':')) return { kind: 'param', name: s.slice(1) };
    return { kind: 'lit', value: s };
  });
  const restAt = segs.findIndex((s) => s.kind === 'rest');
  if (restAt !== -1 && restAt !== segs.length - 1) {
    throw new Error(`'*' must be the last segment: ${pattern}`);
  }
  return segs;
}

function match(segs, parts) {
  const params = Object.create(null);
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.kind === 'rest') {
      // Zero remaining parts is a legal match, so `/files/*path` also
      // answers `/files`. Callers that need a non-empty path validate it.
      params[seg.name] = parts.slice(i).join('/');
      return params;
    }
    if (i >= parts.length) return null;
    if (seg.kind === 'lit') {
      if (parts[i] !== seg.value) return null;
    } else {
      params[seg.name] = parts[i];
    }
  }
  return parts.length === segs.length ? params : null;
}

export function createRouter() {
  const routes = [];
  const api = {};

  const add = (methods, pattern, handler) => {
    const segs = compile(pattern);
    for (const method of methods) routes.push({ method, segs, handler, pattern });
    return api;
  };

  // A GET route answers HEAD too — `respond.js` and `static.js` drop the body.
  api.get = (p, h) => add(['GET', 'HEAD'], p, h);
  api.post = (p, h) => add(['POST'], p, h);
  api.put = (p, h) => add(['PUT'], p, h);
  api.patch = (p, h) => add(['PATCH'], p, h);
  api.delete = (p, h) => add(['DELETE'], p, h);

  api.handle = async (req, res, base = {}) => {
    let url;
    let parts;
    try {
      url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;
      const rawParts = pathname === '/' ? [] : pathname.slice(1).split('/');
      // Decode per segment so an encoded slash lands inside a segment value
      // rather than inventing a new one. Path validation re-splits on '/'
      // afterwards, so `..%2F..` still gets caught as two '..' segments.
      parts = rawParts.map(decodeURIComponent);
    } catch {
      return json(res, 400, { error: 'malformed url' });
    }

    const allowed = new Set();
    for (const route of routes) {
      const params = match(route.segs, parts);
      if (!params) continue;
      if (route.method !== req.method) {
        allowed.add(route.method);
        continue;
      }
      const ctx = { ...base, req, res, url, params, query: url.searchParams };
      try {
        await route.handler(ctx);
      } catch (err) {
        if (err instanceof HttpError) {
          json(res, err.status, { error: err.message, ...err.extra });
        } else {
          console.error(`${req.method} ${route.pattern} failed`, err);
          if (!res.headersSent) json(res, 500, { error: 'internal error' });
          else res.end();
        }
      }
      return;
    }

    if (allowed.size) {
      res.setHeader('Allow', [...allowed].join(', '));
      return json(res, 405, { error: 'method not allowed' });
    }
    return json(res, 404, { error: 'not found' });
  };

  return api;
}
