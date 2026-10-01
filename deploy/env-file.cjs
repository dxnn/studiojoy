// The studio's env file on a server: `$STUDIO_ENV`, or ~/apps/studio.env.
// Read by deploy/ecosystem.config.cjs, which hands all of it to the studio
// process, and by bin/env.js, which takes only the two paths from it so a
// maintenance script finds the same database the studio runs on. `.cjs`
// because pm2 requires the ecosystem file directly, outside the package's
// `"type": "module"`.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const envFilePath = (env = process.env) => env.STUDIO_ENV ?? path.join(os.homedir(), 'apps/studio.env');

// KEY=value per line, `#` starts a comment. No quoting and no interpolation:
// one program reads this file and one person writes it, so paths are absolute
// and values are literal. See studio.env.example.
function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

module.exports = { envFilePath, readEnv };
