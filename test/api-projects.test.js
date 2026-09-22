import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  setup, signIn, startGames,
} from './helpers.js';
import { isRepo, logCommits } from '../server/files/git.js';
import { parseConfigFile } from '../public/config-file.js';

async function studio(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  return app;
}

test('creating a project makes a working tree with a repo behind it', async (t) => {
  const app = await studio(t);
  const res = await app.client.json('POST', '/api/projects', {
    body: { name: 'Tank Game' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.slug, 'tank-game');
  assert.equal(res.body.name, 'Tank Game');
  assert.equal(res.body.archived, false);
  // A blank page is a free-form game: no type, so no editors in the centre.
  assert.equal(res.body.type, null);

  const dir = path.join(app.gamesDir, 'tank-game');
  assert.equal(fs.existsSync(dir), true, 'the working tree exists');
  assert.equal(await isRepo(dir), true, 'and it is its own repository');

  // The empty initial commit is what makes `git log` safe on a new project.
  const commits = await logCommits(dir);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'init tank-game');
  assert.equal(commits[0].author, 'Dann');
});

// Against the real public/, unlike the rest of the suite, whose fixture
// offers no libraries: this is the one test of what creation scaffolds.
test('a new game is born holding the studio library', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });

  const dir = path.join(app.gamesDir, 'tank');
  const index = JSON.parse(
    fs.readFileSync(path.join(publicDir, 'studio-lib', 'index.json'), 'utf8'),
  );
  // The core set is what a blank game is born with, version and all; the
  // extras are libraries.test.js's.
  const core = Object.entries(index.libraries).filter(([, l]) => l.core);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'studio/studio.json'), 'utf8'));
  assert.deepEqual(manifest, Object.fromEntries(core.map(([n, l]) => [n, l.version])));
  // Nobody picked, so the library's own seed wrote it: the null controller,
  // which draws nothing over a game that has not grown controls yet.
  assert.deepEqual(
    fs.readFileSync(path.join(dir, 'config/controls.js')),
    fs.readFileSync(path.join(publicDir, 'templates/controls-none.js')),
  );
  // Every file each library declares, byte for byte — the screens library
  // carries its own typefaces, and a .woff2 that came through a text read
  // would be a game with no type and no error to say why.
  for (const [name, library] of core) {
    for (const file of library.files) {
      assert.deepEqual(
        fs.readFileSync(path.join(dir, 'studio', file)),
        fs.readFileSync(path.join(publicDir, 'studio-lib', name, file)),
        `studio/${file}`,
      );
    }
  }

  const commits = await logCommits(dir);
  assert.equal(commits.length, 3);
  assert.equal(commits[0].subject, 'a page to start from');
  assert.equal(commits[1].subject, 'set up the studio library');
  assert.equal(commits[2].subject, 'init tank');

  const res = await app.client.json('GET', '/api/projects/tank');
  const byPath = Object.fromEntries(res.body.files.map((f) => [f.path, f]));
  assert.equal(byPath['studio/input.js'].library, true, 'listed as a library file');
  assert.equal(byPath['config/controls.js'].library, undefined, 'the seed is the game\'s own');
});

// Also against the real public/: a game made without a template gets one page
// carrying its name, which is the difference between a playable link and
// `{"error":"not found"}` from the minute it is made.
test('a game made from a blank page is playable straight away', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);
  const games = await startGames(app);
  t.after(() => games.close());

  // A name that would break the page if it went in unescaped.
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Tank & <Chips>', slug: 'tank' },
  });

  const played = await games.client.request('GET', '/tank/');
  assert.equal(played.status, 200);
  const markup = await played.text();
  assert.match(markup, /<title>Tank &amp; &lt;Chips&gt;<\/title>/);
  assert.match(markup, /<h1>Tank &amp; &lt;Chips&gt;<\/h1>/);
  assert.doesNotMatch(markup, /\{\{name\}\}/);

  // The page loads every library the game was born holding, the same way the
  // quiz template's does — so a newborn game is not one tag short of Sound.
  // The input module included: it used to be left out, because on a phone it
  // drew a stick and buttons over "Nothing here yet", and the null
  // controller is what answers that instead now.
  const index = JSON.parse(
    fs.readFileSync(path.join(publicDir, 'studio-lib', 'index.json'), 'utf8'),
  );
  for (const library of Object.values(index.libraries).filter((l) => l.core)) {
    for (const src of library.scripts) assert.ok(markup.includes(`<script src="${src}">`), src);
  }
  // And config/controls.js stands in front of studio/input.js, which is the
  // order that file is read in.
  assert.ok(
    markup.indexOf('config/controls.js') < markup.indexOf('studio/input.js'),
    'the bindings load before the library that reads them',
  );

  // A brief goes with the page, the way every template ships one. It is the
  // only place that says which tags this particular page carries, and that
  // the control scheme is a decision somebody made rather than a default.
  const brief = fs.readFileSync(path.join(app.gamesDir, 'tank', 'BRIEF.md'), 'utf8');
  assert.match(brief, /started from a blank page/);
  assert.match(brief, /chosen when the game was made/);
  assert.match(brief, /"none"/);
  assert.match(brief, /"one-button"/);
  // Escaped for the page, never for the brief: the substitution is HTML.
  assert.ok(!brief.includes('&amp;'), 'no html escaping in markdown');
});

// Also against the real public/: templates are starter trees, and this pins
// down what starting from one actually copies and commits.
test('a game born from the quiz template holds its starter tree', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);

  const res = await app.client.json('POST', '/api/projects', {
    body: { name: 'Quizzy', template: 'quiz' },
  });
  assert.equal(res.status, 201);
  // The template's key is the game's type from here on.
  assert.equal(res.body.type, 'quiz');

  const dir = path.join(app.gamesDir, 'quizzy');
  const templateRoot = path.join(publicDir, 'game-templates', 'quiz');
  for (const f of ['BRIEF.md', 'SPEC.md', 'index.html', 'css/style.css',
    'config/look.js', 'config/questions.js', 'config/words.js', 'js/quiz.js',
    'assets/sounds/pick.wav']) {
    assert.deepEqual(
      fs.readFileSync(path.join(dir, f)),
      fs.readFileSync(path.join(templateRoot, f)),
      `${f} is copied whole`,
    );
  }

  // init, the library scaffold, then the template — three commits.
  const commits = await logCommits(dir);
  assert.equal(commits.length, 3);
  assert.equal(commits[0].subject, 'start from the quiz template');

  // The template's page already loads every library the game was born
  // holding, so a newborn shows no Update offers.
  const index = JSON.parse(
    fs.readFileSync(path.join(publicDir, 'studio-lib', 'index.json'), 'utf8'),
  );
  const markup = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  for (const library of Object.values(index.libraries).filter((l) => l.core)) {
    for (const src of library.scripts) assert.ok(markup.includes(src), src);
  }

  // The heart stays inside the plain-value subset the forms can open.
  const parsed = parseConfigFile(fs.readFileSync(path.join(dir, 'config/questions.js'), 'utf8'));
  assert.equal(parsed.ok, true, parsed.reason);
});

// The second template, and the one whose tree is mostly bytes: the point of
// copying server-side is that pictures and sounds survive it.
test('a game born from the visual novel template holds its starter tree', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);

  const res = await app.client.json('POST', '/api/projects', {
    body: { name: 'Nightfall', template: 'visual-novel' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.type, 'visual-novel');

  const dir = path.join(app.gamesDir, 'nightfall');
  const templateRoot = path.join(publicDir, 'game-templates', 'visual-novel');
  for (const f of ['BRIEF.md', 'SPEC.md', 'index.html', 'css/style.css',
    'config/look.js', 'config/story.js', 'config/words.js', 'js/story.js']) {
    assert.deepEqual(
      fs.readFileSync(path.join(dir, f)),
      fs.readFileSync(path.join(templateRoot, f)),
      `${f} is copied whole`,
    );
  }
  // Born empty of art and of story: the guide asks for both, and the example
  // is one click in it. The pictures live studio-side, in public/story-art.
  assert.equal(fs.existsSync(path.join(dir, 'assets')), false, 'no art in the tree');

  const commits = await logCommits(dir);
  assert.equal(commits.length, 3);
  assert.equal(commits[0].subject, 'start from the visual-novel template');

  // The heart stays inside the plain-value subset the forms can open, so the
  // story editor has something to open and the config form is the fallback.
  const parsed = parseConfigFile(fs.readFileSync(path.join(dir, 'config/story.js'), 'utf8'));
  assert.equal(parsed.ok, true, parsed.reason);
  assert.deepEqual(parsed.decls.map((d) => d.name), ['CAST', 'SCENES']);
});

// The adventure: the same shape as the visual novel, empty and pictureless at
// birth, with the pointer as its control.
test('a game born from the adventure template holds its starter tree', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);

  const res = await app.client.json('POST', '/api/projects', {
    body: { name: 'Key Hunt', template: 'adventure' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.type, 'adventure');

  const dir = path.join(app.gamesDir, 'key-hunt');
  const templateRoot = path.join(publicDir, 'game-templates', 'adventure');
  for (const f of ['BRIEF.md', 'SPEC.md', 'index.html', 'css/style.css',
    'config/look.js', 'config/scenes.js', 'config/words.js', 'js/adventure.js']) {
    assert.deepEqual(
      fs.readFileSync(path.join(dir, f)),
      fs.readFileSync(path.join(templateRoot, f)),
      `${f} is copied whole`,
    );
  }
  assert.equal(fs.existsSync(path.join(dir, 'assets')), false, 'no art in the tree');
  // The pointer is the control, so nothing is drawn over the picture.
  assert.match(fs.readFileSync(path.join(dir, 'config/controls.js'), 'utf8'), /const SCHEME = "none";/);

  const commits = await logCommits(dir);
  assert.equal(commits.length, 3);
  assert.equal(commits[0].subject, 'start from the adventure template');

  const parsed = parseConfigFile(fs.readFileSync(path.join(dir, 'config/scenes.js'), 'utf8'));
  assert.equal(parsed.ok, true, parsed.reason);
  assert.deepEqual(parsed.decls.map((d) => d.name), ['SCENES']);
});

// The racing template: the one template that ships its own config/controls.js,
// because its buttons are GO and BOOST, which no seed says. The seed the
// scheme writes lands first and the template's copy lands over it.
test('a game born from the racing template holds its starter tree, sounds and controls', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);

  const res = await app.client.json('POST', '/api/projects', {
    body: { name: 'Lap Attack', template: 'racing' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.type, 'racing');

  const dir = path.join(app.gamesDir, 'lap-attack');
  const templateRoot = path.join(publicDir, 'game-templates', 'racing');
  for (const f of ['BRIEF.md', 'SPEC.md', 'index.html', 'css/style.css', 'js/race.js',
    'config/look.js', 'config/track.js', 'config/play.js', 'config/words.js',
    'config/controls.js', 'config/achievements.js', 'assets/sounds/engine.wav', 'assets/sounds/lap.wav']) {
    assert.deepEqual(
      fs.readFileSync(path.join(dir, f)),
      fs.readFileSync(path.join(templateRoot, f)),
      `${f} is copied whole`,
    );
  }
  assert.match(fs.readFileSync(path.join(dir, 'config/controls.js'), 'utf8'), /const SCHEME = "buttons";/);
  assert.match(fs.readFileSync(path.join(dir, 'config/controls.js'), 'utf8'), /toggle:BOOST/);

  const commits = await logCommits(dir);
  assert.equal(commits.length, 3);
  assert.equal(commits[0].subject, 'start from the racing template');

  const parsed = parseConfigFile(fs.readFileSync(path.join(dir, 'config/track.js'), 'utf8'));
  assert.equal(parsed.ok, true, parsed.reason);
  assert.deepEqual(parsed.decls.map((d) => d.name), ['TRACK', 'THINGS']);
});

// A game from before the type column is marked '' by the migration and asked
// once: its type is read off its tree — the template whose heart it holds —
// and the answer written back, null included. So a helper writing a story file
// into a free-form game afterwards changes nothing about its editors.
test('a game from before the column gets its type from its tree, once', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Old Story', slug: 'old-story', template: 'visual-novel' },
  });
  await app.client.json('POST', '/api/projects', { body: { name: 'Plain', slug: 'plain' } });
  // What the migration leaves on every game that predates the column.
  app.db.prepare("UPDATE projects SET type = ''").run();

  const list = await app.client.json('GET', '/api/projects');
  const bySlug = Object.fromEntries(list.body.map((p) => [p.slug, p.type]));
  assert.equal(bySlug['old-story'], 'visual-novel');
  assert.equal(bySlug.plain, null);
  // Written back, so the tree is never read for it again.
  const stored = (slug) => app.db.prepare('SELECT type FROM projects WHERE slug = ?').get(slug).type;
  assert.equal(stored('old-story'), 'visual-novel');
  assert.equal(stored('plain'), null);

  // The free-form game gaining a story file is not a visual novel now.
  fs.mkdirSync(path.join(app.gamesDir, 'plain', 'config'), { recursive: true });
  fs.writeFileSync(path.join(app.gamesDir, 'plain', 'config', 'story.js'), 'const CAST = {};\n');
  const again = await app.client.json('GET', '/api/projects/plain');
  assert.equal(again.body.type, null);
});

// Every template's index.json entry has to name a file the tree really holds,
// or a new game opens on nothing.
test("each template's heart is a file in its own tree", () => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const root = path.join(publicDir, 'game-templates');
  const { templates } = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  for (const [name, t] of Object.entries(templates)) {
    assert.ok(t.title && t.what, `${name} has words for the dialog`);
    if (!t.heart) continue;
    assert.ok(fs.existsSync(path.join(root, name, t.heart)), `${name}: ${t.heart} exists`);
  }
});

// Also against the real public/: how a game is held is picked when it is
// made, the way its type is — and unlike the type it lands in a file, because
// input.js reads it inside the running game.
test('a new game holds the control scheme that was picked', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);

  await app.client.json('POST', '/api/projects', {
    body: { name: 'Twin', slug: 'twin', scheme: 'dual-stick' },
  });
  assert.deepEqual(
    fs.readFileSync(path.join(app.gamesDir, 'twin', 'config/controls.js')),
    fs.readFileSync(path.join(publicDir, 'templates/controls-dual-stick.js')),
    'the whole seed, comments and all, not just the word',
  );

  // A template that fixes its own is never asked, and gets what it says.
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Quizzy', slug: 'quizzy', template: 'quiz' },
  });
  assert.match(
    fs.readFileSync(path.join(app.gamesDir, 'quizzy', 'config/controls.js'), 'utf8'),
    /const SCHEME = "none";/,
  );

  // An explicit one still wins over the template's: a quiz you steer is a
  // stranger game rather than a mistake.
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Steered', slug: 'steered', template: 'quiz', scheme: 'buttons' },
  });
  assert.match(
    fs.readFileSync(path.join(app.gamesDir, 'steered', 'config/controls.js'), 'utf8'),
    /const SCHEME = "buttons";/,
  );
});

test('a scheme has to exist, and a chat has none', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);

  // ⚠️ Checked before anything touches the disk, and by key: the seed path is
  // the studio's own, so a name shaped like a path is a 400 rather than a
  // read of some other file.
  for (const scheme of ['zorp', '../templates/controls.js', 'controls-buttons.js']) {
    const res = await app.client.json('POST', '/api/projects', {
      body: { name: 'Nope', slug: 'nope', scheme },
    });
    assert.equal(res.status, 400, scheme);
    assert.match(res.body.error, /no such control scheme/);
    assert.ok(!fs.existsSync(path.join(app.gamesDir, 'nope')), 'and nothing was made');
  }

  const chat = await app.client.json('POST', '/api/projects', {
    body: { name: 'Chatty', kind: 'chat', scheme: 'buttons' },
  });
  assert.equal(chat.status, 400);
  assert.match(chat.body.error, /chat has no controls/);
});

test('a template has to exist, and a chat cannot start from one', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);

  const unknown = await app.client.json('POST', '/api/projects', {
    body: { name: 'Nope', template: 'no-such-template' },
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /no such template/);

  const chat = await app.client.json('POST', '/api/projects', {
    body: { name: 'Chatty', kind: 'chat', template: 'quiz' },
  });
  assert.equal(chat.status, 400);
  assert.match(chat.body.error, /chat cannot start/);
});

test('an explicit slug overrides the derived one', async (t) => {
  const app = await studio(t);
  const res = await app.client.json('POST', '/api/projects', {
    body: { name: 'Tank Game', slug: 'tanks' },
  });
  assert.equal(res.body.slug, 'tanks');
  assert.equal(fs.existsSync(path.join(app.gamesDir, 'tanks')), true);
});

test('a name with no derivable slug asks for one rather than inventing it', async (t) => {
  const app = await studio(t);
  const res = await app.client.json('POST', '/api/projects', {
    body: { name: '!!! ???' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /explicit slug/);
});

test('bad slugs are refused before anything is created', async (t) => {
  const app = await studio(t);
  for (const slug of ['UPPER', 'has space', 'has.dot', '-lead', '..', '.git', 'x'.repeat(41)]) {
    const res = await app.client.json('POST', '/api/projects', {
      body: { name: 'Game', slug },
    });
    assert.equal(res.status, 400, slug);
  }
  assert.deepEqual(fs.readdirSync(app.gamesDir), [], 'no stray directories');
});

// ⚠️ The CSRF-shaped forgery from spec.md §7: a game on the same hostname can
// POST cross-origin with the operator's cookie, and text/plain skips the
// preflight. The signed-in cookie must not be enough — the declared type is.
test('a text/plain POST is refused even with a valid session', async (t) => {
  const app = await studio(t);
  const res = await app.client.request('POST', '/api/projects', {
    headers: { 'content-type': 'text/plain' },
    rawBody: JSON.stringify({ name: 'Sneak' }),
  });
  assert.equal(res.status, 415);
  await res.text();
  assert.deepEqual(fs.readdirSync(app.gamesDir), [], 'nothing was created');
});

test('a duplicate slug is a conflict', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const again = await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /taken/);
});

test('a name is required and bounded', async (t) => {
  const app = await studio(t);
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 5 }, { name: 'x'.repeat(201) }]) {
    const res = await app.client.json('POST', '/api/projects', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('the list is newest first and carries a preview', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'First' } });
  await app.client.json('POST', '/api/projects', { body: { name: 'Second' } });

  const res = await app.client.json('GET', '/api/projects');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((p) => p.slug), ['second', 'first']);
  assert.equal(res.body[0].preview, '');
});

test('the list says which games hold an icon.png', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  await app.client.json('POST', '/api/projects', { body: { name: 'Plain' } });
  await app.client.json('POST', '/api/projects', { body: { name: 'Room', kind: 'chat' } });

  const before = await app.client.json('GET', '/api/projects');
  assert.ok(before.body.every((p) => p.has_icon === false), 'no icons yet');

  // A reserved image at the root, where an upload puts it.
  fs.writeFileSync(path.join(app.gamesDir, 'tank', 'icon.png'), 'png bytes');
  const after = await app.client.json('GET', '/api/projects');
  const bySlug = Object.fromEntries(after.body.map((p) => [p.slug, p.has_icon]));
  assert.equal(bySlug.tank, true);
  assert.equal(bySlug.plain, false);
  assert.equal(bySlug.room, false, 'a chat has no tree and never an icon');
});

test('project detail carries the play url, agents, files, and messages', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  fs.writeFileSync(path.join(app.gamesDir, 'tank', 'index.html'), '<h1>Tank</h1>');

  const res = await app.client.json('GET', '/api/projects/tank');
  assert.equal(res.status, 200);
  assert.equal(res.body.play_url, 'http://games.test/tank/');
  assert.deepEqual(res.body.agents, []);
  assert.deepEqual(res.body.messages, []);
  assert.deepEqual(res.body.files.map((f) => f.path), ['index.html']);
  assert.equal(res.body.files[0].text, true);
});

test('an unknown project is 404, and so is a malformed slug', async (t) => {
  const app = await studio(t);
  assert.equal((await app.client.json('GET', '/api/projects/nope')).status, 404);
  // A slug that could never exist is a 400 from validation, not a 404.
  assert.equal((await app.client.json('GET', '/api/projects/UPPER')).status, 400);
});

test('renaming changes the name and never the slug', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const res = await app.client.json('PATCH', '/api/projects/tank', {
    body: { name: 'Tank Deluxe' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Tank Deluxe');
  assert.equal(res.body.slug, 'tank');
  assert.equal(fs.existsSync(path.join(app.gamesDir, 'tank')), true);
});

test('archiving blocks writes, reads keep working, and unarchiving undoes it', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });

  const archived = await app.client.json('POST', '/api/projects/tank/archive', { body: {} });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.archived, true);

  // Reads continue.
  const read = await app.client.json('GET', '/api/projects/tank');
  assert.equal(read.status, 200);
  assert.equal(read.body.archived, true);

  // Writes are refused with 409.
  const write = await app.client.json('PATCH', '/api/projects/tank', {
    body: { name: 'Nope' },
  });
  assert.equal(write.status, 409);
  assert.match(write.body.error, /archived/);

  // Archive is not a toggle, whatever the body says: coming back has its own
  // route (spec/ §11).
  const again = await app.client.json('POST', '/api/projects/tank/archive', {
    body: { archived: false },
  });
  assert.equal(again.status, 409);
  assert.equal((await app.client.json('GET', '/api/projects/tank')).body.archived, true);
  assert.equal(
    (await app.client.json('POST', '/api/projects/nope/archive', { body: {} })).status,
    404,
  );

  // And back: the same person, one bit, and the writes it blocked work again.
  const back = await app.client.json('POST', '/api/projects/tank/unarchive', { body: {} });
  assert.equal(back.status, 200);
  assert.equal(back.body.archived, false);
  assert.equal((await app.client.json('GET', '/api/projects/tank')).body.archived, false);
  assert.equal(
    (await app.client.json('PATCH', '/api/projects/tank', { body: { name: 'Tank II' } })).status,
    200,
  );

  // A game that is not away has nothing to come back from.
  const twice = await app.client.json('POST', '/api/projects/tank/unarchive', { body: {} });
  assert.equal(twice.status, 409);
  assert.match(twice.body.error, /not archived/);
  assert.equal(
    (await app.client.json('POST', '/api/projects/nope/unarchive', { body: {} })).status,
    404,
  );
});

test("archiving and unarchiving are the originator's alone, and never a published game's", async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  // A new game is open, so a second account may change it — and still may not
  // put it away.
  const other = app.newClient();
  await signIn(app, { email: 'qiby@example.com', displayName: 'Qiby', client: other });
  const theirs = await other.json('POST', '/api/projects/tank/archive', { body: {} });
  assert.equal(theirs.status, 403);
  assert.match(theirs.body.error, /only whoever made it/);
  // The payload says who may, so the ··· can leave Archive out for everybody else.
  assert.equal((await app.client.json('GET', '/api/projects/tank')).body.originator, true);
  assert.equal((await other.json('GET', '/api/projects/tank')).body.originator, false);

  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: true } });
  const listed = await app.client.json('POST', '/api/projects/tank/archive', { body: {} });
  assert.equal(listed.status, 409);
  assert.match(listed.body.error, /unpublish it first/);

  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: false } });
  assert.equal(
    (await app.client.json('POST', '/api/projects/tank/archive', { body: {} })).status, 200,
  );

  // The way back is the same door: an editor who is not the originator is
  // refused there too, so a game cannot be brought back by whoever finds it.
  const theirBack = await other.json('POST', '/api/projects/tank/unarchive', { body: {} });
  assert.equal(theirBack.status, 403);
  assert.match(theirBack.body.error, /only whoever made it/);
  assert.equal(
    (await app.client.json('POST', '/api/projects/tank/unarchive', { body: {} })).status, 200,
  );
});

// Zero account complexity: a second account has exactly the same authority
// over a project it did not create (spec.md §3).
test('a fork copies the files and their history, and gets the builder', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.put('/api/projects/tank/files/index.html', {
    headers: { 'content-type': 'text/plain' }, rawBody: '<h1>tank</h1>',
  });
  // The fixture's public/ has no templates to start from, so the type is set
  // by hand: a copy is the same game, and brings its type with it.
  app.db.prepare("UPDATE projects SET type = 'quiz' WHERE slug = 'tank'").run();

  const forked = await app.client.json('POST', '/api/projects/tank/fork', {
    body: { name: 'Tank Two', slug: 'tank-two' },
  });
  assert.equal(forked.status, 201);
  assert.equal(forked.body.slug, 'tank-two');
  assert.equal(forked.body.type, 'quiz');

  const dir = path.join(app.gamesDir, 'tank-two');
  assert.equal(await isRepo(dir), true, 'the fork is its own repository');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<h1>tank</h1>');

  // History came along, and the remote pointing back at the original did not.
  const commits = await logCommits(dir);
  assert.ok(commits.length >= 2, 'the original commits are present');
  assert.equal(fs.existsSync(path.join(dir, '.git', 'refs', 'remotes', 'origin')), false);

  // The builder is in the copy's Building like any game's, and the copy is
  // born with a game's two rooms — a fork is the files, not the rooms.
  const forked2 = await app.client.json('GET', '/api/projects/tank-two');
  const building = forked2.body.chats.find((c) => c.builder);
  const detail = await app.client.json('GET', `/api/projects/tank-two?chat=${building.id}`);
  assert.deepEqual(detail.body.agents.map((a) => a.name), ['Builder']);
  assert.deepEqual(forked2.body.chats.map((c) => c.name), ['Humans only', 'Building']);
  // A fresh thread, saying where it came from.
  assert.equal(detail.body.messages.length, 1);
  assert.equal(detail.body.messages[0].kind, 'system');
  assert.match(detail.body.messages[0].body, /copy of "Tank"/);

  // The two trees are independent from here on.
  await app.client.put('/api/projects/tank-two/files/index.html', {
    headers: { 'content-type': 'text/plain' }, rawBody: 'changed',
  });
  assert.equal(
    fs.readFileSync(path.join(app.gamesDir, 'tank', 'index.html'), 'utf8'),
    '<h1>tank</h1>',
    'the original is untouched',
  );
});

test('a fork refuses a taken slug and refuses a chat', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Chat', slug: 'chat', kind: 'chat' },
  });

  const taken = await app.client.json('POST', '/api/projects/tank/fork', {
    body: { name: 'Again', slug: 'tank' },
  });
  assert.equal(taken.status, 409);

  const chat = await app.client.json('POST', '/api/projects/chat/fork', {
    body: { name: 'Nope', slug: 'nope' },
  });
  assert.equal(chat.status, 400);
  assert.equal(fs.existsSync(path.join(app.gamesDir, 'nope')), false);
});

test('publishing is a boolean, games only, and shows in the payload', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Chat', slug: 'chat', kind: 'chat' },
  });

  const before = await app.client.json('GET', '/api/projects/tank');
  assert.equal(before.body.published, false);

  const on = await app.client.json('POST', '/api/projects/tank/publish', { body: {} });
  assert.equal(on.status, 200);
  assert.equal(on.body.published, true);
  const after = await app.client.json('GET', '/api/projects/tank');
  assert.equal(after.body.published, true);

  const bad = await app.client.json('POST', '/api/projects/tank/publish', {
    body: { published: 'yes' },
  });
  assert.equal(bad.status, 400);

  const chat = await app.client.json('POST', '/api/projects/chat/publish', { body: {} });
  assert.equal(chat.status, 400);
});

// Superseded by authorship (test/authors.test.js): every account still reads
// every project, but changing one takes being an author of it or the game
// being open. What is left of the old rule is the reading half.
test('any account can read any project', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  // Closed, so that reading it is the only thing being tested: a new game is
  // open to the whole studio (test/authors.test.js).
  await app.client.json('POST', '/api/projects/tank/open', { body: { open_edit: false } });

  const other = app.newClient();
  await signIn(app, {
    email: 'sam@example.com', password: 'pw', displayName: 'Sam', client: other,
  });
  const res = await other.json('GET', '/api/projects/tank');
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Tank');
  assert.equal(res.body.can_edit, false);
});

// When a game last changed (spec/ §3): stamped by every write to its tree and
// every change to its row — from one hook on the broker, so no route has to
// remember — and by nothing said in it.
test('updated_at follows the game’s changes and ignores its chat', async (t) => {
  const app = await studio(t);
  const made = (await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } })).body;
  assert.equal(made.updated_at, made.created_at);

  await app.client.json('POST', '/api/projects/tank/messages', { body: { body: 'hello' } });
  const talked = (await app.client.json('GET', '/api/projects/tank')).body;
  assert.equal(talked.updated_at, made.updated_at, 'talk is not a change');

  await app.client.put('/api/projects/tank/files/index.html', {
    headers: { 'content-type': 'text/plain' }, rawBody: '<h1>Tank</h1>',
  });
  const saved = (await app.client.json('GET', '/api/projects/tank')).body;
  assert.ok(saved.updated_at > made.updated_at, 'a save is');

  const before = new Date().toISOString();
  await app.client.json('PATCH', '/api/projects/tank', { body: { name: 'Tank II' } });
  const renamed = (await app.client.json('GET', '/api/projects/tank')).body;
  assert.ok(renamed.updated_at >= before && renamed.updated_at >= saved.updated_at, 'so is a rename');

  const listed = (await app.client.json('GET', '/api/projects')).body;
  assert.equal(listed[0].updated_at, renamed.updated_at, 'and the list carries it');
});

// The arc's ratchet (spec/ §6, public/arc.js): stamps a game holds, moved one
// at a time by an editor, forward or back, and never by anybody else.
test('stamps are earned one at a time, taken back one at a time, and are an editor’s', async (t) => {
  const app = await studio(t);
  const made = (await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } })).body;
  assert.equal(made.stage, 0, 'a new game holds no stamps');

  const stamp = (stage) => app.client.json('POST', '/api/projects/tank/stage', { body: { stage } });
  assert.equal((await stamp(1)).status, 200);
  assert.equal((await stamp(3)).status, 409, 'one at a time');
  assert.equal((await stamp(2)).status, 200);
  assert.equal((await stamp(1)).status, 200, 'and one back');
  assert.equal((await stamp(-1)).status, 400);
  assert.equal((await stamp('two')).status, 400);
  assert.equal((await app.client.json('GET', '/api/projects/tank')).body.stage, 1);

  // Past the end is refused: a blank game's arc is the arcade's with one in
  // front, eight stamps.
  await app.client.json('POST', '/api/projects/tank/open', { body: { open_edit: false } });
  const other = app.newClient();
  await signIn(app, { email: 'kid@example.com', password: 'hunter2', displayName: 'Robin', client: other });
  const theirs = await other.json('POST', '/api/projects/tank/stage', { body: { stage: 2 } });
  assert.equal(theirs.status, 403, 'somebody who may not change the game may not stamp it');

  await app.client.json('POST', '/api/projects', { body: { name: 'Room', slug: 'room', kind: 'chat' } });
  assert.equal((await app.client.json('POST', '/api/projects/room/stage', { body: { stage: 1 } })).status, 400);
});
