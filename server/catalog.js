import { escapeHtml } from './util/html.js';
import { SLOTS, shapeSvg } from '../public/gear-shapes.js';

// The games origin's two studio-authored pages: the catalog at `/` — the
// front door, and the one page there that is the studio's own rather than a
// game's — and a game's players page at `/:slug/_players`, everybody's scores
// and trophies for one game. Server-rendered whole — the list, the signed-in
// name, everything — because this origin serves no other studio asset and one
// self-contained page is the entire deployment.
//
// They wear the studio's look on purpose: the wordmark, the dark ground, the
// halftone and the hairline are lifted from public/css/ so the front
// door and the studio read as one place. Cyan is the studio's voice, crimson
// is JOY, and gold appears on scores — the board's, your own best — and on
// nothing else: a count of trophies is a number, not a score.
//
// Names and slugs are typed by people and these pages are served to the
// public: everything interpolated below goes through escapeHtml, and the
// client script writes only textContent.

// The dress both pages share — the palette, the ground, the hairline, the
// wordmark and the buttons. Each page adds its own rules after it.
const DRESS = `
  /* The studio's own dark, always: same ground, same halftone, same hairline
     as public/css/base.css and shell.css, so the front door matches the
     house. */
  :root {
    --bg: #15112b;
    --panel: #1a1436;
    --panel-3: #0d0a1c;
    --border: #2f2757;
    --text: #f2effe;
    --muted: #9a8fd0;
    --cyan: oklch(0.82 0.13 195);
    --cyan-hi: oklch(0.88 0.12 195);
    --ink: #0e1424;
    --red: oklch(0.76 0.19 22);
    --gold: oklch(0.85 0.15 95);
    --danger: oklch(0.72 0.19 20);
  }
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
    font: 16px/1.5 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    color: var(--text);
    background-color: var(--bg);
    background-image:
      radial-gradient(oklch(0.75 0.15 350 / 0.22) 1px, transparent 1px),
      radial-gradient(oklch(0.82 0.13 195 / 0.18) 1px, transparent 1px),
      linear-gradient(165deg, oklch(0.5 0.14 195 / 0.16), transparent 55%, oklch(0.5 0.16 340 / 0.18));
    background-size: 10px 10px, 10px 10px, 100% 100%;
    background-position: 0 0, 5px 5px, 0 0;
    background-attachment: fixed;
    display: flex;
    justify-content: center;
    padding: 0 20px 64px;
    -webkit-font-smoothing: antialiased;
  }
  .hairline {
    position: fixed; top: 0; left: 0; right: 0; height: 2px; z-index: 10;
    background: linear-gradient(90deg,
      oklch(0.82 0.13 195), oklch(0.75 0.15 350), oklch(0.68 0.2 20), oklch(0.85 0.15 95));
  }
  main { width: 100%; max-width: 760px; }
  header {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 30px 0 0;
  }
  header .space { flex: 1; }
  .me { color: var(--cyan-hi); font-weight: 600; }

  /* UNBRIDLED / JOY, exactly as the studio draws it: two words and the
     little controller lying between them at the slash angle — three empty
     spans, every measurement in em (see public/css/shell.css). */
  .brand {
    margin: 0;
    display: inline-flex; align-items: center; gap: 4px;
    font-weight: 700; font-size: min(34px, 7.6vw); line-height: 1;
    letter-spacing: -0.03em; color: var(--cyan-hi); white-space: nowrap;
  }
  .brand .b2 { color: var(--red); }
  a.home { text-decoration: none; }
  .mark {
    width: 1.34em; height: 0.84em; flex-shrink: 0; margin: 0 0.03em;
    border-radius: 0.29em;
    background: linear-gradient(160deg, #9a93ab, #6c6683);
    border: 1px solid #b4adc4;
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.4);
    transform: rotate(-60deg);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 0.11em;
  }
  .mark .dpad { position: relative; width: 0.43em; height: 0.43em; flex-shrink: 0; }
  .mark .dpad::before, .mark .dpad::after {
    content: ''; position: absolute; border-radius: 0.04em;
    background: oklch(0.82 0.13 195);
  }
  .mark .dpad::before { top: 0.148em; left: 0; width: 0.43em; height: 0.135em; }
  .mark .dpad::after { top: 0; left: 0.148em; width: 0.135em; height: 0.43em; }
  .mark .abxy {
    width: 0.375em; height: 0.375em; flex-shrink: 0;
    background-image:
      radial-gradient(circle at 22% 22%, oklch(0.85 0.15 95) 0.082em, transparent 0.086em),
      radial-gradient(circle at 78% 22%, oklch(0.72 0.19 22) 0.082em, transparent 0.086em),
      radial-gradient(circle at 22% 78%, oklch(0.78 0.15 350) 0.082em, transparent 0.086em),
      radial-gradient(circle at 78% 78%, oklch(0.72 0.16 265) 0.082em, transparent 0.086em);
  }

  button {
    background: transparent; color: var(--cyan);
    border: 1px solid color-mix(in oklab, var(--cyan) 55%, transparent);
    border-radius: 9px; padding: 6px 14px; cursor: pointer;
    font: inherit; font-weight: 600;
  }
  button:hover { background: var(--cyan); color: var(--ink); border-color: var(--cyan); }
  button.quiet { color: var(--muted); border-color: var(--border); }
  button.quiet:hover { background: transparent; color: var(--cyan); border-color: var(--cyan); }
  .note { margin: 26px 0 0; color: var(--muted); font-size: 14px; }
  .empty { color: var(--muted); margin: 26px 0 0; }
`;

const BRAND = '<h1 class="brand">UNBRIDLED<span class="mark"><span class="dpad"></span><span class="abxy"></span></span><span class="b2">JOY</span></h1>';

const HEAD = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#15112b">
<title>${title}</title>
<link rel="manifest" href="/_manifest.json">
<link rel="icon" href="/_icons/icon-192.png">
<link rel="apple-touch-icon" href="/_icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Unbridled Joy">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">`;

const num = (n) => n.toLocaleString('en-US');
const has = (n) => n !== null && n !== undefined;

// A card: the game's name with its icon.png before it when it has one, its
// hero.png behind when it has that (the `hero` class and `--hero` variable
// are load-bearing — tests assert them), and its numbers stacked at the right: the board's best score in gold when the game
// keeps one, and — signed in — your own best and your trophies against what
// the game defines (ideas/front-page-players.md, rung 1) — and, in gold too,
// the joy still there to earn in it (server/joy.js). Under the card, the link
// to everybody's: its own control, because the whole card opens the game.
// Whoever made a game, as their avatar (server/gear.js): a head, a body and
// legs, each a piece of gear's picture over the bare shape, or the bare shape
// alone, with their alias on hover — the games origin says no name.
const BARE = '#5b5486';
const part = (m, slot) => (m[slot]
  ? `<img class="${slot}" src="/_gear/${Number(m[slot])}" style="background-image:url('${shapeSvg(slot, BARE)}')" alt="">`
  : `<img class="${slot}" src="${shapeSvg(slot, BARE)}" alt="">`);
const figure = (m) => (m
  ? `<span class="maker" title="made by ${escapeHtml(m.alias ?? '')}">${SLOTS.map((slot) => part(m, slot)).join('')}</span>`
  : '');

const card = (g) => {
  const slug = escapeHtml(g.slug);
  const hero = g.hero ? ` class="hero" style="--hero:url('/${slug}/hero.png')"` : '';
  const icon = g.icon ? `<img class="badge" src="/${slug}/icon.png" alt="">` : '';
  const nums = [
    has(g.top) ? `<span class="top"><small>top score</small> ${num(g.top)}</span>` : '',
    has(g.best) ? `<span class="best"><small>your best</small> ${num(g.best)}</span>` : '',
    g.achievements ? `<span class="got"><small>★</small> ${g.achievements.got} of ${g.achievements.of}</span>` : '',
    has(g.joy) ? `<span class="joy"><small>joy to earn</small> ${num(g.joy)}</span>` : '',
  ].join('');
  return `<li><a href="/${slug}/"${hero}>${figure(g.maker)}<span class="name">${icon}${escapeHtml(g.name)}</span>`
    + `${nums ? `<span class="nums">${nums}</span>` : ''}</a>`
    + `<a class="players" href="/${slug}/_players">Scores &amp; trophies</a></li>`;
};

export function catalogPage({ games, player = null }) {
  const joy = player && player.joy ? ` <span class="joy">${num(player.joy)} <small>joy</small></span>` : '';
  const who = player
    ? `<span class="me">${escapeHtml(player.alias)}</span>${joy}
      <button id="signout" class="quiet">Sign out</button>`
    : `<button id="signin-go">Sign in</button>
      <button id="join-go" class="quiet">Ask to join</button>`;

  const cards = games.map(card).join('\n      ');

  // Signed in, the two forms have no button to open them, so they are not on
  // the page at all — and the script's lookups are all optional for the same
  // reason.
  const dialogs = player ? '' : `<dialog id="signin">
    <form method="dialog">
      <h2>Sign in</h2>
      <label for="si-email">Email</label>
      <input id="si-email" type="email" autocomplete="email" required>
      <label for="si-pass">Password</label>
      <input id="si-pass" type="password" autocomplete="current-password" required>
      <p class="err" id="si-err"></p>
      <div class="row">
        <button type="button" class="quiet" data-close>Cancel</button>
        <button type="submit">Sign in</button>
      </div>
    </form>
  </dialog>

  <dialog id="signup">
    <form method="dialog">
      <h2>Ask to join</h2>
      <p class="hint">Only the studio sees your name. The scoreboards show an alias instead — ask whoever lets you in for the one you want.</p>
      <label for="su-name">Your name</label>
      <input id="su-name" maxlength="100" required>
      <label for="su-email">Email</label>
      <input id="su-email" type="email" autocomplete="email" required>
      <label for="su-pass">Pick a password</label>
      <input id="su-pass" type="password" autocomplete="new-password" minlength="6" required>
      <p class="err" id="su-err"></p>
      <div class="row">
        <button type="button" class="quiet" data-close>Cancel</button>
        <button type="submit">Ask to join</button>
      </div>
    </form>
  </dialog>

  <dialog id="waiting">
    <h2>You're on the list!</h2>
    <p class="hint">One of the studio's admins will let you in. Come back and sign in once they have.</p>
    <div class="row"><button data-close>OK</button></div>
  </dialog>`;

  return `${HEAD('Unbridled Joy')}
<style>${DRESS}
  .tag { margin: 6px 0 0; color: var(--muted); }

  ul {
    list-style: none; padding: 0; margin: 26px 0 0;
    display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
  ul a:not(.players) {
    display: flex; align-items: flex-end; justify-content: space-between; gap: 10px;
    min-height: 84px; padding: 14px 16px;
    border: 1px solid var(--border); border-radius: 12px;
    /* ⚠️ background-color, never the background shorthand: the shorthand
       resets background-image to none, and the hero rule below has to be
       able to set one. */
    background-color: var(--panel);
    text-decoration: none; color: var(--text); font-weight: 600; font-size: 18px;
  }
  ul a:not(.players):hover {
    border-color: var(--cyan);
    box-shadow: 0 0 20px color-mix(in oklab, var(--cyan) 28%, transparent);
  }
  /* A game's hero picture fills its card under a dark wash, so the name
     stays legible whatever the picture is.
     ⚠️ "ul a.hero", not "a.hero": the plain card above is "ul a:not(.players)"
     and :not() carries its argument's weight, so a bare "a.hero" loses to it
     on every property they share. That is how the hero pictures vanished the
     day the players link arrived — the class and the variable were right, and
     nothing painted. */
  ul a.hero {
    min-height: 136px;
    background-image:
      linear-gradient(rgba(10, 8, 18, 0.12), rgba(10, 8, 18, 0.66)),
      var(--hero);
    background-size: cover; background-position: center;
  }
  .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  /* The game's icon before its name, the size the sidebar wears it plus a
     little, since a card is bigger than a row. */
  .badge { width: 28px; height: 28px; border-radius: 7px; vertical-align: -8px; margin-right: 10px; }
  /* Whoever made it, a head over a body over legs, pixels kept square. */
  .maker { flex: 0 0 auto; display: flex; flex-direction: column; margin-right: 12px; }
  .maker img { display: block; width: 20px; height: auto; image-rendering: pixelated; background-size: 100% 100%; }
  /* The numbers, stacked at the card's foot: scores in gold, the trophy count
     in the page's own ink, because a count is a number but not a score. */
  .nums { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
  .top, .best, .joy { color: var(--gold); font-weight: 700; white-space: nowrap; font-size: 15px; }
  .got { color: var(--text); font-weight: 600; white-space: nowrap; font-size: 13px; }
  .nums small { color: var(--muted); font-weight: 500; font-size: 12px; margin-right: 4px; }
  /* Under the card, the way to everybody's numbers: a link, because it looks
     at something, and its own control, because the card is the game's. */
  a.players { display: inline-block; margin: 6px 0 0 4px; font-size: 13px; color: var(--muted); text-decoration: none; }
  a.players:hover { color: var(--cyan); }

  dialog {
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 14px;
    padding: 22px; width: min(92vw, 360px);
  }
  dialog::backdrop { background: rgba(8, 6, 16, 0.65); }
  dialog h2 { margin: 0; font-size: 20px; }
  dialog .hint { margin: 6px 0 0; color: var(--muted); font-size: 14px; }
  label { display: block; margin: 14px 0 4px; font-size: 13px; color: var(--muted); }
  input {
    width: 100%; background: var(--panel-3); color: var(--text);
    border: 1px solid var(--border); border-radius: 9px;
    padding: 8px 10px; font: inherit;
  }
  input:focus { outline: none; border-color: var(--cyan); }
  .err { color: var(--danger); font-size: 14px; min-height: 1.3em; margin: 12px 0 0; }
  .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
</style>
</head>
<body>
  <div class="hairline"></div>
  <main>
    <header>
      ${BRAND}
      <span class="space"></span>
      ${who}
    </header>
    <p class="tag">Games made by us. Click one and play it.</p>
    ${games.length ? `<ul>\n      ${cards}\n    </ul>` : '<p class="empty">No games yet.</p>'}
    ${player ? '' : '<p class="note">Sign in and every score you get goes on the board under your alias — and each game here says how you are doing.</p>'}
  </main>

  ${dialogs}

  <script>
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/_sw.js');
    const $ = (id) => document.getElementById(id);
    const post = async (path, body) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      let data = null;
      try { data = await res.json(); } catch {}
      return { ok: res.ok, error: data && data.error };
    };
    for (const b of document.querySelectorAll('[data-close]')) {
      b.addEventListener('click', () => b.closest('dialog').close());
    }
    const open = (id) => { const d = $(id); d.returnValue = ''; d.showModal(); };
    $('signin-go')?.addEventListener('click', () => open('signin'));
    $('join-go')?.addEventListener('click', () => open('signup'));
    $('signout')?.addEventListener('click', async () => {
      await post('/_logout', {});
      location.reload();
    });
    $('signin')?.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { ok, error } = await post('/_login', {
        email: $('si-email').value, password: $('si-pass').value,
      });
      if (ok) return location.reload();
      $('si-err').textContent = error || 'That did not work — try again.';
    });
    $('signup')?.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { ok, error } = await post('/_signup', {
        name: $('su-name').value, email: $('su-email').value, password: $('su-pass').value,
      });
      if (!ok) { $('su-err').textContent = error || 'That did not work — try again.'; return; }
      $('signup').close();
      open('waiting');
    });
  </script>
</body>
</html>
`;
}

// A game's players page: everybody's numbers for one game, the answer to
// "who else has played this?" (ideas/front-page-players.md, rung 2). Three
// lists — one personal best per person, the trophies with who holds each, and
// under those the board's top 100: the people first, because a hundred runs
// is a long way to scroll to find out how your friends are doing — and the
// viewer's own rows marked, which is the only thing the player cookie does
// here. `board` and `bests` arrive empty when
// the game's scoreboard is switched off, so the page says nothing about
// scores then; the trophies stay, because earned is forever. Static and
// scriptless: nothing on it changes without a reload.
export function playersPage({
  game, player = null, board = [], bests = [], achievements = [],
}) {
  const slug = escapeHtml(game.slug);
  const name = escapeHtml(game.name);
  const mine = (userId) => (player && userId === player.id ? ' class="me"' : '');
  const rows = (list) => list.map((r, i) => `<li${mine(r.user_id)}>`
    + `<span class="rank">${i + 1}</span><span class="who">${escapeHtml(r.name)}</span>`
    + `<span class="score">${num(r.score)}</span></li>`).join('\n      ');
  const trophies = achievements.map((a) => `<li${a.mine ? ' class="got"' : ''}>`
    + `<span class="icon">${a.icon ? escapeHtml(a.icon) : '★'}</span>`
    + `<span class="what"><span class="tname">${escapeHtml(a.name)}</span>`
    + `${a.how ? `<span class="how">${escapeHtml(a.how)}</span>` : ''}</span>`
    + `${a.joy ? `<span class="joy">${num(a.joy)} <small>joy</small></span>` : ''}`
    + `<span class="holders">${a.names.length ? a.names.map(escapeHtml).join(', ') : '<em>nobody yet</em>'}</span></li>`)
    .join('\n      ');

  const sections = [
    bests.length
      ? `<section><h3>Personal bests</h3><ol class="board">\n      ${rows(bests)}\n    </ol></section>`
      : '',
    achievements.length
      ? `<section><h3>Trophies</h3><ul class="trophies">\n      ${trophies}\n    </ul></section>`
      : '',
    board.length
      ? `<section><h3>Top 100</h3><ol class="board">\n      ${rows(board)}\n    </ol></section>`
      : '',
  ].filter(Boolean);

  return `${HEAD(`${name} — who's playing`)}
<style>${DRESS}
  h2.game { margin: 22px 0 0; font-size: 26px; line-height: 1.2; }
  h2.game a { color: var(--text); text-decoration: none; }
  h2.game a:hover { color: var(--cyan-hi); }
  .tag { margin: 4px 0 0; color: var(--muted); }
  section { margin-top: 28px; }
  h3 { margin: 0 0 8px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  ol.board, ul.trophies { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); overflow: hidden; }
  ol.board li, ul.trophies li { display: flex; align-items: baseline; gap: 12px; padding: 9px 14px; border-top: 1px solid var(--border); }
  ol.board li:first-child, ul.trophies li:first-child { border-top: none; }
  /* Your own rows in the studio's voice: cyan is the studio talking to you. */
  li.me, li.got { background: color-mix(in oklab, var(--cyan) 12%, transparent); }
  li.me .who, li.got .tname { color: var(--cyan-hi); }
  .rank { flex: 0 0 2.2em; color: var(--muted); font-variant-numeric: tabular-nums; }
  .who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  /* Gold is a number worth looking at — a score, and the joy a trophy gives
     — and nothing else on this page. */
  .score, .joy { color: var(--gold); font-weight: 700; font-variant-numeric: tabular-nums; }
  .joy { flex: 0 0 auto; white-space: nowrap; }
  .icon { flex: 0 0 1.6em; font-size: 18px; text-align: center; }
  .what { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .tname { font-weight: 600; }
  .how { color: var(--muted); font-size: 13px; }
  .holders { flex: 0 1 45%; text-align: right; font-size: 14px; color: var(--text); }
  .holders em { color: var(--muted); font-style: normal; }
</style>
</head>
<body>
  <div class="hairline"></div>
  <main>
    <header>
      <a class="home" href="/">${BRAND}</a>
      <span class="space"></span>
      ${player ? `<span class="me">${escapeHtml(player.alias)}</span>` : ''}
    </header>
    <h2 class="game"><a href="/${slug}/">${name}</a></h2>
    <p class="tag">Everyone who has played, and how they did.</p>
    ${sections.length ? sections.join('\n    ') : '<p class="empty">Nothing to show yet — nobody has played, or the game keeps no scores.</p>'}
    ${player ? '' : '<p class="note">Sign in on the front page and your own rows are marked here.</p>'}
  </main>
</body>
</html>
`;
}
