// Reading and editing a config file without running it (spec.md §8).
//
// A config file is a run of `const NAME = <plain value>;` declarations with a
// comment on each value. This reads exactly that subset — numbers, strings,
// true/false/null, and arrays or objects of those — and refuses everything
// else. Refusing the whole file is the point: a form that rendered the half it
// understood would silently drop the other half, and the file is the truth.
//
// ⚠️ There is no `eval` and no `new Function` here, and there must never be.
// A config file is written by an LLM or by a kid and is served from the games
// origin; running it in the studio would hand game code the studio's own
// context, which is the boundary §7 exists to keep.
//
// Edits are a splice of one value's own span, so every comment, blank line and
// bit of alignment in the file survives untouched. Offsets shift after a
// splice, so callers apply one edit and re-parse — config files are small
// enough that this is free.

// Only under config/, and only .js — the shape spec.md §8 asks agents for.
// Here rather than beside the form so the server can ask it too: the file
// tools refuse to turn one of these into something the form cannot open.
export const isConfigPath = (p) => /^config\/[^/]+\.js$/.test(p);

const IDENT =/[A-Za-z_$][A-Za-z0-9_$]*/y;
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

class Refused extends Error {}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

// The comment that describes a value: whatever follows it on its own line,
// else the run of `//` lines directly above the line it starts on. Read from
// the raw text by offset rather than collected while tokenising, so a `//`
// inside a string can never be mistaken for a comment.
//
// Both halves are anchored to the value's *slot* — where its own text begins,
// its key included — because a value sharing a line with the group holding it
// has no comment of its own. A note at the end of a line of colours describes
// the list, not the fifth colour, and the form was captioning all five fields
// with it.
function commentFor(text, slot, end) {
  const lineEnd = text.indexOf('\n', end);
  const rest = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
  const trailing = rest.indexOf('//');
  // Only a comma, or the semicolon closing a declaration, may stand between a
  // value and its comment. A bracket in there means the comment is describing
  // whatever that bracket closes.
  if (trailing !== -1 && /^[\s,;]*$/.test(rest.slice(0, trailing))) {
    return rest.slice(trailing + 2).trim();
  }

  const lines = text.slice(0, slot).split('\n');
  // The lines above describe the line below them, so they are this value's
  // only if this value is what starts that line.
  if (lines.pop().trim() !== '') return '';
  const above = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('//')) break;
    above.unshift(line.slice(2).trim());
  }
  return above.join(' ');
}

export function parseConfigFile(text) {
  let i = 0;

  const refuse = (reason) => {
    throw new Refused(`${reason} on line ${lineOf(text, i)}`);
  };

  function skip() {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i += 1;
      if (text.startsWith('//', i)) {
        const nl = text.indexOf('\n', i);
        i = nl === -1 ? text.length : nl;
      } else if (text.startsWith('/*', i)) {
        const close = text.indexOf('*/', i + 2);
        if (close === -1) refuse('a /* comment is never closed');
        i = close + 2;
      } else {
        return;
      }
    }
  }

  function at(token) {
    skip();
    return text.startsWith(token, i);
  }

  function eat(token) {
    if (!at(token)) refuse(`expected ${token}`);
    i += token.length;
  }

  function ident() {
    skip();
    IDENT.lastIndex = i;
    const match = IDENT.exec(text);
    if (!match) refuse('expected a name');
    i = IDENT.lastIndex;
    return match[0];
  }

  // A quoted string, single or double. Template literals are refused: they can
  // hold ${...}, which is an expression, and this reads no expressions.
  function string() {
    const quote = text[i];
    i += 1;
    let out = '';
    while (i < text.length && text[i] !== quote) {
      if (text[i] === '\n') refuse('a piece of text runs past the end of its line');
      if (text[i] === '\\') {
        // − and the like: a helper writes a minus sign or an em dash
        // this way often enough that a kid's words file refused to open as
        // a form over one (2026-09-15). Four hex digits, or it is not one.
        if (text[i + 1] === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) refuse('\\u needs four hex digits after it');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        const escapes = {
          n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"',
        };
        const mapped = escapes[text[i + 1]];
        if (mapped === undefined) refuse(`\\${text[i + 1]} is not something this can read`);
        out += mapped;
        i += 2;
        continue;
      }
      out += text[i];
      i += 1;
    }
    if (i >= text.length) refuse('a piece of text is never closed');
    i += 1;
    return out;
  }

  // Returns a node: {kind, value, start, end} plus items/props for the
  // containers, and comment where one is attached.
  // slotStart is where the whole entry begins — the `const`, or the key of the
  // property this value belongs to. It defaults to the value itself, which is
  // all a list item has.
  function value(slotStart) {
    skip();
    const start = i;
    const slot = slotStart ?? start;
    const done = (kind, parsed, extra = {}) => ({
      kind, value: parsed, start, end: i, comment: commentFor(text, slot, i), ...extra,
    });
    const ch = text[i];

    if (ch === '"' || ch === "'") return done('string', string());
    if (ch === '`') refuse('a `backtick` string can hold code, so it is not allowed here');

    if (ch === '[') {
      i += 1;
      const items = [];
      for (;;) {
        if (at(']')) { i += 1; break; }
        items.push(value());
        if (at(',')) { i += 1; continue; }
        eat(']');
        break;
      }
      return done('array', items.map((n) => n.value), { items });
    }

    if (ch === '{') {
      i += 1;
      const props = [];
      for (;;) {
        if (at('}')) { i += 1; break; }
        skip();
        const keyStart = i;
        // A key is a name, a quoted string, or a number — `1: ["add"]` for
        // a tower's floors is a plain value a kid can read, and two games
        // refused to open as forms over one (2026-09-15).
        NUMBER.lastIndex = i;
        const numbered = /[0-9]/.test(text[i] ?? '') ? NUMBER.exec(text) : null;
        let key;
        if (numbered) { key = numbered[0]; i = NUMBER.lastIndex; } else key = (text[i] === '"' || text[i] === "'") ? string() : ident();
        eat(':');
        props.push({ key, node: value(keyStart) });
        if (at(',')) { i += 1; continue; }
        eat('}');
        break;
      }
      return done(
        'object',
        Object.fromEntries(props.map((p) => [p.key, p.node.value])),
        { props },
      );
    }

    for (const [word, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, i) && !/[A-Za-z0-9_$]/.test(text[i + word.length] ?? '')) {
        i += word.length;
        return done(word === 'null' ? 'null' : 'boolean', parsed);
      }
    }

    NUMBER.lastIndex = i;
    const number = NUMBER.exec(text);
    if (number) {
      i = NUMBER.lastIndex;
      // A number followed by an operator is arithmetic, not a value.
      skip();
      if (/[-+*/%]/.test(text[i] ?? '')) refuse('a sum, rather than a plain number');
      return { kind: 'number', value: Number(number[0]), start, end: start + number[0].length, comment: commentFor(text, slot, start + number[0].length) };
    }

    return refuse('something that is not a plain value');
  }

  try {
    const decls = [];
    skip();
    // A leading "use strict" is the one statement that is allowed and ignored.
    for (const directive of ['"use strict";', "'use strict';"]) {
      if (text.startsWith(directive, i)) i += directive.length;
    }
    skip();
    while (i < text.length) {
      if (!at('const')) refuse('only `const NAME = value;` lines can be shown as a form');
      const declStart = i;
      i += 'const'.length;
      const name = ident();
      eat('=');
      const node = value(declStart);
      if (at(';')) i += 1;
      decls.push({ name, node });
      skip();
    }
    return { ok: true, decls };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, reason: err.message };
    throw err;
  }
}

// The source text for a value the form has changed. Strings go through
// JSON.stringify so quotes and backslashes inside them can't break the file.
export function literalFor(kind, raw) {
  if (kind === 'number') {
    // Checked against the same pattern the parser reads, so the form can never
    // write a value it would then refuse to reopen — `0x10` is a finite number
    // to Number() and not a plain one here.
    const typed = String(raw).trim();
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(typed)) return null;
    if (!Number.isFinite(Number(typed))) return null;
    // What was typed is kept when it means the same number: 0.50 and 1e3 are
    // somebody's choice, and normalising them is noise in the diff.
    return typed;
  }
  if (kind === 'boolean') return raw ? 'true' : 'false';
  if (kind === 'string') return JSON.stringify(String(raw));
  return null;
}

// Replace one value in place. Everything outside its span — comments,
// alignment, the rest of the file — is byte-identical afterwards.
export function spliceValue(text, node, literal) {
  return text.slice(0, node.start) + literal + text.slice(node.end);
}
