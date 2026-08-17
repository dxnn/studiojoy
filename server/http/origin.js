// Play and preview links have to name the games listener, which shares a
// machine with the studio and differs only by port (spec.md §7). Deriving that
// from the request means the hostname is configured nowhere: whatever name the
// studio was reached by, the games origin is reached by too, so `localhost`, a
// LAN address, and `chunk.local` all work with nothing exported at startup.
//
// ⚠️ `Host` is client-controlled. Only the hostname is taken from it — the
// scheme and the port are ours — and a value that is not a plausible hostname
// is refused rather than interpolated into a URL the studio hands the browser.

const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;
const IPV6 = /^\[[0-9a-f:.]+\]$/i;

// `Host` is `name`, `name:port`, or a bracketed IPv6 literal whose own colons
// are the reason the port can't simply be split off at the first one.
export function hostnameFrom(host) {
  if (typeof host !== 'string' || host === '') return null;
  const cut = host.startsWith('[') ? host.indexOf(']') + 1 : host.indexOf(':');
  const name = cut > 0 ? host.slice(0, cut) : host;
  if (name.startsWith('[')) return IPV6.test(name) ? name : null;
  // A fully-qualified `Host` may carry a trailing dot. Same host either way.
  const bare = name.endsWith('.') ? name.slice(0, -1) : name;
  return HOSTNAME.test(bare) ? bare : null;
}

// null when the request carries no usable hostname, which leaves the caller to
// report "no games origin" rather than build a URL around a guess. Always
// `http`: this process only ever serves plaintext, so TLS can only arrive via
// a proxy — and that deployment sets `GAMES_URL` explicitly anyway.
export function gamesUrlFrom(req, gamesPort) {
  const name = hostnameFrom(req.headers?.host);
  return name === null ? null : `http://${name}:${gamesPort}`;
}
