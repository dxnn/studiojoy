// The sidebar: the game list, the two foldable sections under it — chats and
// helpers — and who is signed in.

import { h } from './dom.js';
import { S, render, prefs, api, openProject, attachAgent } from './main.js';

/* Render: sidebar --------------------------------------------------------- */

// The header of a foldable section. The marker is the affordance; the whole
// label is the hit area, because a 12px triangle is not one.
function sectionHead(id, label, add) {
  const open = S.sections[id];
  return h('div', { class: 'section-label row' },
    h('button', {
      class: 'sec-toggle',
      text: `${open ? '▾' : '▸'} ${label}`,
      title: open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`,
      onclick: () => {
        S.sections[id] = !open;
        prefs.set(`sec-${id}`, open ? 'closed' : 'open');
        render();
      },
    }),
    h('div', { class: 'spacer' }),
    add ? h('button', { class: 'icon tiny', text: '+', title: add.title, onclick: add.onclick }) : null);
}

export function renderSidebar() {
  const rows = S.projects.filter((p) => p.kind !== 'chat').map((p) => h('button', {
    class: `item${p.slug === S.slug ? ' active' : ''}${p.archived ? ' archived' : ''}`,
    onclick: () => { S.narrowPane = 'chat'; openProject(p.slug); },
  },
  h('div', { class: 'item-name', text: p.name }),
  h('div', { class: 'item-sub', text: p.preview || 'No messages yet' })));

  return h('div', { class: `pane side${S.narrowPane === 'games' ? ' show' : ''}` },
    h('div', { class: 'bar brand-bar' },
      h('div', { class: 'brand', text: 'Game Studio' }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'icon only-wide', text: '«', title: 'Hide this list',
        onclick: () => { S.sidebar = false; prefs.set('sidebar', 'closed'); render(); },
      })),
    h('div', { class: 'pad' },
      h('button', {
        class: 'filled', style: 'width:100%',
        text: '+ New game',
        onclick: () => { S.dialog = { kind: 'new-project' }; render(); },
      })),
    h('div', { class: 'section-label', text: 'Games' }),
    h('div', { class: 'scroll', 'data-scroll': 'games' },
      rows.length ? rows : h('div', { class: 'pad muted', text: 'No games yet. Make one!' })),
    renderChatList(),
    renderHelperList(),
    h('div', { class: 'who' },
      h('div', { class: 'name', text: S.me.display_name }),
      h('button', {
        class: 'quiet tiny', text: 'Sign out',
        onclick: async () => { await api('POST', '/api/logout'); location.href = '/'; },
      })),
  );
}

// A chat is a game with the game taken out: the same thread and the same
// helpers, no files and no preview.
function renderChatList() {
  const chats = S.projects.filter((p) => p.kind === 'chat');
  const head = sectionHead('chats', 'Chats', {
    title: 'Start a new chat',
    onclick: () => { S.dialog = { kind: 'new-project', chat: true }; render(); },
  });
  if (!S.sections.chats) return [head];

  const rows = chats.map((p) => h('div', { class: `srow${p.slug === S.slug ? ' sel' : ''}` },
    h('button', {
      class: 'hname', text: p.name, title: p.name,
      onclick: () => { S.narrowPane = 'chat'; openProject(p.slug); },
    })));

  return [head, h('div', { class: 'small-list' },
    rows.length
      ? rows
      : h('div', { class: 'pad hint muted', text: 'No chats yet. Start one with +.' }))];
}

// Helpers belong to the studio, not to one game, so they live beside the game
// list. Which game a helper is *in* is shown and changed in that game's title
// bar instead.
function renderHelperList() {
  const attached = new Set((S.project?.agents ?? []).map((a) => a.agent_id));
  const canAdd = Boolean(S.project) && !S.project.archived;

  const rows = S.agents.map((agent) => {
    const here = attached.has(agent.id);
    return h('div', { class: `srow${here ? ' here' : ''}` },
      h('button', {
        class: 'hname',
        title: here
          ? `${agent.name} is in this game`
          : (canAdd ? `Put ${agent.name} in this game` : agent.name),
        disabled: here || !canAdd,
        onclick: () => attachAgent(agent),
      }, here ? h('span', { class: 'dot', text: '●' }) : null, agent.name),
      h('button', {
        class: 'icon tiny', text: '✎', title: `Change ${agent.name}`,
        onclick: () => { S.dialog = { kind: 'edit-agent', agent }; render(); },
      }));
  });

  const head = sectionHead('helpers', 'Helpers', {
    title: 'Make a new helper',
    onclick: () => { S.dialog = { kind: 'new-agent' }; render(); },
  });
  if (!S.sections.helpers) return [head];

  return [head, h('div', { class: 'small-list' },
    rows.length
      ? rows
      : h('div', { class: 'pad hint muted', text: 'No helpers yet. Make one with +.' }))];
}
