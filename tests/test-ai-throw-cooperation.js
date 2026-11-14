'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeState, cards } = require('./fixtures');
const { createConfig } = require('../miniprogram/engine/config');
const { buildDeck } = require('../miniprogram/engine/deck');
const { parseCombo, domainOf } = require('../miniprogram/engine/combo');
const { validatePlay, legalMoves } = require('../miniprogram/engine/validate');
const { validateThrow } = require('../miniprogram/engine/throw');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { buildThrowCooperation } = require('../miniprogram/ai/throw-cooperation');

// 全副108张守恒，庄家本墩已经将吃方块，末家有方块A与小牌可选。
function position({ points = false, long = false, ruff = true, pair = false } = {}) {
  const config = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const pool = buildDeck(config);
  function take(suit, rank) {
    const i = pool.findIndex((c) => c.suit === suit && c.rank === rank);
    assert.ok(i >= 0); return pool.splice(i, 1)[0];
  }
  const plays = [{ playerIdx: 1, cards: [take('D', 'Q')] },
    { playerIdx: 2, cards: [take('D', '6')] },
    { playerIdx: 0, cards: [take(ruff ? 'H' : 'C', '3')] }];
  const mine = [take('D', points ? 'K' : 'A'), take('D', '4')];
  if (pair) {
    for (const p of plays) p.cards.push(take(p.cards[0].suit, p.cards[0].rank));
    mine.push(take('D', points ? 'K' : 'A'), take('D', '4'));
  }
  if (long) for (const rank of ['J', 'Q', '9', '8']) mine.push(take('D', rank));
  while (mine.length < 25) mine.push(pool.splice(pool.findIndex((c) => c.suit !== 'D'), 1)[0]);
  const dealer = [];
  const remaining = pair ? 23 : 24;
  while (dealer.length < remaining) dealer.push(pool.splice(pool.findIndex((c) => c.suit !== 'D' || c.rank === '2'), 1)[0]);
  const hands = [dealer, pool.splice(0, remaining), pool.splice(0, remaining), mine];
  const state = makeState({ hands, turnIdx: 3 });
  state.config = config; state.bottomCards = pool; state.contractScore = 90;
  state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  plays.forEach((p) => { p.combo = parseCombo(p.cards, state.trumpInfo, config); });
  state.currentTrick = { leadPlayerIdx: 1, leadCombo: plays[0].combo, plays };
  return state;
}

test('庄家已毙住白墩，短门闲家清A而非继续留A挡队友甩牌', () => {
  const st = position(), before = structuredClone(st), ai = new GreedyStrategy();
  const ctx = ai._buildCtx(st, 3);
  assert.ok(ctx.knowledge.consistent && ctx.throwCooperation.has('D'));
  const pick = ai.decidePlay(st, 3);
  assert.equal(pick[0].rank, 'A');
  assert.equal(validatePlay(st, 3, pick).ok, true);
  assert.deepEqual(st, before);
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../h5/js/game-bundle.js'), 'utf8'), browser);
  const browserPick = new browser.window.GameCore.GameService().ai.decidePlay(st, 3);
  assert.deepEqual(Array.from(browserPick, (c) => c.id), pick.map((c) => c.id));
});

test('清掉同伴的A后，长门KQJ从甩牌失败变成合法甩牌', () => {
  const st = makeState({ hands: [cards('H3'), cards('DK', 'DQ', 'DJ'), cards('D8'), cards('DA', 'D4')] });
  const combo = parseCombo(st.players[1].hand, st.trumpInfo, st.config);
  assert.equal(combo.type, 'throw');
  assert.equal(validateThrow(st, combo, 1, st.config).ok, false);
  st.players[3].hand = cards('D4');
  assert.equal(validateThrow(st, combo, 1, st.config).ok, true);
});

test('庄家已毙住时不为清K额外送10分', () => {
  const st = position({ points: true });
  const pick = new GreedyStrategy().decidePlay(st, 3);
  assert.equal(pick[0].rank, '4');
});

test('庄家已毙住对子白墩，清掉整对A为更长队友让出对子甩牌空间', () => {
  const st = position({ pair: true }), ai = new GreedyStrategy();
  assert.ok(ai._buildCtx(st, 3).throwCooperation.has('D'));
  const pick = ai.decidePlay(st, 3);
  assert.equal(pick.length, 2);
  assert.ok(pick.every((c) => c.rank === 'A'));
  assert.equal(validatePlay(st, 3, pick).ok, true);
});

test('清大对也不能给已将吃的庄家多送20分', () => {
  const st = position({ pair: true, points: true });
  const pick = new GreedyStrategy().decidePlay(st, 3);
  assert.ok(pick.every((c) => c.rank === '4'));
});

test('本家方块长门保留结构，不承担短门清障角色', () => {
  const st = position({ long: true }), ai = new GreedyStrategy();
  assert.equal(ai._buildCtx(st, 3).throwCooperation.has('D'), false);
});

test('未公开绝门不启动；公开估计不一致也不启动', () => {
  const st = position(), ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 3);
  ctx.sdy.voids.dealer.clear();
  assert.equal(buildThrowCooperation(st, 3, ctx).size, 0);
  ctx.sdy.voids.dealer.add('D'); ctx.knowledge.consistent = false;
  assert.equal(buildThrowCooperation(st, 3, ctx).size, 0);
});

test('清障不读取庄家、队友手牌或底牌，决定可复现', () => {
  const st = position(), ai = new GreedyStrategy();
  const ctx = ai._buildCtx(st, 3), candidates = legalMoves(st, 3);
  const small = candidates.find((cs) => cs[0].rank === '4' && domainOf(cs[0], st.trumpInfo) === 'D');
  for (const seat of [0, 1, 2]) Object.defineProperty(st.players[seat], 'hand', {
    get() { throw new Error('读取了暗牌'); }
  });
  Object.defineProperty(st, 'bottomCards', { get() { throw new Error('读取了底牌'); } });
  assert.deepEqual(buildThrowCooperation(st, 3, ctx), ctx.throwCooperation);
  assert.equal(ai._chooseThrowSupport(st, 3, ctx, candidates, small)[0].rank, 'A');
  assert.equal(ai.decidePlay(st, 3)[0].rank, 'A');
});

test('队友已稳拿本墩时仍优先收分，不为清A少喂10分', () => {
  const st = position({ ruff: false }), ai = new GreedyStrategy();
  const hand = st.players[3].hand, pool = st.players[1].hand;
  const replace = hand.findIndex((c) => c.suit !== 'D');
  const ten = pool.findIndex((c) => c.suit === 'D' && c.rank === '10');
  assert.ok(ten >= 0);
  [hand[replace], pool[ten]] = [pool[ten], hand[replace]];
  const ctx = ai._buildCtx(st, 3), candidates = legalMoves(st, 3);
  const point = candidates.find((cs) => cs[0].suit === 'D' && cs[0].rank === '10');
  const pick = ai._chooseThrowSupport(st, 3, ctx, candidates, point);
  assert.equal(pick[0].rank, '10');
});
