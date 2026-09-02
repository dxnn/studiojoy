This game started from the visual novel template: it shows a scene from
config/story.js, says its lines one at a time, and offers the choices that
lead to the next scene. The whole story is content — there is no code to
write to change what happens. It starts empty: the story editor's guide asks
for the story one question at a time and writes the answers here.

- config/story.js — the cast and every scene. This is the whole story; the
  studio opens it as the story editor, the Story tab beside the chats.
- config/words.js — the words on the title and ending screens.
- config/look.js — the four colours the game and the studio both wear.
- js/story.js — the machinery: show a scene, say a line, take a choice.
- css/style.css — how it looks: the text box, the portraits, the choices.
- index.html — loads the studio libraries, the config files, then js/story.js.
- assets/images/ — the backgrounds, one per place, named in each scene's
  `picture`. Made from the story editor, or with "+ Draw a picture" or
  "+ Upload".
- assets/sprites/ — the portraits, named <who>-<mood>.png so the story can
  ask for a person's face by mood.
- assets/sounds/ — a scene's `sound` is a .wav in here, by its plain name.
  Made with "+ Make a sound", so opening it in the studio shows the sliders.

The game is DOM and CSS rather than a canvas, because a story is mostly text
and text wants to wrap and scale on a phone. It uses two of the studio
libraries — Sound for a scene's sound, Screens for the title and ending
screens — and neither Input nor Sprites, though both are loaded.
