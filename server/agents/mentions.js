// Agent names are free-form ("Level Designer"), but a mention is one token, so
// both sides are normalised to lowercase alphanumerics before comparison:
// "@leveldesigner", "@Level-Designer", and "@level" all reach Level Designer.
function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function parseMentions(body) {
  const found = new Set();
  for (const match of String(body ?? '').matchAll(/@([A-Za-z0-9_-]{1,100})/g)) {
    const handle = normalize(match[1]);
    if (handle) found.add(handle);
  }
  return found;
}

// A prefix match needs two characters, so a stray "@a" doesn't wake the whole
// roster. An exact match on the full normalised name always counts, which
// keeps single-character names mentionable.
const MIN_PREFIX = 2;

export function agentEligible({ name, chatty = false }, mentions) {
  if (chatty) return true;
  const normalized = normalize(name);
  if (!normalized) return false;
  for (const handle of mentions) {
    if (handle === normalized) return true;
    if (handle.length >= MIN_PREFIX && normalized.startsWith(handle)) return true;
  }
  return false;
}
