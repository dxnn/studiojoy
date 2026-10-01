// pm2 process definition. `.cjs` because pm2 requires this file directly and
// it sits outside the package's `"type": "module"`.
//
// ⚠️ The `.config.cjs` ending is not decoration. pm2 decides whether a file is
// a process definition or a script to run by matching its name against
// `.json` / `.yaml` / `.config.js` / `.config.cjs` / `.config.mjs`. Named
// anything else, this file is executed as a program: it defines no server, so
// pm2 reports an app called `ecosystem` that is online and doing nothing.
//
// Everything here is scoped to this one process: pm2 hands `env` to the studio
// and to nothing else on the box. No shell profile is touched, no other app
// under pm2 sees these values, and nothing is exported system-wide — which is
// the point of putting them here rather than in ~/.bashrc or /etc/environment.
//
// The values live outside the repository, in an env file the deploy never
// overwrites, so a push can never carry a key and a checkout can never lose
// one.
const path = require('node:path');
const { envFilePath, readEnv } = require('./env-file.cjs');

const ENV_FILE = envFilePath();

module.exports = {
  apps: [{
    name: 'studio',
    // Derived from this file's own location, so the deploy directory can move
    // without editing anything.
    cwd: path.join(__dirname, '..'),
    // One process, two listeners, deliberately separate origins (spec.md §7).
    // There is no second app to define: the games origin is this one.
    script: 'server/index.js',
    // `node:sqlite` is experimental in Node 25; same flag as `npm start`.
    node_args: '--disable-warning=ExperimentalWarning',
    env: readEnv(ENV_FILE),
    // SIGINT/SIGTERM close both listeners and the database (server/index.js),
    // so a reload is graceful without pm2 doing anything special.
    kill_timeout: 5000,
  }],
};
