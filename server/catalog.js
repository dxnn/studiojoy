import { escapeHtml } from './util/html.js';

// The catalog page: the games origin's front door, and the one page there
// that is the studio's own rather than a game's. Server-rendered whole —
// the list, the signed-in name, everything — because this origin serves no
// other studio asset and one self-contained page is the entire deployment.
//
// It wears the studio's look on purpose: the wordmark, the dark ground, the
// halftone and the hairline are lifted from public/style.css so the front
// door and the studio read as one place. Cyan is the studio's voice, crimson
// is JOY, and gold appears on scores — the board's top and your own best —
// and on nothing else: a count of trophies is a number, not a score.
//
// Names and slugs are typed by people and this page is served to the public:
// everything interpolated below goes through escapeHtml, and the client
// script writes only textContent.

// A card: the game's name, its hero.png when it has one (the `hero` class
// and `--hero` variable are load-bearing — tests assert them), and its
// numbers stacked at the right: the board's best score in gold when the game
// keeps one, and — signed in — your own best and your trophies against what
// the game defines (ideas/front-page-players.md, rung 1).
const card = (g) => {
  const slug = escapeHtml(g.slug);
  const hero = g.hero ? ` class="hero" style="--hero:url('/${slug}/hero.png')"` : '';
  const num = (n) => n.toLocaleString('en-US');
  const has = (n) => n !== null && n !== undefined;
  const nums = [
    has(g.top) ? `<span class="top"><small>top score</small> ${num(g.top)}</span>` : '',
    has(g.best) ? `<span class="best"><small>your best</small> ${num(g.best)}</span>` : '',
    g.achievements ? `<span class="got"><small>★</small> ${g.achievements.got} of ${g.achievements.of}</span>` : '',
  ].join('');
  return `<li><a href="/${slug}/"${hero}><span class="name">${escapeHtml(g.name)}</span>`
    + `${nums ? `<span class="nums">${nums}</span>` : ''}</a></li>`;
};

export function catalogPage({ games, player = null }) {
  const who = player
    ? `<span class="me">${escapeHtml(player.display_name)}</span>
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
      <p class="hint">Your name is what the scoreboards will show.</p>
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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#15112b">
<title>Unbridled Joy</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* The studio's own dark, always: same ground, same halftone, same hairline
     as public/style.css, so the front door matches the house. */
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
     spans, every measurement in em (see public/style.css). */
  .brand {
    margin: 0;
    display: inline-flex; align-items: center; gap: 4px;
    font-weight: 700; font-size: min(34px, 7.6vw); line-height: 1;
    letter-spacing: -0.03em; color: var(--cyan-hi); white-space: nowrap;
  }
  .brand .b2 { color: var(--red); }
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

  .tag { margin: 6px 0 0; color: var(--muted); }
  .note { margin: 26px 0 0; color: var(--muted); font-size: 14px; }

  ul {
    list-style: none; padding: 0; margin: 26px 0 0;
    display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
  ul a {
    display: flex; align-items: flex-end; justify-content: space-between; gap: 10px;
    min-height: 84px; padding: 14px 16px;
    border: 1px solid var(--border); border-radius: 12px;
    background: var(--panel);
    text-decoration: none; color: var(--text); font-weight: 600; font-size: 18px;
  }
  ul a:hover {
    border-color: var(--cyan);
    box-shadow: 0 0 20px color-mix(in oklab, var(--cyan) 28%, transparent);
  }
  /* A game's hero picture fills its card under a dark wash, so the name
     stays legible whatever the picture is. */
  a.hero {
    min-height: 136px;
    background-image:
      linear-gradient(rgba(10, 8, 18, 0.12), rgba(10, 8, 18, 0.66)),
      var(--hero);
    background-size: cover; background-position: center;
  }
  .name { overflow: hidden; text-overflow: ellipsis; }
  /* The numbers, stacked at the card's foot: scores in gold, the trophy count
     in the page's own ink, because a count is a number but not a score. */
  .nums { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
  .top, .best { color: var(--gold); font-weight: 700; white-space: nowrap; font-size: 15px; }
  .got { color: var(--text); font-weight: 600; white-space: nowrap; font-size: 13px; }
  .nums small { color: var(--muted); font-weight: 500; font-size: 12px; margin-right: 4px; }
  .empty { color: var(--muted); margin: 26px 0 0; }

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
      <h1 class="brand">UNBRIDLED<span class="mark"><span class="dpad"></span><span class="abxy"></span></span><span class="b2">JOY</span></h1>
      <span class="space"></span>
      ${who}
    </header>
    <p class="tag">Games made by us. Click one and play it.</p>
    ${games.length ? `<ul>\n      ${cards}\n    </ul>` : '<p class="empty">No games yet.</p>'}
    ${player ? '' : '<p class="note">Sign in and every score you get goes on the board under your name — and each game here says how you are doing.</p>'}
  </main>

  ${dialogs}

  <script>
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
