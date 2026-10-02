// A DOM small enough to render into and no bigger, so the studio's own front
// end can be held to its own rules by `npm test` (CLAUDE.md, "Three
// conventions to keep"). Zero dependencies is the whole point: this is about
// a hundred lines of it and jsdom is a browser.
//
// What it is not: a browser. Nothing here lays anything out, computes a
// style, or knows what a pointer is — those go to Playwright by hand, which
// is the expensive check and now only has to cover the things that need it.
//
// ⚠️ install() must run before main.js is imported: the client reads
// `document` and the stored rail width on the way in. It does not start the
// studio — `start()` is the shell's call (public/index.html).

import fs from 'node:fs';
import path from 'node:path';

export function element(tag = 'div') {
  const node = {
    tag,
    className: '',
    textContent: '',
    children: [],
    parent: null,
    // Recorded rather than acted on: a test asks what a node listens for.
    handlers: new Map(),
    attrs: {},
    dataset: {},
    style: {
      setProperty(name, value) { node.style[name] = value; },
      removeProperty(name) { delete node.style[name]; },
    },
    classList: {
      add: (c) => { node.className = `${node.className} ${c}`.trim(); },
      remove: (c) => {
        node.className = node.className.split(/\s+/).filter((n) => n !== c).join(' ');
      },
      contains: (c) => node.className.split(/\s+/).includes(c),
      toggle: (c) => (node.classList.contains(c)
        ? node.classList.remove(c) : node.classList.add(c)),
    },
    append(...kids) {
      for (const kid of kids.flat(Infinity)) {
        if (kid && typeof kid === 'object') kid.parent = node;
        node.children.push(kid);
      }
    },
    prepend(...kids) { node.children.unshift(...kids); },
    // A copy: the stage spreads one node's children into another's
    // replaceChildren, which would otherwise empty the list it is reading.
    get childNodes() { return [...node.children]; },
    remove() {
      const at = node.parent?.children.indexOf(node) ?? -1;
      if (at >= 0) node.parent.children.splice(at, 1);
      node.parent = null;
    },
    replaceChildren(...kids) {
      node.children.length = 0;
      node.append(...kids);
    },
    setAttribute(name, value) {
      node.attrs[name] = value;
      if (name === 'class') node.className = value;
      if (name === 'disabled') node.disabled = true;
    },
    removeAttribute(name) { delete node.attrs[name]; },
    addEventListener(name, fn) { node.handlers.set(name, fn); },
    removeEventListener(name) { node.handlers.delete(name); },
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({
      top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    }),
    focus() { node.focused = true; },
    // A text box remembers where its caret is; the @ menu reads it to know
    // what is being typed and writes it back after it puts a name in.
    setSelectionRange(start, end) { node.selectionStart = start; node.selectionEnd = end; },
    click() { (node.handlers.get('click') ?? node.onclick)?.({ stopPropagation() {} }); },
  };
  return node;
}

// h() asks `kid instanceof Node` to tell an element from a string, so the
// stand-in needs a Node that these plain objects answer to. Declaring what
// counts, rather than making element() a class, keeps it the same shape as
// the fakes in the input and screens tests.
class StandInNode {
  static [Symbol.hasInstance](value) {
    return !!value && typeof value === 'object' && Array.isArray(value.children);
  }
}

// The globals the client reaches for on the way in, and nothing more. Returns
// the root the shell renders into.
export function install() {
  const root = element('div');
  globalThis.Node = StandInNode;
  globalThis.document = {
    body: element('body'),
    head: element('head'),
    documentElement: element('html'),
    title: '',
    createElement: (tag) => element(tag),
    createTextNode: (text) => ({ tag: '#text', textContent: String(text), children: [] }),
    getElementById: (id) => (id === 'root' ? root : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = globalThis;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 800;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.location = { pathname: '/', search: '', origin: 'http://studio.test' };
  globalThis.history = { pushState() {}, replaceState() {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  // Private mode as far as the client is concerned, which it already handles.
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  // ⚠️ Nothing in a render should reach the network. A test that trips this
  // has found something worth knowing rather than something to stub out.
  globalThis.fetch = () => Promise.reject(new Error('a render asked for the network'));
  return root;
}

/* Asking the tree things --------------------------------------------------- */

const classesOf = (node) => (typeof node?.className === 'string'
  ? node.className.split(/\s+/).filter(Boolean) : []);

export const hasClass = (node, name) => classesOf(node).includes(name);

// Every node under here, the roots included, depth first.
export function all(nodes) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object' || !Array.isArray(node.children)) return;
    out.push(node);
    for (const kid of node.children) walk(kid);
  };
  for (const node of [nodes].flat(Infinity)) walk(node);
  return out;
}

export const withClass = (nodes, name) => all(nodes).filter((n) => hasClass(n, name));

// Whether a node would do something if it were pressed: h() puts a click
// handler on the map, and the studio also assigns onclick directly for a row
// that opens.
export const pressable = (node) => !!(node.handlers?.get('click') ?? node.onclick);

// Everything a node says, its own words and its children's.
export const textOf = (node) => [node?.textContent ?? '', ...(node?.children ?? []).map(textOf)].join('');

/* The rules, read off the studio's own stylesheet ---------------------------- */

// What lights up under the pointer, and what wears gold, are questions the
// stylesheet already answers — so they are read from it rather than listed by
// hand. A list by hand is how the first gold check came to ask about `gold`
// and `score`, which no rule styles. Selectors are read as far as these rules
// need: classes, a tag, `:not(.x)`, and every combinator as a descendant.

const cssDir = path.resolve(import.meta.dirname, '..', 'public', 'css');

// Split on a character, but not inside brackets: `:not(.a, .b)` is one piece.
function splitOutside(text, at) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (depth === 0 && at.test(text[i])) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function compound(text) {
  const nots = [...text.matchAll(/:not\(([^)]*)\)/g)]
    .flatMap(([, inner]) => [...inner.matchAll(/\.([\w-]+)/g)].map((m) => m[1]));
  const bare = text.replace(/:not\([^)]*\)/g, '');
  return {
    tag: /^[a-z][a-z0-9]*/i.exec(bare)?.[0].toLowerCase() ?? null,
    classes: [...bare.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
    nots,
    hover: bare.includes(':hover'),
    // `:not(:disabled)`: a disabled one does not light up, so is not asked.
    enabledOnly: text.includes(':not(:disabled)'),
  };
}

// Every selector in public/css/ as a list of compounds, with its rule's body.
// The innermost braces are always a rule, so an @media opens up for nothing.
const SELECTORS = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css')).flatMap((file) => {
  const text = fs.readFileSync(path.join(cssDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, head, body]) => splitOutside(head, /,/)
    .map((sel) => ({ chain: splitOutside(sel.replace(/[>+~]/g, ' '), /\s/).map(compound), body })));
});

const fits = (node, c) => (!c.tag || node.tag === c.tag)
  && c.classes.every((name) => hasClass(node, name))
  && !c.nots.some((name) => hasClass(node, name))
  && !(c.enabledOnly && node.disabled);

// The last compound is the node; each one before it is some ancestor, in
// order. ⚠️ Only ancestors inside the rendered piece are seen, so a rule that
// needs the page around it is not asked about rather than guessed at.
function matches(node, chain) {
  if (!fits(node, chain[chain.length - 1])) return false;
  let at = node.parent;
  for (let i = chain.length - 2; i >= 0; i -= 1) {
    while (at && !fits(at, chain[i])) at = at.parent;
    if (!at) return false;
    at = at.parent;
  }
  return true;
}

// What lights up is the compound carrying `:hover` — `.card:hover .cname`
// lights the card — and a bare tag (`a:hover`) is a link, not a row.
const LIT = SELECTORS.flatMap(({ chain }) => {
  const at = chain.findIndex((c) => c.hover);
  return at >= 0 && chain[at].classes.length ? [chain.slice(0, at + 1)] : [];
});

// Gold is `--num` (public/css/base.css). A hover's gold is a passing state,
// not something a node wears.
const GOLD = SELECTORS
  .filter(({ chain, body }) => body.includes('var(--num)') && !chain.some((c) => c.hover))
  .map(({ chain }) => chain);

// A score, a count, a version: a digit, or a commit's hex.
const numberish = (text) => /\d/.test(text) || /^[0-9a-f]{7,40}$/i.test(text.trim());

const describe = (node) => {
  const words = textOf(node).trim().slice(0, 30);
  return `${node.tag}${classesOf(node).map((c) => `.${c}`).join('')}${words ? ` “${words}”` : ''}`;
};

// What a rendered piece does against the conventions any surface keeps
// (CLAUDE.md, "Three conventions to keep"; spec/ §17), as one sentence each —
// empty when it keeps them all, so a failure lists every one at once.
export function conventionBreaks(tree) {
  const breaks = [];
  for (const node of all(tree)) {
    if (LIT.some((chain) => matches(node, chain))
      && !pressable(node) && !(node.tag === 'a' && node.attrs.href)) {
      breaks.push(`${describe(node)} lights up and does nothing`);
    }
    if (hasClass(node, 'scroll') && !node.attrs['data-scroll']) {
      breaks.push(`${describe(node)} scrolls with no data-scroll name`);
    }
    if (GOLD.some((chain) => matches(node, chain)) && !numberish(textOf(node))) {
      breaks.push(`${describe(node)} wears gold and is not a number`);
    }
  }
  return breaks;
}

// The nodes each list picks out, so a test can see the stylesheet was read at
// all rather than trusting a check that found nothing to ask about.
export const litIn = (tree) => all(tree).filter((n) => LIT.some((chain) => matches(n, chain)));
export const goldIn = (tree) => all(tree).filter((n) => GOLD.some((chain) => matches(n, chain)));

// A press, with an event that landed on nothing inside the node, handing back
// whatever the handler returned. An onclick that opens something returns its
// promise, or Back stops working (spec/ §17) — so a test asks for a thenable
// and then awaits it, since an opener's failure would otherwise land after
// the test as nobody's.
export function press(node) {
  const handler = node.handlers?.get('click') ?? node.onclick;
  return handler?.({
    target: { closest: () => null }, currentTarget: node, stopPropagation() {}, preventDefault() {},
  });
}
