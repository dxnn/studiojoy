// One-off, after probe-extension.mjs: every small-ask fire there hit exactly
// 6,656 tokens of a 12.7 K prompt whether or not it extended the sizing
// exchange — so the sizing's request boundary was not a unit the fire could
// match. What stops it? The sizing there used `response_format: json_object`,
// which the 2026-09-03 tools-cache probe (95% on the extension) never did.
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-extension-2.mjs > tmp/probe-extension-2.out 2>&1
//
// Arms, REPS times each on their own salt, space-racer's tree:
//   E1  json sizing, then the identical request again — is its boundary a unit at all?
//   E2  plain sizing (no response_format), identical repeat.
//   E3  plain sizing, then the extension fire with tools.
//   E4  plain sizing, then today's fire (ask dropped) with tools.
//   E5  json sizing, then the extension fire with no tools and no json — tools or json?
//   E6  plain sizing, 20 s wait, then the extension fire with tools — write latency?

import { setTimeout as sleep } from 'node:timers/promises';
import { complete, preamble, fileBlock, TOOLS, u, a } from './probe-lib.mjs';
import { sizingAsk, SIZING_MAX_TOKENS } from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 2);
const SMALL = 'make the ship turn a bit faster';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const files = fileBlock('games/space-racer');
const system = (arm) => `Run ${STAMP} · Arm ${arm}.\n\n${preamble('Space Racer')}\n\n${files}`;
const row = (label, r) => console.log(`${label.padEnd(22)} ${r.ok
  ? `total ${String(r.total).padStart(6)}  hit ${String(r.hit).padStart(6)}  miss ${String(r.miss).padStart(6)}  ${String(r.pct).padStart(3)}%  out ${String(r.out).padStart(5)}  ${(r.ms / 1000).toFixed(1).padStart(5)}s`
  : `HTTP ${r.status} ${r.error}`}`);

const ask = u(`[Dann] ${SMALL}\n\n${sizingAsk()}`);
const sizing = (sys, json) => complete({
  system: sys, messages: [ask], tools: null, effort: 'none', maxTokens: SIZING_MAX_TOKENS,
  extra: json ? { response_format: { type: 'json_object' } } : {},
});
const extension = (sys, text, tools) => complete({
  system: sys, messages: [ask, a(text), u('[studio] Go ahead.')], tools, effort: 'none', maxTokens: 64,
});

for (let rep = 1; rep <= REPS; rep += 1) {
  let sys; let s;

  sys = system(`E1 #${rep}`);
  s = await sizing(sys, true); row(`E1 json sizing #${rep}`, s);
  row(`E1 json repeat #${rep}`, await sizing(sys, true));

  sys = system(`E2 #${rep}`);
  s = await sizing(sys, false); row(`E2 plain sizing #${rep}`, s);
  row(`E2 plain repeat #${rep}`, await sizing(sys, false));

  sys = system(`E3 #${rep}`);
  s = await sizing(sys, false); row(`E3 plain sizing #${rep}`, s);
  row(`E3 ext+tools #${rep}`, await extension(sys, s.text, TOOLS));

  sys = system(`E4 #${rep}`);
  s = await sizing(sys, false); row(`E4 plain sizing #${rep}`, s);
  row(`E4 today+tools #${rep}`, await complete({
    system: sys, messages: [u(`[Dann] ${SMALL}`)], tools: TOOLS, effort: 'none', maxTokens: 64,
  }));

  sys = system(`E5 #${rep}`);
  s = await sizing(sys, true); row(`E5 json sizing #${rep}`, s);
  row(`E5 ext, no tools #${rep}`, await extension(sys, s.text, null));

  sys = system(`E6 #${rep}`);
  s = await sizing(sys, false); row(`E6 plain sizing #${rep}`, s);
  await sleep(20_000);
  row(`E6 ext after 20s #${rep}`, await extension(sys, s.text, TOOLS));
  console.log('');
}
