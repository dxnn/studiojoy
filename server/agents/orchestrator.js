import path from 'node:path';
import { tx } from '../db.js';
import { listTree, readFileAt } from '../files/tree.js';
import { commitPaths, currentSha } from '../files/git.js';
import { hasErrors, listErrors } from '../runtime.js';
import { tokensCharged, DEFAULT_MAX_TOKENS } from '../llm/deepseek.js';
import {
  hasBudget, consumeBudget, DEFAULT_DAILY_TOKEN_BUDGET,
} from '../budget.js';
import { messagePublic, agentAuthorFor } from '../routes/helpers.js';
import { parseMentions, agentEligible } from './mentions.js';
import { createToolset } from './tools.js';

// Context budgets (spec.md §8). DeepSeek's window is 1,048,576 tokens, so
// these caps are about cost and latency rather than capability — roughly
// 200K tokens against a 1M ceiling. Prompt caching makes re-sending a stable
// prefix cheap, which is why files are emitted in a deterministic order.
const AMBIENT_BYTES = 400 * 1024;
const HISTORY_BYTES = 200 * 1024;
const MAX_HISTORY_MESSAGES = 200;

// How many recent human turns' context_paths count as pinned.
const PINNED_TURNS = 3;

const DEFAULT_COOLDOWN_MS = 5_000;
// A whole small game is index.html, a stylesheet and four or five scripts,
// and the model reads a file or two before it patches. At 8 turns it ran out
// mid-build routinely, because DeepSeek usually emits one or two calls per
// turn — so turns bound first and 12 tool calls were never reached. These are
// runaway guards, not a work allowance; the daily token budget is what caps
// cost.
const MAX_ASSISTANT_TURNS = 24;
const MAX_TOOL_CALLS = 40;
// Times an agent may pick up where it left off after exhausting its turns,
// counted from the last human message. Without this a stall needs a human to
// type "keep going", which is the whole complaint.
const MAX_CONTINUATIONS = 3;

// A tool call cut off mid-arguments wrote nothing at all — the JSON never
// parsed, so there was no path and no content. The model does not know that
// and its reply says the file was written, so it has to be told, or a game
// gets committed with a hole in it.
const CUT_NOTICE = '[studio] Your last reply was cut off before a tool call'
  + ' finished, so that file was NOT written and nothing was saved for it.'
  + ' Write it again, smaller: one file per call, and split a long file into'
  + ' several shorter ones.';

const BRIEF_FILE = 'BRIEF.md';
const MAX_COMMIT_SUBJECT = 72;

function firstLine(text) {
  const line = String(text ?? '').trim().split('\n')[0] ?? '';
  return line.length > MAX_COMMIT_SUBJECT
    ? `${line.slice(0, MAX_COMMIT_SUBJECT - 1)}…`
    : line;
}

// Games only. A chat gets no preamble at all: every sentence here is about a
// working tree it does not have, and an agent in a chat is whatever its
// description says it is, with nothing from the studio layered on top.
function studioPreamble({ project, canEdit, maxAssistantTurns, maxToolCalls }) {
  const lines = [
    `You are an agent in Game Studio, working with people on the browser game "${project.name}".`,
    'The project is a working tree of files. Every change is committed to git, so nothing is unrecoverable.',
    '',
    'Paths are project-relative and / separated: no leading slash, no "..", no ".git", at most 8 segments.',
  ];
  if (canEdit) {
    lines.push(
      '',
      'You have file tools. Prefer patch_file over write_file when changing a file that already exists —',
      'it is cheaper and cannot silently lose the parts you did not mean to touch.',
      'Split a game across files (index.html, js/, css/, assets/) rather than emitting one enormous file.',
      '',
      `This reply gets at most ${maxAssistantTurns} turns and ${maxToolCalls} tool calls, then it is cut off`,
      'wherever it happens to be. Several tool calls in one turn cost one turn, so send them together:',
      'a turn spent on a single read is a turn you do not get back. If you can see you will not finish,',
      'stop and say what is left rather than being cut off mid-file.',
    );
  } else {
    lines.push(
      '',
      'You have no file tools. You can read and discuss the project but not change it.',
    );
  }
  lines.push(
    '',
    'The game is served from a different origin than the studio, so absolute URLs back to the studio',
    'will not resolve. Use relative paths inside the game.',
    '',
    'Keep your reply short — a note on what you did or think. The files carry the detail.',
  );
  return lines.join('\n');
}

// Paths the humans pointed at recently. Pinned files are never dropped by the
// byte cap and are labelled in the prompt.
function pinnedPaths(db, projectId) {
  const recentTurns = db
    .prepare(
      `SELECT id FROM messages
        WHERE project_id = ? AND user_id IS NOT NULL
        ORDER BY id DESC LIMIT ?`,
    )
    .all(projectId, PINNED_TURNS)
    .map((r) => r.id);
  if (recentTurns.length === 0) return new Set();
  const placeholders = recentTurns.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT DISTINCT path FROM message_context WHERE message_id IN (${placeholders})`)
    .all(...recentTurns);
  return new Set(rows.map((r) => r.path));
}

async function buildFileBlock(db, project, dir) {
  const { files } = await listTree(dir);
  const pinned = pinnedPaths(db, project.id);
  // A file already on disk that path validation refuses is listed but never
  // opened — no tool could act on it anyway.
  const usable = files.filter((f) => !f.unreachable);
  const texts = usable.filter((f) => f.text);
  const binaries = usable.filter((f) => !f.text);

  // Pinned files are included unconditionally. Unpinned ones are taken
  // smallest-first, which means the largest are the ones the cap drops.
  const included = new Set();
  let used = 0;
  for (const file of texts) {
    if (!pinned.has(file.path)) continue;
    included.add(file.path);
    used += file.size;
  }
  const unpinned = texts
    .filter((f) => !pinned.has(f.path))
    .sort((a, b) => a.size - b.size);
  for (const file of unpinned) {
    if (used + file.size > AMBIENT_BYTES) continue;
    included.add(file.path);
    used += file.size;
  }

  // Deterministic emission order — pinned first, then alphabetical — so the
  // prompt prefix stays stable between turns and the cache keeps hitting.
  const ordered = [...texts].sort((a, b) => {
    const rank = (f) => (pinned.has(f.path) ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.path < b.path ? -1 : 1;
  });

  const parts = [];
  parts.push(
    'PROJECT FILES\n'
    + (usable.length
      ? usable.map((f) => `${f.path} (${f.size} bytes)`).join('\n')
      : '(the project has no files yet)'),
  );

  const omitted = [];
  for (const file of ordered) {
    if (!included.has(file.path)) {
      omitted.push(file.path);
      continue;
    }
    const buffer = await readFileAt(path.join(dir, file.path));
    if (buffer === null) continue;
    const label = pinned.has(file.path) ? ' [pinned by the user]' : '';
    parts.push(
      `--- FILE: ${file.path} (${file.size} bytes)${label} ---\n`
      + `${buffer.toString('utf8')}\n--- END FILE ---`,
    );
  }
  for (const file of binaries) {
    parts.push(`[binary: ${file.path}, ${file.size} bytes]`);
  }
  if (omitted.length > 0) {
    parts.push(`(left out for size — call read_file if you need them: ${omitted.join(', ')})`);
  }
  return parts.join('\n\n');
}

// What the game said when someone played it. Only the current version's
// problems: a row is stamped with the commit it happened on, so a fix retires
// it rather than leaving the agent chasing something it already repaired.
async function buildErrorBlock(db, project, dir) {
  if (!hasErrors(db, project.id)) return null;
  const rows = listErrors(db, project.id, await currentSha(dir));
  if (rows.length === 0) return null;
  const lines = rows.map((row) => {
    const where = row.location ? `${row.location} — ` : '';
    const repeats = row.times > 1 ? ` (${row.times} times)` : '';
    return `- ${where}${row.message}${repeats}`;
  });
  return 'PROBLEMS THE RUNNING GAME REPORTED\n'
    + '(from this version of the files, while someone was playing it in the studio)\n'
    + lines.join('\n');
}

function historyTurns(db, project, agent, lastFiredMaxId = 0) {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM messages WHERE project_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`,
    )
    .all(project.id, MAX_HISTORY_MESSAGES);

  const userNames = new Map(
    db.prepare('SELECT id, display_name FROM users').all().map((u) => [u.id, u.display_name]),
  );
  const agentNames = new Map(
    db.prepare('SELECT id, name FROM agents').all().map((a) => [a.id, a.name]),
  );

  const mapped = [];
  for (const row of rows) {
    if (!row.body) continue;
    if (row.kind === 'system') {
      mapped.push({ id: row.id, role: 'user', text: `[studio] ${row.body}` });
    } else if (row.agent_id === agent.id) {
      // Only this agent's own messages are assistant turns; another agent's
      // reply is context, not something this one said.
      mapped.push({ id: row.id, role: 'assistant', text: row.body });
    } else if (row.agent_id !== null) {
      mapped.push({
        id: row.id, role: 'user', text: `[${agentNames.get(row.agent_id) ?? 'agent'}] ${row.body}`,
      });
    } else {
      mapped.push({
        id: row.id, role: 'user', text: `[${userNames.get(row.user_id) ?? 'someone'}] ${row.body}`,
      });
    }
  }

  // A message posted while this agent was streaming has a lower id than the
  // reply it never saw. Left in id order the transcript would end with the
  // agent's own turn, so the next fire would find nothing to answer and the
  // dirty bit would produce a no-op. Float this agent's own post-snapshot
  // replies ahead of everyone else's, so the sequence still ends with a human.
  let turns = mapped;
  if (lastFiredMaxId > 0) {
    const before = mapped.filter((m) => m.id <= lastFiredMaxId);
    const after = mapped.filter((m) => m.id > lastFiredMaxId);
    const mine = after.filter((m) => m.role === 'assistant');
    const theirs = after.filter((m) => m.role !== 'assistant');
    turns = [...before, ...mine, ...theirs];
  }

  // Trim from the front, always keeping the newest turn.
  let total = turns.reduce((sum, t) => sum + t.text.length, 0);
  while (turns.length > 1 && total > HISTORY_BYTES) {
    total -= turns[0].text.length;
    turns.shift();
  }

  // Collapse consecutive same-role turns; past tool calls are never replayed,
  // so no stale tool_call_id can dangle.
  const collapsed = [];
  for (const turn of turns) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.role === turn.role) last.text += `\n\n${turn.text}`;
    else collapsed.push({ ...turn });
  }
  return collapsed;
}

async function buildContext({
  db, project, dir, agent, lastFiredMaxId = 0,
  maxAssistantTurns = MAX_ASSISTANT_TURNS, maxToolCalls = MAX_TOOL_CALLS,
}) {
  const turns = historyTurns(db, project, agent, lastFiredMaxId);
  // The model needs something to answer. If the newest turn is this agent's
  // own reply there is nothing to respond to.
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') return null;

  // In a chat there is no directory, so no brief and no files — and no
  // preamble either. The system prompt is the agent's description and
  // nothing else; empty is allowed, and sends no system message at all.
  const isChat = project.kind === 'chat';
  const brief = isChat ? null : await readFileAt(path.join(dir, BRIEF_FILE));
  const system = [
    isChat ? null : studioPreamble({
      project, canEdit: agent.file_tools, maxAssistantTurns, maxToolCalls,
    }),
    brief ? `Project brief (${BRIEF_FILE}):\n${brief.toString('utf8')}` : null,
    agent.description || null,
  ].filter(Boolean).join('\n\n');

  const messages = turns.map((t) => ({ role: t.role, content: t.text }));
  if (!isChat) {
    const fileBlock = await buildFileBlock(db, project, dir);
    const errorBlock = await buildErrorBlock(db, project, dir);
    const last = messages[messages.length - 1];
    // Files first and errors after, next to the message: the file block is
    // the stable prefix prompt caching pays for, and the errors change on
    // every playthrough.
    last.content = [fileBlock, errorBlock, last.content].filter(Boolean).join('\n\n');
  }
  return { system, messages };
}

function postSystemMessage(db, broker, { project, agentId, body }) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO messages (project_id, agent_id, kind, body, created_at)
       VALUES (?, ?, 'system', ?, ?)`,
    )
    .run(project.id, agentId, body, now);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid));
  broker.broadcast('message.new', messagePublic(db, row, project.slug));
}

export function createOrchestrator({
  db,
  broker,
  mutex,
  llm,
  gamesDir = 'games',
  dailyTokenBudget = DEFAULT_DAILY_TOKEN_BUDGET,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  maxAssistantTurns = MAX_ASSISTANT_TURNS,
  maxToolCalls = MAX_TOOL_CALLS,
  maxContinuations = MAX_CONTINUATIONS,
}) {
  if (!llm) throw new Error('createOrchestrator requires an llm');

  const timers = new Map();
  // Agents mid-fire. A message arriving now sets the dirty bit; the running
  // fire picks it up when it finishes.
  const firing = new Set();
  // project_agents.id -> MAX(messages.id) when that agent last fired
  // successfully. Used to reorder context so a message that arrived
  // mid-stream is presented after the reply that never saw it. Lost on
  // restart, which only costs one turn of ordering.
  const lastFired = new Map();
  // project_agents.id -> continuations spent since the last human message.
  // A fresh human turn is a fresh allowance, so this is cleared there.
  const continued = new Map();

  function schedule(projectAgentId, readyAtMs) {
    const now = Date.now();
    if (readyAtMs <= now) {
      fireAgent(projectAgentId).catch((err) => console.error('fireAgent failed', err));
      return;
    }
    if (timers.has(projectAgentId)) return;
    const timer = setTimeout(() => {
      timers.delete(projectAgentId);
      fireAgent(projectAgentId).catch((err) => console.error('fireAgent failed', err));
    }, readyAtMs - now);
    timer.unref?.();
    timers.set(projectAgentId, timer);
  }

  // Only human messages make agents eligible — bot-to-bot dampening. Agents
  // still see each other's replies as context.
  function onHumanMessage(project, message) {
    if (project.archived) return;
    const mentions = parseMentions(message.body);
    const attached = db
      .prepare(
        `SELECT pa.id, pa.chatty, pa.cooldown_until, a.name
           FROM project_agents pa
           JOIN agents a ON a.id = pa.agent_id
          WHERE pa.project_id = ? AND a.deleted = 0`,
      )
      .all(project.id);

    for (const row of attached) {
      if (!agentEligible({ name: row.name, chatty: row.chatty === 1 }, mentions)) continue;
      continued.delete(row.id);
      db.prepare('UPDATE project_agents SET response_pending = 1 WHERE id = ?').run(row.id);
      if (firing.has(row.id)) continue;
      const readyAt = row.cooldown_until ? new Date(row.cooldown_until).getTime() : 0;
      schedule(row.id, readyAt);
    }
  }

  async function fireAgent(projectAgentId) {
    const row = db
      .prepare(
        `SELECT pa.id, pa.project_id, pa.agent_id, pa.response_pending,
                a.name AS agent_name, a.description, a.model, a.reasoning,
                a.file_tools, a.deleted,
                p.slug, p.name AS project_name, p.kind, p.archived
           FROM project_agents pa
           JOIN agents a ON a.id = pa.agent_id
           JOIN projects p ON p.id = pa.project_id
          WHERE pa.id = ?`,
      )
      .get(projectAgentId);
    if (!row || row.response_pending !== 1 || row.deleted) return;

    const project = {
      id: row.project_id, slug: row.slug, name: row.project_name, kind: row.kind,
    };
    const clearPending = () => db
      .prepare('UPDATE project_agents SET response_pending = 0 WHERE id = ?')
      .run(row.id);

    if (row.archived) {
      clearPending();
      return;
    }

    // Claim the flag before any await, so a message arriving mid-fire sets it
    // again rather than being swallowed.
    clearPending();
    firing.add(row.id);

    const emit = (event, data = {}) => broker.broadcast(event, {
      project_slug: row.slug, agent_id: row.agent_id, ...data,
    });

    try {
      if (!hasBudget(db, dailyTokenBudget)) {
        postSystemMessage(db, broker, {
          project,
          agentId: row.agent_id,
          body: `${row.agent_name} could not reply: the studio is out of tokens for today.`,
        });
        return;
      }

      // null for a chat: there is no such directory, and nothing may go
      // looking for one.
      const dir = row.kind === 'chat' ? null : path.join(path.resolve(gamesDir), row.slug);
      const agent = {
        id: row.agent_id,
        name: row.agent_name,
        description: row.description,
        model: row.model,
        reasoning: row.reasoning === 1,
        file_tools: row.file_tools === 1,
      };
      // Snapshot before streaming: anything with a higher id arrived while
      // this reply was being written and was therefore unseen by it.
      const snapshot = db
        .prepare('SELECT COALESCE(MAX(id), 0) AS n FROM messages WHERE project_id = ?')
        .get(project.id).n;
      const context = await buildContext({
        db, project, dir, agent, lastFiredMaxId: lastFired.get(row.id) ?? 0,
        maxAssistantTurns, maxToolCalls,
      });
      if (!context) return;

      const toolset = agent.file_tools && dir !== null
        ? createToolset({ dir, mutex, slug: row.slug })
        : null;

      emit('agent.stream.start');

      const messages = [...context.messages];
      let replyText = '';
      let charged = 0;
      let toolCallCount = 0;
      // Whether the turn that ended the loop left a cut-off call unanswered.
      // A cut that a later turn rewrote successfully is not worth reporting.
      let pendingCut = false;
      let hitLength = false;
      let hitLimit = null;

      for (let turn = 0; turn < maxAssistantTurns; turn += 1) {
        let text = '';
        const calls = [];
        let cutCalls = 0;
        try {
          const stream = llm.stream({
            model: agent.model,
            system: context.system,
            messages,
            tools: toolset ? toolset.definitions : null,
            reasoning: agent.reasoning,
            maxTokens: DEFAULT_MAX_TOKENS,
          });
          for await (const event of stream) {
            if (event.type === 'reasoning') {
              // Streamed for the UI, never persisted and never replayed.
              emit('agent.stream.reasoning', { delta: event.text });
            } else if (event.type === 'delta') {
              text += event.text;
              emit('agent.stream.chunk', { delta: event.text });
            } else if (event.type === 'tool_use') {
              calls.push(event);
            } else if (event.type === 'tool_use_failed') {
              cutCalls += 1;
            } else if (event.type === 'end') {
              if (event.finish_reason === 'length') hitLength = true;
              charged += tokensCharged(event.usage);
            }
          }
        } catch (err) {
          console.error('agent stream failed', err);
          emit('agent.stream.end', { error: true });
          consumeBudget(db, charged);
          return;
        }

        if (text) replyText += replyText ? `\n\n${text}` : text;
        pendingCut = cutCalls > 0;

        // Nothing to run and nothing cut off: a plain reply, so the turn is
        // done. A cut call is not "done" — it is a file that never landed,
        // and the loop keeps going so the model can write it again.
        if (calls.length === 0 && cutCalls === 0) break;

        if (calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: text || null,
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.input) },
            })),
          });

          for (const call of calls) {
            if (toolCallCount >= maxToolCalls) {
              hitLimit = 'tool';
              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: 'refused: this turn has reached its tool call limit',
              });
              continue;
            }
            emit('agent.tool', { tool: call.name, path: call.input?.path ?? null });
            const result = await toolset.run(call.name, call.input);
            messages.push({ role: 'tool', tool_call_id: call.id, content: result });
            toolCallCount += 1;
          }
          if (hitLimit) break;
        } else if (text) {
          // No valid call to answer, so this turn's prose stands on its own.
          messages.push({ role: 'assistant', content: text });
        }

        if (cutCalls > 0) messages.push({ role: 'user', content: CUT_NOTICE });
        if (turn === maxAssistantTurns - 1) hitLimit = 'turn';
      }

      consumeBudget(db, charged);
      // The reply is written; from here on, anything newer than the snapshot
      // is something this agent has not seen.
      lastFired.set(row.id, snapshot);

      const changed = toolset ? toolset.changedPaths() : [];
      let commitSha = null;
      if (changed.length > 0) {
        const subject = firstLine(replyText) || 'update files';
        commitSha = await mutex.run(row.slug, () => commitPaths(
          dir, changed, `${row.agent_name}: ${subject}`, agentAuthorFor(agent, row.slug),
        ));
      }

      if (!replyText && changed.length === 0) {
        // Neither prose nor files: nothing worth a message row.
        emit('agent.stream.end');
      } else {
        const now = new Date().toISOString();
        const messageId = tx(db, () => {
          const info = db
            .prepare(
              `INSERT INTO messages (project_id, agent_id, body, created_at, tokens)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(project.id, agent.id, replyText, now, charged);
          const id = Number(info.lastInsertRowid);
          // A write of identical bytes produces no commit, so there is
          // nothing to record and nothing changed to report.
          if (commitSha) {
            for (const [filePath, change] of toolset.changes) {
              db.prepare(
                `INSERT INTO message_writes (message_id, path, action, bytes, commit_sha)
                 VALUES (?, ?, ?, ?, ?)`,
              ).run(id, filePath, change.action, change.bytes, commitSha);
            }
          }
          return id;
        });

        const stored = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
        broker.broadcast('message.new', messagePublic(db, stored, row.slug));
        emit('agent.stream.end', { message_id: messageId });
        if (commitSha) {
          broker.broadcast('files.changed', { project_slug: row.slug, paths: changed });
        }
      }

      // Explain a missing file rather than leaving it looking like a backend
      // fault (spec.md §8). Only the final turn's cut matters: an earlier one
      // the model was told about and rewrote is not a missing file.
      if (pendingCut || (hitLength && changed.length === 0)) {
        postSystemMessage(db, broker, {
          project,
          agentId: agent.id,
          body: `${row.agent_name} ran out of output budget mid-reply; a file may be missing or incomplete.`,
        });
      } else if (hitLimit === 'tool') {
        postSystemMessage(db, broker, {
          project,
          agentId: agent.id,
          body: `${row.agent_name} stopped after ${maxToolCalls} tool calls in one turn.`,
        });
      } else if (hitLimit === 'turn') {
        // Out of turns mid-build. Rather than making a human type "keep
        // going", re-arm the agent and let it pick up where it stopped.
        // The system message is not decoration: a 'system' row enters the
        // transcript as a user turn, which is what gives the next fire
        // something to answer — without it the agent's own reply would be
        // newest and the fire would no-op.
        const used = continued.get(row.id) ?? 0;
        if (used < maxContinuations && hasBudget(db, dailyTokenBudget)) {
          continued.set(row.id, used + 1);
          postSystemMessage(db, broker, {
            project,
            agentId: agent.id,
            body: `${row.agent_name} is not finished yet — carrying on from where they stopped.`,
          });
          db.prepare('UPDATE project_agents SET response_pending = 1 WHERE id = ?')
            .run(row.id);
        } else {
          postSystemMessage(db, broker, {
            project,
            agentId: agent.id,
            body: `${row.agent_name} stopped after ${maxAssistantTurns} turns without finishing. Ask them to keep going if you want more.`,
          });
        }
      }
    } finally {
      firing.delete(row.id);
      try {
        // Cooldown runs from the end of the response, not its start.
        const readyAt = Date.now() + cooldownMs;
        db.prepare('UPDATE project_agents SET cooldown_until = ? WHERE id = ?')
          .run(new Date(readyAt).toISOString(), row.id);
        const fresh = db
          .prepare('SELECT response_pending FROM project_agents WHERE id = ?')
          .get(row.id);
        if (fresh?.response_pending === 1) schedule(row.id, readyAt);
      } catch (err) {
        // A fire can outlive the process it belongs to — a test closing its
        // fixture, or a shutdown mid-reply. There is nothing to record
        // against a closed database, and anything else here is worth seeing.
        if (err.code !== 'ERR_INVALID_STATE') throw err;
      }
    }
  }

  return {
    onHumanMessage,
    // Test seams.
    _fireAgent: fireAgent,
    _buildContext: buildContext,
    _isFiring: (id) => firing.has(id),
    _pendingTimers: () => timers.size,
  };
}
