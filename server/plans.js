// A plan: what the builder's sizing call split a request into, and how far
// it has got. One row per plan card — the `messages` row of kind 'plan' the
// chat shows as a checklist — with the pieces as JSON, because a piece is read
// and written whole and nothing queries inside one (spec.md §3, §8). Beside
// the pieces, the plan's words: a summary and the assumptions the planner
// made, which a person reads and changes before a plan of two or more is
// built.
//
// Status: 'draft' while a plan of two or more waits for Build it; 'queued'
// between the press and the builder picking it up; 'running' while pieces are
// being done; 'paused' when a message arrived mid-plan or the studio
// restarted; 'done'; or 'dropped', when a later sizing replaced it or the
// person said to stop. A plan of one is born running.

import { planBody } from './agents/sizing.js';

export function createPlan(db, {
  messageId, projectId, chatId, request, pieces, now = new Date().toISOString(),
  summary = '', assumptions = [], begun = false, status = 'running',
}) {
  db.prepare(
    `INSERT INTO plans (message_id, project_id, chat_id, request, pieces, status, created_at, updated_at,
                        summary, assumptions, begun)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    messageId, projectId, chatId, request,
    JSON.stringify(pieces.map((p) => ({ ...p, status: 'todo', message_id: null, note: null }))),
    status, now, now, summary, JSON.stringify(assumptions), begun ? 1 : 0,
  );
  return planFor(db, messageId);
}

const parse = (row) => (row ? {
  ...row,
  pieces: JSON.parse(row.pieces),
  summary: row.summary ?? '',
  assumptions: row.assumptions ? JSON.parse(row.assumptions) : [],
} : null);

export const planFor = (db, messageId) => parse(
  db.prepare('SELECT * FROM plans WHERE message_id = ?').get(messageId),
);

// The plan a new message in this chat would pick up: the newest paused one.
export const pausedPlan = (db, chatId) => parse(
  db.prepare(
    `SELECT * FROM plans WHERE chat_id = ? AND status = 'paused'
      ORDER BY message_id DESC LIMIT 1`,
  ).get(chatId),
);

// A plan waiting to be built, and one somebody just pressed Build on.
export const draftPlan = (db, chatId) => parse(
  db.prepare(
    `SELECT * FROM plans WHERE chat_id = ? AND status = 'draft'
      ORDER BY message_id DESC LIMIT 1`,
  ).get(chatId),
);
export const queuedPlan = (db, chatId) => parse(
  db.prepare(
    `SELECT * FROM plans WHERE chat_id = ? AND status = 'queued'
      ORDER BY message_id DESC LIMIT 1`,
  ).get(chatId),
);

export function setPlanStatus(db, messageId, status, now = new Date().toISOString()) {
  db.prepare('UPDATE plans SET status = ?, updated_at = ? WHERE message_id = ?')
    .run(status, now, messageId);
  return planFor(db, messageId);
}

export function setPiece(db, messageId, index, patch, now = new Date().toISOString()) {
  const plan = planFor(db, messageId);
  if (!plan || !plan.pieces[index]) return plan;
  plan.pieces[index] = { ...plan.pieces[index], ...patch };
  db.prepare('UPDATE plans SET pieces = ?, updated_at = ? WHERE message_id = ?')
    .run(JSON.stringify(plan.pieces), now, messageId);
  return planFor(db, messageId);
}

// A person's edit to a draft or a paused plan (spec.md §6, §8): the words and
// the pieces still to do, the done ones kept as they are. Marked edited, so
// Build sizes the person's words again rather than running them as written.
export function editPlan(db, messageId, {
  summary, assumptions, pieces, now = new Date().toISOString(),
}) {
  const plan = planFor(db, messageId);
  if (!plan) return null;
  const done = plan.pieces.filter((p) => p.status === 'done');
  const left = pieces === undefined
    ? plan.pieces.filter((p) => p.status !== 'done')
    : pieces.map((p) => ({ ...p, status: 'todo', message_id: null, note: null }));
  db.prepare(
    `UPDATE plans SET summary = ?, assumptions = ?, pieces = ?, edited = 1, updated_at = ?
      WHERE message_id = ?`,
  ).run(
    summary ?? plan.summary, JSON.stringify(assumptions ?? plan.assumptions),
    JSON.stringify([...done, ...left]), now, messageId,
  );
  return planFor(db, messageId);
}

// What the pieces still to do become once an edited plan has been sized
// again on Build: the done ones kept, the rest replaced, the edit settled.
export function settlePieces(db, messageId, left, now = new Date().toISOString()) {
  const plan = planFor(db, messageId);
  if (!plan) return null;
  const done = plan.pieces.filter((p) => p.status === 'done');
  db.prepare('UPDATE plans SET pieces = ?, edited = 0, updated_at = ? WHERE message_id = ?').run(
    JSON.stringify([...done, ...left.map((p) => ({ ...p, status: 'todo', message_id: null, note: null }))]),
    now, messageId,
  );
  return planFor(db, messageId);
}

// The Build press: the plan is the builder's to pick up, charged to whoever
// pressed. The pieces are the ones on the row; whether they are sized again
// first is `edited`'s to say.
export function queuePlan(db, messageId, userId, now = new Date().toISOString()) {
  db.prepare("UPDATE plans SET status = 'queued', built_by = ?, updated_at = ? WHERE message_id = ?")
    .run(userId, now, messageId);
  return planFor(db, messageId);
}

// A restart mid-plan: nothing is running any more, and the next message in
// that chat picks the rest up, the way an interruption does. A plan pressed
// but never picked up goes back to waiting for the press.
export function pauseRunningPlans(db, now = new Date().toISOString()) {
  db.prepare("UPDATE plans SET status = 'paused', updated_at = ? WHERE status = 'running'")
    .run(now);
  db.prepare("UPDATE plans SET status = 'draft', updated_at = ? WHERE status = 'queued'")
    .run(now);
}

// What the card shows, and what its body is written from (spec.md §8): the
// plan's words, and per piece its status — todo, running, done — its headline
// (`note`, the closing paragraph of its reply), the files it changed, and the
// id of its row, which lives behind the card and is opened from it.
const pieceWrites = (db, messageId) => db
  .prepare('SELECT path FROM message_writes WHERE message_id = ? ORDER BY path')
  .all(messageId)
  .map((w) => w.path);

export const planPublic = (db, plan) => (plan ? {
  status: plan.status,
  summary: plan.summary,
  assumptions: plan.assumptions,
  edited: plan.edited === 1,
  pieces: plan.pieces.map((p) => ({
    title: p.title,
    files: p.files,
    what: p.what,
    status: p.status,
    message_id: p.message_id,
    note: p.note ?? null,
    writes: p.message_id ? pieceWrites(db, p.message_id) : [],
  })),
} : null);

// The card moving along: the checklist to every tab, and the card's own body
// rewritten from the same shape — it is what the thread shows for the plan
// and what history replays, so it carries the plan's words, each piece's
// headline and the files it changed (spec.md §8, §9).
export function announcePlan(db, broker, slug, plan) {
  const shown = planPublic(db, plan);
  const body = planBody(shown.pieces, {
    status: plan.status, begun: plan.begun === 1, summary: plan.summary, assumptions: plan.assumptions,
  });
  // The card's token note is the pieces' cost so far, summed from their rows
  // behind it: one number for the plan where a reply has one for itself. Null
  // until a piece has landed, as a reply's is until it costs.
  const tokens = db
    .prepare('SELECT SUM(tokens) AS n FROM messages WHERE plan_message_id = ?')
    .get(plan.message_id).n;
  db.prepare('UPDATE messages SET body = ?, tokens = ? WHERE id = ?').run(body, tokens, plan.message_id);
  broker.broadcast('plan.update', {
    project_slug: slug,
    chat_id: plan.chat_id,
    message_id: plan.message_id,
    body,
    tokens,
    plan: shown,
  });
  return body;
}
