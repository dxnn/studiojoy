# One pane

Decided 2026-10-05: the rail goes. Everything in it moves into the centre,
and the preview becomes a mode of its own.

Why. On a phone there is room for one pane at a time, so the rail was only
ever a second place to switch to. On a wide screen neither pane can be
closed, so whoever is focused on one keeps dragging the other to its minimum.
The open question in CLAUDE.md — *what the rail is for* — is answered: nothing
the centre cannot hold, if phones are first class.

A transient info panel sliding in from the right, for a selected thing, may
come later. It does not translate to a phone, so it is not part of this.

## What lives in the rail today

- **The preview** (`renderPreview`, main.js): the frame laid over a placeholder,
  the preview player's controls, the shape `···`, Open, Hide, the note or the
  robot's, then the game's **problems** and **moments**.
- **The inspector** under it (`renderInspector`): the story's and the
  adventure's scene fields, the Track, World and Level inspectors, Pics'
  picture or person fields, Hear's sound editor — and the **tweaks** when none
  of those claims it.
- The grip, `S.railWidth`, `.no-rail`, `hasRail()`, `S.narrowPane = 'rail'`
  (four editors jump there), and the phone header's *Preview* button.

## The shape after

1. **The preview is a mode** — a pill, and an entry in the phone's list. The
   game, its controls, the robot note, the tweaks, its problems and its
   moments, in that order, the game as big as the pane allows in the chosen
   shape. The frame still lives outside the rendered tree, over a placeholder
   (spec/ §17), so a render never restarts it.
2. **Off its tab, the game stays loaded and paused.** ⚠️ This is load-bearing:
   the builder's shot (`look_at_game`, telemetry.js) is taken from the live
   preview when a message is sent, and messages are sent from Speak. Unloaded
   off-tab, the builder would never see the game again. Paused, it keeps its
   place, makes no sound, and the shot is the frame you last looked at. It
   carries on when you come back, unless you paused it yourself.
3. **The selected thing's fields open in place, in the centre** — the studio's
   own convention: under the row that was picked, or under the canvas, one at
   a time, the same control closing them. Hear's sound editor under its sound;
   Pics' fields under the open picture; a scene's fields in the story's and the
   adventure's stage; the plan canvases' inspectors under the canvas. Nothing
   jumps to another pane any more, because there is none.
4. **Try this scene / Try it** opens the preview's mode on that place. The mode
   is in the address, so Back is the way back to the editor.
5. **The rail goes**: the grid column, the grip and its width, `hasRail`,
   `narrowPane = 'rail'`, the phone header's Preview button. The centre takes
   the whole width beside the sidebar.

## What is given up

- **Chat and game side by side on a wide screen.** Today the builder's change
  lands in the preview while you read its reply. After, it is a tab apart.
  *Open* — the game in its own browser tab — is the wide-screen way to have
  both, and the preview's pill can wear a mark when the game reports a
  problem, the way Speak's wears one for a message.
- **Editing a scene while watching it.** Try is one press and Back is one
  more.

## Stages, each shippable and green

1. **The preview's mode.** Preview, controls, tweaks, problems and moments into
   it; off-tab paused. The rail keeps only the editors' inspectors, and a mode
   with none has no rail.
2. **The inspectors, one surface a commit:** Hear, Pics, story, adventure,
   then Track, World and Level.
3. **The rail removed** — shell, CSS, state, phone header — and spec/ §6 and
   §17 rewritten for one pane.

## Questions

1. **The mode's name.** The pills are senses on trial (Speak See Hear Touch
   Taste Recall Smell), and none is left that means *play*. Recommended:
   **Play**, plainly — a kid knows it, and the trial can rename it with the
   rest.
2. **Where in the row.** Recommended: second, after Speak — the two things you
   go between most.
3. **Off-tab: paused or unloaded.** Recommended: paused (point 2 above).
