// Is one builder prompt better than another? The studio's real orchestrator —
// sizing, plans, Build it, pieces, the tool loop, commits — against the live
// API, on ten fixed asks a few times each, and a score over what came out.
//
//   env NODE_OPTIONS=--use-env-proxy node probes/probe-prompt-eval.mjs run <label>
//   node probes/probe-prompt-eval.mjs score <label> [<label> …] > probes/probe-prompt-eval.out
//   node probes/probe-prompt-eval.mjs pairs <labelA> <labelB>
//
// `run` answers with whatever prompt this checkout sends, so a prompt version
// is a commit and two labels are two checkouts' runs. Each run's record,
// its before and after trees and its diff land in tmp/prompt-eval/<label>/.
// PROBE_REPS (3), PROBE_PARALLEL (4) and PROBE_ASKS (keys, comma separated)
// narrow it. ⚠️ It costs money; the score reads only what is on disk.
//
// The score is three numbers per label: the share of mechanical checks passed
// (each check a rule the prompt exists to teach), tokens, and wall time. Read
// two labels of the same prompt first — the gap between them is the noise
// floor, and a later gap under it is no difference at all. `pairs` writes the
// same asks from two labels side by side under shuffled names, for a blind
// judge to say which did what the kid asked better.
//
// Prompt tokens are compared as totals, never as cache hits: a second label of
// the same prompt runs on the first one's warm cache.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { setup, signIn, builderChat } from '../test/helpers.js';
import { createDeepSeek, tokensCharged } from '../server/llm/deepseek.js';
import { parseSizing } from '../server/agents/sizing.js';
import { parseConfigFile } from '../public/config-file.js';
import { achievementsModel } from '../public/achievements-editor.js';
import { quizModel } from '../public/quiz-editor.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'tmp', 'prompt-eval');

// Each ask leans on one part of the prompt, so a drop points at a cut.
// `size`: reply, one (a plan of one), plan (two or more), work (either).
const ASKS = [
  { key: 'frog', template: '', size: 'plan', text: 'make a game where a frog jumps between lily pads and eats flies' },
  { key: 'slower', template: 'arcade', size: 'one', clear: true, text: 'make the meteors fall slower' },
  { key: 'freeze', template: 'arcade', size: 'work', text: 'when I lose my last life the game just freezes and I cant play again' },
  { key: 'drawship', template: 'arcade', size: 'reply', text: 'how do I draw my own spaceship?' },
  { key: 'laser', template: 'arcade', size: 'one', text: 'add a laser sound when I shoot' },
  { key: 'level5', template: 'arcade', size: 'one', text: 'give me an achievement for reaching level 5' },
  { key: 'beach', template: 'quiz', size: 'one', text: 'add 3 more questions about what you like to do at the beach' },
  { key: 'split', template: 'arcade', size: 'work', text: 'add a second kind of meteor that splits in two when you shoot it' },
  { key: 'exciting', template: 'arcade', size: 'work', clear: false, text: 'make it more exciting' },
  { key: 'tap', template: 'arcade', size: 'one', text: 'make it so you play by tapping anywhere on the screen' },
];

const DOCS = new Set(['BRIEF.md', 'SPEC.md', 'TODO.md']);
const say = (...s) => console.log(...s);

// ---------- run ----------

function keyFromDisk() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  return fs.readFileSync(path.join(ROOT, 'tmp', 'deepseek.key'), 'utf8').trim();
}

// Every call the orchestrator makes, filed under the game it is for — read
// off the preamble's first line, which names the game.
function tap(real, log) {
  const gameOf = (system) => /browser game "([^"]+)"/.exec(system ?? '')?.[1] ?? '?';
  const file = (system, rec) => {
    const name = gameOf(system);
    if (!log.has(name)) log.set(name, []);
    log.get(name).push(rec);
  };
  return {
    async complete(opts) {
      const at = Date.now();
      const last = opts.messages.at(-1)?.content ?? '';
      const rec = { type: 'complete', sizing: last.includes('[studio] Size this request.'), at };
      file(opts.system, rec);
      try {
        const r = await real.complete(opts);
        Object.assign(rec, { ms: Date.now() - at, text: r.text, finish: r.finish_reason, usage: r.usage });
        return r;
      } catch (err) {
        rec.error = err.message;
        throw err;
      }
    },
    stream(opts) {
      const at = Date.now();
      const rec = {
        type: 'stream', thinking: opts.thinking, at, tools: [], reasoning: 0, text: 0, messages: opts.messages,
      };
      file(opts.system, rec);
      const inner = real.stream(opts);
      return (async function* relay() {
        try {
          for await (const ev of inner) {
            if (ev.type === 'reasoning') rec.reasoning += ev.text?.length ?? 0;
            if (ev.type === 'delta') rec.text += ev.text?.length ?? 0;
            if (ev.type === 'tool_use') rec.tools.push(ev.name);
            if (ev.type === 'tool_use_failed') rec.tools.push(`${ev.name}:cut`);
            if (ev.type === 'end') Object.assign(rec, { finish: ev.finish_reason, usage: ev.usage });
            yield ev;
          }
        } catch (err) {
          rec.error = err.message;
          throw err;
        } finally {
          rec.ms = Date.now() - at;
        }
      })();
    },
  };
}

const git = (dir, ...args) => execFileSync('git', [
  '--git-dir', path.join(dir, '.git'), '--work-tree', dir, '-c', 'core.quotePath=false', ...args,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// The game's own text files, never studio/ or .git: what the score reads.
function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'studio') continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (/\.(js|html|css|md|json|txt|svg)$/.test(entry.name)) {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oneRun(app, log, ask, rep, dir) {
  const name = `${ask.key} ${rep}`;
  const slug = `${ask.key}-${rep}`;
  const made = await app.client.json('POST', '/api/projects', {
    body: { name, slug, ...(ask.template ? { template: ask.template } : {}) },
  });
  if (made.status !== 201) throw new Error(`${slug}: ${JSON.stringify(made.body)}`);
  const gameDir = path.join(app.gamesDir, slug);
  const before = git(gameDir, 'rev-parse', 'HEAD').trim();
  copyTree(gameDir, path.join(dir, 'before'));
  const chatId = await builderChat(app, slug);
  const project = app.db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug);
  const ca = app.db.prepare('SELECT id FROM chat_agents WHERE chat_id = ?').get(chatId);
  const started = Date.now();
  const sent = await app.client.json('POST', `/api/projects/${slug}/messages`, {
    body: { chat_id: chatId, body: ask.text },
  });
  if (sent.status >= 300) throw new Error(`${slug}: ${JSON.stringify(sent.body)}`);

  // Quiet twice in a row: nothing pending, nothing firing, no plan moving. A
  // draft is pressed as written, as a kid who reads it and agrees would.
  let quiet = 0;
  let builds = 0;
  let timedOut = false;
  while (quiet < 2) {
    await sleep(500);
    if (Date.now() - started > 15 * 60 * 1000) { timedOut = true; break; }
    const pending = app.db.prepare('SELECT response_pending FROM chat_agents WHERE id = ?').get(ca.id).response_pending;
    const moving = app.db.prepare(
      "SELECT COUNT(*) AS n FROM plans WHERE chat_id = ? AND status IN ('queued', 'running')",
    ).get(chatId).n;
    const draft = app.db.prepare(
      "SELECT message_id FROM plans WHERE chat_id = ? AND status = 'draft' ORDER BY message_id DESC LIMIT 1",
    ).get(chatId);
    if (pending || moving || app.orchestrator._isFiring(ca.id)) { quiet = 0; continue; }
    if (draft && builds < 3) {
      builds += 1;
      const res = await app.client.json('POST', `/api/plans/${draft.message_id}/build`, {});
      if (res.status !== 202) throw new Error(`${slug}: build ${res.status} ${JSON.stringify(res.body)}`);
      quiet = 0;
      continue;
    }
    quiet += 1;
  }
  const wall = Date.now() - started;

  const messages = app.db.prepare(
    'SELECT id, kind, agent_id, user_id, body, working, plan_message_id FROM messages WHERE chat_id = ? ORDER BY id',
  ).all(chatId);
  const plans = app.db.prepare('SELECT * FROM plans WHERE chat_id = ? ORDER BY message_id').all(chatId)
    .map((p) => ({ ...p, pieces: JSON.parse(p.pieces), assumptions: JSON.parse(p.assumptions || '[]') }));
  const receipts = app.db.prepare('SELECT message_id, breakdown FROM message_receipts WHERE project_id = ?')
    .all(project.id).map((r) => ({ message_id: r.message_id, ...JSON.parse(r.breakdown) }));

  // Tool results, from the arrays each fire's loop appended to.
  const calls = log.get(name) ?? [];
  const results = new Map();
  for (const call of calls) {
    for (const m of call.messages ?? []) {
      if (m.role === 'tool') results.set(m.tool_call_id, String(m.content).slice(0, 300));
    }
    delete call.messages;
  }
  const head = git(gameDir, 'rev-parse', 'HEAD').trim();
  const diff = git(gameDir, 'diff', before, head, '--', '.', ':(exclude)studio');
  copyTree(gameDir, path.join(dir, 'after'));
  fs.writeFileSync(path.join(dir, 'diff.patch'), diff);
  const record = {
    ask, rep, slug, wall, timedOut, builds, before, head, messages, plans, receipts, calls,
    toolResults: [...results.values()],
  };
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify(record, null, 2));
  return record;
}

async function run(label) {
  const reps = Number(process.env.PROBE_REPS ?? 3);
  const parallel = Number(process.env.PROBE_PARALLEL ?? 4);
  const only = process.env.PROBE_ASKS ? new Set(process.env.PROBE_ASKS.split(',')) : null;
  const log = new Map();
  const llm = tap(createDeepSeek({ apiKey: keyFromDisk() }), log);
  const app = await setup({ llm, publicDir: path.join(ROOT, 'public'), dailyTokenBudget: 1e12 });
  const user = await signIn(app);
  app.db.prepare('UPDATE users SET daily_tokens = NULL WHERE id = ?').run(user.id);

  const jobs = [];
  for (let rep = 1; rep <= reps; rep += 1) {
    for (const ask of ASKS) if (!only || only.has(ask.key)) jobs.push({ ask, rep });
  }
  const base = path.join(OUT, label);
  let next = 0;
  let spent = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { ask, rep } = jobs[next++];
      const dir = path.join(base, `${ask.key}-${rep}`);
      fs.mkdirSync(dir, { recursive: true });
      try {
        const r = await oneRun(app, log, ask, rep, dir);
        const charged = r.calls.reduce((n, c) => n + (c.usage ? tokensCharged(c.usage) : 0), 0);
        spent += charged;
        say(`${label} ${ask.key}-${rep}  ${(r.wall / 1000).toFixed(0)}s  ${r.calls.length} calls  ${charged} charged${r.timedOut ? '  TIMED OUT' : ''}`);
      } catch (err) {
        fs.writeFileSync(path.join(dir, 'error.txt'), String(err.stack));
        say(`${label} ${ask.key}-${rep}  ERROR ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  say(`${label}: ${jobs.length} runs, ${spent} tokens charged (miss-priced), ~$${(spent * 0.30 / 1e6).toFixed(2)}`);
  await app.close();
}

// ---------- score ----------

const read = (dir, rel) => {
  try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return null; }
};
function walk(dir, rel = '') {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, p));
    else out.push(p);
  }
  return out;
}

function parses(src) {
  try { new vm.Script(src); return true; } catch { /* a module, maybe */ }
  try { new vm.SourceTextModule(src); return true; } catch { return false; }
}

// Number literals a js/ file holds, as a multiset. 0, 1, 2, ½ and 1000 (a
// second in ms) are arithmetic, not tuning.
const ARITHMETIC = new Set(['0', '1', '2', '0.5', '1000']);
function literals(src) {
  const bag = new Map();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  for (const m of code.matchAll(/(?<![\w.$])(\d+\.?\d*|\.\d+)(?![\w$])/g)) {
    const n = String(Number(m[1]));
    if (!ARITHMETIC.has(n)) bag.set(n, (bag.get(n) ?? 0) + 1);
  }
  return bag;
}
function added(beforeBag, afterBag) {
  let n = 0;
  for (const [k, v] of afterBag) n += Math.max(0, v - (beforeBag.get(k) ?? 0));
  return n;
}
const jsOf = (dir) => walk(dir, 'js').map((p) => read(dir, p) ?? '').join('\n');

function checks(runDir) {
  const r = JSON.parse(fs.readFileSync(path.join(runDir, 'record.json'), 'utf8'));
  const { ask } = r;
  const B = path.join(runDir, 'before');
  const A = path.join(runDir, 'after');
  const c = {};

  // Process.
  const sizing = r.calls.find((x) => x.type === 'complete' && x.sizing);
  const sized = sizing ? parseSizing(sizing.text) : null;
  c.sized = sizing ? sized !== null : null;
  const pieces = sized?.size === 'pieces' ? sized.pieces.length : 0;
  const got = sized ? (sized.size === 'reply' ? 'reply' : pieces === 1 ? 'one' : 'plan') : null;
  c.sized_right = sized ? (ask.size === 'work' ? got !== 'reply' : got === ask.size) : false;
  c.clear_right = ask.clear !== undefined && got === 'one' && sized.clear !== null
    ? sized.clear === ask.clear : null;
  const streams = r.calls.filter((x) => x.type === 'stream');
  const ranAway = streams.some((x) => x.finish === 'length' && x.text === 0 && x.tools.length === 0);
  c.no_errors = !r.timedOut && !ranAway && !r.calls.some((x) => x.error);
  c.in_budget = !r.plans.some((p) => p.begun) && !r.plans.some((p) => ['paused', 'running', 'queued'].includes(p.status));
  const patchFails = r.toolResults.filter((t) => /^old_text (does not appear|appears \d+ times)/.test(t)).length;
  c.patches_clean = patchFails === 0;
  c.no_refusals = !r.toolResults.some((t) => t.startsWith('refused:'));
  const changed = walkDiff(runDir);
  const work = changed.filter((p) => !DOCS.has(p));
  c.changed_right = ask.size === 'reply' ? work.length === 0 : work.length > 0;

  // The tree, where the run changed it.
  if (work.length) {
    const js = walk(A).filter((p) => /^(js|config)\/.*\.js$/.test(p));
    c.js_parses = js.every((p) => parses(read(A, p)));
    const html = read(A, 'index.html') ?? '';
    const refs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map((m) => m[1])
      .filter((u) => !/^(https?:|\/\/|data:|\/)/.test(u) && !u.startsWith('studio/'));
    c.html_refs = refs.every((u) => fs.existsSync(path.join(A, u.split(/[?#]/)[0])));
    c.config_forms = walk(A, 'config').filter((p) => p.endsWith('.js')).every((p) => parseConfigFile(read(A, p)).ok);
    c.literals_in_config = added(literals(jsOf(B)), literals(jsOf(A))) <= 3;
    const keyListeners = (s) => (s.match(/addEventListener\(\s*["'`]key(down|up)/g) ?? []).length;
    c.no_own_keys = keyListeners(jsOf(A)) <= keyListeners(jsOf(B));
    const drawn = (s) => (s.match(/(fillText|textContent|innerHTML)[^;\n]*(game over|play again|press (space|enter))/gi) ?? []).length;
    c.no_drawn_screens = drawn(jsOf(A)) <= drawn(jsOf(B));
    // The editors' own readers: a file they cannot hold costs somebody an editor.
    const shapes = [];
    const ach = read(A, 'config/achievements.js');
    if (ach !== null) shapes.push(achievementsModel(ach).ok);
    const quiz = read(A, 'config/questions.js');
    if (quiz !== null) shapes.push(quizModel(quiz).ok);
    c.shapes_kept = shapes.length ? shapes.every(Boolean) : null;
    const newFiles = work.filter((p) => read(B, p) === null && !p.startsWith('config/'));
    c.brief_kept = newFiles.length ? changed.includes('BRIEF.md') : null;
  }

  // The ask's own.
  const reply = r.messages.filter((m) => m.agent_id !== null).map((m) => m.body ?? '').join('\n');
  const jsA = jsOf(A);
  const jsB = jsOf(B);
  if (ask.key === 'frog') {
    c.frog_libraries = ['Screens.title', 'State.reset', 'Screens.fit', 'Moments.say'].every((s) => jsA.includes(s))
      && (!/Input\.(held|pressed|axis)/.test(jsA) || jsA.includes('Input.update'))
      && read(A, 'config/play.js') !== null;
  }
  if (ask.key === 'slower') c.slower_config_only = work.length > 0 && work.every((p) => p.startsWith('config/'));
  if (ask.key === 'drawship') c.drawship_points = /Draw a picture/.test(reply) && /[\w-]+\.png\b/.test(reply);
  if (ask.key === 'laser') {
    c.laser_calls = (jsA.match(/Sound\.play\(/g) ?? []).length > (jsB.match(/Sound\.play\(/g) ?? []).length;
    c.laser_asks = /assets\/sounds\/[\w-]+\.wav/.test(reply) && /Make a sound/.test(reply);
  }
  if (ask.key === 'level5') {
    const t = read(A, 'config/achievements.js') ?? '';
    c.level5_rule = /moment:\s*["']level["']\s*,\s*atLeast:\s*5\b/.test(t);
  }
  if (ask.key === 'beach') {
    const q = quizModel(read(A, 'config/questions.js') ?? '');
    const q0 = quizModel(read(B, 'config/questions.js') ?? '');
    c.beach_three = q.ok && q0.ok && q.questions.length >= q0.questions.length + 3;
  }
  if (ask.key === 'tap') {
    const t = read(A, 'config/controls.js') ?? '';
    c.tap_scheme = /SCHEME\s*=\s*["']one-button["']/.test(t) && /touch:screen/.test(t);
  }

  const usage = r.calls.filter((x) => x.usage).map((x) => x.usage);
  return {
    key: ask.key,
    rep: r.rep,
    checks: c,
    prompt: usage.reduce((n, u) => n + (u.prompt_tokens ?? 0), 0),
    out: usage.reduce((n, u) => n + (u.completion_tokens ?? 0), 0),
    charged: usage.reduce((n, u) => n + tokensCharged(u), 0),
    wall: r.wall,
    patchFails,
    replyWords: (r.messages.filter((m) => m.agent_id !== null).at(-1)?.body ?? '').split(/\s+/).filter(Boolean).length,
  };
}

// Files the run changed, from its diff: what `git diff` names, renames included.
function walkDiff(runDir) {
  const diff = read(runDir, 'diff.patch') ?? '';
  return [...new Set([...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((m) => m[2]))];
}

const FAMILIES = {
  process: ['sized', 'sized_right', 'clear_right', 'no_errors', 'in_budget', 'patches_clean', 'no_refusals', 'changed_right'],
  tree: ['js_parses', 'html_refs', 'config_forms', 'literals_in_config', 'no_own_keys', 'no_drawn_screens', 'shapes_kept', 'brief_kept'],
};

function score(labels) {
  const rows = {};
  for (const label of labels) {
    const base = path.join(OUT, label);
    rows[label] = fs.readdirSync(base).sort()
      .filter((d) => fs.existsSync(path.join(base, d, 'record.json')))
      .map((d) => checks(path.join(base, d)));
  }
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
  const tally = (list, keys) => {
    let pass = 0;
    let n = 0;
    for (const row of list) {
      for (const [k, v] of Object.entries(row.checks)) {
        if (v === null || v === undefined || (keys && !keys(k))) continue;
        n += 1;
        if (v) pass += 1;
      }
    }
    return { pass, n };
  };
  const inFamily = (fam) => (k) => (fam === 'ask' ? !FAMILIES.process.includes(k) && !FAMILIES.tree.includes(k) : FAMILIES[fam].includes(k));
  const mean = (list, f) => Math.round(list.reduce((n, x) => n + f(x), 0) / Math.max(1, list.length));

  say(`labels: ${labels.join(', ')}\n`);
  say('label            runs  rule score     process     tree        ask         prompt tok/run  out tok/run  charged/run  wall/run  patch fails  reply words');
  for (const label of labels) {
    const list = rows[label];
    const all = tally(list);
    const f = (fam) => { const t = tally(list, inFamily(fam)); return `${pct(t.pass, t.n)} (${t.pass}/${t.n})`; };
    say(`${label.padEnd(16)} ${String(list.length).padStart(4)}  ${`${pct(all.pass, all.n)} (${all.pass}/${all.n})`.padEnd(14)} ${f('process').padEnd(11)} ${f('tree').padEnd(11)} ${f('ask').padEnd(11)} `
      + `${String(mean(list, (x) => x.prompt)).padStart(14)}  ${String(mean(list, (x) => x.out)).padStart(11)}  ${String(mean(list, (x) => x.charged)).padStart(11)}  ${`${(mean(list, (x) => x.wall) / 1000).toFixed(0)}s`.padStart(8)}  `
      + `${String(list.reduce((n, x) => n + x.patchFails, 0)).padStart(11)}  ${String(mean(list, (x) => x.replyWords)).padStart(11)}`);
  }

  // Per check, so a drop names the rule.
  const keys = [...new Set(labels.flatMap((l) => rows[l].flatMap((x) => Object.keys(x.checks))))];
  say(`\n${'check'.padEnd(22)}${labels.map((l) => l.padStart(16)).join('')}`);
  for (const k of keys) {
    say(`${k.padEnd(22)}${labels.map((l) => {
      const t = tally(rows[l], (x) => x === k);
      return `${pct(t.pass, t.n)} ${t.pass}/${t.n}`.padStart(16);
    }).join('')}`);
  }

  // Per ask, every rep's failures, so a regression can be read back.
  say('\nfailures, per run');
  for (const label of labels) {
    for (const x of rows[label]) {
      const failed = Object.entries(x.checks).filter(([, v]) => v === false).map(([k]) => k);
      if (failed.length) say(`  ${label} ${x.key}-${x.rep}: ${failed.join(', ')}`);
    }
  }
}

// ---------- pairs, for a blind judge ----------

function pairs(a, b) {
  const dir = path.join(OUT, `pairs-${a}-vs-${b}`);
  fs.mkdirSync(dir, { recursive: true });
  const key = {};
  for (const d of fs.readdirSync(path.join(OUT, a)).sort()) {
    const ra = path.join(OUT, a, d);
    const rb = path.join(OUT, b, d);
    if (!fs.existsSync(path.join(ra, 'record.json')) || !fs.existsSync(path.join(rb, 'record.json'))) continue;
    const flip = Math.random() < 0.5;
    const [first, second] = flip ? [rb, ra] : [ra, rb];
    key[d] = { X: flip ? b : a, Y: flip ? a : b };
    const side = (runDir) => {
      const r = JSON.parse(fs.readFileSync(path.join(runDir, 'record.json'), 'utf8'));
      const said = r.messages.filter((m) => m.agent_id !== null && m.kind !== 'system')
        .map((m) => m.body).join('\n\n---\n\n');
      const diff = read(runDir, 'diff.patch') ?? '';
      return `### What the builder said\n\n${said || '(nothing)'}\n\n### What it changed\n\n\`\`\`diff\n${diff.length > 60000 ? `${diff.slice(0, 60000)}\n… (cut at 60000 bytes)` : diff}\n\`\`\`\n`;
    };
    const r = JSON.parse(fs.readFileSync(path.join(ra, 'record.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, `${d}.md`), [
      `# ${d}`,
      '',
      `A kid in a game studio said to the studio's builder helper: "${r.ask.text}"`,
      `The game started as: ${r.ask.template ? `the ${r.ask.template} template` : 'a blank page'}.`,
      '',
      '## X',
      '',
      side(first),
      '## Y',
      '',
      side(second),
    ].join('\n'));
  }
  fs.writeFileSync(path.join(OUT, `pairs-${a}-vs-${b}.key.json`), JSON.stringify(key, null, 2));
  say(`${Object.keys(key).length} pairs in ${dir}; the key is beside it, not in it`);
}

// ---------- main ----------

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'run' && rest[0]) await run(rest[0]);
else if (mode === 'score' && rest.length) score(rest);
else if (mode === 'pairs' && rest.length === 2) pairs(...rest);
else {
  say('usage: run <label> | score <label> [<label> …] | pairs <labelA> <labelB>');
  process.exitCode = 1;
}
process.exit();
