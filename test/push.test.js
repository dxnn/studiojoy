// The two pieces of web push that had to be hand-rolled, because the studio
// has no runtime dependency (server/push.js, ideas/notifications.md rung 2).
//
// ⚠️ This is the test that makes hand-rolling one of these safe: RFC 8291 §5
// is a complete worked example — a plaintext, both key pairs, the salt, and
// the exact bytes that must come out — so the encryption is checked against
// the specification itself rather than against somebody's live push service.
// Given the same salt and the same ephemeral key it is deterministic, which
// is the only reason `encrypt` takes them at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import {
  encrypt, vapidHeader, makeKeys, pushConfig, sendOne,
} from '../server/push.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const unb64 = (text) => new Uint8Array(Buffer.from(text, 'base64url'));

/* RFC 8291 §5 --------------------------------------------------------------- */

const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  ua_public: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  ua_private: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  as_public: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  as_private: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml'
    + 'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT'
    + 'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

// A P-256 pair out of the RFC's two halves. The private scalar alone is not
// importable — webcrypto wants x and y beside it, which come out of the
// public point (0x04, then 32 of x, then 32 of y).
async function pairFrom(publicKey, privateKey, usage) {
  const point = unb64(publicKey);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64(point.subarray(1, 33)),
    y: b64(point.subarray(33, 65)),
    ext: true,
  };
  return {
    publicKey: await crypto.subtle.importKey(
      'raw', point, { name: 'ECDH', namedCurve: 'P-256' }, true, [],
    ),
    privateKey: await crypto.subtle.importKey(
      'jwk', { ...jwk, d: privateKey }, { name: 'ECDH', namedCurve: 'P-256' }, false, usage,
    ),
  };
}

test('the payload is the bytes RFC 8291 says it is', async () => {
  const body = await encrypt(RFC.plaintext, { p256dh: RFC.ua_public, auth: RFC.auth }, {
    pair: await pairFrom(RFC.as_public, RFC.as_private, ['deriveBits']),
    salt: unb64(RFC.salt),
  });
  assert.equal(b64(body), RFC.body);
});

// The receiving half, written here and nowhere else: it is what a browser
// does, so it belongs in the test rather than in the studio. It also says
// what the framing means, which the encryptor's own comments claim.
async function decrypt(body, { p256dh, auth, private: uaPrivate }) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const as = body.subarray(21, 21 + idlen);
  const sealed = body.subarray(21 + idlen);
  const pair = await pairFrom(p256dh, uaPrivate, ['deriveBits']);
  const asKey = await crypto.subtle.importKey(
    'raw', as, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: asKey }, pair.privateKey, 256,
  ));
  const info = new Uint8Array([
    ...Buffer.from('WebPush: info\0'), ...unb64(p256dh), ...as,
  ]);
  const step = async (ikm, s, i, n) => new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: s, info: i },
    await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
    n * 8,
  ));
  const ikm = await step(shared, unb64(auth), info, 32);
  const cek = await step(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await step(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const out = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, sealed,
  ));
  // The delimiter the encryptor put on: 0x02 for the last record.
  assert.equal(out.at(-1), 0x02);
  return Buffer.from(out.subarray(0, -1)).toString('utf8');
}

test('a real send, with its own salt and key, still reads back', async () => {
  const sub = {
    p256dh: RFC.ua_public, auth: RFC.auth, private: RFC.ua_private,
  };
  const said = 'Tank — Robin: look at the new level';
  const body = await decrypt(await encrypt(said, sub), sub);
  assert.equal(body, said, 'a fresh salt and ephemeral key change the bytes, not the message');
  // Twice over, because the whole point of the ephemeral pair is that two
  // sends of the same words are different bytes.
  const once = await encrypt(said, sub);
  const twice = await encrypt(said, sub);
  assert.notDeepEqual(once, twice);
});

// A record bigger than `rs` is one a browser drops without saying so, which
// is exactly the failure nobody would ever find. `messageText` cuts the words
// long before this, so it is a guard and not a thing that happens.
test('a payload too big for one record is refused rather than sent', async () => {
  await assert.rejects(
    encrypt('x'.repeat(4100), { p256dh: RFC.ua_public, auth: RFC.auth }),
    /at most 3993 bytes/,
  );
});

/* VAPID (RFC 8292) ---------------------------------------------------------- */

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

test('the VAPID header is an ES256 token this key really signed', async () => {
  const keys = await makeKeys();
  const config = { ...keys, subject: 'mailto:studio@example.com' };
  const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc123', config);
  const [, token, sent] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(sent, keys.publicKey, 'the key the push service checks against rides along');

  const [head, claims, signature] = token.split('.');
  assert.deepEqual(decodePart(head), { typ: 'JWT', alg: 'ES256' });
  const body = decodePart(claims);
  // ⚠️ The origin, never the whole endpoint: the whole URL here is a 401
  // from Firefox and a shrug from Chrome.
  assert.equal(body.aud, 'https://fcm.googleapis.com');
  assert.equal(body.sub, 'mailto:studio@example.com');
  assert.ok(body.exp > Math.floor(Date.now() / 1000), 'not already expired');
  assert.ok(body.exp <= Math.floor(Date.now() / 1000) + 24 * 3600, 'RFC 8292 caps it at a day');

  // And it verifies — which is what the push service will do with it. The
  // signature is raw r‖s, not DER; a DER one verifies false here.
  const point = unb64(keys.publicKey);
  const key = await crypto.subtle.importKey(
    'raw', point, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  );
  assert.equal(await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature),
    Buffer.from(`${head}.${claims}`),
  ), true);
});

test('a fresh pair is the shape every browser and web-push expects', async () => {
  const { publicKey, privateKey } = await makeKeys();
  assert.equal(unb64(publicKey).length, 65);
  assert.equal(unb64(publicKey)[0], 0x04, 'an uncompressed point');
  assert.equal(unb64(privateKey).length, 32, 'the bare scalar');
});

/* The send, and being switched off ------------------------------------------ */

test('no keys in the environment is no push, not an error', () => {
  assert.equal(pushConfig({}), null);
  assert.equal(pushConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_SUBJECT: 'b' }), null);
  assert.deepEqual(
    pushConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'c' }),
    { publicKey: 'a', privateKey: 'b', subject: 'c' },
  );
});

test('a send carries the aes128gcm headers and reports what came back', async () => {
  const keys = await makeKeys();
  const seen = [];
  const status = await sendOne(
    { endpoint: 'https://push.example.com/x', p256dh: RFC.ua_public, auth: RFC.auth },
    'hello',
    { ...keys, subject: 'mailto:s@example.com' },
    async (url, options) => { seen.push({ url, options }); return { status: 201 }; },
  );
  assert.equal(status, 201);
  const { url, options } = seen[0];
  assert.equal(url, 'https://push.example.com/x');
  assert.equal(options.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(options.headers['Content-Type'], 'application/octet-stream');
  assert.match(options.headers.Authorization, /^vapid t=.+, k=.+$/);
  assert.ok(Number(options.headers.TTL) > 0);
  assert.ok(options.body.length > 86, 'the header alone is 86 bytes');
});

// A push service that cannot be reached is not a crash: the studio carries on
// and the message is still in the thread when somebody looks.
test('a push service that will not answer is a 0, not a throw', async () => {
  const keys = await makeKeys();
  const status = await sendOne(
    { endpoint: 'https://push.example.com/x', p256dh: RFC.ua_public, auth: RFC.auth },
    'hello',
    { ...keys, subject: 'mailto:s@example.com' },
    async () => { throw new Error('ENOTFOUND'); },
  );
  assert.equal(status, 0);
});
