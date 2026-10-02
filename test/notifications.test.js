// Whether the studio tells somebody something happened while they were not
// looking (ideas/notifications.md, rung 1). Four decisions live in notify.js
// and none of them can be checked in a browser without a real permission
// prompt, which is exactly why they are here: what state the switch is in,
// when a notification is shown at all, what it says, and that a burst from
// one conversation is one of them rather than four.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` and the stored rail width on the
// way in — and a real store, because whether you want them is remembered.
install();
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
};

// What this browser was asked to show. No service worker is registered here,
// so notify.js takes the constructor path — the one a laptop in development
// takes, and the one a test can see.
const shown = [];
class FakeNotification {
  static permission = 'granted';

  constructor(title, options) {
    shown.push({ title, options });
    this.title = title;
  }

  addEventListener() {}

  close() {}
}
globalThis.Notification = FakeNotification;

const { S } = await import('../public/main.js');
const { notifyState, notifyMessage, keyBytes, renewPush } = await import('../public/notify.js');

function studio({ permission = 'granted', want = 'on', hidden = true } = {}) {
  FakeNotification.permission = permission;
  store.clear();
  store.set('gs.notify', want);
  globalThis.document.hidden = hidden;
  S.me = { id: 1, display_name: 'Dann' };
  S.projects = [{ slug: 'tank', name: 'Tank', kind: 'game' }];
  S.agents = [{ id: 7, name: 'Steve' }];
  shown.length = 0;
}

const message = (extra) => ({
  project_slug: 'tank', chat_id: 3, user_id: 2, user_name: 'Robin',
  agent_id: null, body: 'look at the new level', ...extra,
});

test('the browser outranks the switch', () => {
  studio({ permission: 'granted', want: 'on' });
  assert.equal(notifyState(), 'on');
  studio({ permission: 'granted', want: 'off' });
  assert.equal(notifyState(), 'off');
  // Said yes here, never asked there: the switch cannot be on ahead of the
  // permission, or it is a switch that does nothing.
  studio({ permission: 'default', want: 'on' });
  assert.equal(notifyState(), 'off');
  studio({ permission: 'denied', want: 'on' });
  assert.equal(notifyState(), 'blocked');
});

// An iPhone or iPad has notifications only for the studio opened from the
// Home Screen. In a Safari tab the bell stays, to say so; anywhere else
// without them it goes, and so does a Home Screen app on an iPadOS too old
// to have them.
test('a Safari tab on an iPad is told to use the Home Screen', () => {
  studio();
  delete globalThis.Notification;
  try {
    for (const [standalone, state] of [[false, 'install'], [undefined, 'unsupported'], [true, 'unsupported']]) {
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone });
      assert.equal(notifyState(), state, `standalone ${standalone}`);
    }
  } finally {
    delete navigator.standalone;
    globalThis.Notification = FakeNotification;
  }
});

test('it says who, in which game, and what they said', () => {
  studio();
  notifyMessage(message());
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'Tank');
  assert.equal(shown[0].options.body, 'Robin: look at the new level');
});

// A helper's name is the client's to look up: the message carries a person's
// name and an agent's id, never an agent's name (§6).
test('a helper is named too', () => {
  studio();
  notifyMessage(message({ user_id: null, user_name: null, agent_id: 7 }));
  assert.equal(shown[0].options.body, 'Steve: look at the new level');
  studio();
  notifyMessage(message({ user_id: null, user_name: null, agent_id: 999 }));
  assert.equal(shown[0].options.body, 'Somebody: look at the new level');
});

test('nothing while the studio is the thing on screen', () => {
  studio({ hidden: false });
  notifyMessage(message());
  assert.deepEqual(shown, [], 'the unread marks are already saying this');
});

test('nothing while the switch is off, or the browser is blocking', () => {
  studio({ want: 'off' });
  notifyMessage(message());
  studio({ permission: 'denied' });
  notifyMessage(message());
  assert.deepEqual(shown, []);
});

// ⚠️ The one thing the switch being off does not stop (spec/ §6): what is
// said in the announcements, wherever the browser allows it.
test('an announcement is told with the switch off, and not past a blocking browser', () => {
  const news = message({ project_slug: 'announcements', chat_id: 1, body: 'Pizza on Friday' });
  const withRoom = () => { S.projects.push({ slug: 'announcements', name: 'Announcements', kind: 'chat', announce: true }); };
  studio({ want: 'off' });
  withRoom();
  notifyMessage(news);
  assert.deepEqual(shown.map((n) => n.title), ['Announcements']);
  studio({ want: 'off', permission: 'denied' });
  withRoom();
  notifyMessage(news);
  assert.deepEqual(shown, []);
});

// One line that keeps changing, not four lines. The tag is the conversation,
// so two chats in one game stay two of them.
test('a burst from one conversation collapses into one', () => {
  studio();
  notifyMessage(message({ body: 'one' }));
  notifyMessage(message({ body: 'two' }));
  notifyMessage(message({ chat_id: 4, body: 'elsewhere' }));
  assert.deepEqual(shown.map((n) => n.options.tag), ['tank:3', 'tank:3', 'tank:4']);
  for (const one of shown) assert.equal(one.options.renotify, true);
});

test('a long message is cut, and it knows where to go back to', () => {
  studio();
  notifyMessage(message({ body: `${'ha'.repeat(200)} end` }));
  const { body, data } = shown[0].options;
  assert.ok(body.length < 140, `one line, got ${body.length}`);
  assert.ok(body.endsWith('…'), 'and it says it was cut');
  assert.deepEqual(data, { slug: 'tank', chat: 3 });
});

// The studio is what is talking, not the game — the same reason the sidebar
// stays the studio's own cyan whatever game is open.
test('it wears the studio icon, never the game’s', () => {
  studio();
  notifyMessage(message());
  assert.equal(shown[0].options.icon, '/icons/icon-192.png');
});

// The press is not the only time the studio subscribes: a browser loses its
// subscription without saying so, and the bell goes on reading 🔔. So every
// open asks again — with the switch on for everything, with it off for the
// announcements alone where the browser has said yes, and nothing at all in a
// browser that never has.
test('an open subscribes again: everything, the announcements, or nothing', async () => {
  const asked = [];
  const bodies = [];
  const subscription = { toJSON: () => ({ endpoint: 'https://push.test/1', keys: { p256dh: 'p', auth: 'a' } }) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    asked.push(url);
    if (options?.body) bodies.push(JSON.parse(options.body));
    return url === '/api/push/key'
      ? { ok: true, json: async () => ({ public_key: 'BAAA' }) }
      : { ok: true };
  };
  globalThis.PushManager = class {};
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { subscribe: async () => subscription } }) },
  });
  try {
    studio({ want: 'off', permission: 'default' });
    await renewPush();
    assert.deepEqual(asked, [], 'never said yes: nothing');
    studio({ want: 'off' });
    await renewPush();
    assert.deepEqual(asked, ['/api/push/key', '/api/push/subscribe']);
    assert.equal(bodies.at(-1).announcements_only, true, 'off still carries the announcements');
    studio({ want: 'on' });
    await renewPush();
    assert.equal(bodies.at(-1).announcements_only, false, 'on carries everything');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.PushManager;
    delete navigator.serviceWorker;
  }
});

// ⚠️ The VAPID key arrives as base64url and `pushManager.subscribe` wants
// bytes, and `atob` is base64 proper. Whether this is wrong depends on which
// pair a studio happened to generate, which is the worst kind of bug: it
// works on the machine it was written on. Checked against Node's own decoder
// over keys that do and do not carry the two URL-safe characters.
test('a VAPID key of any shape decodes to the same 65 bytes', async () => {
  const { makeKeys } = await import('../server/push.js');
  const keys = [
    'BFt25_zo5fCD7VGBy5F8fWMMM6EUOQ8YxEydSJlGyT1wQwmHXob2fO51uU0MlJcCuaIBoHMJX_U8pS5gJchnKEU',
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    (await makeKeys()).publicKey,
  ];
  for (const key of keys) {
    const bytes = keyBytes(key);
    assert.equal(bytes.length, 65, key);
    assert.equal(bytes[0], 0x04, 'an uncompressed point');
    assert.deepEqual(Buffer.from(bytes), Buffer.from(key, 'base64url'), key);
  }
});
