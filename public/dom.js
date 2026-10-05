// Making elements: h() for HTML, and the icon buttons drawn from SVG paths.
// Split out because everything that renders needs these, and nothing in here
// needs the rest of the studio.

/* DOM ---------------------------------------------------------------------- */

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* The inspector ------------------------------------------------------------ */

// The selected thing's fields, opened in place under the row or the cards it
// belongs to (spec.md §6, inspector.css): what kind of thing it is over its
// name, then a labelled row a field. Every editor's selected thing is one; a
// head of its own — a ✕ beside the name — builds the box itself.
export const inspector = (kind, name, ...kids) => h('div', { class: 'inspector' },
  h('div', { class: 'inspector-head' },
    h('span', { class: 'section-label', text: kind }),
    h('div', { class: 'iname', text: name })),
  ...kids);

export const fieldRow = (label, ...kids) => h('div', { class: 'ifield' },
  h('span', { class: 'ilabel', text: label }), ...kids);

/* Icons -------------------------------------------------------------------- */

// h() makes HTML elements, and an <svg> built with createElement is inert —
// SVG needs its own namespace. Small enough to keep separate rather than
// teaching h() about namespaces: the icons and the pixel editor's grid are
// the only two users.
export const SVG_NS = 'http://www.w3.org/2000/svg';

// Drawn in outline from currentColor, so a tool that is on inherits the filled
// button's ink without a second copy of the icon.
const ICONS = {
  pencil: ['M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'],
  eraser: ['M9 20H6l-3-3 10-10 6 6-7 7z', 'M4 21h16', 'M8 10l6 6'],
  bucket: ['M6 13l7-7 6.5 6.5-7 7L6 13z', 'M13 6 9.5 2.5', 'M19.5 15.5c1.2 1.7 1.2 3.5 0 3.5s-1.2-1.8 0-3.5z'],
  // A round bulb, because the first draft was a tapered diagonal body and read
  // as a second pencil sitting next to the pencil.
  dropper: ['M3 21l1-3.6 7.8-7.8 2.6 2.6L6.6 20 3 21z', 'M12.8 9.6l2.6 2.6', 'M14.5 6.5a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0'],
  // The three shapes, drawn as themselves: there is nothing to be clever
  // about, and a kid reading the row wants to see the thing they will get.
  line: ['M4 20L20 4'],
  rect: ['M4 6h16v12H4z'],
  ellipse: ['M12 5a8 7 0 1 0 0 14a8 7 0 1 0 0-14'],
  undo: ['M2 5v6h6', 'M4.6 15.5a9 9 0 1 0 1.9-9.2L2 11'],
  redo: ['M22 5v6h-6', 'M19.4 15.5a9 9 0 1 1-1.9-9.2L22 11'],
  // A bin with its lid, beside the word Delete rather than instead of it.
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14', 'M10 10v6', 'M14 10v6'],
};

export function icon(name, size = 17) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // The words are on the button's title and aria-label; the picture is
  // decoration on top of them.
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// An icon button always carries the words too: a picture nobody recognises is
// only a button you have to press to find out about.
export const iconButton = ({ name, label, hint, on = false, disabled = false, onclick }) => h('button', {
  class: `quiet icon-btn${on ? ' on' : ''}`,
  title: hint ? `${label} — ${hint}` : label,
  'aria-label': label,
  'aria-pressed': on ? 'true' : null,
  disabled,
  onclick,
}, icon(name));
