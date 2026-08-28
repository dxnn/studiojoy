// The quiz editor's model layer: config/questions.js in, a plain model out,
// and back to file text again. Reading goes through the config reader — the
// file is never executed — and writing regenerates the whole file with the
// template's standard comments: unlike the generic form, which splices one
// value, this editor adds and removes whole questions, and it is the
// authoring surface for this one file. Anything the shape does not cover —
// extra declarations, weights, code — makes quizModel decline with a reason,
// and the file falls back to the generic form or the text.

import { parseConfigFile } from './config-file.js';

export const isQuizPath = (p) => p === 'config/questions.js';

// Result keys are wiring, never shown to the person: identifiers the
// serializer can write bare and the reader reads back.
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const str = (node) => (node && node.kind === 'string' ? node.value : null);

export function quizModel(text) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const grown = { ok: false, reason: 'the file has grown past what the quiz editor understands' };

  if (parsed.decls.map((d) => d.name).join(',') !== 'QUESTIONS,RESULTS') return grown;
  const [q, r] = parsed.decls.map((d) => d.node);
  if (q.kind !== 'array' || r.kind !== 'object') return grown;

  const results = [];
  for (const prop of r.props) {
    if (!KEY.test(prop.key) || prop.node.kind !== 'object') return grown;
    const keys = prop.node.props.map((p) => p.key).sort().join(',');
    if (keys !== 'name,tell') return grown;
    const name = str(prop.node.props.find((p) => p.key === 'name')?.node);
    const tell = str(prop.node.props.find((p) => p.key === 'tell')?.node);
    if (name === null || tell === null) return grown;
    results.push({ key: prop.key, name, tell });
  }

  const questions = [];
  for (const item of q.items) {
    if (item.kind !== 'object') return grown;
    const keys = item.props.map((p) => p.key).sort().join(',');
    if (keys !== 'answers,ask') return grown;
    const ask = str(item.props.find((p) => p.key === 'ask')?.node);
    const list = item.props.find((p) => p.key === 'answers')?.node;
    if (ask === null || !list || list.kind !== 'array') return grown;
    const answers = [];
    for (const a of list.items) {
      if (a.kind !== 'object') return grown;
      const akeys = a.props.map((p) => p.key).sort().join(',');
      if (akeys !== 'result,say') return grown;
      const say = str(a.props.find((p) => p.key === 'say')?.node);
      const result = str(a.props.find((p) => p.key === 'result')?.node);
      if (say === null || result === null) return grown;
      answers.push({ say, result });
    }
    questions.push({ ask, answers });
  }

  return { ok: true, questions, results };
}

export function quizText({ questions, results }) {
  const s = JSON.stringify;
  const lines = [
    '// The questions, asked in order. Every answer counts toward one of the',
    '// endings in RESULTS below — the ending with the most answers wins.',
    'const QUESTIONS = [',
  ];
  for (const q of questions) {
    lines.push('  {');
    lines.push(`    ask: ${s(q.ask)},`);
    lines.push('    answers: [');
    for (const a of q.answers) {
      lines.push(`      { say: ${s(a.say)}, result: ${s(a.result)} },`);
    }
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  lines.push('// The endings. A tie goes to the one listed first.');
  lines.push('const RESULTS = {');
  for (const r of results) {
    lines.push(`  ${r.key}: {`);
    lines.push(`    name: ${s(r.name)},`);
    lines.push(`    tell: ${s(r.tell)},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

// A fresh internal key for a new ending: never shown, never reused while any
// current key matches.
export function freshKey(results) {
  for (let n = results.length + 1; ; n += 1) {
    const key = `ending_${n}`;
    if (!results.some((r) => r.key === key)) return key;
  }
}
