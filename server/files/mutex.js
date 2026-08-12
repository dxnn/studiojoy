// Per-key serialization (spec.md §5). Two agents can stream concurrently in
// one project, but their write-and-commit steps must not interleave — a
// `git add` from one would otherwise stage the other's half-written file.
export function createMutex() {
  const tails = new Map();

  return {
    run(key, fn) {
      const prev = tails.get(key) ?? Promise.resolve();
      const result = prev.then(() => fn());
      // The stored tail must never reject, or every later caller on this key
      // inherits the earlier failure. The caller still gets `result`, with
      // the rejection intact.
      const tail = result.then(
        () => {},
        () => {},
      );
      tails.set(key, tail);
      tail.then(() => {
        // Only the last waiter clears the entry, so a queue that is still
        // draining keeps its ordering.
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },

    // Test seam: how many keys currently have work queued.
    _size() {
      return tails.size;
    },
  };
}
