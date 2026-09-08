## 9. SSE events

One stream per tab at `/api/stream`. Because every studio account can see
every project, **every event goes to every connected tab** and the client
filters on `project_slug`. This deletes `new-y`'s membership lookup in the
broker entirely.

| event | payload |
|---|---|
| `project.new` | `{slug, name}` |
| `project.updated` | `{slug, name, archived, published?, scores_on?, stage?}` — the row changed; the client refetches the list and applies whichever of the optional fields came |
| `message.new` | full message: `{id, project_slug, user_id, user_name, agent_id, kind, body, working, created_at, tokens, trimmed, context_paths, writes, reactions, plan, plan_message_id}` — `working` is whether the reply has *working* to open (a flag; the text is fetched, §6), `plan` is `{status, pieces}` on a card of kind `'plan'`, null otherwise; `plan_message_id` is set on a *piece*'s row, which the client keeps out of the thread — its card carries it — and marks nothing unread for (§8) |
| `plan.update` | `{project_slug, chat_id, message_id, body, plan: {status, summary, assumptions, edited, pieces: [{title, files, what, status, message_id, note, writes}]}}` — a person changed a draft, Build it was pressed (`queued`), a *piece* started (`running`) or landed, or the plan paused, finished or was set aside; `body` is the card's rewritten text, `tokens` the pieces' cost so far — summed from their rows and written onto the card's own, null until one has landed — and `note` a piece's *headline*; the client puts all three on the card and re-renders (§8) |
| `message.reaction` | `{project_slug, chat_id, message_id, user_id, user_name, emoji, action: 'add'\|'remove'}` — a delta, applied by the same idempotent merge as the reacting tab's own optimistic click |
| `agent.stream.start` | `{project_slug, agent_id}` |
| `agent.stream.reasoning` | `{project_slug, agent_id, delta}` — reasoning trace, rendered dimmed and collapsible, never persisted |
| `agent.stream.chunk` | `{project_slug, agent_id, delta}` — reply text |
| `agent.tool` | `{project_slug, agent_id, tool, path, bytes?}` — drives the line under the name (`writing js/game.js, 3 KB`). Sent as a call *begins to arrive* — its name and path read off the first fragments (`tool_start` in the DeepSeek client) — then every 512 characters with `bytes` so far (`tool_progress`), and again as it runs: a file takes as long to arrive as the model takes to write it, and that was a fire's longest silence. Once more ahead of the builder's *sizing* call as `tool: 'size'`, not a tool but the one thing in a fire that streams nothing at all. A tool call ends a turn, so it also folds what the turn said into the live reply's `Working` panel (§8) |
| `agent.stream.end` | `{project_slug, agent_id, message_id?, error?}` |
| `chats.changed` | `{project_slug}` — a chat was added or renamed; the client refetches the list rather than being sent it |
| `files.changed` | `{project_slug, paths: string[]}` — the tree changed: client refreshes the tree and reloads the preview iframe. Fires on the write, which for a save is before its commit (§5) |
| `version.new` | `{project_slug, sha, paths: string[]}` — a commit landed, from whichever route or turn made it: the *pending commit* on its timer, a helper's turn, a restore. Client refreshes Versions and the open file's count; never the preview |
| `game.errors` | `{project_slug, errors: [{id, message, location, times, at}]}` — the whole current list, not a delta |
| `collection.changed` | `{}` — the *studio collection* gained or lost a picture. The only event with no `project_slug`, because the collection belongs to no game: every tab drops its copy of the *shelf*'s index and repaints |

⚠️ **`STREAM_EVENTS` in `public/stream.js` is an allow-list.** `EventSource` delivers
only what has been subscribed to by name, so a handler added to `onEvent`
without a line in that array is dead code that looks alive — which is exactly
how `collection.changed` shipped inert the first time.

`files.changed` is what makes the studio feel live: an agent writes a file and
the game in your preview pane reloads. It stopped meaning "a version landed"
when saves stopped committing at once; `version.new` says that now, and the
two arrive together for every commit but a save's. `files.changed` and
`project.updated` are also what stamp `projects.updated_at`, from a hook on
the broker beside the one web push hangs on (§3).

A streaming reply exists nowhere but the tabs watching the stream until the
fire ends, so the client buffers it **per game** and never clears a buffer on
a project switch: an event for a game that is not on screen still lands in
its buffer and paints nothing, and switching back mid-fire shows everything
said so far. A reload is still a loss — the server has nothing to replay —
and a reasoning trace is never persisted at all (§8).
