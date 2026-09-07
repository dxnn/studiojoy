// SSE fan-out. Every studio account can see every project (spec.md §3), so
// there is no membership to filter on: each event goes to every connected
// tab and the client decides whether it cares, keyed on project_slug. That
// deletes the per-conversation recipient lookup new-y needs.
export function createBroker() {
  const clients = new Map();
  let nextId = 1;
  // The one thing that must happen for every message wherever it was made.
  // A `message.new` is broadcast from three places — a person's post and two
  // in the orchestrator — and web push has to reach a browser that is not
  // connected at all, so it cannot ride the fan-out below. Hung here rather
  // than added to each site, because the fourth site is the one that would
  // forget (server/notify.js, spec/ §6).
  let onMessage = null;
  // The same for a game changing — its tree or its row: seventeen routes say
  // so, and the eighteenth is the one that would forget to stamp it (app.js,
  // `projects.updated_at`, spec/ §3).
  let onChange = null;

  function frame(event, data) {
    // JSON.stringify never emits a raw newline, so the payload is always the
    // single line the SSE format requires.
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  return {
    subscribe(userId, write) {
      const id = nextId;
      nextId += 1;
      clients.set(id, { userId, write });
      return () => clients.delete(id);
    },

    // Nothing is told about a message until one is asked for. Absent — no
    // VAPID keys, or a test's app — every broadcast is what it always was.
    watchMessages(fn) {
      onMessage = fn;
    },

    // Told the slug of every game whose tree or row just changed.
    watchChanges(fn) {
      onChange = fn;
    },

    broadcast(event, data) {
      const payload = frame(event, data);
      for (const [id, client] of clients) {
        try {
          client.write(payload);
        } catch {
          // A write to a socket the peer already dropped isn't an error
          // worth surfacing; forget the client and carry on.
          clients.delete(id);
        }
      }
      // ⚠️ After the connected tabs, and never awaited: a push service being
      // slow must not hold up a reply landing in the thread.
      if (event === 'message.new' && onMessage) onMessage(data);
      // The two events that mean the game itself changed. A `version.new` is
      // the write's commit landing, already counted; a message is talk.
      if ((event === 'files.changed' || event === 'project.updated') && onChange) {
        onChange(data.project_slug ?? data.slug);
      }
    },

    // Everyone sees everything, so this is only used for diagnostics and to
    // let the stream route report how many tabs are attached.
    count() {
      return clients.size;
    },

    userIds() {
      return [...new Set([...clients.values()].map((c) => c.userId))];
    },
  };
}
