// The next UTC midnight strictly after `now`. Used for the studio token
// budget's lazy rollover: the stored reset timestamp is always in the future
// of whatever moment produced it (spec.md §12).
export function nextUtcMidnight(now = new Date()) {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  )).toISOString();
}
