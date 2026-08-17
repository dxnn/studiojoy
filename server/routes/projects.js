import { json, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { checkSlug, slugify, requireSlug } from '../files/paths.js';
import {
  initRepo, isRepo, forkRepo, currentSha,
} from '../files/git.js';
import { listTree } from '../files/tree.js';
import { listErrors, errorPublic } from '../runtime.js';
import {
  requireProject, projectDirFor, authorFor, requireString, messagePublic,
} from './helpers.js';
import { PROJECT_KINDS, tx } from '../db.js';

const MAX_PROJECT_NAME = 200;
const RECENT_MESSAGES = 100;

function projectPublic(db, row) {
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
    created_by: row.created_by,
    created_at: row.created_at,
    last_message_at: last?.created_at ?? row.created_at,
    preview: last ? last.body.slice(0, 80) : '',
  };
}

export function projectRoutes(r) {
  r.get('/api/projects', (ctx) => {
    requireAuth(ctx);
    const rows = ctx.db.prepare('SELECT * FROM projects ORDER BY id DESC').all();
    json(ctx.res, 200, rows.map((row) => projectPublic(ctx.db, row)));
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
        }
      });
    }

    const now = new Date().toISOString();
    const info = ctx.db
      .prepare(
        `INSERT INTO projects (slug, name, kind, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(slug, name, kind, user.id, now);
    const row = ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
    const payload = projectPublic(ctx.db, row);
    ctx.broker.broadcast('project.new', { slug: row.slug, name: row.name, kind: row.kind });
    json(ctx.res, 201, payload);
  });

  r.get('/api/projects/:slug', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx);
    const messages = ctx.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages WHERE project_id = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
      )
      .all(project.id, RECENT_MESSAGES);
    const agents = ctx.db
      .prepare(
        `SELECT pa.agent_id, pa.chatty, pa.cooldown_until, pa.response_pending,
                a.name, a.model, a.reasoning, a.file_tools
           FROM project_agents pa
           JOIN agents a ON a.id = pa.agent_id
          WHERE pa.project_id = ? AND a.deleted = 0
          ORDER BY a.name`,
      )
      .all(project.id);
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
      ...projectPublic(ctx.db, project),
      // No games origin means the request carried no usable hostname to build
      // one from, which is a null play url rather than a URL around a guess.
      play_url: isChat || !ctx.gamesUrl ? null : `${ctx.gamesUrl}/${project.slug}/`,
      agents: agents.map((a) => ({
        agent_id: a.agent_id,
        name: a.name,
        model: a.model,
        reasoning: a.reasoning === 1,
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
    const name = requireString(body.name, 'name', { max: MAX_PROJECT_NAME });
    ctx.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, project.id);
    ctx.broker.broadcast('project.updated', {
      slug: project.slug, name, archived: project.archived === 1,
    });
    json(ctx.res, 200, { slug: project.slug, name });
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
      const info = ctx.db
        .prepare(
          `INSERT INTO projects (slug, name, kind, created_by, created_at)
           VALUES (?, ?, 'game', ?, ?)`,
        )
        .run(slug, name, user.id, now);
      const id = Number(info.lastInsertRowid);
      // The helpers come along; their cooldowns and pending flags do not.
      const attached = ctx.db
        .prepare('SELECT agent_id, chatty FROM project_agents WHERE project_id = ?')
        .all(source.id);
      for (const a of attached) {
        ctx.db
          .prepare(
            `INSERT INTO project_agents (project_id, agent_id, chatty, attached_by, attached_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(id, a.agent_id, a.chatty, user.id, now);
      }
      // Says where it came from, in the thread, where a kid will see it.
      ctx.db
        .prepare(
          `INSERT INTO messages (project_id, kind, body, created_at)
           VALUES (?, 'system', ?, ?)`,
        )
        .run(id, `This game started as a copy of "${source.name}".`, now);
      return ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    });

    ctx.broker.broadcast('project.new', { slug: row.slug, name: row.name, kind: row.kind });
    json(ctx.res, 201, projectPublic(ctx.db, row));
  });

  // Publishing lists a game in the public catalog. It does not change who can
  // play it — every game has always been playable by link (spec.md §7); this
  // is only about being findable.
  r.post('/api/projects/:slug/publish', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx);
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
    requireAuth(ctx);
    const slug = requireSlug(ctx.params.slug);
    const project = ctx.db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug);
    if (!project) throw new HttpError(404, 'no such project');

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
