// Installability only — no offline support. There is no build step and no
// filename hashing on the studio's own JS/CSS, so a cache-first strategy
// would risk serving stale code after every edit; the studio also needs the
// network for everything it does (the API, SSE). `skipWaiting`/`clients.claim`
// just mean a new deploy takes over existing tabs without a manual reload
// prompt, since there is nothing versioned here to migrate between.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
