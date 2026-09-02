# Letting people put their own art in the studio's collection

**Built, 2026-09-02.** Dann answered the licence question with *no licence,
the kid keeps their copyright*, which is what the code does — there is no
`licence` column and nothing prints one. spec.md §3 and §6 are the state now;
this file is the argument, and the two "also unsettled" items at the end that
were settled by choosing defaults are marked below. TODO.md carries the line
to revisit the licence if the studio ever grows.

Dann, 2026-09-02: *"I want kids to be able to add their art to this studio
collection also."* Said while the *standard set* was being filled with CC0
packs. Nothing here is built. The set itself is built and full (spec.md §6):
33 portraits, 9 backgrounds, picked from the *shelf*.

## Why this is not a small change

The standard set is `public/story-art/` — files in the repo, listed in an
`index.json` in the repo, served statically, read-only. Everything about it
assumes it ships with the studio and changes only when somebody commits.

Making it writable from a browser breaks all four assumptions at once. A
picture a kid adds cannot go in `public/`: that is the studio's own source,
versioned in git, and a running studio writing into its own checkout is how
you lose work on the next deploy. So the contributed half needs somewhere
else to live, and the shelf needs to show both halves as one row.

## The shape that fits this studio

**Two halves, one shelf.** `public/story-art/` stays exactly as it is — the
shipped set, read-only, in git, the thing a fresh studio starts with. Beside
it a **studio collection**: what people here have added. `artIndex()` already
returns one merged list to the shelf, so the shelf itself barely changes.

**The bytes go in SQLite, not on disk.** This is the part worth arguing for.
Every other durable thing the studio owns is either a git repo (a game's
tree, which recovers itself) or a row (`scores`, `achievements`,
`personal_bests`, the chats, the accounts). `npm run backup` is a
`VACUUM INTO` of the database and nothing else, and CLAUDE.md is explicit
that the game trees recover themselves from git while the chats and accounts
only live in the database. A kid's drawing is in the second category: it
exists nowhere else. Put it in a directory beside `games/` and it is outside
both the git safety net and the backup; put it in a row and one existing
command already protects it. At 4–40 KB a picture, a few hundred pictures is
a few megabytes — nothing SQLite minds.

```
collection_art
  id           INTEGER PK
  kind         TEXT     'portrait' | 'background' | 'sound'
  name         TEXT     what the shelf calls it, ≤ 60
  who, mood    TEXT     portraits only, for the file name it suggests
  bytes        BLOB
  mime         TEXT     from the extension, never from the client (§4)
  width,height INTEGER  measured server-side, for the strip rule
  added_by     INTEGER  → users.id
  by_name      TEXT     the display name at the time, so the credit survives
  created_at   TEXT
```

`by_name` is copied rather than resolved, unlike a message's author: a credit
on a picture is a statement about who drew it, not about what that person is
called today.

**Routes.** `GET /api/collection` (the merged index — the shelf's one fetch),
`GET /api/collection/:id` (the bytes, cacheable, `immutable`: a row's bytes
never change), `POST /api/collection` (add), `DELETE /api/collection/:id`.
The shipped half keeps being served statically; only the added half needs a
route.

**Getting art in.** The natural place is a picture already open in the rail:
you drew it, and now you want to share it. `Put this in the studio's
collection` beside `Copy to…` on the open file's bar, which is where the
other "send this elsewhere" action already lives. It asks two things — what
to call it, and whether it is a face or a place — because the shelf needs a
name and a kind, and neither can be guessed from a PNG.

**Taking art out.** Whoever added it, or an admin. Confirmed first, like every
destructive action. ⚠️ Unlike an *achievement*, this one really is a delete:
the row is the only copy. The confirm has to say so, and it has to say that
games which already picked it keep their copy — which they do, because
picking copies the bytes in.

## ⚠️ The one that needs Dann, not a default

**What licence does a child's drawing carry?** The set's `index.json` requires
`by` and `licence` on every entry and the test enforces it, because the
shipped art is other people's work under CC0. A kid's own drawing is not that.
Three answers, and I do not think a coding agent should pick:

1. **No licence at all.** Contributed entries carry `by_name` and no licence
   field, and the shelf shows `Made here by Ada`. The set is only ever offered
   inside this studio, so no grant is needed or implied. Requires the test and
   the shape to stop demanding `licence` for the contributed half.
2. **Studio-only, stated.** `licence: "Made in this studio"` — the same
   effect, but the word is present so nothing looks unlabelled.
3. **CC0, asked for explicitly.** A checkbox on the add dialog. Honest only if
   a ten-year-old can meaningfully agree to it, which is the whole question.

⚠️ It matters beyond the studio because a *published* game is public, and a
game that picked a contributed picture carries those bytes into its own repo.
So the answer travels further than the shelf.

My recommendation is 1: the studio does not need a licence to show a kid their
own drawing, and inventing one is a rights claim nobody asked for. But it is
Dann's to decide, and the schema above is deliberately silent on it.

## Also unsettled, lower stakes

- **Moderation.** Anyone in the studio can add, so anyone can add something
  unwelcome. The studio is a few trusted people, so the shelf is probably
  fine with "an admin can remove anything" and no queue. Worth saying out
  loud rather than discovering.
- **Caps.** A per-picture cap (2 MB is generous for a 128² PNG), a per-person
  count, and a total. §10 is where they go.
- **Moods.** The shipped animals have one face each. A contributed portrait
  could name a `mood`, which is how a cast member gets more than one — worth
  offering, because it is the thing the set is most short of.
- **The shelf at scale.** 33 faces already scroll sideways. Contributions
  make that worse, and at some point the shelf wants filtering or a dialog
  rather than a strip. Not yet.

## Build order

1. The table, the four routes, the caps, the merged index. `artIndex()` gains
   a second source; the shelf does not change.
2. `Put this in the studio's collection` on the open file's bar, and the
   dialog behind it (name, kind, optional mood).
3. Removal, with the confirm that says it is the only copy.
4. Docs: spec.md §3 (the table), §6 (the routes and the collection), §10
   (the caps), GLOSSARY (*studio collection*), and whichever licence answer
   came back.
