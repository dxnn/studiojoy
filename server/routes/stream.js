import { requireAuth } from '../auth.js';

// Heartbeat interval. A comment frame keeps intermediaries from closing an
// idle connection; 25s is comfortably inside the usual 60s proxy timeout.
const PING_MS = 25_000;

export function streamRoutes(r) {
  r.get('/api/stream', (ctx) => {
    const user = requireAuth(ctx);
    const { req, res } = ctx;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx not to buffer the stream, which would defeat streaming.
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const unsubscribe = ctx.broker.subscribe(user.id, (frame) => res.write(frame));
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // The close handler does the cleanup; nothing to do here.
      }
    }, PING_MS);
    ping.unref?.();

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      clearInterval(ping);
      unsubscribe();
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);

    // Deliberately does not end the response: the handler returns while the
    // connection stays open for the life of the tab.
  });
}
