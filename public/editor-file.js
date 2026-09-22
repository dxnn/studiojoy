// The file under an editor of the whole game — the track, the adventure, the
// story, the achievements (spec.md §6). Every one of them reads its config
// file the same way (present or not, readable or not, still in the shape its
// model can read) and writes it the same way (against the etag it read, a
// 409 being somebody else's save). What each does with the model, the
// selection and the parked copy stays its own.

import { S, send, say, render, NO_CONNECTION, encodePath } from './main.js';

// `parse(text)` is the editor's model reader: `{ ok: true, … }`, or
// `{ ok: false, reason }` when the file has grown past it. The answer is
// `{ missing }`, `{ grown }` — the editor's state as it stands — or
// `{ text, etag, read }`; null when the person left the game meanwhile.
export async function readEditorFile(slug, file, parse) {
  if (!S.files.some((f) => f.path === file)) {
    return { state: { grown: `${file} is not in this game`, missing: true } };
  }
  const res = await send(`/api/projects/${slug}/files/${encodePath(file)}`);
  if (S.slug !== slug) return null;
  if (!res.ok) {
    return { state: { grown: res.status === 0 ? NO_CONNECTION : `the studio could not read ${file}` } };
  }
  const text = await res.text();
  if (S.slug !== slug) return null;
  const read = parse(text);
  if (!read.ok) return { state: { grown: read.reason } };
  return { text, etag: res.headers.get('etag'), read };
}

// The PUT, against the etag the editor holds unless `force`. A 409 opens the
// one conflict dialog, which asks the editor named by `editor` (dialogs.js)
// to keep theirs or write over them; any other failure is said here. The new
// etag on success, or null.
export async function writeEditorFile(file, text, {
  etag, force = false, keepalive = false, editor, noun,
}) {
  const headers = { 'content-type': 'text/plain' };
  if (!force && etag) headers['if-match'] = etag;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(file)}`, {
    method: 'PUT', headers, body: text, keepalive,
  });
  const body = await res.json().catch(() => null);
  if (res.status === 409) {
    S.dialog = { kind: 'editor-conflict', editor };
    render();
    return null;
  }
  if (!res.ok) {
    say(res.status === 0 ? NO_CONNECTION : (body?.error ?? `Could not save the ${noun}.`), true);
    return null;
  }
  return body.etag;
}
