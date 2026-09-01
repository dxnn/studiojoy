// Codepoint ranges rather than a regex on purpose: a character class holding
// these would be a run of invisible bytes in the source, which greps badly
// and dies silently if an editor normalises the file. Hex literals are plain
// ASCII and say what they mean.
//
// - control: C0 and DEL, meaningless in a filename and a classic truncation
//   trick against anything that later hands the path to a C API.
// - format: soft hyphen, zero-width spaces/joiners, bidi overrides, BOM.
//   macOS treats several as ignorable, so `.gi<ZWSP>t` opens the real `.git`
//   directory; bidi overrides make a filename render as something it isn't.
//
// One check for a path and for a person's name, because the second reason
// holds for both: a name is shown to kids on a scoreboard and in the crew,
// and a bidi override makes it read as something other than what it is
// (spec.md §3, §4). Returns the kind of character found, or null.
export function forbiddenCharKind(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || c === 0x7f) return 'a control character';
    if (
      c === 0x00ad ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x2064) ||
      (c >= 0x206a && c <= 0x206f) ||
      c === 0xfeff ||
      (c >= 0xfff9 && c <= 0xfffb)
    ) {
      return 'a zero-width or bidi character';
    }
  }
  return null;
}

// The same characters taken out rather than refused, for a name that was
// stored before the door checked.
export function stripForbidden(s) {
  return [...s].filter((ch) => forbiddenCharKind(ch) === null).join('');
}
