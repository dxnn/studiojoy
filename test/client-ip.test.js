import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, ipBucket } from '../server/routes/helpers.js';

// The address every lockout and limiter keys on. IPv6 is bucketed by its
// /64, because the whole address is a fresh one per request for anybody who
// wants it to be (spec.md §6).
test('ipBucket keeps IPv4 whole and folds IPv6 to its /64', () => {
  assert.equal(ipBucket('203.0.113.7'), '203.0.113.7');
  assert.equal(ipBucket('::ffff:203.0.113.7'), '::ffff:203.0.113.7', 'a mapped IPv4 is IPv4');
  assert.equal(ipBucket('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('2001:0db8:0001:0002::1'), '2001:db8:1:2::/64', 'leading zeros are not a new bucket');
  assert.equal(ipBucket('2001:db8:1:2::'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('2001:db8:1:3::1'), '2001:db8:1:3::/64', 'the next /64 is another bucket');
  assert.equal(ipBucket('::1'), '0:0:0:0::/64');
  assert.equal(ipBucket('unknown'), 'unknown');
});

test('clientIp reads the forwarded hop only when the proxy is trusted, and buckets it', () => {
  const ctx = (trustProxy, forwarded, remoteAddress = '2001:db8:9:9::1') => ({
    trustProxy,
    req: { headers: forwarded ? { 'x-forwarded-for': forwarded } : {}, socket: { remoteAddress } },
  });
  assert.equal(clientIp(ctx(false, '203.0.113.7')), '2001:db8:9:9::/64', 'untrusted, the socket wins');
  assert.equal(clientIp(ctx(true, '203.0.113.7, 10.0.0.1')), '203.0.113.7', 'trusted, the first hop');
  assert.equal(clientIp(ctx(true, '2001:db8:1:2:aaaa::1, 10.0.0.1')), '2001:db8:1:2::/64');
  assert.equal(clientIp(ctx(true, undefined, '203.0.113.9')), '203.0.113.9', 'no header, the socket');
  assert.equal(clientIp({ trustProxy: false, req: { headers: {}, socket: undefined } }), 'unknown');
});
