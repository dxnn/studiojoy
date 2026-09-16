// Does one re-ask bring a plan that came back in Chinese into the person's
// script?
//
//   env PROBE_MODEL=deepseek-flash NODE_OPTIONS=--use-env-proxy \
//     node probes/probe-v41-script.mjs > probes/probe-v41-script.out 2>&1
//
// probe-v41-language.mjs (2026-09-15) found a plan with its words in Chinese
// once in 35 on the rules as shipped, and a line in the rules naming the
// person's language made it worse — 4 in 42. So the fix is on the answer:
// `inOtherScript` checks a plan's words against the request's script and the
// orchestrator asks once more on the same transcript, the first answer left
// standing as the assistant turn and `SCRIPT_TRIGGER` after it
// (server/agents/sizing.js). At 1 in 35 a live run would see one case in an
// afternoon, so this measures the re-ask alone: the tank ask, a Chinese plan
// as the assistant turn — tank #12 of probe-v41-language-2.out's five titles,
// with its files, whats, summary and assumptions put into Chinese by hand —
// then the trigger, forty times. What counts is whether the second answer
// parses and is in the person's script; the titles are printed so a re-ask
// that quietly changed the plan can be seen.
//
// ⚠️ What it found (2026-09-15, `probe-v41-script.out`): 39 of 40 back in
// the person's script, 1 still Chinese, 0 unparseable, every one the same
// five pieces with the titles a translation of the Chinese ones. 87% cache,
// ~3 s. So a card in Chinese reaches a kid about once in 1,400 plans.

import {
  complete, preamble, EMPTY_TREE, TASK, u, a, MODEL,
} from './probe-lib.mjs';
import {
  sizingRules, sizingTrigger, parseSizing, inOtherScript, SCRIPT_TRIGGER, SIZING_MAX_TOKENS,
} from '../server/agents/sizing.js';

const REPS = Number(process.env.PROBE_REPS ?? 40);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

const system = [
  `Run ${STAMP}.`, '', preamble('Tank'), '', sizingRules(), '', EMPTY_TREE,
].join('\n');

const CHINESE = JSON.stringify({
  size: 'pieces',
  pieces: [
    {
      title: '游戏骨架与双人分屏',
      files: ['index.html', 'css/style.css', 'js/main.js', 'js/state.js', 'config/words.js', 'BRIEF.md', 'SPEC.md'],
      what: '页面加载一个画布、标题画面和带重新开始的结束画面，由一个小状态机驱动，画面分成上下两半。先不写坦克和墙，但游戏必须能运行。',
    },
    {
      title: '坦克移动与射击',
      files: ['js/tank.js', 'js/input.js', 'js/bullet.js', 'js/draw.js', 'config/play.js'],
      what: '两辆坦克用键盘控制，各画在自己那一半屏幕里，能开动、转炮塔和发射子弹。不要碰墙和道具。',
    },
    {
      title: '可破坏的地图',
      files: ['js/walls.js', 'js/collide.js', 'config/world.js'],
      what: '为场地生成一张墙的布局；子弹打到墙块就把它打掉。不要改动坦克的移动和子弹的伤害。',
    },
    {
      title: '道具系统',
      files: ['js/powerups.js', 'config/play.js'],
      what: '场地里定时出现道具，坦克开过去捡起，获得几秒的加速、护盾或三连发。不要改墙和分屏的代码。',
    },
    {
      title: '命中、生命与胜负',
      files: ['js/round.js', 'js/sound.js', 'config/play.js', 'TODO.md'],
      what: '子弹命中扣生命，生命归零则本局结束、对手得一分并开始新的一局；每半边屏幕顶上显示比分，加上开火、命中和捡道具的音效。',
    },
  ],
  summary: '一个双人坦克游戏，两个人共用一个键盘，上下分屏各看自己的坦克，墙可以被打掉，道具能带来短暂的优势。一辆坦克被消灭就结束一局，赢的人得一分。',
  assumptions: [
    '两位玩家共用一个键盘：一号用 WASD 加一个开火键，二号用方向键加一个开火键。',
    '分屏是上下的：一号在上，二号在下，两人看到同一个俯视的场地。',
    '场地大小固定，正好放进屏幕，不滚动。',
    '墙是按格子被打掉的，不分几个阶段开裂。',
    '道具是暂时的，持续固定的秒数。',
    '有比分但暂时没有局数上限，玩到两人不想玩为止。',
  ],
});

const request = `[Dann] ${TASK}`;
const wordsOf = (plan) => plan.pieces.map((p) => p.title).join(' · ');

console.log(`${MODEL}, the rules as they stand in server/agents/sizing.js, response_format json_object`);
console.log(`the transcript: the tank ask + trigger, a five-piece plan in Chinese, then SCRIPT_TRIGGER; ${REPS} times\n`);

let fixed = 0;
let still = 0;
let unparsed = 0;
let n = 0;
let hit = 0;
let total = 0;
for (let i = 1; i <= REPS; i += 1) {
  const r = await complete({
    system,
    messages: [u(`${request}\n\n${sizingTrigger()}`), a(CHINESE), u(SCRIPT_TRIGGER)],
    tools: null,
    effort: 'none',
    maxTokens: SIZING_MAX_TOKENS,
    extra: { response_format: { type: 'json_object' } },
  });
  if (!r.ok) { console.log(`#${String(i).padStart(2)}  HTTP ${r.status} ${r.error}`); continue; }
  n += 1;
  hit += r.hit;
  total += r.total;
  const plan = parseSizing(r.text);
  const secs = `${(r.ms / 1000).toFixed(1)}s`.padStart(5);
  if (!plan || plan.size !== 'pieces') {
    unparsed += 1;
    console.log(`#${String(i).padStart(2)}  unparseable  ${secs}  finish ${r.finish}  out ${r.out}  “${r.text.slice(0, 80).replace(/\n/g, ' ')}…”`);
  } else if (inOtherScript(plan, request)) {
    still += 1;
    console.log(`#${String(i).padStart(2)}  ⚠️ STILL      ${secs}  cache ${String(r.pct).padStart(3)}%  ${plan.pieces.length} pieces  ${wordsOf(plan).slice(0, 100)}`);
  } else {
    fixed += 1;
    console.log(`#${String(i).padStart(2)}  fixed        ${secs}  cache ${String(r.pct).padStart(3)}%  ${plan.pieces.length} pieces  ${wordsOf(plan).slice(0, 100)}`);
  }
}
console.log(`\nre-ask: in the person's script ${fixed} of ${n}, still not ${still}, unparseable ${unparsed}`);
console.log(`cache ${total ? Math.round((hit / total) * 100) : 0}% over the run`);
