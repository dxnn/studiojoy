import { json, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { checkSlug, slugify, requireSlug } from '../files/paths.js';
import { initRepo, isRepo } from '../files/git.js';
import { listTree } from '../files/tree.js';
import {
  requireProject, projectDirFor, authorFor, requireString, messagePublic,
} from './helpers.js';
import { PROJECT_KINDS } from '../db.js';

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
    const files = isChat ? [] : (await listTree(projectDirFor(ctx, project))).files;

    json(ctx.res, 200, {
      ...projectPublic(ctx.db, project),
      play_url: isChat ? null : `${ctx.gamesUrl}/${project.slug}/`,
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
