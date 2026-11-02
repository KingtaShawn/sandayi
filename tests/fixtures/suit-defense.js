'use strict';
const assert = require('node:assert/strict');
const { createConfig } = require('../../miniprogram/engine/config');
const { buildDeck } = require('../../miniprogram/engine/deck');
const { domainOf, parseCombo, strengthInDomain } = require('../../miniprogram/engine/combo');
const { resolveTrick } = require('../../miniprogram/engine/trick');
const { createInitialState } = require('../../miniprogram/core/state');

/** 108张完整、合法历史：三家已公开无主，庄家还留六张顶主及副牌A/K/8。 */
function sweepPosition(direction = 'counterclockwise', crowded = false) {
  const cfg = createConfig({ gameMode: 'san_da_yi', playDirection: direction, throwPenalty: 'penalty_smallest' });
  const state = createInitialState(cfg), pool = buildDeck(cfg);
  const { buildTrumpInfo } = require('../../miniprogram/engine/trump');
  state.trumpInfo = buildTrumpInfo('H', '2', cfg);
  const order = state.playOrder, attackers = order.slice(1);
  const take = (name) => {
    const i = pool.findIndex((c) => c.suit + c.rank === name);
    assert.ok(i >= 0, name); return pool.splice(i, 1)[0];
  };
  const human = ['JOKERBJ', 'JOKERBJ', 'JOKERRJ', 'JOKERRJ', 'H2', 'H2', 'SA', 'SK', 'S8'].map(take);
  const led = take('H3');
  const specs = crowded ? [
    ['SA', 'SQ', 'SJ', 'S9', 'S7', 'S4', 'CA', 'C3', 'DA', 'D3'],
    ['SK', 'SQ', 'SJ', 'S9', 'S7', 'CA', 'CQ', 'CJ', 'C4', 'D4'],
    ['S6', 'S6', 'S5', 'S5', 'S4', 'DA', 'DQ', 'DJ', 'D4', 'C5']
  ] : [
    ['SA', 'SQ', 'SJ', 'S9', 'S7', 'S4', 'CA', 'DA', 'C3', 'D3'],
    ['CA', 'CQ', 'CJ', 'C9', 'C7', 'C4', 'SK', 'DK', 'S3', 'D4'],
    ['DA', 'DQ', 'DJ', 'D9', 'D7', 'D4', 'CK', 'SQ', 'S4', 'C3']
  ];
  state.players[0].hand = human;
  attackers.forEach((seat, i) => { state.players[seat].hand = specs[i].map(take); });
  const trumps = pool.filter((c) => domainOf(c, state.trumpInfo) === 'TRUMP')
    .sort((a, b) => strengthInDomain(b, state.trumpInfo) - strengthInDomain(a, state.trumpInfo));
  assert.equal(trumps.length, 29);
  const remove = (c) => pool.splice(pool.findIndex((p) => p.id === c.id), 1)[0];
  const record = (cards) => {
    const plays = order.map((playerIdx, i) => ({ playerIdx, cards: [cards[i]],
      combo: parseCombo([cards[i]], state.trumpInfo, cfg) }));
    const trick = { leadPlayerIdx: 0, leadCombo: plays[0].combo, plays };
    resolveTrick(trick, state.trumpInfo, cfg); assert.equal(trick.winnerIdx, 0);
    state.completedTricks.push(trick);
  };
  for (let round = 0; round < 8; round++) {
    const cards = [remove(trumps.shift())];
    for (let i = 0; i < 3; i++) cards.push(trumps.length > 1 || round < 6
      ? remove(trumps.pop()) : pool.splice(pool.findIndex((c) => domainOf(c, state.trumpInfo) !== 'TRUMP'), 1)[0]);
    record(cards);
  }
  assert.equal(trumps.length, 0);
  // 剩余副牌按4张同门分成七墩；取模选底，保证每次跟单都能合法跟同门。
  const bottom = [];
  for (const suit of ['S', 'C', 'D']) {
    const n = pool.filter((c) => c.suit === suit).length % 4;
    for (let i = 0; i < n; i++) bottom.push(pool.splice(pool.findIndex((c) => c.suit === suit), 1)[0]);
  }
  while (bottom.length < 8) {
    const suit = ['S', 'C', 'D'].find((s) => pool.filter((c) => c.suit === s).length >= 4);
    for (let i = 0; i < 4; i++) bottom.push(pool.splice(pool.findIndex((c) => c.suit === suit), 1)[0]);
  }
  for (const suit of ['S', 'C', 'D']) while (pool.some((c) => c.suit === suit)) {
    const cards = [];
    for (let i = 0; i < 4; i++) cards.push(pool.splice(pool.findIndex((c) => c.suit === suit), 1)[0]);
    cards.sort((a, b) => strengthInDomain(b, state.trumpInfo) - strengthInDomain(a, state.trumpInfo));
    record(cards);
  }
  assert.equal(state.completedTricks.length, 15);
  state.phase = 'PLAYING'; state.turnIdx = attackers[0]; state.dealerIdx = 0;
  state.sanDaYiTeams = { dealer: 0, attackers }; state.contractScore = 90;
  state.buryDone = true; state.bottomMerged = true; state.bottomCards = bottom;
  const combo = parseCombo([led], state.trumpInfo, cfg);
  state.currentTrick = { leadPlayerIdx: 0, leadCombo: combo, plays: [{ playerIdx: 0, cards: [led], combo }] };
  const all = state.players.flatMap((p) => p.hand).concat(bottom, [led],
    state.completedTricks.flatMap((t) => t.plays.flatMap((p) => p.cards)));
  assert.equal(all.length, 108); assert.equal(new Set(all.map((c) => c.id)).size, 108);
  return state;
}

module.exports = { sweepPosition };
