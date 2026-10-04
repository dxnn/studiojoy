// A game template: a starter tree copied into a new game at creation, right
// after the library scaffold, as one commit. From then on the files are the
// game's own — no version recorded, no update ever offered — unlike a
// library, because "add a timer to my quiz" has to land in editable files,
// not behind the studio/ write-wall (spec.md §4). public/game-templates is
// the source; index.json names each template and carries the words the New
// game dialog shows, and doubles as the validation list.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAt } from './tree.js';
import { commitPaths } from './git.js';
import { escapeHtml } from '../util/html.js';

// The one page a game made without a template starts from, and the brief that
// goes with it.
const BLANK_PAGE = ['game-templates', 'blank', 'index.html'];
const BLANK_BRIEF = ['game-templates', 'blank', 'BRIEF.md'];
const BRIEF_FILE = 'BRIEF.md';

export function listTemplates(publicDir) {
  try {
    const index = JSON.parse(
      fs.readFileSync(path.join(publicDir, 'game-templates', 'index.json'), 'utf8'),
    );
    return index.templates ?? {};
  } catch {
    // No template directory — the test fixture, or a stripped deployment.
    return {};
  }
}

// Which game type a game from before `projects.type` is, read off its tree:
// the type whose heart file it holds. Null when it holds none — a free-form
// game. Asked once per game and the answer written back (routes/projects.js),
// so a helper writing config/story.js into a free-form game later changes
// nothing about which editors anybody sees.
export function typeFromTree(dir, publicDir) {
  for (const [type, t] of Object.entries(listTemplates(publicDir))) {
    if (t.heart && fs.existsSync(path.join(dir, t.heart))) return type;
  }
  return null;
}

// "A blank page" in the New game dialog, which until now meant a blank
// *directory*: a game with no index.html is nothing the games origin can
// serve, so the preview and the play link both answered `{"error":"not
// found"}` until a helper had written one. One page instead, carrying the
// game's name, so a game loads from the minute it exists.
//
// It lives under game-templates/ with the templates and is deliberately not in
// their index.json — the New game dialog offers it as the empty choice, and a
// second entry would be the same option listed twice. The one way it differs
// from a template is `{{name}}`: templates are copied byte for byte, and this
// page has the game's name in it. Small on purpose, because the preamble tells
// an agent to write index.html itself — this is a page to replace, not a tree
// to grow.
//
// The brief goes with it. Every other template ships one saying what its own
// setup is, and a game made without a template had nothing: the preamble says
// what the studio is, and nothing said which script tags this particular page
// carries, that the input module is deliberately left out of them, or that the
// seeded control scheme is a default rather than a decision. No `{{name}}` in
// it — the substitution is HTML-escaped, which is right for the page and wrong
// for markdown.
//
// ⚠️ Read from publicDir like every other scaffold, so a public/ without it
// writes nothing: that is what keeps the suite's games born empty (spec.md §4)
// and what leaves "a game with no page" a state still worth testing.
export async function scaffoldStart(dir, publicDir, name, author) {
  let page;
  try {
    page = await fs.promises.readFile(path.join(publicDir, ...BLANK_PAGE), 'utf8');
  } catch {
    return null;
  }
  await writeFileAt(
    path.join(dir, 'index.html'), page.replaceAll('{{name}}', escapeHtml(name)),
  );
  const written = ['index.html'];
  // A brief is a nicety where the page is the thing that makes a game
  // playable, so a public/ missing it costs the brief and not the game.
  const brief = await fs.promises.readFile(path.join(publicDir, ...BLANK_BRIEF))
    .catch(() => null);
  if (brief !== null) {
    await writeFileAt(path.join(dir, BRIEF_FILE), brief);
    written.push(BRIEF_FILE);
  }
  return commitPaths(dir, written.sort(), 'a page to start from', author);
}

export async function scaffoldTemplate(dir, publicDir, name, author) {
  const written = await copyTemplate(dir, publicDir, name);
  if (written.length === 0) return null;
  return commitPaths(dir, written.sort(), `start from the ${name} template`, author);
}

// The template's tree written over the game's, uncommitted: what the paths
// were, so a caller doing more than this — Game Design's Make it — commits
// the whole of it as one version.
export async function copyTemplate(dir, publicDir, name) {
  if (!listTemplates(publicDir)[name]) throw new Error(`no such template: ${name}`);
  const root = path.join(publicDir, 'game-templates', name);
  const written = [];
  const walk = async (rel) => {
    const entries = await fs.promises.readdir(
      rel ? path.join(root, rel) : root, { withFileTypes: true },
    );
    for (const entry of entries) {
      const sub = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(sub);
      else {
        await writeFileAt(path.join(dir, sub), await fs.promises.readFile(path.join(root, sub)));
        written.push(sub);
      }
    }
  };
  await walk('');
  return written;
}
