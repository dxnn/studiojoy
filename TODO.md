# TODO

Build order for v0. Each line is independently testable; `spec.md` is the
design-of-record.

- write routes: messages
- write server/budget.js — studio-wide daily counter
- write server/agents/tools.js — write_file, patch_file, read_file, delete_file
- write server/agents/{mentions,orchestrator}.js — dirty bit, cooldown, tool loop
- write routes: messages
- write server/index.js — boot, env, both listeners
- write public/{index.html,style.css,main.js} — chat, file tree, editor, preview
- write README.md and fill in CLAUDE.md current state
