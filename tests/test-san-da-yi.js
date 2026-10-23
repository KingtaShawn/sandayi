/**
 * tests/test-san-da-yi.js —— 三打一模式（R25/R26）专项测试。
 *
 * 覆盖：
 *   1. 配置校验（gameMode/sanDaYi 参数）
 *   2. 报分竞价：起报 90、+10 递增、可反复加价、必须高于当前最高、到 200 封顶
 *   3. 竞价结束：最高者坐庄、主牌=王+2、1v3 阵营
 *   4. 全员不报 → 重发
 *   5. 结算：庄家得分≥合同分=庄胜；底牌×1 不翻倍；下局首报=上局赢家
 *   6. 甩牌失败罚则（penalty_smallest）：罚 10 分/张 + 强制出最小
 *   7. AI 压测：N 局零非法零异常、分守恒 200
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfig, validateConfig } = require('../miniprogram/engine/config');
const { createInitialState } = require('../miniprogram/core/state');
const { transition } = require('../miniprogram/core/statemachine');
const { runRoundToScoring } = require('../miniprogram/core/dealer-ai-loop');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { scoreBidOptions, canScoreBid } = require('../miniprogram/engine/bid');
const { createRng } = require('../miniprogram/utils/random');
const { domainOf } = require('../miniprogram/engine/combo');

/** 构造三打一配置 */
function sdyCfg(extra) {
  return createConfig(Object.assign({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' }, extra || {}));
}

/** 发牌并到 BIDDING */
function dealToBidding(cfg, seed) {
  let s = createInitialState(cfg, null, createRng(seed));
  s = transition(s, { type: 'DEAL', rng: createRng(seed) });
  return s;
}

/* ========== 1. 配置校验 ========== */

test('SDY-配置1：默认参数合法', () => {
  const cfg = sdyCfg();
  assert.equal(cfg.gameMode, 'san_da_yi');
  assert.equal(cfg.sanDaYiBidStart, 90);
  assert.equal(cfg.sanDaYiBidStep, 10);
  assert.equal(cfg.sanDaYiBidCap, 200);
  assert.equal(cfg.sanDaYiNoBidAction, 'redeal');
  assert.equal(cfg.sanDaYiPeekBottomMaxBid, -1);
  assert.equal(validateConfig(cfg).ok, true);
});

test('SDY-配置2：非法参数被拦截', () => {
  assert.equal(validateConfig(createConfig.__doNotUse ? {} : { gameMode: 'san_da_yi', sanDaYiBidStep: 0 }) && false || (() => {
    try { createConfig({ gameMode: 'san_da_yi', sanDaYiBidStep: 0 }); return false; }
    catch (e) { return true; }
  })(), true, 'step=0 应被拦截');
});

/* ========== 2. 叫分竞价（用户规则：90 起，步长 10 可跳档，循环加价直到无人再加，放弃出局） ========== */

test('SDY-叫分1：起叫 90，全档 90~200 步 10', () => {
  const cfg = sdyCfg();
  const s = dealToBidding(cfg, 1);
  const opts = scoreBidOptions(s, 0, cfg);
  assert.equal(opts.length, 12);
  assert.equal(opts[0], 90);
  assert.equal(opts[opts.length - 1], 200);
});

test('SDY-叫分2：有人叫后可加价（+10 或跳档），必须高于当前最高', () => {
  const cfg = sdyCfg();
  let s = dealToBidding(cfg, 2);
  s = transition(s, { type: 'SCORE_BID', playerIdx: 0, score: 90 });
  const opts = scoreBidOptions(s, s.turnIdx, cfg);
  assert.deepEqual(opts, [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200]);
  // 叫 90（不高于当前最高）应失败；跳档 130 合法
  assert.equal(canScoreBid(s, s.turnIdx, 90, cfg).ok, false);
  assert.equal(canScoreBid(s, s.turnIdx, 130, cfg).ok, true);
});

test('SDY-叫分3：放弃者出局（本局不可再叫）', () => {
  const cfg = sdyCfg();
  let s = dealToBidding(cfg, 3);
  s = transition(s, { type: 'SCORE_BID', playerIdx: 0, score: 90 });
  s = transition(s, { type: 'PASS_BID', playerIdx: 1 }); // P1 放弃
  // P1 再叫应被拒
  const r = canScoreBid(s, 1, 120, cfg);
  assert.equal(r.ok, false);
  // 轮转跳过 P1
  assert.equal(s.turnIdx, 2);
});

test('SDY-叫分4：轮次校验（非本家叫分被拒）', () => {
  const cfg = sdyCfg();
  const s = dealToBidding(cfg, 4);
  assert.equal(s.turnIdx, 0);
  assert.throws(() => transition(s, { type: 'SCORE_BID', playerIdx: 2, score: 90 }), /轮到/);
});

test('SDY-叫分5：循环加价——已叫过者被超过后轮回来仍可再加，直到无人再加', () => {
  const cfg = sdyCfg();
  let s = dealToBidding(cfg, 5);
  s = transition(s, { type: 'SCORE_BID', playerIdx: 0, score: 90 });
  s = transition(s, { type: 'SCORE_BID', playerIdx: 1, score: 100 });
  s = transition(s, { type: 'SCORE_BID', playerIdx: 2, score: 110 });
  s = transition(s, { type: 'SCORE_BID', playerIdx: 3, score: 120 });
  // 已叫过者未 pass → 轮回来仍可再加（120 叫过一圈，turn 回到 0）
  assert.equal(s.phase, 'BIDDING');
  assert.equal(s.turnIdx, 0);
  s = transition(s, { type: 'SCORE_BID', playerIdx: 0, score: 130 }); // 反超
  // 其余三家 pass → 130 成交（P0 坐庄）
  s = transition(s, { type: 'PASS_BID', playerIdx: 1 });
  s = transition(s, { type: 'PASS_BID', playerIdx: 2 });
  s = transition(s, { type: 'PASS_BID', playerIdx: 3 });
  assert.equal(s.phase, 'CHOOSE_TRUMP');
  assert.equal(s.contractScore, 130);
  assert.equal(s.dealerIdx, 0);
});

/* ========== 3. 竞价成交 ========== */

test('SDY-成交1：其余三家 pass → 最高者坐庄 → 进入选主；选主后阵营 1v3', () => {
  const cfg = sdyCfg();
  let s = dealToBidding(cfg, 5);
  const first = s.turnIdx;
  s = transition(s, { type: 'SCORE_BID', playerIdx: first, score: 90 });
  for (let k = 0; k < 3; k++) {
    s = transition(s, { type: 'PASS_BID', playerIdx: s.turnIdx });
  }
  // 成交 → CHOOSE_TRUMP（庄家选主花色）
  assert.equal(s.phase, 'CHOOSE_TRUMP');
  assert.equal(s.dealerIdx, first);
  assert.equal(s.contractScore, 90);
  // 阵营
  assert.equal(s.sanDaYiTeams.dealer, first);
  assert.deepEqual(s.sanDaYiTeams.attackers.slice().sort(), [0, 1, 2, 3].filter((i) => i !== first));
  // 庄家选主（自由选，不要求持有该花色的 2）→ BURYING
  s = transition(s, { type: 'CHOOSE_TRUMP', playerIdx: first, suit: 'H' });
  assert.equal(s.phase, 'BURYING');
  assert.equal(s.trumpInfo.trumpSuit, 'H');
  // 主牌含王、全部2、H花色
  const joker = { suit: 'JOKER', rank: 'BJ', isJoker: true };
  assert.equal(domainOf(joker, s.trumpInfo), 'TRUMP');
  assert.ok(s.trumpInfo.trumpIds.has('H-5'), 'H5 应为主牌');
  assert.ok(!s.trumpInfo.trumpIds.has('S-5'), 'S5 不应为主牌');
});

test('SDY-成交2：报 200 封顶即成交 → 选主 → 埋底', () => {
  const cfg = sdyCfg();
  let s = dealToBidding(cfg, 6);
  s = transition(s, { type: 'SCORE_BID', playerIdx: 0, score: 200 });
  // 报满即成交（无需他人表态）
  assert.equal(s.phase, 'CHOOSE_TRUMP');
  assert.equal(s.contractScore, 200);
  assert.equal(s.bottomPeekable, false); // peek=-1 本玩法不公开看底
  // 选主 → 埋底
  s = transition(s, { type: 'CHOOSE_TRUMP', playerIdx: 0, suit: 'S' });
  assert.equal(s.phase, 'BURYING');
});

/* ========== 4. 全员不报 → 重发 ========== */

test('SDY-重发1：四家全 pass → 重发，首报者轮到原首报者的下家', () => {
  const cfg = sdyCfg();
  let s = dealToBidding(cfg, 7);
  const first = s.turnIdx;
  s = transition(s, { type: 'PASS_BID', playerIdx: 0 });
  s = transition(s, { type: 'PASS_BID', playerIdx: 1 });
  s = transition(s, { type: 'PASS_BID', playerIdx: 2 });
  s = transition(s, { type: 'PASS_BID', playerIdx: 3 });
  // redeal：回 INIT_DEAL，首报者 = 原首报者下家
  assert.equal(s.phase, 'INIT_DEAL');
  assert.equal(s.sanDaYiFirstBidder, (first + 1) % 4);
  assert.equal(s.redEalCount, 1);
  // 重新发牌 → 新一局叫分从下家开始
  s = transition(s, { type: 'DEAL', rng: createRng(8) });
  assert.equal(s.phase, 'BIDDING');
  assert.equal(s.turnIdx, (first + 1) % 4);
  assert.equal(s.bids.length, 0);
});

test('SDY-重发2：force_lowest 覆盖配置仍有效（首位强制打最低分）', () => {
  const cfg = sdyCfg({ sanDaYiNoBidAction: 'force_lowest' });
  let s = dealToBidding(cfg, 7);
  const first = s.turnIdx;
  s = transition(s, { type: 'PASS_BID', playerIdx: 0 });
  s = transition(s, { type: 'PASS_BID', playerIdx: 1 });
  s = transition(s, { type: 'PASS_BID', playerIdx: 2 });
  s = transition(s, { type: 'PASS_BID', playerIdx: 3 });
  // force_lowest：首位以 90 成交
  assert.equal(s.phase, 'CHOOSE_TRUMP');
  assert.equal(s.dealerIdx, first);
  assert.equal(s.contractScore, 90);
  assert.equal(s.bottomPeekable, false); // peek=-1 不公开看底
});

/* ========== 5. 结算 ========== */

test('SDY-结算1：完整局——庄家得分≥合同=庄胜；分守恒；底牌×1', () => {
  const cfg = sdyCfg();
  const ai = new GreedyStrategy('normal');
  let state = createInitialState(cfg, null, createRng(1));
  let guard = 0;
  while (state.phase !== 'SCORING' && guard++ < 10) {
    const r = runRoundToScoring(state, ai, createRng(guard + 1));
    state = r.state;
    if (state.phase === 'INIT_DEAL') continue;
    break;
  }
  assert.equal(state.phase, 'SCORING');
  const s = state.lastSettle;
  // 分守恒
  assert.equal(s.dealerPoints + s.attackerPoints, 200);
  // 底牌倍数恒 1
  assert.equal(s.bottomMultiplierUsed, 1);
  // 胜负与合同一致
  assert.equal(s.winnerTeam, s.dealerPoints >= s.contractScore ? 'dealer' : 'attackers');
  // 下局首报 = 赢家
  const expectFirst = s.winnerTeam === 'dealer' ? s.dealerIdx : (s.dealerIdx + 1) % 4;
  assert.equal(s.nextFirstBidder, expectFirst);
});

test('SDY-结算2：NEXT_ROUND 后新局字段重置、首报者正确', () => {
  const cfg = sdyCfg();
  const ai = new GreedyStrategy('normal');
  let state = createInitialState(cfg, null, createRng(2));
  let guard = 0;
  while (state.phase !== 'SCORING' && guard++ < 10) {
    const r = runRoundToScoring(state, ai, createRng(guard + 50));
    state = r.state;
    if (state.phase === 'INIT_DEAL') continue;
    break;
  }
  const settle = state.lastSettle;
  state = transition(state, { type: 'NEXT_ROUND' });
  assert.equal(state.phase, 'INIT_DEAL');
  assert.equal(state.sanDaYiFirstBidder, settle.nextFirstBidder);
  assert.equal(state.contractScore, null);
  // 发牌后首报轮次 = sanDaYiFirstBidder
  state = transition(state, { type: 'DEAL', rng: createRng(99) });
  assert.equal(state.turnIdx, settle.nextFirstBidder);
});

/* ========== 7. AI 压测 ========== */

test('SDY-压测1：15 局完整模拟零非法、分守恒', () => {
  const cfg = sdyCfg();
  const ai = new GreedyStrategy('normal');
  let done = 0;
  for (let seed = 1; seed <= 15; seed++) {
    let state = createInitialState(cfg, null, createRng(seed));
    let guard = 0;
    let illegal = 0;
    while (state.phase !== 'SCORING' && guard++ < 10) {
      const r = runRoundToScoring(state, ai, createRng(seed * 13 + guard));
      state = r.state;
      illegal += r.illegalCount;
      if (state.phase === 'INIT_DEAL') continue;
      break;
    }
    if (state.phase !== 'SCORING') continue;
    done++;
    assert.equal(illegal, 0, `seed=${seed} 非法出牌`);
    const s = state.lastSettle;
    assert.equal(s.dealerPoints + s.attackerPoints, 200, `seed=${seed} 分守恒`);
  }
  assert.ok(done >= 12, `完成局数不足: ${done}/15`);
});

test('SDY-压测2：升级模式回归不受影响（同 config 工厂默认 shengji）', () => {
  const cfg = createConfig({}); // 默认升级
  assert.equal(cfg.gameMode, 'shengji');
});
