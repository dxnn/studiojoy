import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn } from './helpers.js';
import { hostnameFrom, gamesUrlFrom } from '../server/http/origin.js';

const req = (host) => ({ headers: host === undefined ? {} : { host } });

test('the hostname comes out of Host with any port dropped', () => {
  assert.equal(hostnameFrom('chunk.local:8100'), 'chunk.local');
  assert.equal(hostnameFrom('chunk.local'), 'chunk.local');
  assert.equal(hostnameFrom('localhost:8100'), 'localhost');
  assert.equal(hostnameFrom('192.168.1.7:8100'), '192.168.1.7');
  assert.equal(hostnameFrom('studio.example.com'), 'studio.example.com');
  // A fully-qualified Host may carry a trailing dot.
  assert.equal(hostnameFrom('studio.example.com.'), 'studio.example.com');
});

test('a bracketed IPv6 literal keeps its brackets', () => {
  assert.equal(hostnameFrom('[::1]:8100'), '[::1]');
  assert.equal(hostnameFrom('[::1]'), '[::1]');
  assert.equal(hostnameFrom('[2001:db8::7]:8100'), '[2001:db8::7]');
});

// ⚠️ Host is client-controlled, and whatever survives this lands in a URL the
// studio hands the browser. Anything that isn't a plain hostname is refused.
test('a Host that is not a plausible hostname is refused', () => {
  const bad = [
    '', ':8100', '.', '..', 'a..b', '-lead.example', 'trail-.example',
    'has space', 'evil.com/path', 'user@evil.com',
    'name_underscore', '[bad', '[fe80::1%25eth0]', 'x\ty',
  ];
  for (const host of bad) {
    assert.equal(hostnameFrom(host), null, `${JSON.stringify(host)} must be refused`);
  }
  assert.equal(hostnameFrom(undefined), null);
  assert.equal(hostnameFrom(null), null);
});

// Everything from the port separator onwards is discarded, so junk smuggled
// after it cannot reach the output — what comes back is a bare hostname or
// nothing. `evil.com/path` with no colon is refused outright, above.
test('anything past the port separator is dropped, not parsed', () => {
  assert.equal(hostnameFrom('evil.com:8100/path'), 'evil.com');
  assert.equal(hostnameFrom('chunk.local:8100:9000'), 'chunk.local');
  assert.equal(gamesUrlFrom(req('evil.com:8100/path'), 8101), 'http://evil.com:8101');
});

test('the games url is the request hostname on the games port', () => {
  assert.equal(gamesUrlFrom(req('chunk.local:8100'), 8101), 'http://chunk.local:8101');
  assert.equal(gamesUrlFrom(req('chunk.local'), 8101), 'http://chunk.local:8101');
  assert.equal(gamesUrlFrom(req('192.168.1.7:8100'), 9001), 'http://192.168.1.7:9001');
  assert.equal(gamesUrlFrom(req('[::1]:8100'), 8101), 'http://[::1]:8101');
});

test('no usable Host means no games origin at all', () => {
  assert.equal(gamesUrlFrom(req(undefined), 8101), null);
  assert.equal(gamesUrlFrom(req('evil.com/x'), 8101), null);
});

// The point of the whole exercise: nothing is configured, and the play link
// still names the host the studio was reached by. The fixture binds 127.0.0.1
// on an ephemeral port, so that is the hostname the request carries.
test('with no games url configured the play link follows the request host', async (t) => {
  const app = await setup({ gamesUrl: null });
  t.after(() => app.close());
  await signIn(app);

  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });

  const res = await app.client.json('GET', '/api/projects/tank');
  assert.equal(res.status, 200);
  assert.equal(res.body.play_url, 'http://127.0.0.1:8101/tank/');

  const me = await app.client.json('GET', '/api/me');
  assert.equal(me.body.games_url, 'http://127.0.0.1:8101');
});
