// Telling somebody something happened while they were not looking
// (ideas/notifications.md, rung 1). The studio's tab is open behind something
// else, or its installed PWA is in the background; a message lands in a room
// nobody here is reading; the operating system shows a notification, and
// pressing it comes back to that conversation.
//
// It fires from exactly where the unread mark is set (`applyMessage` in
// stream.js): somebody other than you spoke, and you are not in that chat.
// That decision is already made in one place and it is already right, so this
// borrows it rather than writing a second one that could disagree.
//
// The app being closed altogether is rung 2 and wants a server: web push,
// VAPID and a subscription table. Nothing here is in its way.

import { S, prefs, openProject, render, say } from './main.js';
import { openChat } from './chats.js';

// A notification is one line, not a message. Long enough to know whether to
// go and look, short enough that the OS does not cut it somewhere unflattering.
const PREVIEW = 120;

// Whether the browser can do this at all. Checked rather than assumed: the
// studio runs in whatever a family has, and Notification is missing from more
// of them than one would think — an iOS PWA that has not been installed to
// the home screen included.
export const notifySupported = () => typeof Notification !== 'undefined';

// 'unsupported' | 'blocked' | 'on' | 'off'. `blocked` is the browser's answer
// and outranks the stored preference: a yes here under a denied permission is
// a switch that does nothing.
export function notifyState() {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  return prefs.get('notify', 'off') === 'on' ? 'on' : 'off';
}

// The press. ⚠️ It must be called from a real click: `requestPermission`
// is only allowed to ask from a gesture, and asked from anywhere else it
// resolves 'denied' without a prompt — which spends the one chance the
// browser gives, permanently.
export async function toggleNotify() {
  const state = notifyState();
  if (state === 'blocked') {
    // The one place the studio explains a control instead of hiding it: this
    // has a real answer, and somebody pressing a bell twice with nothing
    // happening deserves to hear it.
    say('This browser is blocking the studio from telling you things. '
      + 'Turn notifications back on for this site in its settings.', true);
    return;
  }
  if (state === 'on') {
    prefs.set('notify', 'off');
    render();
    return;
  }
  if (Notification.permission !== 'granted') {
    let asked = 'denied';
    try { asked = await Notification.requestPermission(); } catch { asked = 'denied'; }
    if (asked !== 'granted') { render(); return; }
  }
  prefs.set('notify', 'on');
  render();
  // So the first press shows what it bought rather than nothing at all.
  await show('The studio will tell you', {
    body: 'When somebody says something while you are away.',
    tag: 'notify-test',
  });
}

// A message landed somewhere you are not reading. Everything it needs is on
// the event already (§9), so nothing here asks the studio anything.
export function notifyMessage(data) {
  if (notifyState() !== 'on') return;
  // Only while nobody is looking. The *marks* on the game, the chat and its
  // pill are what the studio says while you are here; a notification over the
  // top of them is saying it twice, and louder.
  if (!document.hidden) return;
  const project = S.projects.find((p) => p.slug === data.project_slug);
  // A helper's name is the client's to look up; a person's arrives with the
  // message, because the studio has no user list of its own (§6).
  const who = data.user_name
    ?? S.agents.find((a) => a.id === data.agent_id)?.name
    ?? 'Somebody';
  const said = (data.body ?? '').trim().replace(/\s+/g, ' ');
  show(project?.name ?? 'The studio', {
    body: `${who}: ${said.length > PREVIEW ? `${said.slice(0, PREVIEW - 1)}…` : said}`,
    // One notification per conversation: a helper that says four things in a
    // row is one line that keeps changing, not four lines. `renotify` is what
    // keeps it audible while it is being replaced.
    tag: `${data.project_slug}:${data.chat_id ?? ''}`,
    data: { slug: data.project_slug, chat: data.chat_id ?? null },
  });
}

// ⚠️ Through the service worker's registration where there is one: the plain
// `new Notification` constructor never fires on an installed iOS PWA, and
// throws outright on Android Chrome. The constructor is the fallback for a
// browser with no worker registered, which is the studio over plain http in
// development.
//
// ⚠️ The icon is the studio's, never the open game's: this is the studio
// talking, the same reason the sidebar stays cyan whatever game is open.
async function show(title, options) {
  const opts = { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', renotify: true, ...options };
  try {
    const reg = navigator.serviceWorker?.controller
      ? await navigator.serviceWorker.ready
      : null;
    if (reg) { await reg.showNotification(title, opts); return; }
    const shown = new Notification(title, opts);
    shown.addEventListener('click', () => {
      window.focus();
      shown.close();
      goTo(opts.data);
    });
  } catch { /* a browser that will not show one is not an error to report */ }
}

// Pressed. From the worker it arrives as a message (the worker has already
// focused this tab); from the constructor above it is the click itself.
//
// ⚠️ The promise goes all the way up, the way every other opening does: a
// render that lands after the navigation writes the wrong address (§17).
function goTo(target) {
  if (!target?.slug) return Promise.resolve();
  if (target.slug !== S.slug) {
    return openProject(target.slug, { view: { chat: target.chat ?? undefined } });
  }
  return target.chat ? openChat(target.chat) : Promise.resolve();
}

// The worker's half of the press, installed once by start().
export function listenForNotifications() {
  navigator.serviceWorker?.addEventListener?.('message', (event) => {
    if (event.data?.type === 'notification') goTo(event.data);
  });
}
