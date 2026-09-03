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
- assets/music/ — whole tracks. A scene's `music` is a path in here; it loops
  behind the scene and keeps playing into the next scene that names the same
  track, so a run of scenes in one place shares one piece of music.
- assets/sounds/ — short noises, by plain name. A noise is a step among the
  lines rather than a key on the scene: `{ sound: "page" }` between two spoken
  lines plays it and carries straight on. Made with "+ Make a sound", so
  opening one in the studio shows the sliders again.

⚠️ A scene-level `sound:` is the older shape. js/story.js still plays it, but
the story editor moves it into the lines the next time somebody saves, so
write new ones as steps.

The game is DOM and CSS rather than a canvas, because a story is mostly text
and text wants to wrap and scale on a phone. It uses three of the studio
libraries — Sound for the music and the noises, Screens for the title and
ending screens, Moments to say which ending was reached — and Sprites is
loaded but unused, because a portrait is an `<img>` the stylesheet can place.

Input is loaded but never asked anything, and that is deliberate: advancing a
story is a click anywhere or a press of Enter or Space, which js/story.js
listens for itself. Binding it would put a stick and buttons over the text on
a phone.
