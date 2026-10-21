/**
 * tests/test-combo.js —— 牌型识别 / 排序 / 比较（单/对/拖/甩，主牌拖拉机特殊相邻）。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG, createConfig } = require('../miniprogram/engine/config');
const {
  parseCombo, pairAdjacent, canBeat, compareCombo, decomposeDomain, isPair
} = require('../miniprogram/engine/combo');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { cards, cardsD } = require('./fixtures');

const TI = buildTrumpInfo('H', '2', DEFAULT_CONFIG); // ♥主打2

test('单张识别', () => {
  const c = parseCombo(cards('S5'), TI);
  assert.equal(c.type, 'single');
  assert.equal(c.suit, 'S');
  assert.equal(c.isTrump, false);
  assert.equal(c.points, 5);
});

test('对子识别：两张同名同花色', () => {
  const c = parseCombo(cardsD('H10'), TI);
  assert.equal(c.type, 'pair');
  assert.equal(c.points, 20);
  const jokerPair = parseCombo(cardsD('BJ'), TI);
  assert.equal(jokerPair.type, 'pair');
  assert.equal(jokerPair.isTrump, true);
});

test('两张不同花色副级牌不是对子（是甩牌）', () => {
  const c = parseCombo(cards('S2', 'C2'), TI);
  assert.equal(c.type, 'throw'); // 跨牌面但同域（都是主），非对 → 甩两单
  assert.equal(c.units.filter((u) => u.type === 'single').length, 2);
});

test('副牌拖拉机：♠55+♠66', () => {
  const c = parseCombo(cardsD('S5', 'S6'), TI);
  assert.equal(c.type, 'tractor');
  assert.equal(c.units[0].cards.length, 4);
});

test('副牌拖拉机：♠KK+♠AA（K/A 相邻）', () => {
  const c = parseCombo(cardsD('SK', 'SA'), TI);
  assert.equal(c.type, 'tractor');
});

test('打5时 ♠44+♠66 不构成拖拉机（5 被抽走为级牌）', () => {
  const ti5 = buildTrumpInfo('H', '5', DEFAULT_CONFIG);
  const c = parseCombo(cardsD('S4', 'S6'), ti5);
  assert.equal(c.type, 'throw'); // 两对不相邻 → 甩两对
  assert.equal(c.units.filter((u) => u.type === 'pair').length, 2);
});

test('三对拖拉机：♠55+♠66+♠77', () => {
  const c = parseCombo(cardsD('S5', 'S6', 'S7'), TI);
  assert.equal(c.type, 'tractor');
  assert.equal(c.units[0].size, 6);
});

test('主牌王拖拉机：对大王+对小王（最大拖拉机）', () => {
  const c = parseCombo(cardsD('BJ', 'RJ'), TI);
  assert.equal(c.type, 'tractor');
  assert.equal(c.isTrump, true);
});

test('主牌拖拉机：对小王+对主级牌', () => {
  const c = parseCombo([...cardsD('RJ'), ...cardsD('H2')], TI);
  assert.equal(c.type, 'tractor');
});

test('主牌拖拉机：对主级牌+对同花色副级牌（PRD：需两张同花色副X）', () => {
  const c = parseCombo([...cardsD('H2'), ...cardsD('S2')], TI);
  assert.equal(c.type, 'tractor');
});

test('主牌拖拉机：对副级牌+对主A', () => {
  const c = parseCombo([...cardsD('S2'), ...cardsD('HA')], TI);
  assert.equal(c.type, 'tractor');
});

test('主牌拖拉机：主AA+主KK', () => {
  const c = parseCombo([...cardsD('HA'), ...cardsD('HK')], TI);
  assert.equal(c.type, 'tractor');
});

test('R22 默认：不同花色副级牌对不构成拖拉机（♠22+♣22 → 甩两对）', () => {
  const c = parseCombo([...cardsD('S2'), ...cardsD('C2')], TI);
  assert.equal(c.type, 'throw');
  assert.equal(c.units.filter((u) => u.type === 'pair').length, 2);
});

test('R22 开启：不同花色副级牌对构成拖拉机', () => {
  const cfg22 = createConfig({ offSuitRankPairAsTractor: true });
  const c = parseCombo([...cardsD('S2'), ...cardsD('C2')], TI, cfg22);
  assert.equal(c.type, 'tractor');
});

test('甩牌识别：A+K+55 三单元同花色', () => {
  const c = parseCombo([...cards('SA'), ...cards('SK'), ...cardsD('S5')], TI);
  assert.equal(c.type, 'throw');
  assert.equal(c.n, 4);
  assert.equal(c.units.length, 3);
});

test('甩牌识别：KK+7+8（对+两单）', () => {
  const c = parseCombo([...cardsD('SK'), ...cards('S7', 'S8')], TI);
  assert.equal(c.type, 'throw');
  const pairU = c.units.find((u) => u.type === 'pair');
  assert.ok(pairU);
});

test('跨域混合返回 null（主+副 / 两门副牌）', () => {
  assert.equal(parseCombo(cards('S5', 'H5'), TI), null);
  assert.equal(parseCombo(cards('H2', 'S5'), TI), null); // 主级牌+副牌
  assert.equal(parseCombo(cards('BJ', 'S5'), TI), null); // 王+副牌
});

test('主牌甩牌（全主域）：对大王+对主X 不相邻 → 甩两对', () => {
  const c = parseCombo([...cardsD('BJ'), ...cardsD('H2')], TI);
  // 对大王(step0) 与 对主X(step2) 中间隔小王 → 不相邻 → 甩牌
  assert.equal(c.type, 'throw');
  assert.equal(c.units.filter((u) => u.type === 'pair').length, 2);
  // 对王+对副X（S2）+ 主H3 单 → 甩牌
  const c2 = parseCombo([...cardsD('BJ'), ...cardsD('S2'), ...cards('H3')], TI);
  assert.equal(c2.type, 'throw');
  assert.equal(c2.units.length, 3);
});

test('canBeat：单张/对子/拖拉机压过判定', () => {
  const s5 = parseCombo(cards('S5'), TI);
  const sK = parseCombo(cards('SK'), TI);
  const sH = parseCombo(cards('H3'), TI); // 主3
  assert.ok(canBeat(s5, sK));
  assert.ok(!canBeat(sK, s5));
  assert.ok(canBeat(sK, sH)); // 主压副（同 n 域不同，此处域判定由 trick 层做，canBeat 仅看单元强度）

  const p5 = parseCombo(cardsD('S5'), TI);
  const p6 = parseCombo(cardsD('S6'), TI);
  assert.ok(canBeat(p5, p6));
  assert.ok(!canBeat(p6, p5));

  const t5566 = parseCombo(cardsD('S5', 'S6'), TI);
  const t7788 = parseCombo(cardsD('S7', 'S8'), TI);
  const tKKAA = parseCombo(cardsD('SK', 'SA'), TI);
  assert.ok(canBeat(t5566, t7788));
  assert.ok(canBeat(t7788, tKKAA));
  assert.ok(!canBeat(tKKAA, t5566));
  // 用两对（非拖）跟拖拉机：不能压
  const throw2pairs = parseCombo([...cardsD('S5'), ...cardsD('S9')], TI);
  assert.ok(!canBeat(t5566, throw2pairs));
});

test('canBeat：甩牌逐单元压过', () => {
  // 领出 SA + SK + S5对 ；跟牌 HA? 不行跨域——用 S 域: SK对+SQ+SJ
  const lead = parseCombo([...cards('SA'), ...cards('SK'), ...cardsD('S5')], TI);
  const win = parseCombo([...cardsD('SA'), ...cards('SK'), ...cardsD('S9')], TI);
  // win 单元：SA对(对) > SA单? 对单元 size 2 > 单元 size1，逐单元对齐：
  // lead units 降序: [SA单(1), SK单(1), S5对(2)] → 排序后 [S5对, SA, SK]
  // win units: [S9对, SA, SK] → S9对>S5对 ✓, SA vs SA ✗ 不压
  assert.ok(!canBeat(lead, win));
});

test('compareCombo：同型比较拖头', () => {
  const a = parseCombo(cardsD('S5', 'S6'), TI);
  const b = parseCombo(cardsD('S7', 'S8'), TI);
  assert.ok(compareCombo(b, a) > 0);
  assert.ok(compareCombo(a, b) < 0);
  const p = parseCombo(cardsD('H9'), TI);
  const q = parseCombo(cardsD('H10'), TI);
  assert.ok(compareCombo(q, p) > 0);
});

test('decomposeDomain：最大拖拉机贪心合并', () => {
  // ♠33 ♠44 ♠55 ♠99 → 334455 拖 + 99 对
  const units = decomposeDomain(cardsD('S3', 'S4', 'S5', 'S9'), TI);
  const tractors = units.filter((u) => u.type === 'tractor');
  assert.equal(tractors.length, 1);
  assert.equal(tractors[0].size, 6);
  assert.equal(units.filter((u) => u.type === 'pair').length, 1);
});

test('isPair 基础判定', () => {
  assert.ok(isPair(cardsD('C9'), TI));
  assert.ok(!isPair(cards('C9', 'C8'), TI));
  assert.ok(!isPair(cards('S2', 'H2'), TI)); // 不同花色级牌非对
});

test('pairAdjacent：副牌相邻含 A-K；主牌 step 相邻', () => {
  const mk = (cs) => ({ cards: cs });
  assert.ok(pairAdjacent(mk(cardsD('SK')), mk(cardsD('SA')), TI, DEFAULT_CONFIG));
  assert.ok(!pairAdjacent(mk(cardsD('SJ')), mk(cardsD('SK', 'x'.slice(0, 0) || 'Q').slice(0, 1)), TI, DEFAULT_CONFIG) === true);
  assert.ok(!pairAdjacent(mk(cardsD('S4')), mk(cardsD('S6')), buildTrumpInfo('H', '5', DEFAULT_CONFIG), DEFAULT_CONFIG));
  assert.ok(pairAdjacent(mk(cardsD('BJ')), mk(cardsD('RJ')), TI, DEFAULT_CONFIG));
});
