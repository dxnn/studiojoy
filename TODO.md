# TODO

Build order for v0. Each line is independently testable; `spec.md` is the
design-of-record.

- write routes: files, history
- write routes: messages, stream
- ⚠️ write server/games.js — public listener, traversal tests, no-cookie test
- write server/llm/deepseek.js — SSE to iterator, with a scripted fake for tests
- write server/agents/{mentions,orchestrator}.js — dirty bit, cooldown, tool loop
- write server/agents/tools.js — write_file, patch_file, read_file, delete_file
- write server/budget.js — studio-wide daily counter
- write public/{index.html,style.css,main.js} — chat, file tree, editor, preview
- add bin/smoke.js — one live DeepSeek round trip, kept out of npm test
- write README.md and fill in CLAUDE.md current state
