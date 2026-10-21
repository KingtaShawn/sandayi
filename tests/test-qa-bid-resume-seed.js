/**
 * tests/test-qa-bid-resume-seed.js —— QA 对抗性测试：反主优先级 / 无主局 / 断线续玩 / 随机种子。
 *
 * 覆盖（PRD §5.5 / R8 / R13 / R16-R20 / F-09）：
 *   1. 对王反无主 > 对级牌反主 > 单张亮主（优先级链路，经状态机全链路）
 *   2. 无主局主牌 = 12 张（王 4 + 级牌 8）；副级牌 tie 先出为大
 *   3. 反主后庄家传递：反主者应坐庄（首局）
 *   4. 断线续玩：PLAYING 中途 serialize→JSON.parse→deserialize→继续 AI 打完到 SCORING
 *   5. 随机种子确定性：同 seed 发牌可复现；不同 seed 不同
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../miniprogram/engine/config');
const { createInitialState, serializeState, deserializeState } = require('../miniprogram/core/state');
const { transition } = require('../miniprogram/core/statemachine');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { createRng } = require('../miniprogram/utils/random');
const { canBid } = require('../miniprogram/engine/bid');
const { cards, cardsD, makeState } = require('./fixtures');

/** 从随机牌局出发构造：把指定牌塞给指定玩家（手工调配） */
function craftBiddingState(seed, assign) {
  let st = createInitialState(DEFAULT_CONFIG, null, createRng(seed));
  st = transition(st, { type: 'DEAL', rng: createRng(seed) });
  // assign: [{suit, rank, idx, count}] — 从全场（含底牌）收集，交换进手牌
  assign.forEach(({ suit, rank, idx, count }) => {
    const pulled = [];
    st.players.forEach((p) => {
      p.hand = p.hand.filter((c) => {
        if (c.suit === suit && c.rank === rank) { pulled.push(c); return false; }
        return true;
      });
    });
    st.bottomCards = st.bottomCards.map((c) => {
      if (c.suit === suit && c.rank === rank && pulled.length < count) {
        pulled.push(c);
        // 用玩家一张废牌补底
        const junk = st.players[idx].hand.find((x) => x.rank !== rank && !x.isJoker);
        if (junk) st.players[idx].hand = st.players[idx].hand.filter((x) => x !== junk);
        return junk || c;
      }
      return c;
    });
    for (let k = 0; k < count && k < pulled.length; k++) st.players[idx].hand.push(pulled[k]);
  });
  return st;
}

test('QA-反1：对王反无主 > 对级牌反主 > 单张亮主（状态机全链路）', () => {
  // P1 单张亮主（D2），P2 对级牌反主（C2对），P3 对王反无主
  const st = craftBiddingState(1, [
    { suit: 'D', rank: '2', idx: 1, count: 1 },
    { suit: 'C', rank: '2', idx: 2, count: 2 },
    { suit: 'JOKER', rank: 'BJ', idx: 3, count: 2 }
  ]);
  const d2 = st.players[1].hand.find((c) => c.suit === 'D' && c.rank === '2');
  let s = transition(st, { type: 'BID', playerIdx: 1, cards: [d2] });
  assert.equal(s.trumpInfo.trumpSuit, 'D');
  assert.equal(s.dealerIdx, 1);
  const c2pair = s.players[2].hand.filter((c) => c.suit === 'C' && c.rank === '2');
  assert.equal(c2pair.length, 2);
  s = transition(s, { type: 'BID', playerIdx: 2, cards: c2pair });
  assert.equal(s.trumpInfo.trumpSuit, 'C');
  const bjPair = s.players[3].hand.filter((c) => c.isJoker && c.rank === 'BJ');
  assert.equal(bjPair.length, 2);
  s = transition(s, { type: 'BID', playerIdx: 3, cards: bjPair });
  assert.equal(s.trumpInfo.isNoTrump, true);
  assert.equal(s.trumpInfo.trumpSuit, null);
  assert.equal(s.bidWinnerIdx, 3);
  // 反主后被同优先级或低优先级反 → 拒绝
  const reC2 = canBid(s, 2, s.players[2].hand.filter((c) => c.suit === 'C' && c.rank === '2'), DEFAULT_CONFIG);
  assert.equal(reC2.ok, false);
  assert.equal(reC2.errorCode, 'E110');
});

test('QA-反2：对王反主成无主局——主牌 12 张（王4+级牌8，6 个域键）', () => {
  const st = craftBiddingState(1, [{ suit: 'JOKER', rank: 'RJ', idx: 2, count: 2 }]);
  const rjPair = st.players[2].hand.filter((c) => c.isJoker && c.rank === 'RJ');
  const s = transition(st, { type: 'BID', playerIdx: 2, cards: rjPair });
  assert.equal(s.trumpInfo.isNoTrump, true);
  assert.equal(s.trumpInfo.trumpIds.size, 6); // BJ/RJ + 4 门级牌
  assert.equal(s.trumpInfo.levelRank, '2');
});

test('QA-反3：反主优先级不足（对级牌反对级牌）被拒 E110', () => {
  const state = makeState({ phase: 'BIDDING', level: '5' });
  state.players[0].hand = cardsD('S5');
  state.players[1].hand = cardsD('H5');
  const first = canBid(state, 0, cardsD('S5'), DEFAULT_CONFIG);
  assert.equal(first.ok, true);
  state.bids.push({ playerIdx: 0, type: 'pair_rank', cards: cardsD('S5'), trumpSuit: 'S', isNoTrump: false, ts: 1 });
  const second = canBid(state, 1, cardsD('H5'), DEFAULT_CONFIG);
  assert.equal(second.ok, false);
  assert.equal(second.errorCode, 'E110');
});

test('QA-反4（已修复）：首局反主后庄家应改为反主者', () => {
  // PRD §5.5：最终定主者坐庄。实现中 doBid 仅在首亮时设 dealerIdx，反主不更新。
  // 本用例锁定当前行为与 PRD 的差异（bug #1），工程师修复后应反转为断言 dealerIdx===3。
  const st = craftBiddingState(1, [
    { suit: 'D', rank: '2', idx: 1, count: 1 },
    { suit: 'C', rank: '2', idx: 3, count: 2 }
  ]);
  const d2 = st.players[1].hand.find((c) => c.suit === 'D' && c.rank === '2');
  let s = transition(st, { type: 'BID', playerIdx: 1, cards: [d2] });
  const c2pair = s.players[3].hand.filter((c) => c.suit === 'C' && c.rank === '2');
  s = transition(s, { type: 'BID', playerIdx: 3, cards: c2pair });
  // PRD 期望 dealerIdx === 3（定主者坐庄）——bug #1 已修复
  assert.equal(s.dealerIdx, 3); // ← 工程师修复后启用此断言
});

test('QA-续1：PLAYING 中途断线续玩——serialize→parse→恢复→打完到 SCORING', () => {
  const rng = createRng(9);
  const ai = new GreedyStrategy('normal');
  let st = createInitialState(DEFAULT_CONFIG, null, rng);
  st = transition(st, { type: 'DEAL', rng });
  const level = st.levels.team0;
  let bidDone = false;
  for (let i = 0; i < 4 && !bidDone; i++) {
    const c = st.players[i].hand.find((x) => x.rank === level);
    if (c) { st = transition(st, { type: 'BID', playerIdx: i, cards: [c] }); bidDone = true; }
  }
  for (let i = 0; i < 4; i++) {
    if (!st.bids.some((b) => b.playerIdx === i)) st = transition(st, { type: 'PASS_BID', playerIdx: i });
  }
  if (st.phase === 'BIDDING') st = transition(st, { type: 'FLIP_BOTTOM', rng });
  if (st.phase === 'BURYING') {
    const bury = ai.decideBury(st, st.dealerIdx, rng);
    st = transition(st, { type: 'BURY', playerIdx: st.dealerIdx, cards: bury });
  }
  assert.equal(st.phase, 'PLAYING');
  // 打 6 墩
  let guard = 0;
  while (st.phase === 'PLAYING' && st.completedTricks.length < 6 && guard < 200) {
    const playCards = ai.decidePlay(st, st.turnIdx, rng);
    st = transition(st, { type: 'PLAY', playerIdx: st.turnIdx, cards: playCards });
    guard++;
  }
  assert.equal(st.phase, 'PLAYING');
  // 断线：JSON 序列化往返
  const json = JSON.stringify(serializeState(st));
  const restored = deserializeState(json);
  assert.equal(restored.phase, 'PLAYING');
  assert.equal(restored.completedTricks.length, st.completedTricks.length);
  assert.equal(restored.turnIdx, st.turnIdx);
  assert.ok(restored.trumpInfo.trumpIds.size > 0); // 主牌域重建
  assert.deepEqual(restored.scores, st.scores);
  // 恢复后继续打完
  let st2 = restored;
  const rng2 = createRng(999);
  guard = 0;
  while (st2.phase === 'PLAYING' && guard < 500) {
    const playCards = ai.decidePlay(st2, st2.turnIdx, rng2);
    st2 = transition(st2, { type: 'PLAY', playerIdx: st2.turnIdx, cards: playCards });
    guard++;
  }
  assert.equal(st2.phase, 'SCORING');
  assert.ok(st2.players.every((p) => p.hand.length === 0));
  assert.ok(st2.lastSettle);
  // 分守恒
  const onTable = st2.completedTricks.reduce((s2, t) => s2 + t.points, 0);
  const bottomPts = st2.bottomCards.reduce((s2, c) => s2 + (DEFAULT_CONFIG.pointValues[c.rank] || 0), 0);
  assert.equal(onTable + bottomPts, 200);
});

test('QA-续2：BIDDING 阶段断线续玩（未定主）', () => {
  let st = createInitialState(DEFAULT_CONFIG, null, createRng(21));
  st = transition(st, { type: 'DEAL', rng: createRng(21) });
  const json = JSON.stringify(serializeState(st));
  const restored = deserializeState(json);
  assert.equal(restored.phase, 'BIDDING');
  assert.equal(restored.players.every((p) => p.hand.length === 25), true);
  // 可继续亮主
  const level = restored.levels.team0;
  let bidIdx = -1; let bidCard = null;
  for (let i = 0; i < 4 && bidIdx < 0; i++) {
    const c = restored.players[i].hand.find((x) => x.rank === level);
    if (c) { bidIdx = i; bidCard = c; }
  }
  assert.ok(bidIdx >= 0);
  const s = transition(restored, { type: 'BID', playerIdx: bidIdx, cards: [bidCard] });
  assert.equal(s.trumpInfo.trumpSuit, bidCard.suit);
});

test('QA-种1：随机种子确定性——同 seed 发牌完全一致', () => {
  const ids = (seed) => {
    let st = createInitialState(DEFAULT_CONFIG, null, createRng(seed));
    st = transition(st, { type: 'DEAL', rng: createRng(seed) });
    return st.players.map((p) => p.hand.map((c) => c.id).join(','))
      .concat([st.bottomCards.map((c) => c.id).join(',')]);
  };
  const a = ids(123);
  const b = ids(123);
  const c = ids(124);
  assert.deepEqual(a, b); // 同 seed 可复现
  assert.notDeepEqual(a, c); // 不同 seed 不同
});

test('QA-种2：同 seed 完整一局轨迹可复现（AI 无随机扰动路径下）', () => {
  const { runRoundToScoring } = require('../miniprogram/core/dealer-ai-loop');
  const ai = new GreedyStrategy('normal');
  const run = (seed) => {
    const rng = createRng(seed);
    const st0 = createInitialState(DEFAULT_CONFIG, null, rng);
    const { state } = runRoundToScoring(st0, ai, rng);
    return state.completedTricks.map((t) => `${t.leadPlayerIdx}>${t.plays.map((p) => p.cards.map((c) => c.id).join('.')).join('/')}`);
  };
  const a = run(55);
  const b = run(55);
  assert.deepEqual(a, b);
});

test('QA-主1：副级牌先出为大（R13）——C2 不能压先出的 S2；主级牌 H2 可压', () => {
  const { buildTrumpInfo } = require('../miniprogram/engine/trump');
  const { parseCombo, canBeat } = require('../miniprogram/engine/combo');
  const TI = buildTrumpInfo('H', '2', DEFAULT_CONFIG);
  const lead = parseCombo(cards('S2'), TI);
  assert.equal(canBeat(lead, parseCombo(cards('C2'), TI)), false); // tie 不压
  assert.equal(canBeat(lead, parseCombo(cards('H2'), TI)), true); // 主级牌压副级牌
  assert.equal(canBeat(lead, parseCombo(cards('RJ'), TI)), true); // 小王压
});
