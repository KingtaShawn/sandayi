/**
 * tests/test-qa-settle-kouDi.js —— QA 对抗性测试：抠底 / 结算升级表 / 过A / 庄传递。
 *
 * 覆盖（R5~R10 / R15~R18 / R24）：
 *   1. 升级表边界全档位：0/1/39/40/79/80/119/120/159/160/199/200
 *   2. 抠底：攻方赢末墩 ×2 计入；守方赢末墩不产生额外得分
 *   3. R10 牌型加倍开关：单2/对4/拖8/甩取最大单元
 *   4. R9=1 不加倍
 *   5. 过A：小光<40 过A→gameOver；≥40 停在 A 升 2 级封顶；攻方上台过A失败
 *   6. R16 庄传递：连庄 / 定主者当庄 / 翻底定主下家 / rotate
 *   7. R5=60 非默认上台分档位
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG, createConfig } = require('../miniprogram/engine/config');
const {
  computeLevelGain, settleRound, bottomMultiplier, nextDealer, advanceRank, checkPassA
} = require('../miniprogram/engine/settle');
const { parseCombo } = require('../miniprogram/engine/combo');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { cards, cardsD, makeState } = require('./fixtures');

const TI = buildTrumpInfo('H', '2', DEFAULT_CONFIG);

test('QA-升1：升级表边界全档位（0/1/39/40/79/80/119/120/159/160/199/200）', () => {
  assert.deepEqual(computeLevelGain(0, DEFAULT_CONFIG), { winnerTeam: 'defense', levels: 3 });   // 大光
  assert.deepEqual(computeLevelGain(1, DEFAULT_CONFIG), { winnerTeam: 'defense', levels: 2 });   // 小光下界
  assert.deepEqual(computeLevelGain(39, DEFAULT_CONFIG), { winnerTeam: 'defense', levels: 2 });  // 小光上界
  assert.deepEqual(computeLevelGain(40, DEFAULT_CONFIG), { winnerTeam: 'defense', levels: 1 });  // 40 分边缘
  assert.deepEqual(computeLevelGain(79, DEFAULT_CONFIG), { winnerTeam: 'defense', levels: 1 });
  assert.deepEqual(computeLevelGain(80, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 1 });   // 上台
  assert.deepEqual(computeLevelGain(119, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 1 });
  assert.deepEqual(computeLevelGain(120, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 2 });  // 跳2级
  assert.deepEqual(computeLevelGain(159, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 2 });
  assert.deepEqual(computeLevelGain(160, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 3 });  // 跳3级
  assert.deepEqual(computeLevelGain(199, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 3 });
  assert.deepEqual(computeLevelGain(200, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 4 });  // 大满贯
});

test('QA-升2：R5=60 非默认上台分档位正确', () => {
  const cfg = createConfig({ pointsToTake: 60 });
  assert.deepEqual(computeLevelGain(59, cfg), { winnerTeam: 'defense', levels: 1 });
  assert.deepEqual(computeLevelGain(60, cfg), { winnerTeam: 'attack', levels: 1 });
  assert.deepEqual(computeLevelGain(100, cfg), { winnerTeam: 'attack', levels: 2 });
  assert.deepEqual(computeLevelGain(200, cfg), { winnerTeam: 'attack', levels: 4 });
  // 小光域不变
  assert.deepEqual(computeLevelGain(39, cfg), { winnerTeam: 'defense', levels: 2 });
  assert.deepEqual(computeLevelGain(40, cfg), { winnerTeam: 'defense', levels: 1 });
});

test('QA-抠1：攻方赢末墩——底牌分 ×2 计入攻方', () => {
  const st = makeState({ dealerIdx: 0 }); // 庄 team0，攻 team1
  st.completedTricks = [{
    leadPlayerIdx: 1,
    leadCombo: parseCombo(cards('SA'), TI, DEFAULT_CONFIG),
    plays: [], winnerIdx: 1, points: 60
  }];
  st.bottomCards = [...cardsD('S5'), ...cards('C10')]; // 底 20 分
  const r = settleRound(st);
  assert.equal(r.bottomPoints, 20);
  assert.equal(r.bottomMultiplierUsed, 2);
  assert.equal(r.bottomGained, 40);
  assert.equal(r.attackPoints, 100); // 60 + 20×2
  assert.equal(r.winnerTeam, 1); // 攻方上台
  assert.equal(r.levelsGained, 1); // 80~119
});

test('QA-抠2：守方赢末墩——底牌分不产生额外得分', () => {
  const st = makeState({ dealerIdx: 0 });
  st.completedTricks = [{
    leadPlayerIdx: 0,
    leadCombo: parseCombo(cards('SA'), TI, DEFAULT_CONFIG),
    plays: [], winnerIdx: 2, points: 60 // 庄家队友赢
  }];
  st.bottomCards = [...cardsD('S5'), ...cards('C10')];
  const r = settleRound(st);
  assert.equal(r.attackPoints, 0);
  assert.equal(r.bottomGained, 0);
  assert.equal(r.bottomMultiplierUsed, 1);
});

test('QA-抠3：攻方赢末墩但底牌 0 分 → 无加倍', () => {
  const st = makeState({ dealerIdx: 0 });
  st.completedTricks = [{
    leadPlayerIdx: 1, leadCombo: parseCombo(cards('SA'), TI, DEFAULT_CONFIG),
    plays: [], winnerIdx: 1, points: 60
  }];
  st.bottomCards = cardsD('C3'); // 0 分
  const r = settleRound(st);
  assert.equal(r.attackPoints, 60);
  assert.equal(r.bottomGained, 0);
});

test('QA-抠4：R10 开启——末墩牌型加倍（单2/对4/拖8/甩取最大单元）', () => {
  const cfg = createConfig({ bottomMultiplierByType: true });
  const mk = (cs) => ({
    leadPlayerIdx: 1, leadCombo: parseCombo(cs, TI, cfg), plays: [], winnerIdx: 1, points: 40
  });
  // 单张末墩 ×2
  const st1 = makeState({ dealerIdx: 0 }); st1.config = cfg;
  st1.completedTricks = [mk(cards('SA'))]; st1.bottomCards = cardsD('S10');
  assert.equal(settleRound(st1).attackPoints, 40 + 20 * 2);
  // 对子末墩 ×4
  const st2 = makeState({ dealerIdx: 0 }); st2.config = cfg;
  st2.completedTricks = [mk(cardsD('SA'))]; st2.bottomCards = cardsD('S10');
  assert.equal(settleRound(st2).attackPoints, 40 + 20 * 4);
  // 拖拉机末墩 ×8
  const st3 = makeState({ dealerIdx: 0 }); st3.config = cfg;
  st3.completedTricks = [mk(cardsD('SA', 'SK'))]; st3.bottomCards = cardsD('S10');
  assert.equal(settleRound(st3).attackPoints, 40 + 20 * 8);
  // 甩牌末墩取最大单元（对 → ×4）
  const st4 = makeState({ dealerIdx: 0 }); st4.config = cfg;
  st4.completedTricks = [mk([...cardsD('S5'), ...cards('SA')])]; st4.bottomCards = cardsD('S10');
  const r4 = settleRound(st4);
  assert.equal(r4.bottomMultiplierUsed, 4);
  assert.equal(r4.attackPoints, 40 + 20 * 4);
});

test('QA-抠5：R9=1 配置——抠底不加倍', () => {
  const cfg = createConfig({ bottomMultiplier: 1 });
  const st = makeState({ dealerIdx: 0 }); st.config = cfg;
  st.completedTricks = [{
    leadPlayerIdx: 1, leadCombo: parseCombo(cards('SA'), TI, cfg),
    plays: [], winnerIdx: 1, points: 60
  }];
  st.bottomCards = cardsD('S10'); // 20 分
  const r = settleRound(st);
  assert.equal(r.bottomMultiplierUsed, 1);
  assert.equal(r.attackPoints, 80); // 60 + 20×1
});

test('QA-过A1：守方打A 小光(<40)过A → gameOver', () => {
  const st = makeState({ dealerIdx: 0, level: 'A' });
  st.levels = { team0: 'A', team1: '5' };
  st.completedTricks = [{
    leadPlayerIdx: 0, leadCombo: parseCombo(cards('SA'), st.trumpInfo, DEFAULT_CONFIG),
    plays: [], winnerIdx: 1, points: 39 // 攻方恰 39 分
  }];
  st.bottomCards = cardsD('C3');
  const r = settleRound(st);
  assert.equal(r.attackPoints, 39);
  assert.equal(r.passedA, true);
  assert.equal(r.gameOver, true);
});

test('QA-过A2：守方打A 恰 40 分（≥40）未过 → 停在 A 升 2 级封顶，非 gameOver', () => {
  const st = makeState({ dealerIdx: 0, level: 'A' });
  st.levels = { team0: 'A', team1: '5' };
  st.completedTricks = [{
    leadPlayerIdx: 0, leadCombo: parseCombo(cards('SA'), st.trumpInfo, DEFAULT_CONFIG),
    plays: [], winnerIdx: 1, points: 40
  }];
  st.bottomCards = cardsD('C3');
  const r = settleRound(st);
  assert.equal(r.passedA, false);
  assert.equal(r.levelsGained, 2);
  assert.equal(r.nextLevels.team0, 'A'); // 封顶
  assert.equal(r.gameOver, false);
});

test('QA-过A3：守方打A 攻方上台 → 过A 失败（攻方升级上台）', () => {
  const st = makeState({ dealerIdx: 0, level: 'A' });
  st.levels = { team0: 'A', team1: '5' };
  st.completedTricks = [{
    leadPlayerIdx: 0, leadCombo: parseCombo(cards('SA'), st.trumpInfo, DEFAULT_CONFIG),
    plays: [], winnerIdx: 1, points: 80
  }];
  st.bottomCards = cardsD('C3');
  const r = settleRound(st);
  assert.equal(r.passedA, false);
  assert.equal(r.winnerTeam, 1);
  assert.equal(r.nextLevels.team1, '6');
  assert.equal(r.nextLevels.team0, 'A'); // 守方停在 A
});

test('QA-庄1：R16 winner_stays——守方胜连庄；攻方上台由定主者当庄', () => {
  const players = [{ team: 0 }, { team: 1 }, { team: 0 }, { team: 1 }];
  assert.equal(nextDealer({
    dealerTeam: 0, winnerTeam: 0, dealerIdx: 1, bidWinnerIdx: 2,
    players, dealerPassRule: 'winner_stays'
  }), 1); // 连庄
  assert.equal(nextDealer({
    dealerTeam: 0, winnerTeam: 1, dealerIdx: 1, bidWinnerIdx: 3,
    players, dealerPassRule: 'winner_stays'
  }), 3); // 攻方定主者
  // 翻底定主（无人亮）→ 上局庄家下家
  assert.equal(nextDealer({
    dealerTeam: 0, winnerTeam: 1, dealerIdx: 2, bidWinnerIdx: null,
    players, dealerPassRule: 'winner_stays', lastDealerIdx: 2
  }), 3);
});

test('QA-庄2：R16 rotate——守方胜庄家队友坐庄', () => {
  const players = [{ team: 0 }, { team: 1 }, { team: 0 }, { team: 1 }];
  assert.equal(nextDealer({
    dealerTeam: 0, winnerTeam: 0, dealerIdx: 2, bidWinnerIdx: 2,
    players, dealerPassRule: 'rotate'
  }), 0); // 对面
});

test('QA-级1：advanceRank 2→A 顺序与封顶', () => {
  assert.equal(advanceRank('2', 3, DEFAULT_CONFIG), '5');
  assert.equal(advanceRank('J', 2, DEFAULT_CONFIG), 'K'); // J→Q→K
  assert.equal(advanceRank('Q', 2, DEFAULT_CONFIG), 'A'); // Q→K→A 恰好
  assert.equal(advanceRank('K', 5, DEFAULT_CONFIG), 'A'); // 封顶
  assert.equal(advanceRank('A', 2, DEFAULT_CONFIG), 'A'); // 停 A
});

test('QA-过A4：checkPassA 各条件（win / big_light）', () => {
  const cfgW = createConfig({ passACondition: 'win' });
  assert.equal(checkPassA({ winnerIsDealer: true, attackPoints: 150, dealerRank: 'A', cfg: cfgW }).passedA, true);
  const cfgB = createConfig({ passACondition: 'big_light' });
  assert.equal(checkPassA({ winnerIsDealer: true, attackPoints: 0, dealerRank: 'A', cfg: cfgB }).passedA, true);
  assert.equal(checkPassA({ winnerIsDealer: true, attackPoints: 5, dealerRank: 'A', cfg: cfgB }).passedA, false);
});
