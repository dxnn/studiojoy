// Text on its way into markup. Two places need it and they must agree: the
// catalog on the games origin, which prints names people typed, and the blank
// start page, which prints a game's name into a file on disk.
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
