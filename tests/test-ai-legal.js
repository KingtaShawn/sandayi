/**
 * tests/test-ai-legal.js —— AI 合法性压测（验收 3：≥100 局零非法出牌）。
 *
 * 每局完整流程：发牌 → 亮主/反主（或翻底）→ 埋底 → 逐墩 → 结算升级；
 * 断言：零非法出牌（RuleError）、零空 legalMoves、分守恒（总 200）、结算合法。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG, createConfig } = require('../miniprogram/engine/config');
const { createInitialState } = require('../miniprogram/core/state');
const { transition } = require('../miniprogram/core/statemachine');
const { runRoundToScoring } = require('../miniprogram/core/dealer-ai-loop');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { createRng } = require('../miniprogram/utils/random');
const { computeLevelGain } = require('../miniprogram/engine/settle');

const ROUNDS = 100;

test(`AI 压测：${ROUNDS} 局完整模拟，零非法出牌`, () => {
  const ai = new GreedyStrategy('normal');
  let totalTricks = 0;
  let attackWins = 0;
  let defenseWins = 0;
  let bigLights = 0;      // 大光局数
  let noTrumpRounds = 0;  // 无主局数
  let throwRounds = 0;    // 出现甩牌领出的局数

  for (let seed = 1; seed <= ROUNDS; seed++) {
    const rng = createRng(seed);
    const st0 = createInitialState(DEFAULT_CONFIG, null, rng);
    // runRoundToScoring 内部：任何非法（validatePlay/transition 抛 RuleError）都会 throw
    const { state, illegalCount } = runRoundToScoring(st0, ai, rng);
    assert.equal(illegalCount, 0, `seed=${seed} 出现非法出牌`);

    // 终态合法
    assert.equal(state.phase, 'SCORING', `seed=${seed} 未到 SCORING`);
    state.players.forEach((p, i) => assert.equal(p.hand.length, 0, `seed=${seed} 玩家${i}手牌未清空`));

    // 墩完整性：每墩 4 家、同张数、有赢家、有分
    state.completedTricks.forEach((t, ti) => {
      assert.equal(t.plays.length, 4, `seed=${seed} trick${ti} 不足 4 家`);
      const n = t.leadCombo.n;
      t.plays.forEach((p) => assert.equal(p.cards.length, n));
      assert.ok(t.winnerIdx !== null && t.winnerIdx >= 0 && t.winnerIdx <= 3);
      if (t.leadCombo.type === 'throw') throwRounds++;
    });
    totalTricks += state.completedTricks.length;

    // 分守恒：场上分 + 底牌分 = 200；攻方得分 = 场上攻方分 +（攻方赢末墩时）底牌分×倍数
    const cfg = state.config;
    const onTable = state.completedTricks.reduce((s, t) => s + t.points, 0);
    const bottomPts = state.bottomCards.reduce((s, c) => s + (cfg.pointValues[c.rank] || 0), 0);
    assert.equal(onTable + bottomPts, 200, `seed=${seed} 分不守恒`);
    const settle = state.lastSettle;
    assert.ok(settle);
    const attackOnTable = state.completedTricks
      .filter((t) => state.players[t.winnerIdx].team === state.attackTeam)
      .reduce((s, t) => s + t.points, 0);
    const expectAttack = attackOnTable + (settle.bottomGained || 0);
    assert.equal(settle.attackPoints, expectAttack, `seed=${seed} 攻方分不一致`);
    assert.equal(settle.bottomPoints, bottomPts);

    // 结算合法：升级数符合 R18 表
    const gain = computeLevelGain(settle.attackPoints, cfg);
    if (!settle.passedA) {
      assert.equal(gain.levels, settle.levelsGained, `seed=${seed} 升级数与 R18 不符`);
    }
    if (settle.winnerTeam === state.attackTeam) attackWins++;
    else defenseWins++;
    if (settle.attackPoints === 0) bigLights++;
    if (state.trumpInfo.isNoTrump) noTrumpRounds++;

    // 序列化健壮（每 20 局抽查）
    if (seed % 20 === 0) {
      const json = JSON.stringify(state);
      assert.ok(json.length > 1000);
    }
  }

  console.log(`[压测] ${ROUNDS}局 | 平均墩数 ${(totalTricks / ROUNDS).toFixed(1)} | 攻方胜 ${attackWins} 守方胜 ${defenseWins} | 大光 ${bigLights} | 无主局 ${noTrumpRounds} | 含甩牌局 ${throwRounds}`);
  // 覆盖面合理性：100 局应至少出现若干攻/守胜利（随机性下几乎必然）
  assert.ok(attackWins > 0 && defenseWins > 0, '胜负分布异常');
});

test('AI 压测：R11/R12 严格模式下零非法（含跟牌结构）', () => {
  const ai = new GreedyStrategy('normal');
  for (let seed = 1000; seed < 1010; seed++) {
    const rng = createRng(seed);
    const st0 = createInitialState(DEFAULT_CONFIG, null, rng);
    const { state, illegalCount } = runRoundToScoring(st0, ai, rng);
    assert.equal(illegalCount, 0);
    assert.equal(state.phase, 'SCORING');
  }
});

test('AI 压测：R14=smallest 罚则模式下也零非法', () => {
  const cfg = createConfig({ throwPenalty: 'smallest' });
  const ai = new GreedyStrategy('normal');
  for (let seed = 2000; seed < 2010; seed++) {
    const rng = createRng(seed);
    const st0 = createInitialState(cfg, null, rng);
    const { state, illegalCount } = runRoundToScoring(st0, ai, rng);
    assert.equal(illegalCount, 0);
    assert.equal(state.phase, 'SCORING');
  }
});

test('AI 压测：连续多局（NEXT_ROUND 链路）升级正确', () => {
  const ai = new GreedyStrategy('normal');
  const rng = createRng(77);
  let state = createInitialState(DEFAULT_CONFIG, null, rng); // INIT_DEAL
  let rounds = 0;
  while (rounds < 5) {
    const r = runRoundToScoring(state, ai, rng); // 内部完成 DEAL
    state = r.state;
    assert.equal(state.phase, 'SCORING');
    rounds++;
    state = transition(state, { type: 'NEXT_ROUND' });
    if (state.phase === 'GAME_OVER') break;
    assert.equal(state.phase, 'INIT_DEAL');
    assert.equal(state.roundNo, rounds + 1);
  }
  assert.ok(rounds >= 1);
});
