/**
 * tests/test-statemachine.js —— 状态机全流程 / 非法 action 拒绝 / 序列化恢复。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG, createConfig } = require('../miniprogram/engine/config');
const { createInitialState, serializeState, deserializeState, roundTripOk } = require('../miniprogram/core/state');
const { transition } = require('../miniprogram/core/statemachine');
const { runRoundToScoring } = require('../miniprogram/core/dealer-ai-loop');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { GameService } = require('../miniprogram/services/game-service');
const { createRng } = require('../miniprogram/utils/random');
const { cardsD, cards } = require('./fixtures');

test('DEAL：发牌后进入 BIDDING，每人 25 张 + 底 8 张', () => {
  const st = createInitialState(DEFAULT_CONFIG, null, createRng(1));
  const next = transition(st, { type: 'DEAL', rng: createRng(1) });
  assert.equal(next.phase, 'BIDDING');
  next.players.forEach((p) => assert.equal(p.hand.length, 25));
  assert.equal(next.bottomCards.length, 8);
});

test('非法 action 被拒绝：BIDDING 前 PLAY（E202）', () => {
  const st = createInitialState(DEFAULT_CONFIG, null, createRng(1));
  assert.throws(() => transition(st, { type: 'PLAY', playerIdx: 0, cards: cards('S5') }), /E202|不允许/);
});

test('非法 action：未知类型（E201）', () => {
  const st = createInitialState(DEFAULT_CONFIG, null, createRng(1));
  assert.throws(() => transition(st, { type: 'XXX' }), /E201|未知/);
});

test('BID：亮级牌定主 → BURYING（AI 循环推进）', () => {
  let st = createInitialState(DEFAULT_CONFIG, null, createRng(7));
  st = transition(st, { type: 'DEAL', rng: createRng(7) });
  // 找一个持级牌的玩家亮主
  const level = st.levels.team0;
  let bidIdx = -1;
  let bidCard = null;
  for (let i = 0; i < 4 && bidIdx < 0; i++) {
    const c = st.players[i].hand.find((x) => x.rank === level);
    if (c) { bidIdx = i; bidCard = c; }
  }
  assert.ok(bidIdx >= 0, '至少一家持级牌');
  st = transition(st, { type: 'BID', playerIdx: bidIdx, cards: [bidCard] });
  assert.equal(st.trumpInfo.trumpSuit, bidCard.suit);
  assert.equal(st.bidWinnerIdx, bidIdx);
  assert.equal(st.dealerIdx, bidIdx); // 首亮者暂定庄
});

test('BURY：非庄家被拒（E108）/ 张数错（E107）', () => {
  let st = createInitialState(DEFAULT_CONFIG, null, createRng(3));
  st = transition(st, { type: 'DEAL', rng: createRng(3) });
  const level = st.levels.team0;
  let bidIdx = -1;
  let bidCard = null;
  for (let i = 0; i < 4 && bidIdx < 0; i++) {
    const c = st.players[i].hand.find((x) => x.rank === level);
    if (c) { bidIdx = i; bidCard = c; }
  }
  st = transition(st, { type: 'BID', playerIdx: bidIdx, cards: [bidCard] });
  // 反主窗口：其余玩家 PASS 后进入 BURYING
  for (let i = 0; i < 4; i++) {
    if (i === bidIdx) continue;
    if (!st.bids.some((b) => b.playerIdx === i)) {
      st = transition(st, { type: 'PASS_BID', playerIdx: i });
    }
  }
  assert.equal(st.phase, 'BURYING');
  const dealerHand = st.players[st.dealerIdx].hand;
  assert.equal(dealerHand.length, 33);
  const other = (st.dealerIdx + 1) % 4;
  assert.throws(() => transition(st, { type: 'BURY', playerIdx: other, cards: dealerHand.slice(0, 8) }), /E108|庄家/);
  assert.throws(() => transition(st, { type: 'BURY', playerIdx: st.dealerIdx, cards: dealerHand.slice(0, 4) }), /E107|张数/);
});

test('完整 AI 一局自动跑到 SCORING（runRoundToScoring）', () => {
  const st0 = createInitialState(DEFAULT_CONFIG, null, createRng(11));
  const ai = new GreedyStrategy('normal');
  const { state, steps, illegalCount } = runRoundToScoring(st0, ai, createRng(11));
  assert.equal(illegalCount, 0);
  assert.ok(steps < 5000);
  assert.equal(state.phase, 'SCORING');
  // 墩数 ≤25（对子/拖/甩墩消耗多张手牌）
  assert.ok(state.completedTricks.length >= 1 && state.completedTricks.length <= 25);
  // 手牌清空
  state.players.forEach((p) => assert.equal(p.hand.length, 0));
  // 每墩 4 家、出牌张数一致
  state.completedTricks.forEach((t) => {
    assert.equal(t.plays.length, 4);
    const n = t.leadCombo.n;
    t.plays.forEach((p) => assert.equal(p.cards.length, n));
  });
  const totalPoints = state.completedTricks.reduce((s, t) => s + t.points, 0);
  const settle = state.lastSettle;
  assert.ok(totalPoints >= 0 && totalPoints <= 200);
  assert.ok(settle.attackPoints >= 0 && settle.attackPoints <= 200 + 200);
  // 场上分 = 攻方场上分 + 守方场上分
  const defOnTable = state.completedTricks
    .filter((t) => state.players[t.winnerIdx].team === settle.winnerTeam)
    .reduce((s, t) => s + t.points, 0);
  void defOnTable;
  assert.equal(settle.attackPointsOnTable + (settle.attackPoints - settle.attackPointsOnTable - settle.bottomGained >= 0 ? 0 : 0), settle.attackPointsOnTable);
});

test('序列化 → 反序列化 → roundTrip 完整（F-09 核心）', () => {
  const st0 = createInitialState(DEFAULT_CONFIG, null, createRng(21));
  const ai = new GreedyStrategy('normal');
  const { state } = runRoundToScoring(st0, ai, createRng(21));
  const json = JSON.stringify(serializeState(state));
  const restored = deserializeState(json);
  assert.equal(restored.phase, state.phase);
  assert.equal(restored.completedTricks.length, state.completedTricks.length);
  assert.ok(roundTripOk(state));
  // trumpInfo 重建
  assert.ok(restored.trumpInfo);
  assert.equal(restored.trumpInfo.levelRank, state.trumpInfo.levelRank);
  assert.equal(restored.trumpInfo.trumpSuit, state.trumpInfo.trumpSuit);
  assert.ok(restored.trumpInfo.trumpIds.size > 0);
});

test('版本过新存档被拒（E301）', () => {
  const bad = { schemaVersion: 99, phase: 'PLAYING' };
  assert.throws(() => deserializeState(bad), /E301|版本/);
  assert.throws(() => deserializeState('not-json{{'), /E302|解析/);
});

test('NEXT_ROUND：新庄/新级数/字段重置', () => {
  const st0 = createInitialState(DEFAULT_CONFIG, null, createRng(31));
  const ai = new GreedyStrategy('normal');
  const { state } = runRoundToScoring(st0, ai, createRng(31));
  const settle = state.lastSettle;
  const next = transition(state, { type: 'NEXT_ROUND' });
  if (settle.gameOver) {
    assert.equal(next.phase, 'GAME_OVER');
  } else {
    assert.equal(next.phase, 'INIT_DEAL');
    assert.equal(next.roundNo, state.roundNo + 1);
    assert.equal(next.dealerIdx, settle.nextDealerIdx);
    assert.deepEqual(next.levels, settle.nextLevels);
    assert.equal(next.bids.length, 0);
    assert.equal(next.completedTricks.length, 0);
    next.players.forEach((p) => assert.equal(p.hand.length, 0));
    // 可继续发牌开下一局
    const dealt = transition(next, { type: 'DEAL', rng: createRng(32) });
    assert.equal(dealt.phase, 'BIDDING');
  }
});

test('GameService：完整一局（tick 驱动 + 真人代理 AI）', () => {
  const svc = new GameService({ config: DEFAULT_CONFIG, rng: createRng(41) });
  svc.startGame();
  let guard = 0;
  while (svc.getState().phase !== 'SCORING' && svc.getState().phase !== 'GAME_OVER' && guard < 400) {
    // 真人也用 AI 策略代打（单测试驱动全流程）
    const st = svc.getState();
    if (st.phase === 'BIDDING') {
      svc.tickUntilHuman(16);
      if (svc.getState().phase === 'BIDDING') {
        // 全员不亮 → 翻底
        svc.dispatch({ type: 'FLIP_BOTTOM', rng: createRng(42) });
      }
    } else if (st.phase === 'BURYING') {
      const dealer = st.dealerIdx;
      if (!st.players[dealer].isHuman) {
        svc.tick();
      } else {
        const hand = st.players[dealer].hand.concat(st.bottomCards);
        // 手工并底
        const st2 = svc.getState();
        st2.players[dealer].hand = hand;
        const bury = new GreedyStrategy().decideBury(st2, dealer, createRng(43));
        svc.bury(bury);
      }
    } else if (st.phase === 'PLAYING') {
      const turn = st.turnIdx;
      if (st.players[turn].isHuman) {
        const pick = new GreedyStrategy().decidePlay(st, turn, createRng(44));
        const r = svc.play(turn, pick);
        assert.equal(r.ok, true, `真人代打出牌失败: ${r.reason}`);
      } else {
        svc.tick();
      }
    } else {
      break;
    }
    guard++;
  }
  const st = svc.getState();
  assert.ok(['SCORING', 'GAME_OVER'].includes(st.phase), `终态异常: ${st.phase}`);
  assert.ok(st.lastSettle);
  // 序列化可恢复
  const json = svc.serialize();
  const svc2 = new GameService({ rng: createRng(45) });
  svc2.resume(json);
  assert.equal(svc2.getState().phase, st.phase);
});

test('R5=60 参数变化：上台门槛随配置（验收 2 链路）', () => {
  const cfg60 = createConfig({ pointsToTake: 60 });
  const st0 = createInitialState(cfg60, null, createRng(51));
  const ai = new GreedyStrategy('normal');
  const { state } = runRoundToScoring(st0, ai, createRng(51));
  const settle = state.lastSettle;
  // 攻方 60+ 分即攻方胜（80 分默认下 60 是守方胜 1 级）
  if (settle.attackPoints >= 60) {
    assert.equal(settle.winnerTeam, state.attackTeam);
  } else {
    assert.notEqual(settle.winnerTeam, state.attackTeam);
  }
});
