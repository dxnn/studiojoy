// The sidebar: one list at a time — games, chats or helpers — with the tabs
// that choose it, the box that filters it, and who is signed in.

import { h } from './dom.js';
import {
  S, render, prefs, api, openProject, attachAgent, SIDE_SEARCH, frozen,
  mentionPerson, calledMark,
} from './main.js';

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

const pickTab = (id) => {
  S.sideTab = id;
  prefs.set('side-tab', id);
  render();
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
      h('div', { class: 'name', text: S.me.display_name }),
      h('button', {
        class: 'quiet tiny', text: 'Sign out',
        onclick: async () => { await api('POST', '/api/logout'); location.href = '/'; },
      })),
  );
}

// Nothing found is not the same as nothing there: a filter that hides
// everything has to say it was the filter.
const nothing = (empty) => h('div', { class: 'pad muted', text: S.sideFind ? 'Nothing with that in its name.' : empty });

// Three groups, in the order you care about them: the games you are an author
// of, the ones anybody may work on, and everyone else's — which you can read,
// play and talk about, and not change. A group with nothing in it says
// nothing: two headings over an empty studio is furniture.
const GAME_GROUPS = [
  { id: 'mine', label: 'Yours', of: (p) => p.mine },
  { id: 'open', label: 'Open to everyone', of: (p) => !p.mine && p.open_edit },
  { id: 'others', label: 'Everyone else’s', of: (p) => !p.mine && !p.open_edit },
];

function gameRows(matches) {
  const games = S.projects.filter((p) => p.kind !== 'chat' && matches(p.name));
  const row = (p) => h('button', {
    class: `item${p.slug === S.slug ? ' active' : ''}${p.archived ? ' archived' : ''}`,
    title: p.mine ? p.name : `${p.name} — ${p.authors.map((a) => a.display_name).join(', ')}`,
    onclick: () => { S.narrowPane = 'chat'; openProject(p.slug); },
  },
  h('div', { class: 'item-name' },
    h('span', { class: 'iname', text: p.name }),
    calledMark(p.mentions)),
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
    const rows = games.filter(group.of);
    if (rows.length === 0) continue;
    out.push(h('div', { class: 'section-label', text: group.label }), rows.map(row));
  }
  return out.length ? out : nothing('No games yet. Make one!');
}

// A chat is a game with the game taken out: the same thread and the same
// helpers, no files and no preview.
function chatRows(matches) {
  const rows = S.projects
    .filter((p) => p.kind === 'chat' && matches(p.name))
    .map((p) => h('div', { class: `srow${p.slug === S.slug ? ' sel' : ''}` },
      h('button', {
        class: 'hname', text: p.name, title: p.name,
        onclick: () => { S.narrowPane = 'chat'; openProject(p.slug); },
      }),
      calledMark(p.mentions)));
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
  const canAdd = Boolean(S.project) && !frozen();

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
