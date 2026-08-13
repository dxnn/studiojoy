// SSE fan-out. Every studio account can see every project (spec.md §3), so
// there is no membership to filter on: each event goes to every connected
// tab and the client decides whether it cares, keyed on project_slug. That
// deletes the per-conversation recipient lookup new-y needs.
export function createBroker() {
  const clients = new Map();
  let nextId = 1;

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
