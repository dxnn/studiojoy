# Checks only a real device can make

What a headless browser cannot judge: a thumb, a frame rate on old hardware,
an installed PWA's notifications. Each was driven by a mouse or keys, or in a
vm, and is waiting for somebody holding the thing. One sitting with a phone
and the older iPad clears most of them.

- **Push on an installed PWA** (a real push landed 2026-09-11, on a phone).
  Whether the service worker's visible-window suppression is right on a phone
  (a PWA in the app switcher may not be `visible`), and whether the shared
  `tag` really does collapse rung 1's notification and the push into one on a
  hidden tab rather than showing two. ⚠️ Found 2026-10-01: WebKit revokes a
  push subscription whenever a push shows no notification, and the
  suppression shows none — so on an iPhone, an iPad or Safari on a Mac it is
  wrong, not merely unchecked.
- **Knock it down** on a phone: play it, and build a pile in the world editor
  — whether a thumb can pull the sling without hiding the aim dots, and hit
  the size dot on a crate (both driven by a mouse only, 2026-09-22).
- **Roll a ball** on a phone: whether the stick steers a maze, the frame rate
  on an older phone (three.js, unminified, 2.1 MB), and painting a 12-by-11
  level with a thumb (driven by keys and a mouse only, 2026-09-23).
- **The story editor at phone width**: at 390px the scene strip stacks over
  the stage and both are tall. The *height* complaint only — sideways is
  checked now and clean (`test/ui/narrow.ui.js`), so what is left is what a
  browser cannot judge: whether two tall things stacked is usable. The last of
  ideas/vn-builder.md's step 1 — the type, the guide, the fill and both
  stand-ins are built and green.
- **The five touch complaints** across the three `Screens.fit` games —
  asteriskoids, vroooooooom and redwolf-radness, the three that were cut off
  sideways (spec/ §4; the other 17 size their canvas to the window and need
  nothing). Input v6 and screens v14 are swept, and screens 14's own job is
  confirmed: iOS Safari's toolbars go on a sideways swipe up (2026-09-11).
  Text selection and feel were never checkable headless.
- **The older iPad**, now input 7 and sound 4 are swept (2026-10-01): pinch a
  drawn-controller game (the zoom that could not be pinched back out should
  not start), and pour stars in Doki Doki (the freeze per pickup should be
  gone, and sound should still play in silent mode). The pinch is checked in
  a vm only, the sound in a vm and desktop Chromium (spec/ §4).
