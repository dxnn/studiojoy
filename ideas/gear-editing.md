# Changing a piece of gear

Asked 2026-10-05: there should be a way to edit gear. Needs thinking before
building, because of what buying one means.

## What is true today

- A piece never changes once made. Its picture is served at `/_gear/:id`
  with `Cache-Control: immutable` for a year (`server/routes/gear.js`), so an
  edit in place would not even reach a browser that has seen it.
- Owning is a row in `gear_owned` — the person and the piece's id — and
  wearing is the id in `users.wear_*`. A buyer holds the piece itself, not a
  copy of it.
- A maker makes at most three pieces a week (`MAKES_A_WEEK`); everybody
  else's cost 20 joy, spent to nobody.

## Questions

1. **In place, or a new picture beside the old?** In place, everybody who
   owns or wears it gets the change whether they wanted it or not — a hat
   bought because it was good can be turned into something else under its
   buyer. Beside the old, each buyer keeps what they paid for.
2. **If beside: what does a buyer get?** The new one free with a choice to
   switch to it (the "upgrade or not" choice), the new one put on for them,
   or nothing — a new piece to buy like any other.
3. **Does a change count as one of the week's three?** If a change is free,
   drawing over a piece entirely is a way past the limit; if it counts,
   fixing one stray pixel costs a whole piece.
