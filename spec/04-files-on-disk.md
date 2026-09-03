## 4. Files on disk

Each project owns a directory `<GAMES_DIR>/<slug>/`. The **working tree** on
disk is the source of truth for file content — there is no `files` table. The
listing is a `readdir`, and the same bytes are what the public plays.

### Path validation (⚠️ security boundary)

A **project path** is the API's identifier for a file inside the working tree.
It must satisfy all of:

- Non-empty, ≤ 200 characters, `/`-separated, relative.
- No leading `/`, no backslashes, no C0 control characters or DEL.
- No Unicode format characters anywhere: soft hyphen, zero-width
  spaces and joiners, bidi overrides, BOM. macOS treats several as
  ignorable, so `.gi<ZWSP>t` opens the real `.git` directory, and a bidi
  override makes a filename render as something other than what it is.
- No empty segments (`a//b`), no segment equal to `.` or `..`.
- No segment equal to `.git`, compared case-insensitively — that is the
  repository's own metadata. Note this is equality, not a prefix test:
  `.gitignore` and `.gitattributes` are ordinary files and stay allowed,
  and the format-character ban above is what closes the spoofing route that
  a prefix test would otherwise be needed for.
- No segment with leading or trailing whitespace.
- ≤ 8 path segments.

The validator returns a reason string rather than throwing, so a tool can
hand an LLM its own correction; route handlers use a wrapper that converts
the reason to a 400.

After validation the path is resolved against the project directory and the
result must still be inside it (prefix comparison including a trailing
separator). Both checks run on every read, write, delete, move, and public
serve. Symlinks are never created by the app; a symlink placed by hand is not
followed for serving (`lstat` check).

### Caps

- Per file: 10 MB.
- Per project: 200 MB total, 500 files.
- Injected into an agent's context: see §8.

### Mime for serving

Chosen from the extension, not from any client claim:

`.html .css .js .mjs .json .txt .md .csv .svg .png .jpg .jpeg .gif .webp .ico
.mp3 .ogg .wav .m4a .aac .opus .flac .webm .woff .woff2 .ttf`

The four audio types past `.wav` are what a phone or a tablet exports music
as. Without them an uploaded track is served as an opaque download and an
`<audio>` asked to play it gets silence with nothing said about why.

Any other extension is stored normally but served as
`application/octet-stream` with `Content-Disposition: attachment`.
