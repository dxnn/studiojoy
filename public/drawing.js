// The pixel editor as a whole: opening a picture ready to draw on, the game's
// own colour palette it draws from (a config file like any other), and the
// canvas itself. public/pixel-editor.js is arithmetic over bytes; the canvas,
// the pointer and toBlob stay here, for the same reason the sound editor's
// numbers and its sliders are two files.

import { h, iconButton, SVG_NS } from './dom.js';
import {
  PALETTE, BRUSHES, MAX_SIDE, UNDO_BYTES, CLEAR,
  blankPicture, pictureFrom, pixelAt, stamp, drawLine, linePoints, isCorner,
  drawRect, drawEllipse, floodFill, replaceColour, gridPath,
  beginStep, endStep, applyStep, stepBytes,
  clipFrame, unclip, copyFrame, pasteFrame,
  rgbaOf, hexOf, isColour,
} from './pixel-editor.js';
import { parseConfigFile, literalFor, spliceValue } from './config-file.js';
import {
  writeFiles, assetPath, IMAGE_DIR, SPRITE_DIR,
} from './upload.js';
import {
  S, send, say, render, encodePath, problem, frozen,
} from './main.js';
import {
  openFile, opening, saveEditorSoon, refreshFiles,
} from './files.js';

/* Drawing ------------------------------------------------------------------ */

// PNG only. A JPEG has no see-through parts and saving one back would quietly
// change what kind of file it is; a game sprite wants the transparency.
export const isDrawable = (open) => open?.mime === 'image/png';

// A picture each, since these four are the ones every drawing program in the
// world draws the same way. The words stay on the title and the aria-label, so
// nothing is only a picture.
const DRAW_TOOLS = [
  { key: 'pencil', name: 'pencil', label: 'Draw', hint: 'paint with the chosen colour' },
  { key: 'eraser', name: 'eraser', label: 'Erase', hint: 'take the colour out again, back to see-through' },
  { key: 'fill', name: 'bucket', label: 'Fill', hint: 'flood everything joined to the pixel you click' },
  { key: 'pick', name: 'dropper', label: 'Eyedropper', hint: 'click a pixel to put its colour in the chosen square' },
  { key: 'line', name: 'line', label: 'Line', hint: 'drag from one end to the other' },
  { key: 'rect', name: 'rect', label: 'Rectangle', hint: 'drag from one corner to the opposite one' },
  { key: 'ellipse', name: 'ellipse', label: 'Ellipse', hint: 'drag out the box it fits inside' },
];

// A shape is dragged out and lands when the pointer lifts, so none of the
// three draws anything until then. `filled` is theirs alone and the two it
// means nothing to leave the button out rather than grey it.
const SHAPES = { line: drawLine, rect: drawRect, ellipse: drawEllipse };
const FILLABLE = new Set(['rect', 'ellipse']);

// Whole screen pixels per picture pixel, because half a pixel drawn is what
// makes an editor look soft. Fit is the other level and is not in the list:
// it is whatever the pane allows, and is where a picture opens.
const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

// Screen pixels per square from which the grid shows. Under it a line one
// screen pixel wide is too much of each square, and the grid hides the
// picture it is there to help with.
const GRID_FROM = 8;

function pictureCanvas(picture) {
  const canvas = document.createElement('canvas');
  canvas.width = picture.width;
  canvas.height = picture.height;
  canvas.getContext('2d').putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
  return canvas;
}

export const pictureBlob = (picture) => new Promise((resolve) => {
  pictureCanvas(picture).toBlob(resolve, 'image/png');
});

// The picture comes back out of the file rather than out of anything the
// studio kept, so what is drawn on is what is actually on disk. Anything it
// will not open stays on screen as the picture, with the reason underneath —
// there is no second way to look at one, so refusing has to leave something.
export async function startDrawing() {
  // Belongs to the open that started it: a picture decoded after a newer file
  // has been asked for is thrown away rather than drawn over it.
  const token = opening;
  const stale = () => opening !== token;
  const path = S.open.path;

  const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (stale()) return;
  // The reason goes in the pane, not only in a banner: the picture itself
  // cannot load either, so without this the editor is a filename over an empty
  // box and nothing says why.
  if (!res.ok) {
    S.drawRefused = problem(res, 'The studio could not read this picture.');
    say(S.drawRefused, true);
    return;
  }
  const bitmap = await createImageBitmap(await res.blob()).catch(() => null);
  if (stale()) return;
  if (!bitmap) {
    S.drawRefused = 'This one will not open as a picture, so there is nothing to draw on.';
    render();
    return;
  }
  if (bitmap.width > MAX_SIDE || bitmap.height > MAX_SIDE) {
    S.drawRefused = `This is ${bitmap.width} by ${bitmap.height}. Drawing works up to `
      + `${MAX_SIDE} across, so this one is here to look at.`;
    render();
    return;
  }
  const canvas = pictureCanvas(blankPicture(bitmap.width, bitmap.height));
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const { data } = canvas.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height);
  S.draw = {
    picture: pictureFrom(bitmap.width, bitmap.height, data),
    undo: [],
    redo: [],
    dirty: false,
  };
  // Read fresh each time: a helper may have changed the game's colours, or
  // Versions may have brought an older look.js back, since the editor was last
  // open.
  await loadPalette();
  if (stale()) return;
  if (S.drawPrefs.slot >= paletteColours().length) S.drawPrefs.slot = 0;
  render();
}

// A blank picture at exactly this path, opened ready to draw on. The story
// guide uses it for a face or a place the story already names.
export async function createPictureAt(path, width, height) {
  const { failure } = await writeFiles([{ path, body: await pictureBlob(blankPicture(width, height)) }]);
  if (failure) { say(failure, true); return false; }
  say(`Made ${path}.`);
  // openFile opens a picture ready to draw on; there is nothing to add here.
  await openFile(path);
  return true;
}

export async function createPicture(name, width, height) {
  // A strip is wider than it is tall by whole frames, which is the same test
  // the sprites library makes when it decides to animate one. So the shape
  // picks the folder: something that moves is a sprite, and everything else is
  // a picture to look at.
  const dir = width > height ? SPRITE_DIR : IMAGE_DIR;
  await createPictureAt(assetPath(dir, `${name || 'picture'}.png`), width, height);
}

/* The game's colours -------------------------------------------------------- */

// The palette is a *config file* like any other, which is the whole point:
// changing a colour is a commit on the game, it shows up in Versions, and a
// helper can read the same list the drawing tools offer.
export const LOOK_FILE = 'config/look.js';

// The four colours a game lends the studio while it is open, read from `LOOK`
// in the same file and set on the shell as --look-primary and friends. The
// names are the game's own to change; what each one means is in GLOSSARY.md,
// and the short of it is: primary is the game's voice, accent is its second,
// highlight is a number worth looking at, deep is the dark behind them.
export const LOOK_ROLES = ['primary', 'accent', 'highlight', 'deep'];

// ⚠️ This string is written into a style attribute, so it is checked rather
// than trusted: no semicolon or colon, so a value cannot close the declaration
// and start another, and no url() or var(). A colour that does not pass is
// simply not applied, which leaves the studio's own default standing.
const isLookColour = (value) => typeof value === 'string'
  && value.length <= 64
  && /^[a-z0-9#(),.%\s/-]+$/i.test(value)
  && !/url|expression|var\s*\(/i.test(value);

const paletteColours = () => S.palette?.colours ?? PALETTE;

// The colour being drawn with is whatever is in the chosen square, so putting a
// new colour in that square changes what the pencil does — which is what makes
// the well and the eyedropper edit the palette rather than sit beside it.
const chosenColour = () => paletteColours()[S.drawPrefs.slot] ?? PALETTE[0];

// The file the studio writes when a game has no look.js yet. Laid out in two
// rows of sixteen because that is how the studio shows it, and commented
// because every config file is.
// Eight to a source line: short enough to read, and short enough that changing
// one colour shows up in Versions as a line you can take in at a glance.
const lookFileText = (colours) => {
  const rows = [];
  for (let i = 0; i < colours.length; i += 8) {
    // Double quotes, matching literalFor and the config files the games already
    // have — otherwise the first colour edited stands out from the other 31.
    rows.push(`  ${colours.slice(i, i + 8).map((c) => `"${c}"`).join(', ')},`);
  }
  return `// How the game looks: the colours it is drawn from.
//
// These are the squares the studio offers when someone draws a picture for this
// game, so changing one here changes what the drawing tools hand out. Greys
// first, then the rainbow, then the ones with more character.
const PALETTE = [
${rows.join('\n')}
];
`;
};

export async function loadPalette() {
  S.palette = { colours: [...PALETTE], text: null, from: null };
  S.look = {};
  if (!S.files.some((f) => f.path === LOOK_FILE)) return;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(LOOK_FILE)}`);
  if (!res.ok) return;
  const text = await res.text();
  S.palette.text = text;
  const parsed = parseConfigFile(text);
  // The same file, read once for two things: the squares the drawing tools
  // offer, and the four colours the studio wears while this game is open.
  const look = parsed.ok ? parsed.decls.find((d) => d.name === 'LOOK') : null;
  const values = look?.node?.value;
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    for (const name of LOOK_ROLES) {
      // A colour and nothing else: this string goes into a style attribute, so
      // anything that is not plainly a colour is dropped rather than trusted.
      if (isLookColour(values[name])) S.look[name] = values[name].trim();
    }
  }
  const found = parsed.ok ? parsed.decls.find((d) => d.name === 'PALETTE') : null;
  // A look.js that holds other things but no PALETTE is normal — a game's own
  // colours belong in there too. The studio's list is then still the default,
  // and writing one appends rather than replaces.
  if (!Array.isArray(found?.node.value) || !found.node.value.every(isColour)) return;
  S.palette.colours = found.node.value;
  S.palette.from = LOOK_FILE;
}

// Changing a colour is a change in memory. Eyedropping half a dozen colours
// while drawing would otherwise be half a dozen commits on the game, which is
// the versioning working against the drawing rather than for it.
function setPaletteColour(index, hex) {
  const colours = [...paletteColours()];
  colours[index] = hex;
  S.palette = { ...S.palette, colours, dirty: true };
  render();
}

// The text the file should hold now: one value spliced in place so every
// comment and every other colour survives, or the whole file when there is not
// one yet. Null when the file is there but unreadable — the colours are then
// left alone rather than being written over something nobody can parse.
export function lookFileWith(colours) {
  const before = S.palette?.text;
  if (before === null || before === undefined) return lookFileText(colours);

  const parsed = parseConfigFile(before);
  if (!parsed.ok) return null;
  const found = parsed.decls.find((d) => d.name === 'PALETTE');
  // The file exists and is readable but has no PALETTE — a game's own drawing
  // colours belong in there too — so add one rather than replacing anything.
  if (!found?.node.items) return `${before.replace(/\n*$/, '\n')}\n${lookFileText(colours)}`;

  // One splice at a time, re-parsing between: a splice moves every offset behind
  // it, which is the same reason the config form applies one edit per read.
  let text = before;
  for (let i = 0; i < colours.length; i += 1) {
    const current = parseConfigFile(text);
    const item = current.ok
      ? current.decls.find((d) => d.name === 'PALETTE')?.node.items?.[i]
      : null;
    if (!item || item.value === colours[i]) continue;
    text = spliceValue(text, item, literalFor('string', colours[i]));
  }
  return text;
}

// Called when the picture is saved and whenever the editor is left behind, so
// the colours ride along with the work rather than needing a save of their own.
export async function flushPalette() {
  if (!S.palette?.dirty) return true;
  const colours = [...S.palette.colours];
  const text = lookFileWith(colours);
  if (text === null) {
    say(`${LOOK_FILE} has something in it the studio cannot read, so the colours were left alone.`, true);
    S.palette.dirty = false;
    return false;
  }
  const { failure } = await writeFiles([{ path: LOOK_FILE, body: text }]);
  if (failure) { say(failure, true); return false; }
  S.palette = { colours, text, from: LOOK_FILE, dirty: false };
  return true;
}

// Module scope rather than inside the pane, because the keyboard reaches it
// too and the pane is rebuilt on every render.
function stepDrawing(back) {
  if (!S.draw) return;
  const from = back ? S.draw.undo : S.draw.redo;
  const to = back ? S.draw.redo : S.draw.undo;
  const move = from.pop();
  if (!move) return;
  applyStep(S.draw.picture, move, back);
  // A step may have landed on a frame that is not on screen; jumping to the
  // frame it touched is what makes the undo visible rather than baffling.
  const p = S.draw.picture;
  const frames = p.width > p.height && p.width % p.height === 0 ? p.width / p.height : 1;
  if (frames > 1 && !S.draw.whole && move.at.length) {
    S.draw.frame = Math.floor((move.at[0] % p.width) / (p.width / frames));
  }
  to.push(move);
  S.draw.dirty = true;
  saveEditorSoon();
  render();
}

// A drawing is the one place in the studio where ⌘Z means something, so the
// listener asks whether one is open rather than being wired up and torn down
// with the pane. Ctrl for a keyboard without a ⌘.
window.addEventListener('keydown', (event) => {
  if (!S.draw || S.dialog) return;
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  if (event.key.toLowerCase() !== 'z') return;
  // Typing a filename into a box is not drawing, and ⌘Z there belongs to the
  // box.
  const el = event.target;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  event.preventDefault();
  stepDrawing(!event.shiftKey);
});

// Saves whichever of the two has changed — the picture, the colours, or both —
// so one button covers the work in the pane. True when everything landed and
// false when any of it did not, the same answer as saveOpenFile, so "Save and
// close" knows whether closing would lose anything.
export async function saveDrawing() {
  const { path } = S.open;
  const drawing = S.draw;
  const drew = !!drawing?.dirty;
  const recoloured = !!S.palette?.dirty;

  if (drew) {
    const headers = S.open.etag ? { 'if-match': S.open.etag } : {};
    const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`, {
      method: 'PUT', headers, body: await pictureBlob(drawing.picture),
    });
    const body = await res.json().catch(() => null);
    // The text conflict dialog offers to keep one side or the other. Two
    // pictures cannot be compared in a dialog, and nothing but a person writes a
    // PNG, so this says what happened and touches nothing.
    if (res.status === 409) {
      say(`Someone changed ${path} while you were drawing. Close it and open it again to see theirs.`, true);
      return false;
    }
    if (!res.ok) {
      say(problem(res, body?.error ?? 'Could not save that picture.'), true);
      return false;
    }
    // This write is a commit, and a commit is a files.changed on the stream like
    // any other, so the pane may already have been rebuilt underneath by the
    // time the response lands. Only the editor that made the request may finish
    // the job.
    if (S.draw === drawing && S.open?.path === path) {
      S.open.etag = body.etag;
      S.open.savedAt = Date.now();
      S.draw.dirty = false;
    }
  }

  const colours = await flushPalette();
  S.previewNonce += 1;
  await refreshFiles();
  if (!colours) return false;
  // The picture saves itself and says so in its own bar; the colours are a
  // separate file and a rarer thing, so they are still announced.
  if (recoloured) say(`Saved the colours in ${LOOK_FILE}.`);
  return true;
}

// Everything here is painted into one canvas and one pair of nodes rather
// than through render(), which would rebuild the canvas under the pointer
// drawing on it — the same reason the problems panel is painted in place.
export function renderDrawing() {
  const { picture } = S.draw;

  // A strip — width a whole multiple of height — opens one frame at a time:
  // the canvas shows the frame being edited, the strip loops in a small
  // preview beside the frame buttons, and the tools are clipped to the frame
  // so a wide brush or a fill cannot leak into the neighbours. "Whole strip"
  // is the way back to seeing and drawing across everything at once.
  const frames = picture.width > picture.height && picture.width % picture.height === 0
    ? picture.width / picture.height
    : 1;
  const frameMode = frames > 1 && !S.draw.whole;
  const fw = picture.width / frames;
  if (!Number.isInteger(S.draw.frame) || S.draw.frame >= frames) S.draw.frame = 0;
  const viewW = frameMode ? fw : picture.width;
  const offsetX = frameMode ? S.draw.frame * fw : 0;
  if (frameMode) clipFrame(picture, offsetX, offsetX + fw);
  else unclip(picture);

  // Blocking up the pixels is what a sprite wants and what a photograph does
  // not: past a few hundred across, a picture is being shown at or below its
  // own size and hard edges just make it look broken.
  const chunky = viewW <= 256 && picture.height <= 256;
  const canvas = h('canvas', {
    class: `pixels${chunky ? '' : ' smooth'}`, width: viewW, height: picture.height,
  });

  // The whole picture, kept as a canvas for the frame view, the ghost and
  // the looping preview to draw slices of. Refreshed by paint().
  const whole = document.createElement('canvas');
  whole.width = picture.width;
  whole.height = picture.height;

  // The picture's edge and, in the whole-strip view, the frame boundaries are
  // overlays — one screen pixel at any zoom, never part of what is saved. Both
  // are inset on the picture's box, so neither is sized by hand, and both
  // follow a zoom for nothing. The edge is there because a transparent pixel
  // and the empty strip beside the picture are the same checkerboard: without
  // it, where the picture ends is a guess.
  const edge = h('div', { class: 'picture-edge' });
  let lines = null;
  if (frames > 1 && !frameMode) {
    lines = h('div', { class: 'frame-lines' });
    lines.style.setProperty('--frames', frames);
  }

  // The lines between the squares, once a square is big enough to see past
  // them, and with Every 8 a brighter one every eighth square to count by.
  // Display only, like the edge: one-screen-pixel strokes over the picture's
  // own units, shown and hidden by sizeBox as the scale moves, and the button
  // with them, since it does nothing while there is no grid.
  const grid = document.createElementNS(SVG_NS, 'svg');
  grid.setAttribute('class', 'pixel-grid');
  grid.setAttribute('viewBox', `0 0 ${viewW} ${picture.height}`);
  grid.setAttribute('preserveAspectRatio', 'none');
  grid.setAttribute('aria-hidden', 'true');
  grid.style.display = 'none';
  const gridLines = (cls, every) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', cls);
    path.setAttribute('d', gridPath(viewW, picture.height, every));
    grid.append(path);
    return path;
  };
  gridLines('squares', 1);
  const eights = gridLines('eights', 8);
  const showEights = () => { eights.style.display = S.drawPrefs.eights ? '' : 'none'; };
  showEights();
  const eightsBtn = h('button', {
    class: `quiet tiny${S.drawPrefs.eights ? ' on' : ''}`,
    text: 'Every 8',
    title: 'A brighter line every 8 squares, to count them by',
    hidden: true,
    onclick: () => {
      S.drawPrefs.eights = !S.drawPrefs.eights;
      eightsBtn.classList.toggle('on', S.drawPrefs.eights);
      showEights();
    },
  });

  // The shape being dragged out, on a canvas of its own over the picture. The
  // call that will land is the one that draws it — into a scratch picture the
  // size of what the canvas shows — so what somebody sees while dragging is
  // exactly what lifting the pointer writes. Nothing touches the real picture
  // until then: no step to undo, no half-drawn shape to save, and abandoning
  // one costs a clear.
  const preview = h('canvas', { class: 'pixels preview', width: viewW, height: picture.height });
  const scratch = blankPicture(viewW, picture.height);
  const clearPreview = () => {
    scratch.data.fill(0);
    preview.getContext('2d').clearRect(0, 0, viewW, picture.height);
  };

  // The picture's box on screen, which the canvas fills exactly — so there is
  // no letterbox to correct for: one element's size is the whole of zoom, and
  // spotOf has one rectangle to read. .media centres it while it is smaller
  // than the pane and scrolls it once it is bigger, which is the whole of
  // panning.
  const pictureBox = h('div', { class: 'picture-box' }, canvas, preview, grid, edge, lines);
  const media = h('div', { class: 'media grow' }, pictureBox);

  // Screen pixels per picture pixel. `fit` is as big as the pane allows —
  // what a picture opens at, and what the canvas always did — and a number is
  // a zoom somebody chose, which survives the pane resizing under it.
  // ⚠️ Both sides of the box come off one scale, so its shape is the picture's
  // exactly: spotOf divides by that shape, and a drift of a pixel puts the far
  // corner on the wrong square.
  let pane = null;
  const scaleNow = () => {
    if (!pane?.width || !pane.height) return 0;
    if (S.drawPrefs.zoom !== 'fit') return S.drawPrefs.zoom;
    return Math.min(pane.width / viewW, pane.height / picture.height);
  };
  const sizeBox = () => {
    const scale = scaleNow();
    if (!(scale > 0)) return;
    grid.style.display = scale >= GRID_FROM ? '' : 'none';
    eightsBtn.hidden = scale < GRID_FROM;
    // Hold the middle of the view still across a zoom, or pressing + walks off
    // towards the top-left corner of the picture.
    const was = [pictureBox.offsetWidth, pictureBox.offsetHeight];
    const cx = was[0] ? (media.scrollLeft + media.clientWidth / 2) / was[0] : 0.5;
    const cy = was[1] ? (media.scrollTop + media.clientHeight / 2) / was[1] : 0.5;
    const w = viewW * scale;
    const hi = picture.height * scale;
    pictureBox.style.width = `${w}px`;
    pictureBox.style.height = `${hi}px`;
    media.scrollLeft = cx * w - media.clientWidth / 2;
    media.scrollTop = cy * hi - media.clientHeight / 2;
  };
  // The observer's content rect is the pane inside its padding, which is the
  // room the picture actually has. Reading it here is what keeps Fit fitting
  // when the window changes, the rail folds or the tools wrap to a new line.
  new ResizeObserver(([entry]) => { pane = entry.contentRect; sizeBox(); }).observe(media);

  // Stepping from Fit means stepping from whatever Fit currently is, so the
  // first press changes the size by something you can see rather than jumping
  // to 1× and shrinking a picture that was filling the pane.
  const stepZoom = (dir) => {
    const now = scaleNow();
    const next = dir > 0
      ? ZOOMS.find((z) => z > now + 0.01)
      : ZOOMS.filter((z) => z < now - 0.01).pop();
    if (!next) return;
    S.drawPrefs.zoom = next;
    sizeBox();
    showZoom();
  };
  // A plain wheel scrolls the pane, which is panning; a pinch on a trackpad
  // arrives as a wheel with ctrl held, and that is the one that zooms.
  media.addEventListener('wheel', (event) => {
    if (!event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    stepZoom(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  const state = h('span', { class: 'hint muted' });
  // The picture saves itself two seconds after a stroke (spec.md §5); the
  // game's colours are the other work in this pane, saved with it and on the
  // way out. The words say which of them is on its way.
  const unsaved = () => {
    if (S.draw.dirty && S.palette?.dirty) return 'Saving the picture and the colours…';
    if (S.draw.dirty) return 'Saving…';
    if (S.palette?.dirty) return 'Colours not saved yet';
    return 'Saved';
  };

  const paint = () => {
    whole.getContext('2d')
      .putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
    if (frameMode) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, viewW, picture.height);
      // The ghost: the frame before, very faint, to draw against. Display
      // only — the eyedropper and the save never see it. Frame one ghosts
      // the last frame, because the animation loops.
      if (S.drawPrefs.ghost) {
        const prev = ((S.draw.frame + frames - 1) % frames) * fw;
        ctx.globalAlpha = 0.25;
        ctx.drawImage(whole, prev, 0, fw, picture.height, 0, 0, fw, picture.height);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(whole, offsetX, 0, fw, picture.height, 0, 0, fw, picture.height);
    } else {
      canvas.getContext('2d')
        .putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
    }
    state.textContent = unsaved();
  };

  const touched = () => {
    S.draw.dirty = true;
    saveEditorSoon();
    paint();
  };

  // A gesture is one step back, however many pixels it covered, so undoing
  // feels like undoing a thing you did rather than a pixel you passed over.
  const opened = () => beginStep(picture);

  const used = () => [...S.draw.undo, ...S.draw.redo].reduce((n, s) => n + stepBytes(s), 0);

  const closed = () => {
    const step = endStep(picture);
    if (!step) return;
    S.draw.undo.push(step);
    // A new gesture is a new branch of history: whatever was undone is not
    // coming back, and keeping it would let redo paste it over this.
    S.draw.redo = [];
    // One step is always kept, however large — a flood fill of a whole big
    // picture is the only thing that can reach the budget on its own, and
    // refusing to remember it would mean it could not be undone.
    while (S.draw.undo.length > 1 && used() > UNDO_BYTES) S.draw.undo.shift();
    S.draw.dirty = true;
    saveEditorSoon();
  };

  const colour = () => (S.drawPrefs.tool === 'eraser' ? CLEAR : rgbaOf(chosenColour()));

  const shaping = () => SHAPES[S.drawPrefs.tool] ?? null;

  // A freehand stroke is stamped one pixel behind the pointer, because whether
  // a pixel is a corner cannot be asked until the one after it arrives (see
  // isCorner). `held` is the pixel waiting to be stamped and `laid` the last
  // one that was; the lag is one pixel of movement, which nobody sees.
  //
  // Pixel-perfect only applies at one pixel across: wider than that the
  // doubling it removes is inside the brush and invisible, and dropping a
  // corner would thin the stroke instead. The machinery runs either way and
  // only the question is skipped, so there is one stroke path, not two.
  let held = null;
  let laid = null;
  const strokeTo = (to) => {
    for (const point of linePoints(held[0], held[1], to[0], to[1]).slice(1)) {
      if (laid && S.drawPrefs.brush === 1 && isCorner(laid, held, point)) { held = point; continue; }
      stamp(picture, held[0], held[1], colour(), S.drawPrefs.brush);
      laid = held;
      held = point;
    }
  };
  // What the stroke still owes when the pointer lifts: the pixel it was
  // holding back. A tap that never moved is only ever this.
  const strokeEnd = () => {
    if (held) stamp(picture, held[0], held[1], colour(), S.drawPrefs.brush);
    held = null;
    laid = null;
  };

  // One call draws a shape, and where it lands is the only difference between
  // seeing it and keeping it. ⚠️ spotOf answers in the picture's own
  // coordinates while the preview canvas holds one frame of a strip, so the
  // frame's offset comes back off for the preview and stays on for the real
  // thing. The other way round puts the shape off the side of a strip.
  const putShape = (target, from, to, shift) => shaping()(
    target, from[0] - shift, from[1], to[0] - shift, to[1],
    colour(), S.drawPrefs.brush, S.drawPrefs.filled,
  );
  const showShape = (from, to) => {
    scratch.data.fill(0);
    putShape(scratch, from, to, offsetX);
    preview.getContext('2d').putImageData(new ImageData(scratch.data, viewW, picture.height), 0, 0);
  };

  // The canvas is the picture's box, so a position on screen is a square in
  // the picture as soon as it is divided by how big a square is drawn — plus
  // the frame's own offset, when the canvas is showing one frame of a strip.
  const spotOf = (event) => {
    const box = canvas.getBoundingClientRect();
    const sx = box.width / viewW;
    const sy = box.height / picture.height;
    // ⚠️ A canvas the layout has squeezed to nothing scales by zero, and the
    // arithmetic below then answers NaN rather than a square — which drawLine
    // walks towards forever, because NaN is never equal to the end of the
    // line. That is a frozen page, not a missed stroke. There is no pixel
    // under the pointer here, so say so and let every tool refuse the gesture.
    if (!(sx > 0) || !(sy > 0)) return null;
    return [
      Math.floor((event.clientX - box.left) / sx) + offsetX,
      Math.floor((event.clientY - box.top) / sy),
    ];
  };

  // One finger draws, so two are how a picture bigger than its pane gets moved
  // about: .media is a scroll box and this drags it. A second finger landing
  // ends the stroke the first one had started rather than bending it — a pan
  // is not a line — and that stroke is one Undo like any other. ⚠️ Ending it
  // here must not render: a render replaces the canvas under the fingers still
  // on it, and the rest of the gesture goes to an element off the page.
  const fingers = new Map();
  let panned = null;
  const middle = () => {
    const [a, b] = [...fingers.values()];
    return [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];
  };

  // Where a shape was started from. Held apart from `last` because the two
  // gestures are not the same shape of thing: a stroke is a run of pixels as
  // it happens, a shape is two corners and nothing at all until it is let go.
  let anchor = null;

  let last = null;
  canvas.addEventListener('pointerdown', (event) => {
    fingers.set(event.pointerId, event);
    if (fingers.size === 2) {
      event.preventDefault();
      if (anchor) { anchor = null; clearPreview(); }
      if (last) { last = null; strokeEnd(); closed(); }
      const [mx, my] = middle();
      panned = { mx, my, left: media.scrollLeft, top: media.scrollTop };
      return;
    }
    if (fingers.size > 2 || frozen()) return;
    event.preventDefault();
    const spot = spotOf(event);
    if (!spot) return;
    const [x, y] = spot;
    if (S.drawPrefs.tool === 'pick') {
      const found = pixelAt(picture, x, y);
      // Picking nothing would set the colour to invisible, which reads as the
      // eyedropper being broken rather than as an empty pixel.
      // Into the chosen square, so picking a colour off the picture is how you
      // build the palette up rather than something separate from it.
      if (found && found[3] !== 0) setPaletteColour(S.drawPrefs.slot, hexOf(found));
      return;
    }
    if (shaping()) {
      // No step is opened and the picture is not touched: a shape exists only
      // on the preview until the pointer lifts.
      anchor = [x, y];
      try { canvas.setPointerCapture(event.pointerId); } catch { /* no capture */ }
      showShape(anchor, anchor);
      return;
    }
    // A pointerup that never arrived — released off-window with no capture —
    // would otherwise leave the last gesture open and lose it to this one.
    if (picture.step) closed();
    opened();
    // Capture keeps a stroke going when the pointer leaves the canvas, so
    // drawing to the edge does not stop halfway. Failing to get it is not a
    // reason to refuse the stroke.
    try { canvas.setPointerCapture(event.pointerId); } catch { /* no capture */ }
    last = [x, y];
    if (S.drawPrefs.tool === 'fill') {
      (S.drawPrefs.everywhere ? replaceColour : floodFill)(picture, x, y, colour());
      // A fill is over the moment it is done; there is no dragging it. Through
      // render() rather than paint() so Undo stops looking greyed out.
      last = null;
      closed();
      render();
      return;
    }
    // Held rather than stamped: the first pixel of a stroke is as much a
    // candidate for being a corner as any other.
    held = [x, y];
    laid = null;
  });

  canvas.addEventListener('pointermove', (event) => {
    if (fingers.has(event.pointerId)) fingers.set(event.pointerId, event);
    if (panned) {
      if (fingers.size < 2) return;
      const [mx, my] = middle();
      media.scrollLeft = panned.left + (panned.mx - mx);
      media.scrollTop = panned.top + (panned.my - my);
      return;
    }
    if (anchor) {
      const spot = spotOf(event);
      if (spot) showShape(anchor, spot);
      return;
    }
    if (!last || S.drawPrefs.tool === 'pick') return;
    const spot = spotOf(event);
    if (!spot) return;
    const [x, y] = spot;
    if (last[0] === x && last[1] === y) return;
    strokeTo(spot);
    last = [x, y];
    touched();
  });

  // Lifting the pointer is what ends a stroke, and therefore what makes it one
  // step back rather than a hundred. For a shape it is the whole of the
  // drawing: everything before it was a picture of one.
  const stop = (event, cancelled = false) => {
    if (event) fingers.delete(event.pointerId);
    // The render the pan owes: the stroke it interrupted was closed without
    // one, so Undo is still sitting there greyed out.
    if (panned) {
      if (fingers.size >= 2) return;
      panned = null;
      render();
      return;
    }
    if (anchor) {
      const from = anchor;
      const to = (!cancelled && event && spotOf(event)) || from;
      anchor = null;
      clearPreview();
      // A cancelled gesture — the browser taking the pointer away — leaves
      // the picture alone, which is what the empty preview already showed.
      if (cancelled) return;
      opened();
      putShape(picture, from, to, 0);
      closed();
      render();
      return;
    }
    if (!last) return;
    last = null;
    strokeEnd();
    closed();
    render();
  };
  canvas.addEventListener('pointerup', (event) => stop(event));
  canvas.addEventListener('pointercancel', (event) => stop(event, true));

  const tools = h('div', { class: 'row wrap' }, DRAW_TOOLS.map((t) => iconButton({
    name: t.name,
    label: t.label,
    hint: t.hint,
    on: S.drawPrefs.tool === t.key,
    onclick: () => { S.drawPrefs.tool = t.key; render(); },
  })));

  // Only worth offering where it changes something: on a 32-square sprite a
  // 16-wide brush is most of the picture. The brush is a standing choice, so
  // one carried over from a big picture is brought back down here rather than
  // painting a whole small one in a single dab.
  const available = BRUSHES.filter((n) => n === 1 || n <= Math.min(viewW, picture.height) / 4);
  if (!available.includes(S.drawPrefs.brush)) S.drawPrefs.brush = available[available.length - 1];

  const brushes = h('div', { class: 'row wrap' },
    h('span', { class: 'hint muted', text: 'Brush' }),
    available.map((n) => h('button', {
      class: `quiet tiny${S.drawPrefs.brush === n ? ' on' : ''}`,
      text: n === 1 ? '1 pixel' : `${n}`,
      title: `Paint ${n} pixel${n === 1 ? '' : 's'} across`,
      onclick: () => { S.drawPrefs.brush = n; render(); },
    })),
    // Only where it means something: a line has no inside, and the four tools
    // above it are not shapes at all. Left out rather than greyed out.
    FILLABLE.has(S.drawPrefs.tool) ? h('button', {
      class: `quiet tiny${S.drawPrefs.filled ? ' on' : ''}`,
      text: 'Fill it in',
      title: 'Colour the middle as well as the edge',
      onclick: () => { S.drawPrefs.filled = !S.drawPrefs.filled; render(); },
    }) : null,
    // Fill's alone, for the same reason: every pixel of the clicked colour
    // rather than only the ones joined to it.
    S.drawPrefs.tool === 'fill' ? h('button', {
      class: `quiet tiny${S.drawPrefs.everywhere ? ' on' : ''}`,
      text: 'Everywhere',
      title: `Change every pixel of that colour in the ${frameMode ? 'frame' : 'picture'}, joined up or not`,
      onclick: () => { S.drawPrefs.everywhere = !S.drawPrefs.everywhere; render(); },
    }) : null);

  // The game's colours, two rows of sixteen. Choosing one says both "draw with
  // this" and "this is the one the colour box and the eyedropper will change".
  const colours = paletteColours();
  const chips = colours.map((hex, i) => h('button', {
    class: `swatch${S.drawPrefs.slot === i ? ' on' : ''}`,
    style: `background:${hex}`,
    title: `${hex} — click to draw with it; the colour box and the eyedropper change the one you have chosen`,
    'aria-label': `Colour ${i + 1}, ${hex}`,
    onclick: () => {
      S.drawPrefs.slot = i;
      if (S.drawPrefs.tool === 'eraser') S.drawPrefs.tool = 'pencil';
      render();
    },
  }));

  const well = h('input', {
    type: 'color', id: 'draw-well',
    title: `Change the square you have chosen — this edits ${LOOK_FILE}`,
    'aria-label': 'Change the chosen colour',
  });
  well.value = colours[S.drawPrefs.slot] ?? PALETTE[0];
  // Dragging around a colour picker fires input continuously. The square is
  // repainted in place so the picker is not replaced under the pointer, and
  // only letting go writes the file.
  well.addEventListener('input', () => {
    const chip = chips[S.drawPrefs.slot];
    if (chip) chip.style.background = well.value;
  });
  well.addEventListener('change', () => setPaletteColour(S.drawPrefs.slot, well.value));

  const swatches = h('div', { class: 'col' },
    h('div', { class: 'swatches' }, chips),
    h('div', { class: 'row wrap' },
      well,
      h('span', {
        class: 'hint muted',
        text: S.palette?.dirty
          ? `Colours change ${LOOK_FILE} when you save`
          : S.palette?.from
            ? `Colours from ${LOOK_FILE}`
            : `The studio's colours — changing one writes ${LOOK_FILE}`,
      }),
      h('div', { class: 'spacer' }),
      S.palette?.from
        ? h('button', {
          class: 'link tiny',
          text: 'See them',
          title: `Open ${LOOK_FILE}`,
          onclick: () => openFile(LOOK_FILE),
        })
        : null));

  // The strip, always playing while it is being edited: a small canvas on the
  // frame row looping at the library's own 8 frames a second, reading the
  // same `whole` canvas paint() refreshes — so a stroke shows up in the loop
  // as it is drawn. The loop stops itself once its canvas leaves the page, so
  // a render never leaks an animation.
  let frameRow = null;
  if (frames > 1) {
    const preview = h('canvas', { class: 'strip-preview', width: fw, height: picture.height });
    preview.style.width = `${Math.max(24, Math.round(40 * (fw / picture.height)))}px`;
    const pctx = preview.getContext('2d');
    let seen = false;
    const loop = (t) => {
      if (preview.isConnected) seen = true;
      else if (seen) return;
      const f = Math.floor(t / 125) % frames;
      pctx.clearRect(0, 0, fw, picture.height);
      pctx.drawImage(whole, f * fw, 0, fw, picture.height, 0, 0, fw, picture.height);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    frameRow = h('div', { class: 'row wrap' },
      preview,
      ...Array.from({ length: frames }, (_, i) => h('button', {
        class: `quiet tiny${frameMode && S.draw.frame === i ? ' on' : ''}`,
        text: `${i + 1}`,
        title: `Edit frame ${i + 1}`,
        onclick: () => { S.draw.whole = false; S.draw.frame = i; render(); },
      })),
      h('button', {
        class: `quiet tiny${frameMode ? '' : ' on'}`,
        text: 'Whole strip',
        title: 'See and draw across every frame at once',
        onclick: () => { S.draw.whole = true; render(); },
      }),
      h('div', { class: 'spacer' }),
      frameMode ? h('button', {
        class: 'quiet tiny', text: 'Copy frame',
        title: 'Remember this frame, to paste over another one',
        onclick: () => { S.draw.copied = copyFrame(picture, fw, S.draw.frame); render(); },
      }) : null,
      frameMode && S.draw.copied ? h('button', {
        class: 'quiet tiny', text: 'Paste frame',
        title: 'Paste the copied frame over this one — one Undo takes it back',
        disabled: frozen(),
        onclick: () => {
          if (picture.step) closed();
          opened();
          pasteFrame(picture, fw, S.draw.frame, S.draw.copied);
          closed();
          render();
        },
      }) : null,
      frameMode ? h('button', {
        class: `quiet tiny${S.drawPrefs.ghost ? ' on' : ''}`,
        text: 'Ghost',
        title: 'Show the frame before, very faintly, to draw against',
        onclick: () => { S.drawPrefs.ghost = !S.drawPrefs.ghost; render(); },
      }) : null);
  }

  // Zoom is about the view rather than the drawing, so it sits in the bar
  // with Undo instead of among the tools. Fit is left out while it is what
  // you are already looking at, the way every other control here is.
  const zoomLabel = h('span', { class: 'hint muted' });
  const fitBtn = h('button', {
    class: 'quiet tiny',
    text: 'Fit',
    title: 'Show the whole picture again',
    onclick: () => { S.drawPrefs.zoom = 'fit'; sizeBox(); showZoom(); },
  });
  // The label says Fit, or how many screen pixels a picture pixel is getting.
  const showZoom = () => {
    zoomLabel.textContent = S.drawPrefs.zoom === 'fit' ? 'Fit' : `${S.drawPrefs.zoom}×`;
    fitBtn.hidden = S.drawPrefs.zoom === 'fit';
  };
  const zoomBtn = (text, dir, title) => h('button', {
    class: 'quiet tiny', text, title, onclick: () => stepZoom(dir),
  });
  const zoomRow = h('div', { class: 'row' },
    zoomBtn('−', -1, 'Make the squares smaller'),
    zoomLabel,
    zoomBtn('+', 1, 'Make the squares bigger, to draw one pixel at a time'),
    fitBtn,
    eightsBtn);
  showZoom();

  paint();
  return h('div', { class: 'drawing grow' },
    media,
    h('div', { class: 'pad col' }, frameRow, tools, brushes, swatches),
    h('div', { class: 'editor-bar row' },
      state,
      h('span', {
        class: 'hint muted',
        text: frameMode
          ? `frame ${S.draw.frame + 1} of ${frames} — ${fw} × ${picture.height}`
          : frames > 1
            ? `${picture.width} × ${picture.height} — ${frames} frames of ${picture.height}`
            : `${picture.width} × ${picture.height}`,
      }),
      h('div', { class: 'spacer' }),
      zoomRow,
      iconButton({
        name: 'undo',
        label: 'Undo',
        hint: 'take back the last thing you drew (⌘Z)',
        disabled: !S.draw.undo.length,
        onclick: () => stepDrawing(true),
      }),
      iconButton({
        name: 'redo',
        label: 'Redo',
        hint: 'put back what you just took back (⇧⌘Z)',
        disabled: !S.draw.redo.length,
        onclick: () => stepDrawing(false),
      })));
}
