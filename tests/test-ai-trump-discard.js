'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cards, cardsD, makeState } = require('./fixtures');
const { createConfig } = require('../miniprogram/engine/config');
const { parseCombo } = require('../miniprogram/engine/combo');
const { legalMoves, validatePlay } = require('../miniprogram/engine/validate');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');

function trumpThrow(hand, lead = cardsD('BJ', 'RJ'), overrides = {}) {
  const state = makeState({ hands: [cards('D3'), hand, cards('C3'), cards('S3')], turnIdx: 1 });
  state.config = createConfig({ gameMode: 'san_da_yi', ...overrides });
  state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  state.contractScore = 90;
  const combo = parseCombo(lead, state.trumpInfo, state.config);
  state.currentTrick = { leadPlayerIdx: 0, leadCombo: combo,
    plays: [{ playerIdx: 0, cards: lead, combo }] };
  return state;
}

function ids(hand) {
  return hand.map((c) => c.id).sort();
}

function assertDiscard(state, expected) {
  const before = structuredClone(state);
  const candidates = legalMoves(state, 1);
  assert.ok(candidates.some((move) => JSON.stringify(ids(move)) === JSON.stringify(ids(expected))),
    '合法候选必须包含满足跟对要求的小主牌组合');
  const pick = new GreedyStrategy().decidePlay(state, 1);
  assert.deepEqual(ids(pick), ids(expected));
  assert.equal(validatePlay(state, 1, pick).ok, true);
  assert.deepEqual(state, before, '枚举和决策不能修改真实牌局');
}

test('跟四个王：小散主挡在前面时，仍应跟两副小对子，保留主2和副2', () => {
  const smallPairs = cardsD('H8', 'H9');
  const hand = [...cards('H3', 'H4', 'H6', 'H7'), ...smallPairs, ...cardsD('S2', 'H2')];
  assertDiscard(trumpThrow(hand), smallPairs);
});

test('跟四个王：小对子不足两副时，只补最小的副2对子，保留主2', () => {
  const expected = cardsD('H8', 'S2');
  const hand = [...cards('H3', 'H4', 'H6', 'H7'), ...expected, ...cardsD('H2')];
  assertDiscard(trumpThrow(hand), expected);
});

test('跟四个王：只有一副2对子时必须跟出，但另外两张应垫最小散主', () => {
  const pair = cardsD('S2');
  const hand = [...cards('H3', 'H4', 'H6', 'H7'), ...pair];
  assertDiscard(trumpThrow(hand), [...pair, ...cards('H3', 'H4')]);
});

test('跟四个王：没有对子时垫最小四张散主，保留2', () => {
  const small = cards('H3', 'H4', 'H6', 'H7');
  assertDiscard(trumpThrow([...small, ...cards('S2', 'H2')]), small);
});

test('跟主牌对加两单：只跟规则要求的一副小对子，其余垫小散主', () => {
  const pair = cardsD('H8');
  const hand = [...cards('H3', 'H4', 'H6', 'H7'), ...pair, ...cardsD('S2', 'C2')];
  const lead = [...cardsD('BJ'), ...cards('RJ', 'H2')];
  assertDiscard(trumpThrow(hand, lead), [...pair, ...cards('H3', 'H4')]);
});

test('关闭有对必跟对时，跟四个王可直接垫小散主，保留2对子', () => {
  const small = cards('H3', 'H4', 'H6', 'H7');
  const state = trumpThrow([...small, ...cardsD('S2', 'H2')], cardsD('BJ', 'RJ'),
    { mustFollowPairAsPair: false });
  assertDiscard(state, small);
});
