'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cards, cardsD, makeState } = require('./fixtures');
const { createConfig } = require('../miniprogram/engine/config');
const { buildDeck } = require('../miniprogram/engine/deck');
const { parseCombo, domainOf } = require('../miniprogram/engine/combo');
const { legalMoves, validatePlay } = require('../miniprogram/engine/validate');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { settleRound } = require('../miniprogram/engine/settle');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');

function position(hand, plays = [[0, cards('HA')]], viewer = 3) {
  const hands = [[], [], [], []];
  hands[viewer] = hand;
  const state = makeState({ hands, turnIdx: viewer });
  state.config = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  state.contractScore = 90;
  const records = plays.map(([playerIdx, cs]) => ({ playerIdx, cards: cs,
    combo: parseCombo(cs, state.trumpInfo, state.config) }));
  state.currentTrick = { leadPlayerIdx: records[0].playerIdx,
    leadCombo: records[0].combo, plays: records };
  return state;
}

function choose(state, viewer = 3) {
  const before = structuredClone(state);
  const pick = new GreedyStrategy().decidePlay(state, viewer);
  assert.equal(validatePlay(state, viewer, pick).ok, true);
  assert.deepEqual(state, before, '保对评估不得改动真实牌局');
  return pick;
}

for (const rank of ['3', '8', 'Q', 'A']) {
  test(`闲家垫单：${rank}${rank}也有结构价值，有散牌就不随便拆对`, () => {
    const state = position(cardsD(`S${rank}`).concat(cards('CJ', 'D9')));
    assert.notEqual(choose(state)[0].suit, 'S');
  });
}

test('同门跟单也保对：跟不过A时优先出J，留下33', () => {
  const state = position(cardsD('S3').concat(cards('SJ', 'C6')), [[0, cards('SA')]]);
  assert.equal(choose(state)[0].rank, 'J');
});

test('整对也不能当废牌垫掉：散牌在原枚举前8张之外仍应保留候选', () => {
  const state = position(cardsD('S3', 'S4', 'S6', 'S7').concat(cards('CJ', 'DQ')),
    [[0, cardsD('HA')]]);
  const singles = legalMoves(state, 3).find((cs) => cs.every((c) => ['CJ', 'DQ'].includes(c.suit + c.rank)));
  assert.ok(singles, '必须枚举垫两张散牌的合法选项');
  assert.deepEqual(choose(state).map((c) => c.suit + c.rank).sort(), ['CJ', 'DQ']);
});

test('半跟对子：仅有一张领出花色时，补散牌而不是拆其他门的对子', () => {
  const state = position(cards('D4', 'CJ').concat(cardsD('S3')), [[0, cardsD('DA')]]);
  assert.deepEqual(choose(state).map((c) => c.suit + c.rank).sort(), ['CJ', 'D4']);
});

test('锁墩喂分：同为10分时先跑散K，保留1010', () => {
  const state = position(cardsD('S10').concat(cards('CK', 'D4')),
    [[0, cards('H3')], [1, cards('BJ')], [2, cards('H4')]]);
  const pick = choose(state);
  assert.equal(pick[0].suit + pick[0].rank, 'CK');
});

test('保对不是禁跑分：锁墩且没有其他分牌时仍可拆55安全跑分', () => {
  const state = position(cardsD('S5').concat(cards('CJ', 'D9')),
    [[0, cards('H3')], [1, cards('BJ')], [2, cards('H4')]]);
  assert.equal(choose(state)[0].rank, '5');
});

test('必须跟牌优先：同门只有33时仍须拆一张跟单', () => {
  const state = position(cardsD('S3').concat(cards('CJ', 'D9')), [[0, cards('SA')]]);
  assert.equal(choose(state)[0].suit + choose(state)[0].rank, 'S3');
});

test('对子用于夺墩：庄家77领出时用88压庄，不能因为保对拒绝赢牌', () => {
  const state = position(cardsD('S8').concat(cards('SJ', 'C6')), [[0, cardsD('S7')]]);
  assert.ok(choose(state).every((c) => c.suit + c.rank === 'S8'));
});

// 记牌夹具：每个指定牌键公开一张；较大的单张仍未见，却已经不能成对。
function exposeOneOfEach(state, include) {
  const usedIds = new Set(state.players[3].hand.concat(
    (state.currentTrick ? state.currentTrick.plays : []).flatMap((p) => p.cards),
    state.completedTricks.flatMap((t) => t.plays.flatMap((p) => p.cards))).map((c) => c.id));
  const seen = new Set();
  for (const c of buildDeck(state.config)) {
    const key = c.suit + c.rank;
    if (usedIds.has(c.id) || seen.has(key) || !include(c)) continue;
    seen.add(key);
    const combo = parseCombo([c], state.trumpInfo, state.config);
    state.completedTricks.push({ leadPlayerIdx: 0, leadCombo: combo,
      plays: [{ playerIdx: 0, cards: [c], combo }], winnerIdx: 0, points: combo.points });
  }
}

test('对子看成对威胁：更大副牌和主牌都只剩单张时，33也值得留到后续走墩', () => {
  const state = position(cardsD('S3').concat(cards('CA')));
  state.currentTrick = null;
  exposeOneOfEach(state, (c) => c.suit === 'S' || domainOf(c, state.trumpInfo) === 'TRUMP');
  const pick = choose(state);
  assert.equal(parseCombo(pick, state.trumpInfo, state.config).type, 'pair');
  assert.ok(pick.every((c) => c.suit + c.rank === 'S3'));
});

test('庄家已示缺门不等于对子死牌：没有未见主对时仍保护副牌对', () => {
  const state = position(cardsD('S3').concat(cards('CA')));
  exposeOneOfEach(state, (c) => domainOf(c, state.trumpInfo) === 'TRUMP');
  state.completedTricks.push({ leadPlayerIdx: 1,
    leadCombo: parseCombo(cards('SJ'), state.trumpInfo, state.config),
    plays: [{ playerIdx: 1, cards: cards('SJ') }, { playerIdx: 0, cards: cards('H9') }],
    winnerIdx: 0, points: 0 });
  assert.equal(choose(state)[0].suit + choose(state)[0].rank, 'CA');
});

test('庄家在主对墩散跟已经证明无主对，无须等所有未知主牌逐张出现', () => {
  const state = position(cardsD('S3').concat(cards('CA')));
  const led = cardsD('H4');
  state.completedTricks.push({ leadPlayerIdx: 1,
    leadCombo: parseCombo(led, state.trumpInfo, state.config),
    plays: [{ playerIdx: 1, cards: led }, { playerIdx: 0, cards: cards('H6', 'H7') }],
    winnerIdx: 1, points: 0 });
  assert.equal(choose(state)[0].suit + choose(state)[0].rank, 'CA');
});

test('可自由拆对跟牌的配置下，庄家散跟主对不能当作无主对的证据', () => {
  const state = position(cardsD('S3').concat(cards('CA')));
  state.config = createConfig({ gameMode: 'san_da_yi', mustFollowPairAsPair: false });
  const led = cardsD('H4');
  state.completedTricks.push({ leadPlayerIdx: 1,
    leadCombo: parseCombo(led, state.trumpInfo, state.config),
    plays: [{ playerIdx: 1, cards: led }, { playerIdx: 0, cards: cards('H6', 'H7') }],
    winnerIdx: 1, points: 0 });
  const ctx = new GreedyStrategy()._buildCtx(state, 3);
  assert.ok(ctx.sdy.trumpPairThreats > 0);
});

test('保对只依赖公开信息和自己手牌，不读取庄家、队友手牌或底牌', () => {
  const state = position(cardsD('S3').concat(cards('CJ', 'D9')));
  const expected = new GreedyStrategy().decidePlay(state, 3);
  for (const seat of [0, 1, 2]) {
    Object.defineProperty(state.players[seat], 'hand', { get() { throw new Error('读取隐藏手牌'); } });
  }
  Object.defineProperty(state, 'bottomCards', { get() { throw new Error('读取隐藏底牌'); } });
  assert.deepEqual(new GreedyStrategy().decidePlay(state, 3), expected);
});

test('前期接力不能因同样能跑分而拆对子替代散K', () => {
  const state = position(cardsD('S10').concat(cards('CK', 'D4')), [[0, cards('H3')]], 1);
  // 前期25张的接力门，采样结果在此固定：两个分牌都100%由后位队友接住。
  const used = new Set(state.players[1].hand.map((c) => c.suit + c.rank));
  for (const c of buildDeck(state.config)) {
    if (state.players[1].hand.length === 25) break;
    if (domainOf(c, state.trumpInfo) === 'TRUMP' || used.has(c.suit + c.rank)) continue;
    state.players[1].hand.push(c);
    used.add(c.suit + c.rank);
  }
  const ai = new GreedyStrategy();
  const ctx = ai._buildCtx(state, 1), candidates = legalMoves(state, 1);
  const king = candidates.find((cs) => cs[0].rank === 'K');
  const ten = candidates.find((cs) => cs[0].rank === '10');
  ai._teamFollowEstimates = () => [king, ten].map((cs) => ({ cards: cs, teamWin: 1, mateWin: 1, signedPoints: 10 }));
  assert.equal(ai._chooseTeamFollow(state, 1, ctx, candidates, king), null);
});

test('前期单墩采样比较集保留垫9留33，而不只比较拆3与跑10', () => {
  const state = position(cardsD('D3').concat(cards('D9', 'D10')), [[0, cards('DA')]], 1);
  const used = new Set(state.players[1].hand.concat(state.currentTrick.plays[0].cards).map((c) => c.id));
  const pool = buildDeck(state.config).filter((c) => !used.has(c.id));
  while (state.players[1].hand.length < 25) {
    state.players[1].hand.push(pool.splice(pool.findIndex((c) => domainOf(c, state.trumpInfo) !== 'D'), 1)[0]);
  }
  state.players[0].hand = pool.splice(0, 24);
  state.players[2].hand = pool.splice(0, 25);
  state.players[3].hand = pool.splice(0, 25);
  state.bottomCards = pool;
  const ai = new GreedyStrategy();
  const candidates = legalMoves(state, 1), ctx = ai._buildCtx(state, 1);
  const ten = candidates.find((cs) => cs[0].suit + cs[0].rank === 'D10');
  const before = structuredClone(state);
  const estimates = ai._teamFollowEstimates(state, 1, ctx, candidates, ten);
  assert.ok(estimates.some((e) => e.cards[0].suit + e.cards[0].rank === 'D9'));
  assert.deepEqual(state, before);
});

test('副牌小对可以扣底：庄家剩两张大主散牌，33走末墩并收队友垫分和底分', () => {
  const state = position(cardsD('S3'));
  state.currentTrick = null;
  const pick = choose(state);
  const trick = { leadPlayerIdx: 3, leadCombo: parseCombo(pick, state.trumpInfo, state.config),
    plays: [[3, pick], [0, cards('HA', 'HK')], [1, cards('D10', 'DK')], [2, cards('C5', 'C10')]]
      .map(([playerIdx, cs]) => ({ playerIdx, cards: cs, combo: parseCombo(cs, state.trumpInfo, state.config) })) };
  resolveTrick(trick, state.trumpInfo, state.config);
  assert.equal(trick.winnerIdx, 3, '大主散张不能毙副牌对子');
  assert.equal(trick.points, 45);
  state.completedTricks = [trick];
  state.bottomCards = cards('S10', 'SK', 'D5');
  const result = settleRound(state);
  assert.equal(result.bottomGained, 0);
  assert.equal(result.bottomMultiplierUsed, 1);
  assert.equal(result.attackerPoints, 70, '队友垫分45 + 底分25，不按对子翻倍');
});
