// The track: the points the road passes through, in order. The road closes
// back to the first point on its own, and `width` is how wide it is. `start`
// is which point the start line sits at. Draw it in the studio's track editor
// rather than typing numbers: drag a point to move it, click on the road to
// add one.
const TRACK = {
  width: 90,
  points: [
    [120, 300],
    [300, 120],
    [700, 120],
    [860, 300],
    [700, 480],
    [300, 480],
  ],
  start: 0,
};

// What sits on the road: a rock to bash into, a boost pad that shoves you on,
// a puddle that slows you down. Each has a kind, a place and a size, and
// belongs on the road, where a car can meet it.
const THINGS = [
  { kind: "rock", at: [500, 135], size: 22 },
  { kind: "boost", at: [500, 500], size: 30 },
  { kind: "puddle", at: [830, 380], size: 36 },
];
