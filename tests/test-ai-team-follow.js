'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeState } = require('./fixtures');
const { buildDeck } = require('../miniprogram/engine/deck');
const { createConfig } = require('../miniprogram/engine/config');
const { parseCombo } = require('../miniprogram/engine/combo');
const { legalMoves, validatePlay } = require('../miniprogram/engine/validate');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { createInitialState } = require('../miniprogram/core/state');
const { runRoundToScoring } = require('../miniprogram/core/dealer-ai-loop');
const { createRng } = require('../miniprogram/utils/random');

/** 全副108张、我仍25张的前期局面；主为红桃，方块副牌首次领出。 */
function earlyTrick({ locked = false, forced = false, afterTen = false } = {}) {
  const config = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const pool = buildDeck(config);
  const take = (suit, rank) => pool.splice(pool.findIndex((c) => c.suit === suit && c.rank === rank), 1)[0];
  const jack = take('D', 'J');
  const dealerPlay = locked ? take('D', '3') : null;
  const tenPlay = afterTen ? take('D', '10') : null;
  const mine = forced ? [take('D', '10')]
    : [take('D', locked ? '4' : '3'), take('D', '10'), take('D', 'K')];
  while (mine.length < 25) {
    mine.push(pool.splice(pool.findIndex((c) => c.suit !== 'D'), 1)[0]);
  }
  const hands = afterTen ? [pool.splice(0, 25), pool.splice(0, 24), pool.splice(0, 24), mine]
    : [pool.splice(0, locked ? 24 : 25), pool.splice(0, 24), mine, pool.splice(0, 25)];
  const state = makeState({ hands, turnIdx: afterTen ? 3 : 2 });
  state.config = config;
  state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  state.contractScore = 90;
  state.bottomCards = pool;
  const leadPlayerIdx = locked ? 0 : 1;
  const led = dealerPlay || jack;
  const plays = (locked ? [{ playerIdx: 0, cards: [dealerPlay] }] : [])
    .concat([{ playerIdx: 1, cards: [jack] }], afterTen ? [{ playerIdx: 2, cards: [tenPlay] }] : []);
  plays.forEach((p) => { p.combo = parseCombo(p.cards, state.trumpInfo, config); });
  state.currentTrick = { leadPlayerIdx, leadCombo: parseCombo([led], state.trumpInfo, config), plays };
  return state;
}

test('前期接力：25张牌、庄家未出且方块大牌未现，J在压时有小牌就不主动送10/K', () => {
  const state = earlyTrick();
  const before = structuredClone(state);
  const ai = new GreedyStrategy();
  const pick = ai.decidePlay(state, 2);
  assert.equal(pick[0].suit, 'D');
  assert.equal(pick[0].rank, '3');
  assert.equal(validatePlay(state, 2, pick).ok, true);
  assert.deepEqual(state, before, '接力评估必须不改动真实牌局');
});

test('前期接力：J后队友已送10、庄家仍未出时，不再用K追加10分冒险超压', () => {
  const state = earlyTrick({ afterTen: true });
  const pick = new GreedyStrategy().decidePlay(state, 3);
  assert.equal(pick[0].rank, '3');
  assert.equal(validatePlay(state, 3, pick).ok, true);
});

test('前期接力：庄家已出且队友锁墩，应当继续喂10，不能一律禁跑分', () => {
  const state = earlyTrick({ locked: true });
  const pick = new GreedyStrategy().decidePlay(state, 2);
  assert.equal(pick[0].rank, '10');
  assert.equal(validatePlay(state, 2, pick).ok, true);
});

test('前期接力：只有方块10可跟时必须跟10，不得为避送分违反跟牌规则', () => {
  const state = earlyTrick({ forced: true });
  const pick = new GreedyStrategy().decidePlay(state, 2);
  assert.equal(pick[0].rank, '10');
  assert.equal(validatePlay(state, 2, pick).ok, true);
});

test('接力概率只依据公开信息和自己手牌，不读取真实队友/庄家手牌及底牌', () => {
  const state = earlyTrick();
  const ai = new GreedyStrategy();
  const ctx = ai._buildCtx(state, 2);
  const candidates = legalMoves(state, 2);
  const pick = candidates.find((cards) => cards[0].rank === '10');
  const expected = ai._teamFollowEstimates(state, 2, ctx, candidates, pick);
  assert.ok(expected && expected.length >= 2);
  for (const seat of [0, 1, 3]) {
    Object.defineProperty(state.players[seat], 'hand', { get() { throw new Error('偷看未公开手牌'); } });
  }
  Object.defineProperty(state, 'bottomCards', { get() { throw new Error('偷看底牌'); } });
  const actual = ai._teamFollowEstimates(state, 2, ctx, candidates, pick);
  assert.deepEqual(actual, expected, '同一公开局面必须得到确定、可复现的概率');
  assert.ok(actual.every((e) => e.teamWin >= 0 && e.teamWin <= 1 && e.mateWin <= e.teamWin));
});

test('前期后位队友有接牌能力时，应跑10而不是自己用K压庄', () => {
  const config = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const pool = buildDeck(config);
  const take = (suit, rank) => pool.splice(pool.findIndex((c) => c.suit === suit && c.rank === rank), 1)[0];
  const led = take('D', 'J'), followed = take('D', '4');
  const mine = [take('D', '3'), take('D', '10'), take('D', 'K')];
  while (mine.length < 25) mine.push(pool.splice(pool.findIndex((c) => c.suit !== 'D'), 1)[0]);
  // 控制采样夹具：这组假设中后位队友必能以 A 接庄，其余方块均未知。
  const mate = [take('D', 'A')];
  while (mate.length < 25) mate.push(pool.splice(pool.findIndex((c) => c.suit !== 'D'), 1)[0]);
  const state = makeState({ hands: [pool.splice(0, 24), pool.splice(0, 24), mine, mate], turnIdx: 2 });
  state.config = config;
  state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  state.contractScore = 90;
  state.bottomCards = pool;
  const plays = [{ playerIdx: 0, cards: [led] }, { playerIdx: 1, cards: [followed] }];
  plays.forEach((p) => { p.combo = parseCombo(p.cards, state.trumpInfo, config); });
  state.currentTrick = { leadPlayerIdx: 0, leadCombo: plays[0].combo, plays };
  const ai = new GreedyStrategy();
  const ctx = ai._buildCtx(state, 2), candidates = legalMoves(state, 2);
  const king = candidates.find((cs) => cs[0].rank === 'K');
  ai._r5Assignments = () => [{ hands: [state.players[0].hand, state.players[1].hand, mate], bottom: pool }];
  const estimates = ai._teamFollowEstimates(state, 2, ctx, candidates, king);
  assert.equal(estimates.find((e) => e.cards[0].rank === '10').mateWin, 1);
  assert.equal(ai._chooseTeamFollow(state, 2, ctx, candidates, king)[0].rank, '10');
});

test('前期对子接力：单墩评估遵守有对跟对且不改变真实牌局', () => {
  const config = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const pool = buildDeck(config);
  const take = (suit, rank) => pool.splice(pool.findIndex((c) => c.suit === suit && c.rank === rank), 1)[0];
  const led = [take('D', 'J'), take('D', 'J')];
  const mine = ['3', '10', 'K'].flatMap((rank) => [take('D', rank), take('D', rank)]);
  while (mine.length < 25) mine.push(pool.splice(pool.findIndex((c) => c.suit !== 'D'), 1)[0]);
  const state = makeState({ hands: [pool.splice(0, 25), pool.splice(0, 23), mine, pool.splice(0, 25)], turnIdx: 2 });
  state.config = config;
  state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  state.contractScore = 90;
  state.bottomCards = pool;
  const combo = parseCombo(led, state.trumpInfo, config);
  state.currentTrick = { leadPlayerIdx: 1, leadCombo: combo, plays: [{ playerIdx: 1, cards: led, combo }] };
  const before = structuredClone(state);
  const ai = new GreedyStrategy();
  const candidates = legalMoves(state, 2);
  const estimates = ai._teamFollowEstimates(state, 2, ai._buildCtx(state, 2), candidates, candidates[0]);
  assert.ok(estimates && estimates.length >= 2);
  assert.ok(estimates.every((e) => parseCombo(e.cards, state.trumpInfo, config).type === 'pair'));
  const pick = ai.decidePlay(state, 2);
  assert.equal(parseCombo(pick, state.trumpInfo, config).type, 'pair');
  assert.equal(validatePlay(state, 2, pick).ok, true);
  assert.deepEqual(state, before);
});

test('前期接力遵循反向playOrder：每家只模拟一次，不漏庄家或重复领出者', () => {
  const state = earlyTrick();
  state.players = [state.players[0], state.players[3], state.players[2], state.players[1]];
  state.playOrder = [0, 3, 2, 1];
  state.currentTrick.leadPlayerIdx = 3;
  state.currentTrick.plays[0].playerIdx = 3;
  const ai = new GreedyStrategy(), sequence = [];
  const apply = ai._r5Apply;
  ai._r5Apply = function (ss, seat, cards, combo) {
    sequence.push(seat);
    return apply.call(this, ss, seat, cards, combo);
  };
  const candidates = legalMoves(state, 2);
  const estimates = ai._teamFollowEstimates(state, 2, ai._buildCtx(state, 2), candidates, candidates[0]);
  assert.ok(estimates.length >= 2);
  for (let i = 0; i < sequence.length; i += 3) assert.deepEqual(sequence.slice(i, i + 3), [2, 1, 0]);
});

for (const partial of [true, false]) {
  test(`对子公开跟牌约束：${partial ? '半跟后已无该门' : '散跟时不可能暗藏可跟对子'}`, () => {
    const config = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
    const pool = buildDeck(config);
    const take = (suit, rank) => pool.splice(pool.findIndex((c) => c.suit === suit && c.rank === rank), 1)[0];
    const led = [take('D', 'J'), take('D', 'J')];
    const followed = [take('D', '4'), partial ? take('C', '6') : take('D', '6')];
    const mine = ['3', '10', 'K'].flatMap((r) => [take('D', r), take('D', r)]);
    while (mine.length < 25) mine.push(pool.splice(pool.findIndex((c) => c.suit !== 'D'), 1)[0]);
    const emptySuit = [];
    while (emptySuit.length < 23) emptySuit.push(pool.splice(pool.findIndex((c) => c.suit !== 'D'), 1)[0]);
    const state = makeState({ hands: [pool.splice(0, 23), emptySuit, mine, pool.splice(0, 25)], turnIdx: 2 });
    state.config = config;
    state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
    state.contractScore = 90;
    state.bottomCards = pool;
    const combo = parseCombo(led, state.trumpInfo, config);
    state.currentTrick = { leadPlayerIdx: 0, leadCombo: combo,
      plays: [{ playerIdx: 0, cards: led, combo }, { playerIdx: 1, cards: followed }] };
    const valid = { hands: [state.players[0].hand.slice(), emptySuit.slice(), state.players[3].hand.slice()], bottom: pool.slice() };
    const invalid = structuredClone(valid);
    // 偷放第二张D4，和刚才公开出的D4构成一对，本应优先跟对。
    const buckets = invalid.hands.concat([invalid.bottom]);
    const donor = buckets.find((hand, i) => i !== 1 && hand.some((c) => c.suit === 'D' && c.rank === '4'));
    const j = donor.findIndex((c) => c.suit === 'D' && c.rank === '4');
    [donor[j], invalid.hands[1][0]] = [invalid.hands[1][0], donor[j]];
    const ai = new GreedyStrategy();
    ai._r5Assignments = () => [invalid, valid];
    let accepted = 0;
    const sim = ai._r5SimState;
    ai._r5SimState = function (st, ctx, seat, seats, asg, bottom) {
      assert.equal(asg, valid, '违反已公开跟牌的假设不得参加胜率平均');
      accepted++;
      return sim.call(this, st, ctx, seat, seats, asg, bottom);
    };
    const candidates = legalMoves(state, 2);
    assert.ok(ai._teamFollowEstimates(state, 2, ai._buildCtx(state, 2), candidates, candidates[0]).length >= 2);
    assert.ok(accepted > 0);
  });
}

test('前期将吃：有足够压庄的中间主Q时不能跳过它改烧大王', () => {
  const config = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const pool = buildDeck(config);
  const take = (suit, rank) => pool.splice(pool.findIndex((c) => c.suit === suit && c.rank === rank), 1)[0];
  const led = take('D', '5'), dealerTrump = take('H', 'J');
  const mine = [take('H', '3'), take('H', '10'), take('H', 'Q'), take('H', 'A'), take('JOKER', 'BJ')];
  const isSmallOff = (c) => ['S', 'C'].includes(c.suit) && c.rank !== '2';
  while (mine.length < 25) mine.push(pool.splice(pool.findIndex(isSmallOff), 1)[0]);
  const dealer = [dealerTrump];
  while (dealer.length < 25) dealer.push(pool.splice(pool.findIndex(isSmallOff), 1)[0]);
  const mate = [];
  while (pool.some((c) => c.suit === 'D' && c.rank !== '2')) mate.push(pool.splice(pool.findIndex((c) => c.suit === 'D' && c.rank !== '2'), 1)[0]);
  while (mate.length < 25) mate.push(pool.shift());
  const state = makeState({ hands: [pool.splice(0, 24), mine, dealer, mate], turnIdx: 1, dealerIdx: 2 });
  state.config = config;
  state.sanDaYiTeams = { dealer: 2, attackers: [0, 1, 3] };
  state.contractScore = 90;
  state.bottomCards = pool;
  const combo = parseCombo([led], state.trumpInfo, config);
  state.currentTrick = { leadPlayerIdx: 0, leadCombo: combo, plays: [{ playerIdx: 0, cards: [led], combo }] };
  const ai = new GreedyStrategy();
  ai._r5Assignments = () => [{ hands: [state.players[0].hand, dealer, mate], bottom: pool }];
  const candidates = legalMoves(state, 1), ctx = ai._buildCtx(state, 1);
  const ten = candidates.find((cs) => cs[0].suit === 'H' && cs[0].rank === '10');
  const estimates = ai._teamFollowEstimates(state, 1, ctx, candidates, ten);
  const queen = estimates.find((e) => e.cards[0].suit === 'H' && e.cards[0].rank === 'Q');
  assert.equal(queen.teamWin, 1);
  assert.equal(ai._chooseTeamFollow(state, 1, ctx, candidates, ten)[0].rank, 'Q');
});

test('顺时针完整对局：前期接力与R3/R5模拟共用真实出牌方向，零非法、200分守恒', () => {
  const config = createConfig({ gameMode: 'san_da_yi', playDirection: 'clockwise', throwPenalty: 'penalty_smallest' });
  const ai = new GreedyStrategy();
  for (let seed = 1; seed <= 5; seed++) {
    let state = createInitialState(config, null, createRng(seed));
    for (let guard = 1; guard <= 10; guard++) {
      const result = runRoundToScoring(state, ai, createRng(seed * 13 + guard));
      assert.equal(result.illegalCount, 0);
      state = result.state;
      if (state.phase !== 'INIT_DEAL') break;
    }
    assert.equal(state.phase, 'SCORING');
    assert.deepEqual(state.playOrder, [0, 3, 2, 1]);
    assert.equal(state.lastSettle.dealerPoints + state.lastSettle.attackerPoints, 200);
  }
});
