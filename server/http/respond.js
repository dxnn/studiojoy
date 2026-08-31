// A thrown HttpError is the normal way a handler refuses a request. The
// router turns it into a JSON body; anything else becomes a 500 and a log
// line, so an unexpected crash never leaks a stack trace to the client.
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.extra = extra;
  }
}

export const conflict = (msg, extra) => new HttpError(409, msg, extra);

// A HEAD request must carry the headers of the equivalent GET and no body.
// Every writer funnels through here so that rule lives in one place.
function finish(res, body) {
  if (res.req?.method === 'HEAD') return res.end();
  res.end(body);
}

export function json(res, status, body) {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  finish(res, payload);
}

export function text(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  finish(res, body);
}

export function noContent(res) {
  res.writeHead(204);
  res.end();
}
