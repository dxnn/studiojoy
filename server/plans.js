// A plan: what the builder's sizing call split a big request into, and how far
// it has got. One row per plan card — the `messages` row of kind 'plan' the
// chat shows as a checklist — with the pieces as JSON, because a piece is read
// and written whole and nothing queries inside one (spec.md §3, §8).
//
// Status: 'running' while pieces are being done; 'paused' when a message
// arrived mid-plan or the studio restarted; 'done'; or 'dropped', when a later
// sizing replaced it or the person said to stop.

export function createPlan(db, {
  messageId, projectId, chatId, request, pieces, now = new Date().toISOString(),
}) {
  db.prepare(
    `INSERT INTO plans (message_id, project_id, chat_id, request, pieces, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`,
  ).run(
    messageId, projectId, chatId, request,
    JSON.stringify(pieces.map((p) => ({ ...p, status: 'todo', message_id: null, note: null }))),
    now, now,
  );
  return planFor(db, messageId);
}

const parse = (row) => (row ? { ...row, pieces: JSON.parse(row.pieces) } : null);

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

// A restart mid-plan: nothing is running any more, and the next message in
// that chat picks the rest up, the way an interruption does.
export function pauseRunningPlans(db, now = new Date().toISOString()) {
  db.prepare("UPDATE plans SET status = 'paused', updated_at = ? WHERE status = 'running'")
    .run(now);
}

// What the card shows, and what its body is written from (spec.md §8): per
// piece its status — todo, running, done — its headline (`note`, the closing
// paragraph of its reply), the files it changed, and the id of its row, which
// lives behind the card and is opened from it.
const pieceWrites = (db, messageId) => db
  .prepare('SELECT path FROM message_writes WHERE message_id = ? ORDER BY path')
  .all(messageId)
  .map((w) => w.path);

export const planPublic = (db, plan) => (plan ? {
  status: plan.status,
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
