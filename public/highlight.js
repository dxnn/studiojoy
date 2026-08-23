// Syntax colours for the text editor, with no library behind them: a
// hand-rolled tokenizer for the three languages a game is written in (plus
// JSON), small enough to read. Pure functions — no DOM — so `npm test` covers
// it without a browser, like sound-maker.js and pixel-editor.js.
//
// It colours what it is sure of — comments, strings, numbers, keywords, tags,
// attributes — and leaves everything else plain. Display only: a token read
// wrongly is a colour, never a change to the file. The one known blind spot
// is a JavaScript regex literal, which is shown plain (telling `/` the
// operator from `/` the regex needs a parser, and a wrong guess would paint
// the rest of the line as if it were a comment or string).
//
// The invariant every tokenizer here keeps: the token texts concatenate back
// to exactly the input. The editor paints these behind a transparent
// textarea, so a dropped or doubled character would shear the overlay off the
// real text.

const tokensOf = (out) => ({
  // Adjacent plain runs are merged so a page of markup is a handful of nodes,
  // not one per '=' and space.
  push(text, cls = null) {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.cls === null && cls === null) last.text += text;
    else out.push({ text, cls });
  },
});

const lineEnd = (text, i) => {
  const nl = text.indexOf('\n', i);
  return nl === -1 ? text.length : nl;
};

// The end of a quoted run, escapes honoured. A single-line string left open
// stops at the newline, the way the browser reads it; a template or an
// attribute value keeps going.
function stringEnd(text, i, quote, multiline) {
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') { j += 2; continue; }
    if (c === quote) return j + 1;
    if (c === '\n' && !multiline) return j;
    j += 1;
  }
  return text.length;
}

/* JavaScript (and JSON, which is a subset of what this colours) ------------ */

const JS_KEYWORDS = new Set(('async await break case catch class const continue debugger default delete do else'
  + ' export extends false finally for from function if import in instanceof let new null of return static'
  + ' super switch this throw true try typeof undefined var void while with yield').split(' '));

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

function tokenizeJs(text, t) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const pair = c + (text[i + 1] ?? '');
    if (pair === '//') {
      const end = lineEnd(text, i);
      t.push(text.slice(i, end), 'com');
      i = end;
    } else if (pair === '/*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      t.push(text.slice(i, end), 'com');
      i = end;
    } else if (c === "'" || c === '"' || c === '`') {
      const end = stringEnd(text, i, c, c === '`');
      t.push(text.slice(i, end), 'str');
      i = end;
    } else if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < n && /[\w.]/.test(text[j])) j += 1;
      t.push(text.slice(i, j), 'num');
      i = j;
    } else if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(text[j])) j += 1;
      const word = text.slice(i, j);
      t.push(word, JS_KEYWORDS.has(word) ? 'kw' : null);
      i = j;
    } else {
      let j = i + 1;
      while (j < n && !/["'`/0-9]/.test(text[j]) && !IDENT_START.test(text[j])) j += 1;
      t.push(text.slice(i, j), null);
      i = j;
    }
  }
}

/* CSS ----------------------------------------------------------------------- */

// Brace depth is the one piece of state: `colour:` before a `{` is a selector,
// inside one it is a property, and `#fff` inside is a colour where `#hero`
// outside is an id.
function tokenizeCss(text, t) {
  let i = 0;
  let depth = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c + (text[i + 1] ?? '') === '/*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      t.push(text.slice(i, end), 'com');
      i = end;
    } else if (c === "'" || c === '"') {
      const end = stringEnd(text, i, c, false);
      t.push(text.slice(i, end), 'str');
      i = end;
    } else if (c === '@' && /[a-zA-Z]/.test(text[i + 1] ?? '')) {
      let j = i + 1;
      while (j < n && /[\w-]/.test(text[j])) j += 1;
      t.push(text.slice(i, j), 'kw');
      i = j;
    } else if (text.startsWith('!important', i)) {
      t.push('!important', 'kw');
      i += '!important'.length;
    } else if (c === '#' && depth > 0 && /[0-9a-fA-F]/.test(text[i + 1] ?? '')) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-F]/.test(text[j])) j += 1;
      t.push(text.slice(i, j), 'num');
      i = j;
    } else if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < n && /[\w.%]/.test(text[j])) j += 1;
      t.push(text.slice(i, j), 'num');
      i = j;
    } else if (/[a-zA-Z-]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w-]/.test(text[j])) j += 1;
      let k = j;
      while (k < n && (text[k] === ' ' || text[k] === '\t')) k += 1;
      t.push(text.slice(i, j), depth > 0 && text[k] === ':' ? 'attr' : null);
      i = j;
    } else {
      if (c === '{') depth += 1;
      if (c === '}' && depth > 0) depth -= 1;
      t.push(c, null);
      i += 1;
    }
  }
}

/* HTML ----------------------------------------------------------------------- */

// Inside a <script> or <style> element the content is the other language, so
// it is handed to that tokenizer — an index.html is mostly those two.
function tokenizeHtml(text, t) {
  const lower = text.toLowerCase();
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      const end = close === -1 ? n : close + 3;
      t.push(text.slice(i, end), 'com');
      i = end;
      continue;
    }
    const open = /^<(\/?)([a-zA-Z][\w-]*)|^<!\w+/.exec(text.slice(i));
    if (text[i] === '<' && open) {
      t.push(open[0], 'tag');
      i += open[0].length;
      let selfClosed = false;
      while (i < n) {
        const c = text[i];
        if (c === '>') {
          t.push('>', 'tag');
          i += 1;
          break;
        }
        if (c + (text[i + 1] ?? '') === '/>') {
          t.push('/>', 'tag');
          selfClosed = true;
          i += 2;
          break;
        }
        if (c === "'" || c === '"') {
          const end = stringEnd(text, i, c, true);
          t.push(text.slice(i, end), 'str');
          i = end;
        } else if (/[a-zA-Z]/.test(c)) {
          let j = i + 1;
          while (j < n && /[\w:.-]/.test(text[j])) j += 1;
          t.push(text.slice(i, j), 'attr');
          i = j;
        } else {
          t.push(c, null);
          i += 1;
        }
      }
      const name = (open[2] ?? '').toLowerCase();
      if (!selfClosed && !open[1] && (name === 'script' || name === 'style')) {
        const close = lower.indexOf(`</${name}`, i);
        const end = close === -1 ? n : close;
        (name === 'script' ? tokenizeJs : tokenizeCss)(text.slice(i, end), t);
        i = end;
      }
      continue;
    }
    // Ordinary text between tags — or a lone '<' that opened nothing, which
    // rides along as text rather than looping forever.
    const next = text.indexOf('<', i + 1);
    const end = next === -1 ? n : next;
    t.push(text.slice(i, end), null);
    i = end;
  }
}

/* The two entry points ------------------------------------------------------ */

const EXT_LANG = {
  js: 'js', mjs: 'js', json: 'js',
  css: 'css',
  html: 'html', htm: 'html', svg: 'html', xml: 'html',
};

const TOKENIZERS = { js: tokenizeJs, css: tokenizeCss, html: tokenizeHtml };

// Which language a path is coloured as, or null for everything the studio
// should keep showing as plain text.
export function langFor(path) {
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  return EXT_LANG[ext] ?? null;
}

// [{text, cls}] where cls is 'com' | 'str' | 'num' | 'kw' | 'tag' | 'attr'
// or null for plain, and the texts concatenate back to exactly the input.
export function tokenize(text, lang) {
  const out = [];
  (TOKENIZERS[lang] ?? tokenizeJs)(text, tokensOf(out));
  return out;
}
