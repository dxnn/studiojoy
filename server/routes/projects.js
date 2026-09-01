import fs from 'node:fs';
import path from 'node:path';
import { json, noContent, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { checkSlug, slugify, requireSlug } from '../files/paths.js';
import {
  initRepo, isRepo, forkRepo, currentSha,
} from '../files/git.js';
import { scaffoldLibraries } from '../files/library.js';
import { listTemplates, scaffoldTemplate, scaffoldStart } from '../files/templates.js';
import { joinStarter } from '../starter.js';
import { listTree } from '../files/tree.js';
import { listErrors, errorPublic } from '../runtime.js';
import {
  requireProject, projectDirFor, authorFor, requireString, optionalBool,
  messagePublic,
} from './helpers.js';
import { PROJECT_KINDS, tx } from '../db.js';
import {
  startChats, startRoom, listChats, requireChat, chatPublic,
} from '../chats.js';
import {
  addAuthor, removeAuthor, listAuthors, canEdit, isAuthor, requireAuthor,
} from '../authors.js';
import { unseenInProject, unseenInChat } from '../mentions.js';

const MAX_PROJECT_NAME = 200;
const RECENT_MESSAGES = 100;

function projectPublic(ctx, row, user = null) {
  const db = ctx.db;
  const last = db
    .prepare(
      `SELECT body, created_at FROM messages
        WHERE project_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(row.id);
  return {
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    archived: row.archived === 1,
    published: row.published === 1,
    scores_on: row.scores_on === 1,
    // Whether icon.png is at the root of the game's tree — a reserved image,
    // the one of the three the client needs for games it has not opened: the
    // sidebar wears every game's icon. The other two are the open game's and
    // come out of its own file list.
    has_icon: row.kind === 'game'
      && fs.existsSync(path.join(projectDirFor(ctx, row), 'icon.png')),
    // Who may change it, and whether you are one of them. `authors` is on
    // every project in the list, not only the open one: the sidebar sorts
    // games into yours, open and everyone else's, and needs to know which is
    // which before you have opened any of them.
    open_edit: row.open_edit === 1,
    authors: listAuthors(db, row.id),
    mine: user ? isAuthor(db, row.id, user.id) : false,
    can_edit: user ? canEdit(db, row, user) : false,
    created_by: row.created_by,
    created_at: row.created_at,
    last_message_at: last?.created_at ?? row.created_at,
    preview: last ? last.body.slice(0, 80) : '',
    // How many messages in this project have called *you* by name and not
    // been read. Yours alone — every list in the sidebar is drawn for one
    // person, so this is never somebody else's mark.
    mentions: user ? unseenInProject(db, user.id, row.id) : 0,
  };
}

export function projectRoutes(r) {
  r.get('/api/projects', (ctx) => {
    const user = requireAuth(ctx);
    const rows = ctx.db.prepare('SELECT * FROM projects ORDER BY id DESC').all();
    json(ctx.res, 200, rows.map((row) => projectPublic(ctx, row, user)));
  });

  r.post('/api/projects', async (ctx) => {
    const user = requireAuth(ctx);
    const body = await readJson(ctx.req);
    const name = requireString(body.name, 'name', { max: MAX_PROJECT_NAME });
    const kind = body.kind === undefined ? 'game' : body.kind;
    if (!PROJECT_KINDS.includes(kind)) {
      throw new HttpError(400, `kind must be one of ${PROJECT_KINDS.join(', ')}`);
    }

    // An explicit slug wins; otherwise derive one. Deriving can fail — a name
    // of only punctuation has no slug — so ask rather than invent.
    const requested = body.slug === undefined ? slugify(name) : body.slug;
    const checked = checkSlug(requested);
    if (!checked.ok) {
      throw new HttpError(400, `${checked.reason} (pass an explicit slug)`);
    }
    const slug = checked.slug;

    if (ctx.db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug)) {
      throw new HttpError(409, `the slug '${slug}' is taken`);
    }

    // A starter tree rather than a blank page (spec.md §4). Checked before
    // anything touches the disk, so a typo creates nothing.
    const template = body.template === undefined || body.template === ''
      ? null
      : String(body.template);
    if (template !== null) {
      if (kind !== 'game') throw new HttpError(400, 'a chat cannot start from a template');
      if (!listTemplates(ctx.publicDir)[template]) {
        throw new HttpError(400, `no such template: ${template}`);
      }
    }

    // A chat never touches the disk: no directory, no repo, nothing to serve
    // on the games origin. Everything else about it is a project.
    if (kind === 'game') {
      const dir = projectDirFor(ctx, { slug });
      // The working tree and its repo are created before the row exists, so a
      // project is never visible without a repository behind it (spec.md §12).
      // A directory left by an earlier failed attempt is reused if it is
      // already a repo, initialised otherwise.
      await ctx.mutex.run(slug, async () => {
        if (!(await isRepo(dir))) {
          await initRepo(dir, { author: authorFor(user), slug });
          // Born holding the studio library (spec.md §4); npm run sweep
          // keeps it current from then on.
          await scaffoldLibraries(dir, ctx.publicDir, authorFor(user));
          // A starter tree, or failing that a page. Either way the game has an
          // index.html from its first minute: a working tree without one is
          // nothing the games origin can serve, and the preview and the play
          // link both answered "not found" until a helper wrote one.
          if (template) {
            await scaffoldTemplate(dir, ctx.publicDir, template, authorFor(user));
          } else {
            await scaffoldStart(dir, ctx.publicDir, name, authorFor(user));
          }
        }
      });
    }

    const now = new Date().toISOString();
    // A new game is open: this is a studio of people who trust each other, and
    // a game nobody else may touch should be a decision somebody made rather
    // than what happens to everything by default. A chat project is not — it
    // has no working tree, and open_edit there decides who may start chats in
    // somebody else's conversation. Set here rather than as the column's
    // default: an existing database already has the column, and SQLite cannot
    // change a default after the fact.
    const openEdit = kind === 'game' ? 1 : 0;
    const info = ctx.db
      .prepare(
        `INSERT INTO projects (slug, name, kind, created_by, created_at, open_edit)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(slug, name, kind, user.id, now, openEdit);
    const row = ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
    // A game gets two conversations from the start: the human-only one it
    // opens on, and one where helpers can be put — a game with nowhere to ask
    // for anything would need a second click before it could be used at all.
    // A chat project gets the one room it is.
    const work = kind === 'chat'
      ? startRoom(ctx.db, row.id, name, now)
      : startChats(ctx.db, row.id, now);
    // And somebody in it. A game whose Building chat is empty is a room with
    // nobody to ask, which is a second trip to the Crew tab before anything
    // can happen — so the studio's starter helper joins, and the answer says
    // where to open. Games only: a chat project has no working tree to build.
    const joined = kind === 'game'
      ? joinStarter(ctx.db, work, user.id, now, !template)
      : null;
    // The person who made it is its first author: everything else about
    // authorship starts from somebody being able to say who else is in.
    addAuthor(ctx.db, row.id, user.id, user.id, now);
    // `chats` and `chat` mean here what they mean on the GET: every
    // conversation, and the one to open. Building when somebody is waiting in
    // it, the human-only one otherwise.
    const chats = listChats(ctx.db, row.id);
    const payload = {
      ...projectPublic(ctx, row, user),
      chats: chats.map(chatPublic),
      chat: chatPublic(joined ? work : chats[0]),
    };
    ctx.broker.broadcast('project.new', { slug: row.slug, name: row.name, kind: row.kind });
    json(ctx.res, 201, payload);
  });

  r.get('/api/projects/:slug', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx);
    // Which conversation this request is about. The messages and the helpers
    // both belong to it, not to the project: everything below the title bar
    // changes when you switch chats, and the files do not.
    const chat = requireChat(ctx.db, project, ctx.query.get('chat'));
    const messages = ctx.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
      )
      .all(chat.id, RECENT_MESSAGES);
    const agents = ctx.db
      .prepare(
        `SELECT ca.agent_id, ca.chatty, ca.cooldown_until, ca.response_pending,
                a.name, a.model, a.thinking, a.file_tools
           FROM chat_agents ca
           JOIN agents a ON a.id = ca.agent_id
          WHERE ca.chat_id = ? AND a.deleted = 0
          ORDER BY a.name`,
      )
      .all(chat.id);
    // A chat has no working tree to list and nothing to play.
    const isChat = project.kind === 'chat';
    const dir = isChat ? null : projectDirFor(ctx, project);
    const files = isChat ? [] : (await listTree(dir)).files;
    // Problems the game reported on the version that is on disk now. Older
    // ones are about code that no longer exists, so they are not sent.
    const errors = isChat
      ? []
      : listErrors(ctx.db, project.id, await currentSha(dir)).map(errorPublic);

    json(ctx.res, 200, {
      ...projectPublic(ctx, project, user),
      // Per chat as well as per project: the mark on the game says somebody
      // called you, and the mark on the pill says where.
      chats: listChats(ctx.db, project.id).map((c) => ({
        ...chatPublic(c),
        mentions: unseenInChat(ctx.db, user.id, c.id),
      })),
      chat: chatPublic(chat),
      // No games origin means the request carried no usable hostname to build
      // one from, which is a null play url rather than a URL around a guess.
      play_url: isChat || !ctx.gamesUrl ? null : `${ctx.gamesUrl}/${project.slug}/`,
      agents: agents.map((a) => ({
        agent_id: a.agent_id,
        name: a.name,
        model: a.model,
        thinking: a.thinking,
        file_tools: a.file_tools === 1,
        chatty: a.chatty === 1,
        responding: a.response_pending === 1,
      })),
      files,
      errors,
      messages: messages.map((m) => messagePublic(ctx.db, m, project.slug)),
    });
  });

  r.patch('/api/projects/:slug', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const body = await readJson(ctx.req);
    const name = body.name === undefined
      ? undefined
      : requireString(body.name, 'name', { max: MAX_PROJECT_NAME });
    const scoresOn = optionalBool(body.scores_on, 'scores_on');
    if (name === undefined && scoresOn === undefined) {
      throw new HttpError(400, 'nothing to change');
    }
    // Renaming is an edit and archived stops edits; the scoreboard switch is
    // moderation, and an archived game is still publicly playable and still
    // taking scores, so that one has to work regardless.
    if (name !== undefined && project.archived) {
      throw new HttpError(409, 'project is archived');
    }
    if (name !== undefined) {
      ctx.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, project.id);
      // A chat project's one room is the project: nobody named it separately,
      // and nothing shows the two names apart, so leaving the old one behind
      // in the database would only ever be a lie to read later.
      if (project.kind === 'chat') {
        ctx.db.prepare('UPDATE chats SET name = ? WHERE project_id = ?').run(name, project.id);
      }
    }
    if (scoresOn !== undefined) {
      ctx.db.prepare('UPDATE projects SET scores_on = ? WHERE id = ?')
        .run(scoresOn ? 1 : 0, project.id);
    }
    const updated = {
      slug: project.slug,
      name: name ?? project.name,
      scores_on: scoresOn ?? project.scores_on === 1,
    };
    ctx.broker.broadcast('project.updated', {
      ...updated, archived: project.archived === 1,
    });
    json(ctx.res, 200, updated);
  });

  // The scoreboard's admin side, on this origin because moderation needs a
  // person: the games listener never reads a cookie, so nothing over there
  // can be allowed to delete. All of it works on an archived game — still
  // publicly playable, so still in need of moderating.
  r.get('/api/projects/:slug/scores', (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx);
    const scores = ctx.db
      .prepare(
        `SELECT id, name, score, created_at FROM scores
          WHERE project_id = ? ORDER BY score DESC, id`,
      )
      .all(project.id);
    json(ctx.res, 200, { scores, scores_on: project.scores_on === 1 });
  });

  // Moderating a game's board is changing that game.
  r.delete('/api/projects/:slug/scores/:id', (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'not a score id');
    const { changes } = ctx.db
      .prepare('DELETE FROM scores WHERE id = ? AND project_id = ?')
      .run(id, project.id);
    if (Number(changes) === 0) throw new HttpError(404, 'no such score');
    noContent(ctx.res);
  });

  r.delete('/api/projects/:slug/scores', (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    ctx.db.prepare('DELETE FROM scores WHERE project_id = ?').run(project.id);
    noContent(ctx.res);
  });

  // A fork copies the files and their history, not the conversation: the new
  // game starts with a clean thread and the same helpers already in it, which
  // is what "make me one like that" means in practice.
  r.post('/api/projects/:slug/fork', async (ctx) => {
    const user = requireAuth(ctx);
    const source = requireProject(ctx);
    if (source.kind !== 'game') {
      throw new HttpError(400, 'a chat has no files to fork');
    }
    const body = await readJson(ctx.req);
    const name = requireString(body.name, 'name', { max: MAX_PROJECT_NAME });

    const requested = body.slug === undefined ? slugify(name) : body.slug;
    const checked = checkSlug(requested);
    if (!checked.ok) throw new HttpError(400, `${checked.reason} (pass an explicit slug)`);
    const slug = checked.slug;
    if (ctx.db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug)) {
      throw new HttpError(409, `the slug '${slug}' is taken`);
    }

    const srcDir = projectDirFor(ctx, source);
    const dstDir = projectDirFor(ctx, { slug });
    // Both directories are locked: the source must not be committed to
    // mid-clone, and the destination is new but shares the same lock table.
    await ctx.mutex.run(source.slug, async () => {
      if (await isRepo(dstDir)) throw new HttpError(409, 'that directory already exists');
      await forkRepo(srcDir, dstDir);
    });

    const now = new Date().toISOString();
    const row = tx(ctx.db, () => {
      // Open, like any other new game — and open whatever the original was,
      // because a copy is its own game and inherits nothing about who may
      // touch it.
      const info = ctx.db
        .prepare(
          `INSERT INTO projects (slug, name, kind, created_by, created_at, open_edit)
           VALUES (?, ?, 'game', ?, ?, 1)`,
        )
        .run(slug, name, user.id, now);
      const id = Number(info.lastInsertRowid);
      // The copy starts with the same two chats every game gets, and a fresh
      // thread in each: a fork is the files and the helpers, not the
      // conversation that produced them.
      const work = startChats(ctx.db, id, now);
      // A copy is the copier's game. Whoever wrote the original is named in
      // its history, which is where that belongs.
      addAuthor(ctx.db, id, user.id, user.id, now);
      // The helpers come along, into the chat that allows them; their
      // cooldowns and pending flags do not. Which chat they were in over there
      // does not survive, because the chats themselves do not.
      const attached = ctx.db
        .prepare(
          `SELECT DISTINCT ca.agent_id, MAX(ca.chatty) AS chatty
             FROM chat_agents ca JOIN chats c ON c.id = ca.chat_id
            WHERE c.project_id = ? GROUP BY ca.agent_id`,
        )
        .all(source.id);
      for (const a of attached) {
        ctx.db
          .prepare(
            `INSERT INTO chat_agents (chat_id, agent_id, chatty, attached_by, attached_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(work.id, a.agent_id, a.chatty, user.id, now);
      }
      // Says where it came from, in the thread, where a kid will see it.
      ctx.db
        .prepare(
          `INSERT INTO messages (project_id, chat_id, kind, body, created_at)
           VALUES (?, ?, 'system', ?, ?)`,
        )
        .run(id, work.id, `This game started as a copy of "${source.name}".`, now);
      return ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    });

    ctx.broker.broadcast('project.new', { slug: row.slug, name: row.name, kind: row.kind });
    json(ctx.res, 201, projectPublic(ctx, row, user));
  });

  // Who may change this game. ⚠️ Authors-only even when the game is open:
  // open means anybody may work on it, not that anybody may decide who does.
  r.post('/api/projects/:slug/authors', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true, anyone: true });
    requireAuthor(ctx.db, project, user);
    const body = await readJson(ctx.req);
    const id = Number(body.user_id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'not a user id');
    const person = ctx.db
      .prepare('SELECT id, display_name FROM users WHERE id = ? AND deleted = 0').get(id);
    if (!person) throw new HttpError(404, 'no such person');

    addAuthor(ctx.db, project.id, person.id, user.id);
    ctx.broker.broadcast('project.updated', {
      slug: project.slug, name: project.name, archived: project.archived === 1,
    });
    json(ctx.res, 201, { authors: listAuthors(ctx.db, project.id) });
  });

  r.delete('/api/projects/:slug/authors/:user_id', (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true, anyone: true });
    requireAuthor(ctx.db, project, user);
    const id = Number(ctx.params.user_id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'no such person');

    removeAuthor(ctx.db, project.id, id);
    ctx.broker.broadcast('project.updated', {
      slug: project.slug, name: project.name, archived: project.archived === 1,
    });
    json(ctx.res, 200, { authors: listAuthors(ctx.db, project.id) });
  });

  // Open: anybody in the studio may change this game. An author's decision,
  // and only an author's — see the note above.
  r.post('/api/projects/:slug/open', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true, anyone: true });
    requireAuthor(ctx.db, project, user);
    const body = await readJson(ctx.req);
    const open = optionalBool(body.open_edit, 'open_edit');
    if (open === undefined) throw new HttpError(400, 'open_edit is required');

    ctx.db.prepare('UPDATE projects SET open_edit = ? WHERE id = ?').run(open ? 1 : 0, project.id);
    ctx.broker.broadcast('project.updated', {
      slug: project.slug, name: project.name, archived: project.archived === 1,
    });
    json(ctx.res, 200, { open_edit: open });
  });

  // Publishing lists a game in the public catalog. It does not change who can
  // play it — every game has always been playable by link (spec.md §7); this
  // is only about being findable.
  r.post('/api/projects/:slug/publish', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    if (project.kind !== 'game') {
      throw new HttpError(400, 'a chat has nothing to publish');
    }
    const body = await readJson(ctx.req);
    const published = body.published === undefined ? true : body.published;
    if (typeof published !== 'boolean') {
      throw new HttpError(400, 'published must be a boolean');
    }
    ctx.db.prepare('UPDATE projects SET published = ? WHERE id = ?')
      .run(published ? 1 : 0, project.id);
    ctx.broker.broadcast('project.updated', {
      slug: project.slug, name: project.name, archived: project.archived === 1, published,
    });
    json(ctx.res, 200, { slug: project.slug, published });
  });

  // Archiving is reversible and never affects the public game, so it takes a
  // boolean rather than being a one-way door.
  r.post('/api/projects/:slug/archive', async (ctx) => {
    const user = requireAuth(ctx);
    const slug = requireSlug(ctx.params.slug);
    const project = ctx.db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug);
    if (!project) throw new HttpError(404, 'no such project');
    // Not requireProject({write:true}): this route is the one that reopens an
    // archived game, and that check refuses an archived one on principle. The
    // authorship half of it still applies.
    if (!canEdit(ctx.db, project, user)) {
      throw new HttpError(403, `${project.name} is not yours to change — ask one of its editors`);
    }

    const body = await readJson(ctx.req);
    const archived = body.archived === undefined ? true : body.archived;
    if (typeof archived !== 'boolean') {
      throw new HttpError(400, 'archived must be a boolean');
    }
    ctx.db.prepare('UPDATE projects SET archived = ? WHERE id = ?')
      .run(archived ? 1 : 0, project.id);
    ctx.broker.broadcast('project.updated', {
      slug: project.slug, name: project.name, archived,
    });
    json(ctx.res, 200, { slug: project.slug, archived });
  });
}
