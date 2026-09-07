## 13. Configuration

| variable | default | notes |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | required; the server fails fast at boot without it |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | the host also answers without the `/v1` prefix |
| `PORT` | `8100` | studio listener; 8090 is left free for `new-y`, which both defaults to and is expected to run alongside this |
| `GAMES_PORT` | `8101` | games listener |
| `GAMES_URL` | unset | overrides play/preview links; unset derives them from each request's `Host` on `GAMES_PORT` |
| `DB_PATH` | `gamestudio.db` | |
| `GAMES_DIR` | `games` | |
| `DAILY_TOKEN_BUDGET` | `5000000` | |
| `TRUST_PROXY` | unset | set to `1` behind a reverse proxy so the login lockouts and the sign-up limiter see real client addresses instead of the proxy's |
| `VAPID_PUBLIC_KEY` | unset | web push (§6). All three or none: with any missing, the push routes are 404 and only a live tab is told anything |
| `VAPID_PRIVATE_KEY` | unset | ⚠️ a signing key. `npm run pushkeys -- mailto:you@example.com` makes the pair, **once** — a new pair silently stops every browser already subscribed from hearing anything |
| `VAPID_SUBJECT` | unset | `mailto:` or `https:`, who a push service contacts if this studio misbehaves |

`node:sqlite` is experimental in Node 25, so the start script passes
`--disable-warning=ExperimentalWarning`.

⚠️ Web push needs a **secure origin**. Over plain http a browser refuses to
subscribe, which looks exactly like the switch not working; `localhost`
counts as secure, so development is fine and a bare-IP deployment is not.
