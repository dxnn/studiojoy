This game started from the point-and-click adventure template: it shows a
scene from config/scenes.js — one picture — and does what the spot a click
lands on says: walk through to another scene, say a line, pick something up.
The whole adventure is content — there is no code to write to change what
happens. It starts empty: the adventure editor's guide asks for it a
question at a time and writes the answers here.

- config/scenes.js — every scene and its spots. This is the whole adventure;
  the studio opens it as the adventure editor, the Scenes tab beside the
  chats. ⚠️ A spot's `at` is four numbers in the picture's own pixels, and
  nobody types those: they are drawn as a box on the picture in that editor.
- config/words.js — the words on the title and ending screens, and the two
  the game says itself: "Nothing happens." and "You have".
- config/look.js — the four colours the game and the studio both wear.
- js/adventure.js — the machinery: show a scene, find the spot under a
  click, do what it says, keep what the player carries.
- css/style.css — how it looks: the picture, the text box, the things
  carried.
- index.html — loads the studio libraries, the config files, then
  js/adventure.js.
- assets/images/ — the pictures, one per scene, named in each scene's
  `picture`. Made from the adventure editor, or with "+ Draw a picture" or
  "+ Upload".
- assets/sprites/ — a picture for each thing the player can take,
  named <thing>.png, shown among what they carry. A thing with no picture
  yet is shown as its word.
- assets/sounds/ — short noises, by plain name: a spot's `sound: "creak"`
  plays assets/sounds/creak.wav when it is clicked.

The game is DOM rather than a canvas: the picture is an `<img>` drawn to fit
the screen, and a click is mapped back into the picture's own pixels through
the box the browser drew it in, so a spot is the same spot on a phone held
either way. It uses three of the studio libraries — Sound for the noises,
Screens for the title and ending screens, Moments to say which scene was
entered, which thing was taken and which ending was reached — and Sprites is
loaded but unused, because a thing carried is an `<img>` the stylesheet can
place.

Input is loaded but never asked anything, and that is deliberate: the
pointer is the control, and a touchscreen needs nothing drawn. The seeded
control scheme is "none" for the same reason. A controller-driven cursor is
a later piece of the input library, not of this game.
