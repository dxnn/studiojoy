// Installability only — no offline support. There is no build step and no
// filename hashing on the studio's own JS/CSS, so a cache-first strategy
// would risk serving stale code after every edit; the studio also needs the
// network for everything it does (the API, SSE). `skipWaiting`/`clients.claim`
// just mean a new deploy takes over existing tabs without a manual reload
// prompt, since there is nothing versioned here to migrate between.
//
// It is also where a notification is shown from and where a press on one
// lands (public/notify.js, ideas/notifications.md): a plain `new
// Notification` never fires on an installed iOS PWA, so one has to come
// through a worker's registration even while the page is the one asking.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// The studio is closed, or its tab is asleep, and the push service woke this
// worker up (server/push.js, ideas/notifications.md rung 2). The payload is
// what notify.js's `messageText` made, decrypted by the browser on the way
// in — the push service carried it and could not read it.
self.addEventListener('push', (event) => {
  const said = (() => {
    try { return event.data?.json() ?? {}; } catch { return {}; }
  })();
  event.waitUntil((async () => {
    // ⚠️ The one time a push shows nothing: a window of this studio is
    // actually on screen. `userVisibleOnly` is a promise to show something
    // for every push, and browsers keep score — but a visible client is the
    // exemption they all make, and it is the right one here, because rung 1
    // stayed silent for exactly this case and the unread marks are already
    // saying it in the pane.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (open.some((client) => client.visibilityState === 'visible')) return;
    // Same tag as rung 1's, so a hidden tab that showed its own does not end
    // up with two: the second replaces the first.
    await self.registration.showNotification(said.title || 'The studio', {
      body: said.body || '',
      tag: `${said.slug ?? ''}:${said.chat ?? ''}`,
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { slug: said.slug ?? null, chat: said.chat ?? null },
    });
  })());
});

// One was pressed. Focus a studio tab if one is open and tell it which
// conversation to go to; otherwise open one at that address. ⚠️ Both are
// inside waitUntil — a worker is allowed to be stopped the moment the handler
// returns, which without it is a press that focuses nothing.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { slug = null, chat = null } = event.notification.data ?? {};
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      client.postMessage({ type: 'notification', slug, chat });
      return;
    }
    // No tab: the address is the view (§17), so the conversation is in it and
    // the studio opens straight there — `/p/<slug>?chat=<id>`, which is what
    // urlNow() writes.
    const at = slug
      ? `/p/${encodeURIComponent(slug)}${chat ? `?chat=${encodeURIComponent(chat)}` : ''}`
      : '/';
    await self.clients.openWindow(at);
  })());
});
