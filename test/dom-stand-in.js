// A DOM small enough to render into and no bigger, so the studio's own front
// end can be held to its own rules by `npm test` (CLAUDE.md, "Three
// conventions to keep"). Zero dependencies is the whole point: this is fifty
// lines and jsdom is a browser.
//
// What it is not: a browser. Nothing here lays anything out, computes a
// style, or knows what a pointer is — those go to Playwright by hand, which
// is the expensive check and now only has to cover the things that need it.
//
// ⚠️ install() must run before main.js is imported: the client reads
// `document` and the stored rail width on the way in. It does not start the
// studio — `start()` is the shell's call (public/index.html).

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
