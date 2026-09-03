// The studio's roster: who is in it, and the admin panel's own numbers.
// Both are read-only from here — an account is made with `npm run adduser`,
// and the admin panel's writes go through studioChange, which is the one
// call every change in it makes so each ends with the same refreshed numbers.

import { S, api, say, render } from './main.js';

export async function loadPeople() {
  const res = await api('GET', '/api/users');
  if (res.ok) S.people = res.body;
}

/* Running the studio ------------------------------------------------------- */

// The panel's data, fetched when it opens and re-fetched after every change:
// the numbers in it — what somebody has spent today — are the server's to
// know, and stale ones would be worse than a moment's wait.
export async function loadStudio() {
  const res = await api('GET', '/api/admin/studio');
  if (!res.ok) {
    say(res.body?.error ?? 'Could not read the studio settings.', true);
    return false;
  }
  S.admin = res.body;
  return true;
}

// One call for every change the panel makes, so every one of them ends with
// the same refreshed numbers.
export async function studioChange(method, path, body) {
  const res = await api(method, `/api/admin${path}`, body);
  if (!res.ok) {
    say(res.body?.error ?? 'Could not do that.', true);
    return false;
  }
  await loadStudio();
  // A name may have changed, and it is on messages and in the crew list.
  await loadPeople();
  render();
  return true;
}
