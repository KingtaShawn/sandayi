/**
 * tests/test-trump.js —— 主牌判定 / 主牌大小序 / 无主局。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../miniprogram/engine/config');
const { buildTrumpInfo, trumpStrength, trumpStep } = require('../miniprogram/engine/trump');
const { isTrump } = require('../miniprogram/engine/card');
const { cards } = require('./fixtures');

test('有主局（♥主打2）：主牌 36 张 = 王4 + 级牌8 + 主花色24', () => {
  const ti = buildTrumpInfo('H', '2', DEFAULT_CONFIG);
  // trumpIds 存域键：JOKER×2键 + 4门级牌键 + 主花色其余12键 = 18 键 → 36 张
  assert.equal(ti.trumpIds.size, 18);
  assert.equal(ti.isNoTrump, false);
  assert.equal(ti.trumpSuit, 'H');
  assert.equal(ti.levelRank, '2');
});

test('无主局（R8）：主牌仅 12 张 = 王4 + 级牌8', () => {
  const ti = buildTrumpInfo(null, '5', DEFAULT_CONFIG);
  assert.equal(ti.isNoTrump, true);
  assert.equal(ti.trumpSuit, null);
  assert.equal(ti.trumpIds.size, 6); // BJ/RJ + 4 门级牌键
});

test('主牌大小序：大王>小王>主级牌>副级牌>主A>…>主3', () => {
  const ti = buildTrumpInfo('H', '2', DEFAULT_CONFIG);
  const [bj, rj, hx, sx, ha, hk, h3] = cards('BJ', 'RJ', 'H2', 'S2', 'HA', 'HK', 'H3');
  assert.ok(trumpStrength(bj, ti) > trumpStrength(rj, ti));
  assert.ok(trumpStrength(rj, ti) > trumpStrength(hx, ti));
  assert.ok(trumpStrength(hx, ti) > trumpStrength(sx, ti)); // 主级牌 > 副级牌
  assert.ok(trumpStrength(sx, ti) === trumpStrength(cards('D2')[0], ti)); // 副级牌同级（R13 tie）
  assert.ok(trumpStrength(sx, ti) > trumpStrength(ha, ti)); // 副级牌 > 主A
  assert.ok(trumpStrength(ha, ti) > trumpStrength(hk, ti));
  assert.ok(trumpStrength(hk, ti) > trumpStrength(h3, ti));
});

test('副级牌不比大小：三门同级（step 相同）', () => {
  const ti = buildTrumpInfo('H', '2', DEFAULT_CONFIG);
  const [s2, c2, d2] = cards('S2', 'C2', 'D2');
  assert.equal(trumpStep(s2, ti), trumpStep(c2, ti));
  assert.equal(trumpStep(c2, ti), trumpStep(d2, ti));
  assert.equal(trumpStep(s2, ti), ti.offRankStep);
});

test('isTrump 判定：级牌/王/主花色为主，副牌花色非主', () => {
  const ti = buildTrumpInfo('S', '5', DEFAULT_CONFIG);
  const [s5, h5, bj, rj, sA, hA, s3] = cards('S5', 'H5', 'BJ', 'RJ', 'SA', 'HA', 'S3');
  assert.equal(isTrump(s5, ti), true); // 主花色级牌
  assert.equal(isTrump(h5, ti), true); // 副级牌也是主
  assert.equal(isTrump(bj, ti), true);
  assert.equal(isTrump(rj, ti), true);
  assert.equal(isTrump(sA, ti), true); // 主花色
  assert.equal(isTrump(s3, ti), true);
  assert.equal(isTrump(hA, ti), false); // 副牌
});

test('打A时主花色序：主A在级牌之下（副级牌>主A）', () => {
  const ti = buildTrumpInfo('D', 'A', DEFAULT_CONFIG);
  const [dA, sA, dK] = cards('DA', 'SA', 'DK');
  // 打A：DA 是主花色级牌(980)，SA 是副级牌(970)？——打A时副A即副级牌
  assert.ok(trumpStrength(dA, ti) > trumpStrength(sA, ti));
  assert.ok(trumpStrength(sA, ti) > trumpStrength(dK, ti));
});

test('主牌 step 单调：王 < 主X < 副X < 主A（step 递增）', () => {
  const ti = buildTrumpInfo('C', '3', DEFAULT_CONFIG);
  const [bj, rj, c3, s3, cA, cK] = cards('BJ', 'RJ', 'C3', 'S3', 'CA', 'CK');
  assert.ok(trumpStep(bj, ti) < trumpStep(rj, ti));
  assert.ok(trumpStep(rj, ti) < trumpStep(c3, ti));
  assert.ok(trumpStep(c3, ti) < trumpStep(s3, ti));
  assert.ok(trumpStep(s3, ti) < trumpStep(cA, ti));
  assert.ok(trumpStep(cA, ti) < trumpStep(cK, ti));
});

test('TrumpInfo 是纯函数：相同入参重建等价（序列化恢复依据）', () => {
  const a = buildTrumpInfo('H', '2', DEFAULT_CONFIG);
  const b = buildTrumpInfo('H', '2', DEFAULT_CONFIG);
  assert.deepEqual([...a.trumpIds], [...b.trumpIds]);
  assert.deepEqual(a.order, b.order);
});
