// The plan canvas: a game's world drawn flat by the studio, for an editor to
// drag things about on — the track editor's road and the world editor's pile
// (ideas/modularity.md). What is the same for both is here: a canvas in the
// world's own pixels, the pointer mapped into them through the box the browser
// drew, a drag held with pointer capture, handles a thumb's size on screen
// whatever the scale, and Delete for the selected thing. What is drawn, what a
// press picks up and what a drag does are the editor's.
//
//   const { canvas, repaint } = planCanvas({
//     world: { width: 960, height: 600 }, className: 'track-canvas', readOnly,
//     paint(ctx, px),          // draw everything; px(n) is n screen pixels in world pixels
//     press(p),                // p = { x, y, scale }: a drag to hold, or null for none
//     drag(held, p),           // the pointer moved while holding it
//     lift(held),              // let go
//     remove(),                // Delete or Backspace, outside a field
//   });

import { h } from './dom.js';

// One keyboard listener for whichever plan is on screen, replaced on every
// render rather than added again.
let keys = null;

export function planCanvas({
  world, className, readOnly = false, paint, press, drag, lift, remove,
}) {
  // Focusable, and focused when pressed: the preview beside it keeps the
  // keyboard otherwise — a game grabs focus when it loads — and Delete would
  // go to the game instead of taking the chosen thing out.
  const canvas = h('canvas', {
    class: className, width: world.width, height: world.height, tabindex: '-1',
  });

  const repaint = () => {
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect?.() ?? { width: world.width };
    const px = (n) => n * (world.width / (rect.width || world.width));
    ctx.clearRect(0, 0, world.width, world.height);
    paint(ctx, px);
  };
  // Painted once the canvas is on the page: its screen size decides how big
  // the handles are drawn.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(repaint);
  else repaint();

  const at = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scale = world.width / (rect.width || world.width);
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale };
  };

  let held = null;
  if (!readOnly) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      canvas.focus({ preventScroll: true });
      held = press(at(e));
      if (!held) return;
      canvas.setPointerCapture?.(e.pointerId);
      repaint();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!held) return;
      drag(held, at(e));
      repaint();
    });
    const up = () => {
      if (!held) return;
      const was = held;
      held = null;
      lift(was);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  if (keys && typeof window !== 'undefined') window.removeEventListener('keydown', keys);
  // Only while a plan is on screen: Delete under Code must not reach a track
  // point. Asked of the page rather than of this canvas, since a render may
  // build the editor more than once and keep the last.
  keys = (e) => {
    if (readOnly || !document.querySelector(`canvas.${className}`)) return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (e.target?.closest?.('input, textarea, select')) return;
    if (remove()) e.preventDefault();
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', keys);

  return { canvas, repaint };
}
