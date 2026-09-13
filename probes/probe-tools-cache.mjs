// One-off: if a sizing call goes out with no tools and the fire that follows
// goes out with them, does either one still hit the prompt cache? And does
// `tool_choice: 'none'` exist on this API, and stop a call?
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-tools-cache.mjs
//
// The design question (ideas/planner.md, to be written): the sizing call and
// the fire share the system prompt and the transcript and differ in the tools
// array and the last message. Where the API serialises tools decides whether
// the two share a cache prefix. §14 found a request diverging at a *new*
// depth reports 0% whatever it shares, so a single request cannot answer
// this; instead the alternation is simulated over four growing transcripts,
// the way real fires grow, and steady state is what is read.
//
// Arm A (control): tools every time, transcript growing — today's fire-to-fire.
// Arm B: no-tools then tools on each transcript, a different system prompt
//        from A so the arms cannot warm each other.
// Arm C: on A's family, tools present plus tool_choice 'none', and a message
//        that asks outright for a file.

import { complete, preamble, fileBlock, TOOLS, u, a } from './probe-lib.mjs';

const files = fileBlock('games/space-racer');
const sys = (arm) => `${arm}\n\n${preamble('Space Racer')}\n\n${files}`;

const H = [
  '[Dann] make the ship turn faster', 'Turned the ship faster.',
  '[Dann] add a second track', 'Added a second track.',
  '[Dann] the rival ships are too easy', 'Rivals are harder now.',
  '[Dann] make the countdown shorter',
];
const transcript = (k) => H.slice(0, 2 * k - 1).map((t, i) => (i % 2 ? a(t) : u(t)));

const row = (label, r) => console.log(
  `${label.padEnd(14)} ${r.ok
    ? `${String(r.total).padStart(6)} total  ${String(r.hit).padStart(6)} hit  ${String(r.miss).padStart(6)} miss  ${String(r.pct).padStart(3)}%  ${r.ms}ms`
    : `HTTP ${r.status} ${r.error}`}`,
);

console.log('Arm A — tools every request (control)');
let withTools = 0;
for (let k = 1; k <= 4; k += 1) {
  const r = await complete({ system: sys('Arm A.'), messages: transcript(k), tools: TOOLS });
  withTools = r.total;
  row(`A${k} tools`, r);
}

console.log('\nArm B — no tools, then tools, per transcript');
let without = 0;
for (let k = 1; k <= 4; k += 1) {
  const n = await complete({ system: sys('Arm B.'), messages: transcript(k), tools: null });
  without = n.total;
  row(`B${k} no tools`, n);
  const t = await complete({ system: sys('Arm B.'), messages: transcript(k), tools: TOOLS });
  row(`B${k} tools`, t);
}
console.log(`\nthe tools array costs ${withTools - without} prompt tokens`);

console.log('\nArm C — tool_choice "none" with a request that wants a file');
const ask = u('[Dann] use write_file to create notes.txt containing the word hello. Do it now, no questions.');
const c1 = await complete({
  system: sys('Arm A.'), messages: [...transcript(3), ask], tools: TOOLS, maxTokens: 300,
  extra: { tool_choice: 'none' },
});
row('C1 choice none', c1);
if (c1.ok) console.log(`   tool calls: ${c1.toolCalls.length}  finish ${c1.finish}  said: “${c1.text.slice(0, 140).replace(/\n/g, ' ⏎ ')}”`);
const c2 = await complete({
  system: sys('Arm A.'), messages: [...transcript(3), ask], tools: TOOLS, maxTokens: 300,
});
row('C2 choice auto', c2);
if (c2.ok) console.log(`   tool calls: ${c2.toolCalls.length}  finish ${c2.finish}  said: “${c2.text.slice(0, 140).replace(/\n/g, ' ⏎ ')}”`);
// Does response_format exist? The sizing call wants JSON; §14 never measured this.
const c3 = await complete({
  system: sys('Arm A.'),
  messages: [...transcript(3), u('[Dann] answer in JSON: {"ok": true}')],
  tools: TOOLS, maxTokens: 50,
  extra: { response_format: { type: 'json_object' } },
});
row('C3 json_object', c3);
if (c3.ok) console.log(`   said: “${c3.text.slice(0, 140).replace(/\n/g, ' ⏎ ')}”`);
