This game started from the visual novel template: it shows a scene from
config/story.js, says its lines one at a time, and offers the choices that
lead to the next scene. The whole story is content — there is no code to
write to change what happens.

- config/story.js — the cast and every scene. This is the whole story; the
  studio opens it as the story editor, which is a list of scenes rather than
  a file of code.
- config/words.js — the words on the title and ending screens.
- config/look.js — the four colours the game and the studio both wear.
- js/story.js — the machinery: show a scene, say a line, take a choice.
- css/style.css — how it looks: the text box, the portraits, the choices.
- index.html — loads the studio libraries, the config files, then js/story.js.
- assets/images/ — the backgrounds, one per place. Replace them with
  "+ Draw a picture" or "+ Upload", keeping the same names.
- assets/sprites/ — the portraits, named <who>-<mood>.png so the story can
  ask for a person's face by mood.
- assets/sounds/page.wav — the one sound. Made with "+ Make a sound", so
  opening it in the studio shows the sliders that made it.

The game is DOM and CSS rather than a canvas, because a story is mostly text
and text wants to wrap and scale on a phone. It uses two of the studio
libraries — Sound for a scene's sound, Screens for the title and ending
screens — and neither Input nor Sprites, though both are loaded.
