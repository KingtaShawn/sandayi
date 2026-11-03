'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfig } = require('../miniprogram/engine/config');
const { buildDeck } = require('../miniprogram/engine/deck');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { parseCombo, domainOf, pointsOf } = require('../miniprogram/engine/combo');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { validatePlay, legalMoves } = require('../miniprogram/engine/validate');
const { createInitialState } = require('../miniprogram/core/state');
const { transition } = require('../miniprogram/core/statemachine');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { SharedAttackStrategy } = require('../miniprogram/ai/strategy-shared');
const fixture = require('./fixtures/free-void-discard-replay.json');

// seed 86005：模拟庄家白墩优先垫最短门、遇分再毙。保留第14墩之前的真实公开历史。
function replay() {
  const cfg = createConfig({ gameMode: 'san_da_yi', playDirection: fixture.direction, throwPenalty: 'penalty_smallest' });
  const st = createInitialState(cfg, null, null, { dealerIdx: fixture.dealer });
  const deck = new Map(buildDeck(cfg).map((c) => [c.id, c]));
  const take = (ids) => ids.map((id) => { const c = deck.get(id); assert.ok(c, id); deck.delete(id); return c; });
  st.phase = 'PLAYING'; st.turnIdx = fixture.turn; st.contractScore = fixture.contract;
  st.bottomMerged = true; st.buryDone = true;
  st.sanDaYiTeams = { dealer: fixture.dealer, attackers: [0, 1, 2, 3].filter((s) => s !== fixture.dealer) };
  st.trumpInfo = buildTrumpInfo(fixture.trump, fixture.level, cfg);
  st.players.forEach((p, s) => { p.hand = take(fixture.hands[s]); p.isHuman = s === fixture.dealer; });
  st.bottomCards = take(fixture.bottom);
  st.completedTricks = fixture.tricks.map((rows) => {
    const plays = rows.map(([playerIdx, ids]) => {
      const cards = take(ids); return { playerIdx, cards, combo: parseCombo(cards, st.trumpInfo, cfg) };
    });
    const t = { leadPlayerIdx: plays[0].playerIdx, leadCombo: plays[0].combo, plays };
    resolveTrick(t, st.trumpInfo, cfg); return t;
  });
  assert.equal(deck.size, 0);
  return st;
}

const names = (cards) => cards.map((c) => c.suit + c.rank);
function advance(st, cards) {
  assert.equal(validatePlay(st, st.turnIdx, cards).ok, true);
  return transition(st, { type: 'PLAY', playerIdx: st.turnIdx, cards, ts: 0 });
}
function played(st, labels) {
  return labels.reduce((s, label) => {
    const card = s.players[s.turnIdx].hand.find((c) => c.suit + c.rank === label);
    assert.ok(card, label); return advance(s, [card]);
  }, st);
}
function playTrick(st, ai, lead) {
  let next = advance(st, lead);
  while (next.currentTrick) {
    const seat = next.turnIdx;
    // 此局庄家仍有梅花时必须跟最后的♣J。
    const cards = seat === fixture.dealer ? legalMoves(next, seat)[0] : ai.decidePlay(next, seat);
    next = advance(next, cards);
  }
  return next.completedTricks.at(-1);
}

test('续红桃白墩会让庄家垫掉最后梅花J：新策略先出梅花Q，队友K收10分', () => {
  const st = replay(), ai = new SharedAttackStrategy(), before = structuredClone(st);
  const pick = ai.decidePlay(st, st.turnIdx);
  assert.deepEqual(names(pick), ['CQ']);
  const trick = playTrick(st, ai, pick);
  assert.equal(trick.winnerIdx, 1); assert.equal(trick.points, 10);
  assert.deepEqual(names(trick.plays.find((p) => p.playerIdx === fixture.dealer).cards), ['CJ']);
  assert.deepEqual(st, before);
});

test('同牌对照：续红桃后梅花K的10分会被庄家的主2拿走', () => {
  let st = played(replay(), ['H4', 'H2', 'HA', 'CJ']);
  assert.equal(st.completedTricks.at(-1).points, 0);
  assert.equal(st.players[fixture.dealer].hand.some((c) => domainOf(c, st.trumpInfo) === 'C'), false);
  st = played(st, ['CK', 'C6', 'S2', 'C8']);
  assert.equal(st.completedTricks.at(-1).winnerIdx, fixture.dealer);
  assert.equal(st.completedTricks.at(-1).points, 10);
});

test('上一轮同样打红桃小单已逼出庄家主牌时，继续保留原逼主攻法', () => {
  let st = replay();
  const hand = st.players[st.turnIdx].hand;
  const give = hand.findIndex((c) => c.suit === 'C' && c.rank === '4');
  const take = st.bottomCards.findIndex((c) => c.suit === 'H' && c.rank === '8');
  assert.ok(give >= 0 && take >= 0);
  [hand[give], st.bottomCards[take]] = [st.bottomCards[take], hand[give]];
  st = played(st, ['H4', 'C8', 'HA', 'D6', 'CJ', 'CQ', 'C9', 'C6']);
  assert.equal(st.turnIdx, fixture.turn);
  const ai = new SharedAttackStrategy(), ctx = ai._buildCtx(st, st.turnIdx), candidates = ai._legalPlays(st, st.turnIdx, ctx);
  const smallHeart = candidates.find((cs) => names(cs).join() === 'H8');
  assert.ok(smallHeart && ctx.sdy.voids.dealer.has('H') && ctx.knowledge.consistent);
  assert.equal(ai._switchAfterFreeDiscard(st, st.turnIdx, ctx, candidates, smallHeart), null);
});

test('只有不安全的分牌可换时，不因庄家垫过该门就直接领分', () => {
  const st = replay(), ai = new SharedAttackStrategy(), ctx = ai._buildCtx(st, st.turnIdx);
  const candidates = ai._legalPlays(st, st.turnIdx, ctx);
  const pick = candidates.find((cs) => names(cs).join() === 'H4');
  const point = candidates.find((cs) => names(cs).join() === 'C5');
  assert.ok(pick && point && ai._dealerCanBeat(parseCombo(point, st.trumpInfo, st.config), ctx));
  assert.equal(ai._switchAfterFreeDiscard(st, st.turnIdx, ctx, [pick, point], pick), null);
});

test('换门依赖公开线索，封住其他三家的手牌和底牌仍会先出梅花Q', () => {
  const st = replay(), ai = new GreedyStrategy(); let reads = 0;
  for (const s of [0, 1, 2, 3].filter((s) => s !== st.turnIdx)) Object.defineProperty(st.players[s], 'hand', {
    get() { reads++; throw Error('不能读暗牌'); }
  });
  Object.defineProperty(st, 'bottomCards', { get() { reads++; throw Error('不能读底牌'); } });
  assert.deepEqual(names(ai.decidePlay(st, st.turnIdx)), ['CQ']); assert.equal(reads, 0);
});

test('H5浏览器逻辑包在换门回归局中同样领梅花Q', () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../h5/js/game-bundle.js'), 'utf8'), browser);
  const st = replay(), cards = new browser.window.GameCore.GameService().ai.decidePlay(st, st.turnIdx);
  assert.deepEqual(Array.from(cards, (c) => c.suit + c.rank), ['CQ']);
});
