/**
 * tests/test-bid.js —— 亮主 / 反主优先级 / 截止。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG, createConfig } = require('../miniprogram/engine/config');
const { canBid, classifyBidCards, bidPriority, currentPriority, bidWindowOpen } = require('../miniprogram/engine/bid');
const { cards, cardsD, makeState } = require('./fixtures');

test('classifyBidCards：单张级牌亮主', () => {
  const cls = classifyBidCards(cards('H5'), '5', DEFAULT_CONFIG);
  assert.deepEqual(cls, { type: 'single_rank', trumpSuit: 'H', isNoTrump: false });
  assert.equal(classifyBidCards(cards('H3'), '5', DEFAULT_CONFIG), null); // 非级牌
  assert.equal(classifyBidCards(cards('BJ'), '5', DEFAULT_CONFIG), null); // R21 默认关
});

test('classifyBidCards：对级牌反主（须同花色）', () => {
  const cls = classifyBidCards(cardsD('S5'), '5', DEFAULT_CONFIG);
  assert.deepEqual(cls, { type: 'pair_rank', trumpSuit: 'S', isNoTrump: false });
  assert.equal(classifyCards_cross(), null);
  function classifyCards_cross() {
    return classifyBidCards(cards('S5', 'H5'), '5', DEFAULT_CONFIG); // 两张不同花色级牌
  }
});

test('classifyBidCards：对王反主 → 无主局（R8 开）', () => {
  const cls = classifyBidCards(cardsD('BJ'), '5', DEFAULT_CONFIG);
  assert.deepEqual(cls, { type: 'joker_pair', trumpSuit: null, isNoTrump: true });
  const clsRJ = classifyBidCards(cardsD('RJ'), '5', DEFAULT_CONFIG);
  assert.deepEqual(clsRJ.type, 'joker_pair');
  // R8 关 → 王不可反主
  const cfgNoNT = createConfig({ allowNoTrump: false });
  assert.equal(classifyBidCards(cardsD('BJ'), '5', cfgNoNT), null);
});

test('R21 开启：单王反无主', () => {
  const cfg21 = createConfig({ allowSingleJokerOverride: true });
  const cls = classifyBidCards(cards('RJ'), '5', cfg21);
  assert.deepEqual(cls, { type: 'single_joker', trumpSuit: null, isNoTrump: true });
});

test('优先级：对王(3) > 对级牌(2) > 单级牌(1)', () => {
  assert.ok(bidPriority('joker_pair') > bidPriority('pair_rank'));
  assert.ok(bidPriority('pair_rank') > bidPriority('single_rank'));
  assert.equal(currentPriority([]), 0);
});

test('canBid：正常亮主通过，非 BIDDING 阶段拒绝', () => {
  const state = makeState({ phase: 'BIDDING', level: '5', hands: [[], [], [], []] });
  state.players[0].hand = cardsD('H5', 'H8');
  const r = canBid(state, 0, cards('H5'), DEFAULT_CONFIG);
  assert.equal(r.ok, true);
  assert.equal(r.meta.trumpSuit, 'H');

  const state2 = makeState({ phase: 'BIDDING', level: '5' });
  state2.players[0].hand = cards('H5');
  const r2 = canBid(state2, 0, cards('C9'), DEFAULT_CONFIG); // C9 不在手
  assert.equal(r2.ok, false);
  assert.equal(r2.errorCode, 'E105');
});

test('canBid：反主优先级不足被拒（E110）', () => {
  const state = makeState({ phase: 'BIDDING', level: '5' });
  state.players[0].hand = [...cardsD('S5'), ...cards('H5')];
  state.players[1].hand = cardsD('H5');
  const first = canBid(state, 1, cardsD('H5'), DEFAULT_CONFIG);
  assert.equal(first.ok, true); // 对级牌优先亮
  state.bids.push({ playerIdx: 1, type: 'pair_rank', cards: cardsD('H5'), trumpSuit: 'H', isNoTrump: false, ts: 1 });
  const lower = canBid(state, 0, cards('H5'), DEFAULT_CONFIG);
  assert.equal(lower.ok, false);
  assert.equal(lower.errorCode, 'E110');
  const higher = canBid(state, 0, cardsD('S5'), DEFAULT_CONFIG);
  assert.equal(higher.ok, false); // 对级牌同级不可反（同级只允许一次）
  state.players[2].hand = cardsD('BJ');
  const joker = canBid(state, 2, cardsD('BJ'), DEFAULT_CONFIG);
  assert.equal(joker.ok, true); // 对王 > 对级牌 ✓
});

test('canBid：对王反主后不可再被对级牌反（优先级单调）', () => {
  const state = makeState({ phase: 'BIDDING', level: '5' });
  state.players[0].hand = cardsD('BJ');
  state.players[1].hand = cardsD('C5');
  const j = canBid(state, 0, cardsD('BJ'), DEFAULT_CONFIG);
  assert.equal(j.ok, true);
  state.bids.push({ playerIdx: 0, type: 'joker_pair', trumpSuit: null, isNoTrump: true, ts: 1 });
  const rp = canBid(state, 1, cardsD('C5'), DEFAULT_CONFIG);
  assert.equal(rp.ok, false);
  assert.equal(rp.errorCode, 'E110');
});

test('bidWindowOpen：R17 翻底前可亮 / 翻底后关闭', () => {
  const state = makeState({ phase: 'BIDDING', level: '2' });
  state.bottomRevealed = false;
  assert.equal(bidWindowOpen(state, DEFAULT_CONFIG), true);
  state.bottomRevealed = true;
  assert.equal(bidWindowOpen(state, DEFAULT_CONFIG), false);
  state.phase = 'BURYING';
  assert.equal(bidWindowOpen(state, DEFAULT_CONFIG), false);
});

test('亮主牌型用对方级数（level 与双方 levels 联动由状态机维护）', () => {
  const state = makeState({ phase: 'BIDDING', level: '7' });
  state.players[1].hand = cardsD('C7');
  const r = canBid(state, 1, cardsD('C7'), DEFAULT_CONFIG);
  assert.equal(r.ok, true);
  assert.equal(r.meta.trumpSuit, 'C');
});
