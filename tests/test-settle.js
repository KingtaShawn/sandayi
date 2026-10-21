/**
 * tests/test-settle.js —— 计分 / 抠底 / 升级 / 过A / 庄传递。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG, createConfig } = require('../miniprogram/engine/config');
const {
  computeLevelGain, advanceRank, checkPassA, nextDealer,
  settleRound, bottomMultiplier, bottomPoints
} = require('../miniprogram/engine/settle');
const { parseCombo } = require('../miniprogram/engine/combo');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { cards, cardsD, makeState } = require('./fixtures');

const TI = buildTrumpInfo('H', '2', DEFAULT_CONFIG);

test('R18 升级表全档位（公式化）', () => {
  assert.deepEqual(computeLevelGain(0, DEFAULT_CONFIG), { winnerTeam: 'defense', levels: 3 });   // 大光 3 级
  assert.deepEqual(computeLevelGain(20, DEFAULT_CONFIG), { winnerTeam: 'defense', levels: 2 });  // 小光 2 级
  assert.deepEqual(computeLevelGain(39, DEFAULT_CONFIG), { winnerTeam: 'defense', levels: 2 });
  assert.deepEqual(computeLevelGain(40, DEFAULT_CONFIG), { winnerTeam: 'defense', levels: 1 });  // 40-79 1 级
  assert.deepEqual(computeLevelGain(79, DEFAULT_CONFIG), { winnerTeam: 'defense', levels: 1 });
  assert.deepEqual(computeLevelGain(80, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 1 });   // 上台
  assert.deepEqual(computeLevelGain(119, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 1 });
  assert.deepEqual(computeLevelGain(120, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 2 });
  assert.deepEqual(computeLevelGain(160, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 3 });
  assert.deepEqual(computeLevelGain(200, DEFAULT_CONFIG), { winnerTeam: 'attack', levels: 4 });
});

test('R7 大光奖励可调（0 → 2 级）', () => {
  const cfg = createConfig({ cleanSweepBonusLevels: 0 });
  assert.deepEqual(computeLevelGain(0, cfg), { winnerTeam: 'defense', levels: 2 });
});

test('advanceRank：2→A 顺序推进与封顶', () => {
  assert.equal(advanceRank('2', 1, DEFAULT_CONFIG), '3');
  assert.equal(advanceRank('5', 2, DEFAULT_CONFIG), '7');
  assert.equal(advanceRank('K', 2, DEFAULT_CONFIG), 'A');
  assert.equal(advanceRank('Q', 5, DEFAULT_CONFIG), 'A'); // 封顶
  assert.equal(advanceRank('A', 1, DEFAULT_CONFIG), 'A'); // 停在 A
});

test('R15 过A：小光(<40)过A / ≥40 停在A 升2级封顶', () => {
  const pass = checkPassA({ winnerIsDealer: true, attackPoints: 39, dealerRank: 'A', cfg: DEFAULT_CONFIG });
  assert.equal(pass.passedA, true);
  const fail = checkPassA({ winnerIsDealer: true, attackPoints: 40, dealerRank: 'A', cfg: DEFAULT_CONFIG });
  assert.equal(fail.passedA, false);
  assert.equal(fail.levelsGained, 2);
  assert.equal(fail.cappedAtA, true);
  // 攻方上台 → 过A失败
  const lose = checkPassA({ winnerIsDealer: false, attackPoints: 80, dealerRank: 'A', cfg: DEFAULT_CONFIG });
  assert.equal(lose.passedA, false);
});

test('R15 备选条件：win / big_light', () => {
  const cfgW = createConfig({ passACondition: 'win' });
  assert.equal(checkPassA({ winnerIsDealer: true, attackPoints: 100, dealerRank: 'A', cfg: cfgW }).passedA, true);
  const cfgB = createConfig({ passACondition: 'big_light' });
  assert.equal(checkPassA({ winnerIsDealer: true, attackPoints: 0, dealerRank: 'A', cfg: cfgB }).passedA, true);
  assert.equal(checkPassA({ winnerIsDealer: true, attackPoints: 5, dealerRank: 'A', cfg: cfgB }).passedA, false);
});

test('R16 庄传递：winner_stays 庄胜连庄 / 攻方上台定主者坐庄', () => {
  const players = [{ team: 0 }, { team: 1 }, { team: 0 }, { team: 1 }];
  // 庄家方(0)胜 → 连庄
  assert.equal(nextDealer({ dealerTeam: 0, winnerTeam: 0, dealerIdx: 1, bidWinnerIdx: 2, players, dealerPassRule: 'winner_stays' }), 1);
  // 攻方(1)上台 → 定主者(2 是攻方? team0... bidWinnerIdx=3) 坐庄
  assert.equal(nextDealer({ dealerTeam: 0, winnerTeam: 1, dealerIdx: 1, bidWinnerIdx: 3, players, dealerPassRule: 'winner_stays' }), 3);
  // 翻底定主（无人亮）→ 上局庄家下家
  assert.equal(nextDealer({ dealerTeam: 0, winnerTeam: 1, dealerIdx: 1, bidWinnerIdx: null, players, dealerPassRule: 'winner_stays', lastDealerIdx: 1 }), 2);
});

test('R9 抠底 ×2 统一倍数', () => {
  assert.equal(bottomMultiplier(null, TI, DEFAULT_CONFIG), 2);
});

test('R10 按牌型加倍：单2/对4/拖8', () => {
  const cfg = createConfig({ bottomMultiplierByType: true });
  const mk = (cs) => {
    const combo = parseCombo(cs, TI, cfg);
    return { leadPlayerIdx: 0, leadCombo: combo, plays: [], winnerIdx: 0, points: 0 };
  };
  assert.equal(bottomMultiplier(mk(cards('S7')), TI, cfg), 2);
  assert.equal(bottomMultiplier(mk(cardsD('S7')), TI, cfg), 4);
  assert.equal(bottomMultiplier(mk(cardsD('S7', 'S8')), TI, cfg), 8);
});

test('settleRound：庄家方守住（攻方 40 分 → 升 1 级）', () => {
  const st = makeState({ dealerIdx: 0 }); // 庄家 team0，攻方 team1
  // 攻方赢两墩共 40 分（25 + 15）
  const t1 = mkTrick(1, [
    { idx: 0, cards: cards('S5') }, { idx: 1, cards: cards('SA') },
    { idx: 2, cards: cards('S3') }, { idx: 3, cards: cards('S4') }
  ]);
  t1.points = 25;
  const t2 = mkTrick(3, [
    { idx: 0, cards: cards('C3') }, { idx: 1, cards: cards('C4') },
    { idx: 2, cards: cards('C6') }, { idx: 3, cards: cards('C5') }
  ]);
  t2.points = 15;
  st.completedTricks = [t1, t2];
  st.bottomCards = cardsD('H3'); // 底 0 分 → 无抠底
  const r = settleRound(st);
  assert.equal(r.attackPoints, 40);
  assert.equal(r.winnerTeam, 0); // 庄家方胜
  assert.equal(r.levelsGained, 1);
  assert.equal(r.nextLevels.team0, '3');
  assert.equal(r.nextLevels.team1, '2');
  assert.equal(r.passedA, false);
  assert.equal(r.gameOver, false);

  function mkTrick(winnerIdx, plays) {
    const leadCombo = parseCombo(plays[0].cards, TI, DEFAULT_CONFIG);
    return {
      leadPlayerIdx: plays[0].idx,
      leadCombo,
      plays: plays.map((p) => ({
        playerIdx: p.idx, cards: p.cards, combo: parseCombo(p.cards, TI, DEFAULT_CONFIG), isDiscard: false
      })),
      winnerIdx,
      points: 0
    };
  }
});

test('settleRound：攻方 80 分上台升 1 级 + 抠底 ×2 计入', () => {
  const st = makeState({ dealerIdx: 0 });
  const t = {
    leadPlayerIdx: 1,
    leadCombo: parseCombo(cards('SA'), TI, DEFAULT_CONFIG),
    plays: [],
    winnerIdx: 1,
    points: 60 // 场上攻方 60
  };
  st.completedTricks = [t];
  st.bottomCards = [...cardsD('S5'), ...cards('C10')]; // 底 20 分
  st.scores = { team0: 0, team1: 60 };
  const r = settleRound(st);
  assert.equal(r.attackPoints, 100); // 60 + 20×2
  assert.equal(r.winnerTeam, 1);
  assert.equal(r.levelsGained, 1); // 80~119 → 1 级
  assert.equal(r.nextLevels.team1, '3');
});

test('settleRound：庄家方赢末墩 → 底牌分不加倍计入（攻方不获得）', () => {
  const st = makeState({ dealerIdx: 0 });
  const t = {
    leadPlayerIdx: 0,
    leadCombo: parseCombo(cards('SA'), TI, DEFAULT_CONFIG),
    plays: [],
    winnerIdx: 2, // 庄家方队友赢末墩
    points: 60
  };
  st.completedTricks = [t];
  st.bottomCards = [...cardsD('S5'), ...cards('C10')];
  const r = settleRound(st);
  assert.equal(r.attackPoints, 0);
  assert.equal(r.bottomGained, 0);
});

test('settleRound：攻方大光 0 分 → 庄家升 3 级', () => {
  const st = makeState({ dealerIdx: 0 });
  const t = { leadPlayerIdx: 0, leadCombo: parseCombo(cards('SA'), TI, DEFAULT_CONFIG), plays: [], winnerIdx: 0, points: 0 };
  st.completedTricks = [t];
  st.bottomCards = cardsD('C3');
  const r = settleRound(st);
  assert.equal(r.attackPoints, 0);
  assert.equal(r.levelsGained, 3);
  assert.equal(r.nextLevels.team0, '5');
});

test('settleRound：过A（打A 小光）→ gameOver', () => {
  const st = makeState({ dealerIdx: 0, level: 'A' });
  st.levels = { team0: 'A', team1: '5' };
  // 攻方（team1）赢 20 分
  const t = { leadPlayerIdx: 0, leadCombo: parseCombo(cards('SA'), st.trumpInfo, DEFAULT_CONFIG), plays: [], winnerIdx: 1, points: 20 };
  st.completedTricks = [t];
  st.bottomCards = cardsD('C3');
  const r = settleRound(st);
  assert.equal(r.attackPoints, 20); // < 40 小光
  assert.equal(r.passedA, true);
  assert.equal(r.gameOver, true);
});

test('settleRound：打A 未过（40 分）→ 停在 A 升 2 级封顶', () => {
  const st = makeState({ dealerIdx: 0, level: 'A' });
  st.levels = { team0: 'A', team1: '5' };
  const t = { leadPlayerIdx: 0, leadCombo: parseCombo(cards('SA'), st.trumpInfo, DEFAULT_CONFIG), plays: [], winnerIdx: 1, points: 40 };
  st.completedTricks = [t];
  st.bottomCards = cardsD('C3');
  const r = settleRound(st);
  assert.equal(r.attackPoints, 40); // ≥40 未过A
  assert.equal(r.passedA, false);
  assert.equal(r.levelsGained, 2);
  assert.equal(r.nextLevels.team0, 'A'); // 封顶 A 继续打 A
  assert.equal(r.gameOver, false);
});

test('bottomPoints：底牌分合计', () => {
  assert.equal(bottomPoints([...cardsD('S5'), ...cards('C10'), ...cards('HK')], DEFAULT_CONFIG), 5 + 5 + 10 + 10);
  assert.equal(bottomPoints(cardsD('C3'), DEFAULT_CONFIG), 0);
});
