/**
 * tools/ai-elo.js —— 三打一 AI 多版本 Elo 天梯（循环赛）。
 *
 * 用法：node tools/ai-elo.js [每格种子预算=200] [版本名...] [--baseline <baseline策略文件>]
 *   全链审计：node tools/ai-elo.js 200            （9 版本 × 81 格，~10 分钟）
 *   聚焦对比：node tools/ai-elo.js 800 base full  （竞价改动 A/B，~4 分钟）
 *   版本名见 versionRegistry：base v4 +R1 +R2 +R5 +R3 +R4 +R7 full
 *
 * 与 ai-bench.js 的分工：
 *   ai-bench = 快速 A/B 回归门（竞价固定走 baseline 保证同合同可比）；
 *   ai-elo   = 版本强度排名，**竞价解锁**——四家真实竞价（各家用自己的
 *   decideScoreBid，含开叫/抬价/pass），X 未抢到庄的局弃用不计。
 *
 * 机制要点（实测校准）：
 *   - 座位效应大（固定 0 号位当庄 −6pp）→ X 庄位随种子轮转；
 *   - 真实竞价保留率 ~24%（X 须抢到庄），种子预算 ≠ 计入局数，看输出 n；
 *   - 绝对庄胜率与 ai-bench 不可直接比（竞价选择效应），看排名与差分；
 *   - 版本 = 新策略 + 完整特性开关组合，cache-busting 重加载多实例
 *     （隔离性已验证：载序无关、不同开关结果不同）。
 * 注意：勿在环境中设置 AI_R3_CAMP（调用时读取的调试旗标，会全局串味）。
 */

'use strict';

const path = require('path');
const { createConfig } = require('../miniprogram/engine/config');
const { createInitialState } = require('../miniprogram/core/state');
const { runRoundToScoring } = require('../miniprogram/core/dealer-ai-loop');
const { createRng } = require('../miniprogram/utils/random');

const ROOT = path.join(__dirname, '..');
const STRATEGY_PATH = path.join(ROOT, 'miniprogram/ai/strategy-greedy.js');
const FLAG_KEYS = ['AI_R1', 'AI_R1D', 'AI_R1A', 'AI_R2', 'AI_R5', 'AI_R3', 'AI_R4', 'AI_R6B', 'AI_R7'];

/** 完整开关组合的版本登记（历史递进消融链：每行只比上行多开一个特性） */
function versionRegistry() {
  const OFF = () => FLAG_KEYS.reduce((m, k) => (m[k] = '0', m), {});
  const on = (base, ...keys) => { const m = Object.assign({}, base); keys.forEach((k) => { m[k] = '1'; }); return m; };
  const v4 = OFF();                 // 新骨架（v4 配合打分）全部关
  const r1 = on(v4, 'AI_R1', 'AI_R1D', 'AI_R1A');
  const r2 = on(r1, 'AI_R2');
  const r5 = on(r2, 'AI_R5');
  const r3 = on(r5, 'AI_R3');
  const r4 = on(r3, 'AI_R4');
  const r7 = on(r4, 'AI_R7');
  const full = on(r7, 'AI_R6B');
  return [
    { name: 'base' },
    { name: 'v4', flags: v4 },
    { name: '+R1', flags: r1 },
    { name: '+R2', flags: r2 },
    { name: '+R5', flags: r5 },
    { name: '+R3', flags: r3 },
    { name: '+R4', flags: r4 },
    { name: '+R7', flags: r7 },
    { name: 'full', flags: full }
  ];
}

/** 同进程按开关组合实例化新策略：临时覆写 env → 清 require 缓存重载 → 还原 */
function loadFlagged(flags) {
  const saved = {};
  FLAG_KEYS.forEach((k) => { saved[k] = process.env[k]; });
  FLAG_KEYS.forEach((k) => { process.env[k] = flags[k]; });
  try {
    delete require.cache[require.resolve(STRATEGY_PATH)];
    const Cls = require(STRATEGY_PATH).GreedyStrategy; // 开关为模块级常量，加载期定型
    return new Cls('normal');
  } finally {
    FLAG_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  }
}

/** 有向对局路由：xSeat 坐庄；四家真实竞价（各家自己的 decideScoreBid） */
function matchAI(dealerInst, attInst, xSeat) {
  const inst = (seat) => (seat === xSeat ? dealerInst : attInst);
  return {
    decideScoreBid: (st, i, opts, rng) => inst(i).decideScoreBid(st, i, opts, rng),
    decideTrumpSuit: (st, i) => inst(i).decideTrumpSuit(st, i),
    decideBury: (st, i, r) => inst(i).decideBury(st, i, r),
    decidePlay: (st, i, r) => inst(i).decidePlay(st, i, r)
  };
}

/** 跑一局（含引擎内部重发），返回 { settle, dealerSeat } 或 null */
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
  return {
    settle: state.lastSettle,
    dealerSeat: state.sanDaYiTeams ? state.sanDaYiTeams.dealer : state.dealerIdx
  };
}

function main() {
  const args = process.argv.slice(2);
  const nIdx = args.findIndex((a) => /^\d+$/.test(a));
  const budget = nIdx >= 0 ? Number(args[nIdx]) : 200;
  const bIdx = args.indexOf('--baseline');
  const baselinePath = bIdx >= 0 && args[bIdx + 1]
    ? path.resolve(process.cwd(), args[bIdx + 1])
    : path.join(ROOT, 'miniprogram/ai/.baseline-strategy.js');

  const registry = versionRegistry();
  const names = new Set(registry.map((v) => v.name));
  const picked = args.filter((a) => names.has(a));
  const chosen = picked.length ? registry.filter((v) => picked.includes(v.name)) : registry;

  const K = 8;
  const cfg = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const versions = chosen.map((v) => {
    if (v.name === 'base') {
      return Object.assign({ inst: new (require(baselinePath).GreedyStrategy)('normal') }, v);
    }
    return Object.assign({ inst: loadFlagged(v.flags) }, v);
  });
  const idx = new Map(versions.map((v, i) => [v.name, i]));

  // 记账：Elo 在线更新；矩阵存双向当庄胜率与局数
  const elo = versions.map(() => 1500);
  const h2h = versions.map(() => versions.map(() => ({ n: 0, dWin: 0, dPts: 0, contract: 0 })));
  let illegalTotal = 0, badTotal = 0, seedsRun = 0;

  const t0 = Date.now();
  console.log(`每格种子预算=${budget}  K=${K}  版本=${versions.length}个  `
    + `baseline=${path.relative(ROOT, baselinePath)}`);
  console.log('竞价：四家真实竞价，X 未抢到庄的局弃用不计（保留率 ~24%）\n');

  for (let xi = 0; xi < versions.length; xi++) {
    for (let yi = 0; yi < versions.length; yi++) {
      const cell = h2h[xi][yi];
      for (let seed = 1; seed <= budget; seed++) {
        const xSeat = (seed - 1) % 4; // 庄位轮转消座位偏置
        const r = playOne(cfg, matchAI(versions[xi].inst, versions[yi].inst, xSeat), seed);
        if (!r) continue;
        if (r.illegal) { illegalTotal += r.illegal; continue; }
        if (r.dealerSeat !== xSeat) continue; // 攻方抢到庄 → 非目标有向对，弃用
        seedsRun++;
        const settle = r.settle;
        const dealerWin = settle.dealerPoints >= settle.contractScore ? 1 : 0;
        cell.n++; cell.dWin += dealerWin;
        cell.dPts += settle.dealerPoints; cell.contract += settle.contractScore;
        if (settle.dealerPoints + settle.attackerPoints !== 200) badTotal++;
        if (xi !== yi) { // 自对局只作校准，不进 Elo
          const ex = 1 / (1 + Math.pow(10, (elo[yi] - elo[xi]) / 400));
          const dx = K * (dealerWin - ex);
          elo[xi] += dx; elo[yi] -= dx;
        }
      }
      if (cell.n) process.stdout.write('.');
    }
  }
  const totalN = h2h.flat().reduce((s, c) => s + c.n, 0);
  console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  计入=${totalN}局  非法=${illegalTotal}  分不守恒=${badTotal}\n`);

  // 天梯表：Elo 降序 + 总当庄胜率 + 对 base 双向参照（无 base 时留空）+ 自对局校准
  const baseI = idx.get('base');
  const overall = versions.map((_, i) => versions.reduce((acc, _, j) => {
    const c = h2h[i][j];
    acc.n += c.n; acc.dWin += c.dWin;
    return acc;
  }, { n: 0, dWin: 0 }));
  const order = versions.map((_, i) => i).sort((a, b) => elo[b] - elo[a]);
  console.log('版本     Elo    总当庄胜率(n)   当庄vs base   当攻vs base   自对局');
  order.forEach((i) => {
    const o = overall[i];
    const d = baseI !== undefined ? h2h[i][baseI] : null;
    const a = baseI !== undefined ? h2h[baseI][i] : null;
    const s = h2h[i][i];
    const pct = (c) => (c && c.n ? (c.dWin / c.n * 100).toFixed(1) + `%(${c.n})` : '—');
    console.log(
      `${versions[i].name.padEnd(6)} ${Math.round(elo[i])}    `
      + `${pct(o).padEnd(13)} ${pct(d).padEnd(13)} ${pct(a).padEnd(13)} ${pct(s)}`
    );
  });
  console.log('\n当庄胜率%(n)（行=当庄版本，列=当攻版本）');
  const head = '        ' + versions.map((v) => v.name.slice(0, 5).padEnd(9)).join('');
  console.log(head);
  versions.forEach((vx, i) => {
    const cells = versions.map((vy, j) => {
      const c = h2h[i][j];
      return (c.n ? `${(c.dWin / c.n * 100).toFixed(0)}(${c.n})` : '·').padEnd(9);
    }).join('');
    console.log(vx.name.slice(0, 6).padEnd(8) + cells);
  });
  console.log('\n判读：链上近邻版本（R1/R2/R4/R5 各自 ≤1.5pp）在计入局数少时差异落在噪声内，'
    + '只看大步差与每局都触发的改动（R7/竞价）；显著性判定仍以 ai-bench 400 为准');
}

module.exports = { versionRegistry, loadFlagged, matchAI, playOne };

if (require.main === module) main();
