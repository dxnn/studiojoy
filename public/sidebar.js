// The sidebar: one list at a time — games, chats or helpers — with the tabs
// that choose it, the box that filters it, and who is signed in.

import { h } from './dom.js';
import {
  S, render, prefs, api, openProject, SIDE_SEARCH, frozen,
} from './main.js';
import { attachAgent, mentionPerson, readMark } from './chats.js';
import { notifyState, toggleNotify, quietBell } from './notify.js';

/* Render: sidebar --------------------------------------------------------- */

// The wordmark: two words with the studio's little controller lying between
// them at the slash angle. Three empty spans and the stylesheet draws it — a
// d-pad and four buttons — so it scales with the type and needs no image. The
// d-pad's span is `.dpad` and not `.pad`, which is a padding utility the mark
// would otherwise inherit.
export const wordmark = (first, second) => [
  first,
  h('span', { class: 'mark' }, h('span', { class: 'dpad' }), h('span', { class: 'abxy' })),
  h('span', { class: 'b2', text: second }),
];

// One tab per list. The label says what the list is; what the button under the
// wordmark makes follows it, so "+ New chat" is never a click away from the
// chats it would join.
const TABS = [
  { id: 'games', label: 'Games' },
  { id: 'chats', label: 'Chats' },
  { id: 'crew', label: 'Crew' },
];

const NEW = {
  games: { label: '+ New game', dialog: { kind: 'new-project' } },
  chats: { label: '+ New chat', dialog: { kind: 'new-project', chat: true } },
  // The only half of the crew this button can make. A person is an account,
  // and accounts come from `npm run adduser` — see the note under the list.
  crew: { label: '+ New helper', dialog: { kind: 'new-agent' } },
};

// Choosing a list is also going back to where you were in it: Games returns to
// the game you last had open and Chats to the chat, which is what a tab called
// "Chats" looks like it does. Only when that project is still there and is
// still of that kind, and never when it is already on screen — clicking the
// tab you are on should not refetch what you are reading.
//
// ⚠️ The promise goes all the way up to the onclick: openProject's render is
// what writes the address, and a render that lands after the navigation is
// over writes the wrong one (see syncUrl).
const pickTab = (id) => {
  S.sideTab = id;
  prefs.set('side-tab', id);
  const back = prefs.get(`last-${id}`, null);
  const wanted = back && back !== S.slug
    ? S.projects.find((p) => p.slug === back)
    : null;
  const kind = id === 'chats' ? 'chat' : 'game';
  if (wanted && wanted.kind === kind) return openProject(back);
  render();
  return undefined;
};

export function renderSidebar() {
  const find = S.sideFind.trim().toLowerCase();
  const matches = (name) => !find || name.toLowerCase().includes(find);
  const make = NEW[S.sideTab];

  // Built fresh like everything else, but its text and caret are put back by
  // render()'s focus snapshot — a filter you are halfway through typing must
  // survive a helper's reply landing in the pane beside it.
  const search = h('input', {
    id: SIDE_SEARCH,
    type: 'search',
    placeholder: 'Search',
    'aria-label': `Search ${S.sideTab}`,
    oninput: (e) => { S.sideFind = e.currentTarget.value; render(); },
  });
  search.value = S.sideFind;

  const tabs = h('div', { class: 'side-tabs' },
    TABS.map(({ id, label }) => h('button', {
      class: S.sideTab === id ? 'on' : null,
      text: label,
      onclick: () => pickTab(id),
    })),
    h('div', { class: 'spacer' }),
    // Moved here off the wordmark's bar, which is what was holding the
    // wordmark off-centre.
    h('button', {
      class: 'collapse only-wide', text: '«', title: 'Hide this list',
      onclick: () => { S.sidebar = false; prefs.set('sidebar', 'closed'); render(); },
    }));

  return h('div', { class: `pane side${S.narrowPane === 'games' ? ' show' : ''}` },
    h('div', { class: 'bar brand-bar' },
      h('div', { class: 'brand' }, wordmark('UNBRIDLED', 'JOY'))),
    h('div', { class: 'pad' },
      h('button', {
        class: 'filled', style: 'width:100%',
        text: make.label,
        onclick: () => { S.dialog = { ...make.dialog }; render(); },
      })),
    announcementsRow(),
    h('div', { class: 'side-search' }, search),
    tabs,
    // Named per tab: three lists behind one scroller, and restoring the games
    // list's offset onto the helpers list would be somebody else's place.
    h('div', { class: 'scroll', 'data-scroll': `side-${S.sideTab}` },
      S.sideTab === 'games' ? gameRows(matches)
        : S.sideTab === 'chats' ? chatRows(matches)
          : crewRows(matches)),
    h('div', { class: 'who' },
      h('div', { class: 'avatar', text: (S.me.display_name ?? '?').trim().charAt(0).toUpperCase() }),
      // Your own settings — the alias, for now — behind your own name.
      h('button', {
        class: 'name', text: S.me.display_name,
        title: `Your settings. Scoreboards call you ${S.me.alias}.`,
        onclick: () => { S.dialog = { kind: 'me' }; render(); },
      }),
      bell(),
      h('button', {
        class: 'quiet tiny', text: 'Sign out',
        onclick: async () => { await api('POST', '/api/logout'); location.href = '/'; },
      })),
  );
}

// Whether the studio may tell you things while you are away — about you
// rather than about any game, which is why it is in the row that is also
// about you and nowhere else (ideas/notifications.md). Absent in a browser
// that cannot do it at all: a control that can never be pressed is left out.
// Blocked is still offered, because there the press has something to say, and
// so is an iPhone or iPad in a Safari tab, where it says to use the Home Screen.
const BELL = {
  on: { text: '🔔', title: 'The studio tells you when somebody says something. Press to stop.' },
  off: { text: '🔕', title: 'Tell me when somebody says something while I am away' },
  // Off in a browser that has said yes: the announcements still come.
  quiet: { text: '🔕', title: 'Only the announcements reach you while you are away. Press to hear everything.' },
  blocked: { text: '🔕', title: 'This browser is blocking notifications' },
  install: { text: '🔕', title: 'Add the studio to your Home Screen to be told things' },
};

function bell() {
  const state = notifyState();
  if (state === 'unsupported') return null;
  const { text, title } = BELL[quietBell() ? 'quiet' : state];
  return h('button', {
    class: `icon tiny bell${state === 'on' ? ' on' : ''}`,
    text,
    title,
    'aria-label': title,
    'aria-pressed': state === 'on' ? 'true' : 'false',
    onclick: toggleNotify,
  });
}

// Nothing found is not the same as nothing there: a filter that hides
// everything has to say it was the filter.
const nothing = (empty) => h('div', { class: 'pad muted', text: S.sideFind ? 'Nothing with that in its name.' : empty });

// Four groups, in the order you care about them: the games you are an author
// of, the ones anybody may work on, everyone else's — which you can read,
// play and talk about, and not change — and, at the end, the ones somebody
// has put away. A group with nothing in it says nothing: two headings over an
// empty studio is furniture.
//
// Archived is its own group rather than italic rows scattered through the
// other three, because that is what archiving a game means: it is not
// something you are looking for any more. It is `shut` — closed until you
// open it — for the same reason. The other three open unless you shut them.
const GAME_GROUPS = [
  { id: 'mine', label: 'Yours', of: (p) => p.mine },
  { id: 'open', label: 'Open to everyone', of: (p) => !p.mine && p.open_edit },
  { id: 'others', label: 'Everyone else’s', of: (p) => !p.mine && !p.open_edit },
  { id: 'archived', label: 'Archived', of: () => true, archived: true, shut: true },
];

// Whether a group is showing its rows. Remembered per browser, like the tab
// above it and the rail's width.
const groupOpen = (group) => prefs.get(`group-${group.id}`, group.shut ? 'closed' : 'open') === 'open';

// Within a group, the game that changed last comes first: a write to its tree
// or a change to its row, never a message (`updated_at`, spec/ §3) — the
// stream moves it as writes land. Ties keep the server's order, newest made
// first.
const byUpdated = (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at);

// The heading over a group. With a filter typed it is a plain label and every
// group is open: a filter that hides a match is a filter that lies, and a
// control that cannot do anything should not be offered. Otherwise the
// heading *is* the control — the same one, its caret flipped, rather than a
// second one appearing beside it — and it carries the count, because a
// collapsed group with no number on it is a question.
function groupHead(group, count) {
  if (S.sideFind) return h('div', { class: 'section-label', text: group.label });
  const open = groupOpen(group);
  return h('button', {
    class: `section-label group-head${open ? ' open' : ''}`,
    title: `${open ? 'Hide' : 'Show'} ${group.label.toLowerCase()}`,
    'aria-expanded': open ? 'true' : 'false',
    onclick: () => { prefs.set(`group-${group.id}`, open ? 'closed' : 'open'); render(); },
  },
  h('span', { class: 'caret', text: open ? '▾' : '▸' }),
  h('span', { class: 'glabel', text: group.label }),
  h('span', { class: 'gcount', text: String(count) }));
}

function gameRows(matches) {
  const all = S.projects.filter((p) => p.kind !== 'chat' && matches(p.name));
  // An archived game belongs to one group and it is the last one, whoever
  // made it: the three above are about what you may do to a game, and there
  // is nothing you may do to this one.
  const games = { live: all.filter((p) => !p.archived), archived: all.filter((p) => p.archived) };
  const row = (p) => h('button', {
    class: `item${p.slug === S.slug ? ' active' : ''}${p.archived ? ' archived' : ''}`,
    title: p.mine
      ? p.name
      : `${p.name} — ${p.authors.map((a) => a.display_name).join(', ') || 'Nobody'}`,
    onclick: () => { S.narrowPane = 'chat'; openProject(p.slug); },
  },
  h('div', { class: 'item-name' },
    // The game's own icon.png when it has one; no icon is simply no icon.
    S.icons.get(p.slug)
      ? h('img', { class: 'item-icon', src: S.icons.get(p.slug), alt: '' })
      : null,
    h('span', { class: 'iname', text: p.name }),
    readMark(p)),
  // Somebody else's game says whose: that is the thing you want to know
  // about a game you cannot change.
  h('div', {
    class: 'item-sub',
    text: p.mine
      ? (p.preview || 'No messages yet')
      : (p.authors.map((a) => a.display_name).join(', ') || 'Nobody'),
  }));

  const out = [];
  for (const group of GAME_GROUPS) {
    const found = (group.archived ? games.archived : games.live).filter(group.of).sort(byUpdated);
    if (found.length === 0) continue;
    out.push(groupHead(group, found.length));
    // Shut, the heading stands alone. Under a filter every group is open, so
    // nothing a search found can be hidden behind one.
    if (S.sideFind || groupOpen(group)) out.push(found.map(row));
  }
  return out.length ? out : nothing('No games yet. Make one!');
}

// The studio's announcements (spec/ §6): pinned over every tab and every
// filter, because it is the studio talking to everybody rather than one more
// conversation to look for. A row that opens on a click anywhere in it, like
// a game's. It lights up while something in it is unread, on top of the mark
// every row wears, so it does not read as just another busy room.
function announcementsRow() {
  const p = S.projects.find((x) => x.announce);
  if (!p) return null;
  const news = Boolean(p.mentions || p.unread);
  return h('button', {
    class: `item announce${p.slug === S.slug ? ' active' : ''}${news ? ' news' : ''}`,
    title: `${p.name} — what the studio says to everybody`,
    onclick: () => { S.narrowPane = 'chat'; return openProject(p.slug); },
  },
  h('div', { class: 'item-name' },
    h('span', { class: 'announce-mark', text: '📣', 'aria-hidden': 'true' }),
    h('span', { class: 'iname', text: p.name }),
    readMark(p)),
  h('div', { class: 'item-sub', text: p.preview || 'Nothing said yet' }));
}

// A chat is a game with the game taken out: the same thread and the same
// helpers, no files and no preview. The announcements are pinned above
// instead of listed here.
function chatRows(matches) {
  const rows = S.projects
    .filter((p) => p.kind === 'chat' && !p.announce && matches(p.name))
    .map((p) => h('div', { class: `srow${p.slug === S.slug ? ' sel' : ''}` },
      h('button', {
        class: 'hname', text: p.name, title: p.name,
        onclick: () => { S.narrowPane = 'chat'; openProject(p.slug); },
      }),
      readMark(p)));
  return rows.length ? rows : nothing('No chats yet. Start one with + New chat.');
}

// The crew is everyone in the studio, in two kinds: the people, then the
// helpers. Both belong to the studio rather than to one game, which is why
// they share a tab. A person's name is one thing to click: it drops "@Robin"
// into what you are typing, and whoever that is gets a mark on this game until
// they read it. Your own name is not — calling yourself is furniture. A name
// clicked with nowhere to write it answers rather than going dead: the row
// lights up, so it has to do something when it is pressed.
function crewRows(matches) {
  const people = S.people.filter((p) => matches(p.display_name));
  const helpers = helperRows(matches);
  return [
    h('div', { class: 'section-label', text: 'Humans' }),
    people.length
      ? people.map((p) => {
        const you = p.id === S.me.id;
        return h('div', { class: 'srow' },
          h('button', {
            class: 'hname',
            text: p.display_name,
            title: you ? 'You' : `Say something to ${p.display_name}`,
            disabled: you,
            onclick: () => mentionPerson(p),
          }),
          you ? h('span', { class: 'tag', text: 'you' }) : null);
      })
      : nothing('Nobody yet — accounts are made with npm run adduser.'),
    h('div', { class: 'section-label', text: 'Helpers' }),
    helpers,
    // Only an admin has anything to open here, so only an admin is offered it.
    // The server refuses the routes behind it either way.
    S.me.admin
      ? h('div', { class: 'pad' }, h('button', {
        class: 'quiet tiny', text: 'Studio settings',
        title: 'People, passwords and what each of them may spend',
        onclick: () => { S.dialog = { kind: 'studio' }; render(); },
      }))
      : null,
  ];
}

// Helpers belong to the studio, not to one game, so they live beside the game
// list. Which *chat* a helper is in is shown and changed in that chat: the
// dot here means the one on screen.
function helperRows(matches) {
  const attached = new Set((S.project?.agents ?? []).map((a) => a.agent_id));
  // Into a chat project's room and nowhere in a game: every room there is
  // the humans' or the Builder's (spec.md §3).
  const canAdd = S.project?.kind === 'chat' && !frozen();

  const rows = S.agents.filter((a) => matches(a.name)).map((agent) => {
    const here = attached.has(agent.id);
    return h('div', { class: `srow${here ? ' here' : ''}` },
      h('button', {
        class: 'hname',
        // A helper is in a conversation, not in a game, so the row is about
        // the chat on screen.
        title: here
          ? `${agent.name} is in this chat`
          : (canAdd ? `Put ${agent.name} in this chat` : agent.name),
        disabled: here || !canAdd,
        onclick: () => attachAgent(agent),
      }, here ? h('span', { class: 'dot', text: '●' }) : null, agent.name),
      h('button', {
        class: 'icon tiny', text: '✎', title: `Change ${agent.name}`,
        onclick: () => { S.dialog = { kind: 'edit-agent', agent }; render(); },
      }));
  });
  return rows.length ? rows : nothing('No helpers yet. Make one with + New helper.');
}
