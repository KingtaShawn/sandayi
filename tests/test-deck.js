/**
 * tests/test-deck.js —— 牌堆构建 / 洗牌确定性 / 发牌切分。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG, createConfig } = require('../miniprogram/engine/config');
const { buildDeck, shuffle, dealInitial } = require('../miniprogram/engine/deck');
const { pointValue } = require('../miniprogram/engine/card');
const { createRng } = require('../miniprogram/utils/random');

test('R1 默认双副牌共 108 张（含大小王各 2）', () => {
  const deck = buildDeck(DEFAULT_CONFIG);
  assert.equal(deck.length, 108);
  const bj = deck.filter((c) => c.rank === 'BJ');
  const rj = deck.filter((c) => c.rank === 'RJ');
  assert.equal(bj.length, 2);
  assert.equal(rj.length, 2);
});

test('deckCount=1 时 54 张', () => {
  const cfg = createConfig({ deckCount: 1, bottomCards: 6 });
  assert.equal(buildDeck(cfg).length, 54);
});

test('每张牌 id 全局唯一', () => {
  const deck = buildDeck(DEFAULT_CONFIG);
  const ids = new Set(deck.map((c) => c.id));
  assert.equal(ids.size, 108);
});

test('总分 200：8×5 + 8×10 + 8×10', () => {
  const deck = buildDeck(DEFAULT_CONFIG);
  const total = deck.reduce((s, c) => s + pointValue(c, DEFAULT_CONFIG), 0);
  assert.equal(total, 200);
});

test('R2 发牌切分：每人 25 张 + 底牌 8 张', () => {
  const deck = shuffle(buildDeck(DEFAULT_CONFIG), createRng(1));
  const { hands, bottom, perPlayer } = dealInitial(deck, DEFAULT_CONFIG);
  assert.equal(perPlayer, 25);
  hands.forEach((h) => assert.equal(h.length, 25));
  assert.equal(bottom.length, 8);
  const all = hands.flat().concat(bottom);
  assert.equal(all.length, 108);
  const ids = new Set(all.map((c) => c.id));
  assert.equal(ids.size, 108); // 无重复无遗漏
});

test('同种子洗牌结果完全一致（可复现）', () => {
  const base = buildDeck(DEFAULT_CONFIG);
  const a = shuffle(base, createRng(123));
  const b = shuffle(base, createRng(123));
  const c = shuffle(base, createRng(124));
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
  assert.notDeepEqual(a.map((x) => x.id), c.map((x) => x.id));
});

test('洗牌不改入参数组', () => {
  const base = buildDeck(DEFAULT_CONFIG);
  const before = base.map((c) => c.id).join(',');
  shuffle(base, createRng(7));
  assert.equal(base.map((c) => c.id).join(','), before);
});

test('非整除底牌张数被拒绝（config 层拦截）', () => {
  assert.throws(() => createConfig({ bottomCards: 10 }), /整除/); // 108-10=98 不整除
  assert.doesNotThrow(() => createConfig({ bottomCards: 8 }));
});
