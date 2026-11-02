/**
 * tools/ai-bench.js —— 三打一 AI 自对弈基准（A/B 对比）。
 *
 * 用法：node tools/ai-bench.js [局数=120] [--baseline <baseline策略文件>]
 *   --fair-throws    新旧根候选均只用公开信息，隔离旧策略的甩牌信息优势
 *   --modes base,a-new  只跑指定对照，另输出闲家扣底率与每局底分收益
 *   --json /tmp/bench.json  保存逐局种子、真实末墩归属和汇总，便于配对复核
 *   baseline 缺省 = miniprogram/ai/.baseline-strategy.js（不入库；= 提交 2a9c125
 *   的策略快照，仅头注释差一行，可用
 *   `git show 2a9c125:miniprogram/ai/strategy-greedy.js > miniprogram/ai/.baseline-strategy.js` 再生）
 *
 * 同一批种子 → 同样的牌、同样的报分（两种策略 decideScoreBid 相同），
 * 三种配置对比庄家胜率：
 *   base  全 baseline（基准线）
 *   d-new 庄家位用新 AI，攻方 baseline → 胜率应高于 base
 *   a-new 攻方用新 AI，庄家 baseline → 胜率应低于 base
 *
 * 同时校验：零非法、分守恒 200。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');
const { createConfig } = require('../miniprogram/engine/config');
const { createInitialState } = require('../miniprogram/core/state');
const { runRoundToScoring } = require('../miniprogram/core/dealer-ai-loop');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { createRng } = require('../miniprogram/utils/random');

const ROOT = path.join(__dirname, '..');

/** 公平对照：旧策略也经相同的公开甩牌视图过滤，模拟态仍使用自己的假设牌。 */
function loadBaseline(file, fairThrows) {
  if (!fairThrows) return require(file).GreedyStrategy;
  const validator = require('../miniprogram/engine/validate');
  const observer = new GreedyStrategy('normal');
  const ownRequire = Module.createRequire(file);
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded.require = (id) => {
    if (id !== '../engine/validate') return ownRequire(id);
    const view = (st, seat) => st.phase === 'PLAYING'
      ? observer._playView(st, seat, observer._buildCtx(st, seat)) : st;
    return { ...validator,
      legalMoves: (st, seat) => validator.legalMoves(view(st, seat), seat),
      validatePlay: (st, seat, cs) => validator.validatePlay(view(st, seat), seat, cs) };
  };
  loaded._compile(fs.readFileSync(file, 'utf8'), file);
  return loaded.exports.GreedyStrategy;
}

/** 按席位路由的双策略调度器：mode 决定谁用新 AI（竞价始终走 baseline 保证同合同） */
function routedAI(newS, oldS, mode) {
  const isNewSeat = (state, seat) => {
    if (mode === 'base') return false;
    if (mode === 'all-new') return true;
    const d = state.sanDaYiTeams ? state.sanDaYiTeams.dealer : state.dealerIdx;
    const isDealerSeat = seat === d;
    if (mode.startsWith('d-')) return isDealerSeat;
    if (mode.startsWith('a-')) return !isDealerSeat;
    return false;
  };
  const pick = (state, seat) => (isNewSeat(state, seat) ? newS : oldS);
  return {
    decideScoreBid: (st, i, o, r) => oldS.decideScoreBid(st, i, o, r),
    decideTrumpSuit: (st, i) => pick(st, i).decideTrumpSuit(st, i),
    decideBury: (st, i, r) => pick(st, i).decideBury(st, i, r),
    decidePlay: (st, i, r) => {
      const useNew = isNewSeat(st, i);
      const isLead = !st.currentTrick || st.currentTrick.plays.length === 0;
      let useNewNow = useNew;
      if (mode.endsWith('-lead')) useNewNow = useNew && isLead;
      else if (mode.endsWith('-follow')) useNewNow = useNew && !isLead;
      return (useNewNow ? newS : oldS).decidePlay(st, i, r);
    }
  };
}

/** 跑一局（含重发循环），返回 settle 或 null */
function playOne(cfg, ai, seed) {
  let state = createInitialState(cfg, null, createRng(seed));
  let guard = 0;
  while (state.phase !== 'SCORING' && state.phase !== 'GAME_OVER' && guard++ < 10) {
    const r = runRoundToScoring(state, ai, createRng(seed * 13 + guard));
    state = r.state;
    if (r.illegalCount > 0) return { illegal: r.illegalCount };
    if (state.phase === 'INIT_DEAL') continue;
    break;
  }
  if (state.phase !== 'SCORING') return null;
  const last = state.completedTricks[state.completedTricks.length - 1];
  return { ...state.lastSettle, attackerWonBottom: last.winnerIdx !== state.lastSettle.dealerIdx };
}

function main() {
  const args = process.argv.slice(2);
  const nIdx = args.findIndex((a) => /^\d+$/.test(a));
  const games = nIdx >= 0 ? Number(args[nIdx]) : 120;
  const bIdx = args.indexOf('--baseline');
  const baselinePath = bIdx >= 0 && args[bIdx + 1]
    ? path.resolve(process.cwd(), args[bIdx + 1])
    : path.join(ROOT, 'miniprogram/ai/.baseline-strategy.js');

  let Old;
  try {
    Old = loadBaseline(baselinePath, args.includes('--fair-throws'));
  } catch (e) {
    console.error(`无法加载 baseline 策略：${baselinePath}\n${e.message}`);
    process.exit(1);
  }

  const cfg = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const newS = new GreedyStrategy('normal');
  const oldS = new Old('normal');

  console.log(`局数=${games}  baseline=${path.relative(ROOT, baselinePath)}\n`);
  const modesIdx = args.indexOf('--modes');
  const modes = modesIdx >= 0 ? args[modesIdx + 1].split(',') : ['base', 'd-new', 'all-new', 'a-new'];
  if (args.includes('--fair-throws')) console.log('甩牌对照：双方根候选均仅用公开信息');
  console.log('配置     庄胜   平均庄分  平均攻分  平均合同  闲扣底率  闲底分收益  非法  分不守恒  耗时(s)');
  const details = { games, baseline: baselinePath, fairThrows: args.includes('--fair-throws'), modes: {} };
  for (const mode of modes) {
    if (!['base', 'd-new', 'all-new', 'a-new'].includes(mode)) throw new Error(`未知配置：${mode}`);
    const ai = routedAI(newS, oldS, mode);
    let wins = 0, done = 0, dPts = 0, aPts = 0, contract = 0, illegal = 0, bad = 0, bottomWins = 0, bottomEarned = 0;
    const t0 = Date.now();
    const rounds = [];
    for (let seed = 1; seed <= games; seed++) {
      const s = playOne(cfg, ai, seed);
      if (!s) continue;
      if (s.illegal) { illegal += s.illegal; continue; }
      done++;
      if (s.dealerPoints + s.attackerPoints !== 200) bad++;
      if (s.dealerPoints >= s.contractScore) wins++;
      if (s.attackerWonBottom) { bottomWins++; bottomEarned += s.bottomPoints; }
      dPts += s.dealerPoints; aPts += s.attackerPoints; contract += s.contractScore;
      rounds.push({ seed, ...s });
    }
    console.log(
      `${mode.padEnd(7)} ${(wins / done * 100).toFixed(1)}%  `
      + `${(dPts / done).toFixed(1)}    ${(aPts / done).toFixed(1)}    `
      + `${(contract / done).toFixed(1)}    ${(bottomWins / done * 100).toFixed(1)}%    `
      + `${(bottomEarned / done).toFixed(1)}    ${illegal}    ${bad}    ${((Date.now() - t0) / 1000).toFixed(1)}`
    );
    details.modes[mode] = { done, wins, dPts, aPts, contract, illegal, bad, bottomWins, bottomEarned, rounds };
  }
  const jsonIdx = args.indexOf('--json');
  if (jsonIdx >= 0) fs.writeFileSync(path.resolve(args[jsonIdx + 1]), JSON.stringify(details, null, 2));
  console.log('\n胜率为庄家胜率；a-new同时比较闲家总分与扣底收益，小样本差异不等于普遍提升。');
}

main();
