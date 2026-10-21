/**
 * tests/test-trick.js —— 墩胜负判定（逐家压过 / 垫牌不争胜 / 将吃为王）。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../miniprogram/engine/config');
const { resolveTrick, playContendInfo, lastTrickShape } = require('../miniprogram/engine/trick');
const { parseCombo } = require('../miniprogram/engine/combo');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { cards, cardsD, C } = require('./fixtures');

const TI = buildTrumpInfo('H', '2', DEFAULT_CONFIG);

/** 构造 PlayRecord */
function play(idx, cards_) {
  return {
    playerIdx: idx,
    cards: cards_,
    combo: parseCombo(cards_, TI, DEFAULT_CONFIG),
    isDiscard: false,
    isEffectiveTrump: false
  };
}

/** 构造一墩 */
function trick(leadCards, followCardsArr) {
  const leadCombo = parseCombo(leadCards, TI, DEFAULT_CONFIG);
  const plays = [play(0, leadCards)];
  followCardsArr.forEach((cs, i) => plays.push(play(i + 1, cs)));
  return {
    leadPlayerIdx: 0,
    leadCombo,
    plays,
    winnerIdx: null,
    points: 0
  };
}

test('单张墩：大牌赢（SK 是 10 分牌）', () => {
  const t = trick(cards('S7'), [cards('S9'), cards('SK'), cards('S3')]);
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 2);
  assert.equal(r.points, 10);
});

test('单张墩：主牌压副牌（副级牌 S2 > 主单 H3）', () => {
  const t = trick(cards('SA'), [cards('H3'), cards('S2'), cards('SK')]);
  // 玩家1 出主 H3（有效将吃）；玩家2 出 S2 副级牌（主牌域更大将吃）
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 2);
});

test('单张墩：大王最大', () => {
  const t = trick(cards('SA'), [cards('BJ'), cards('H3'), cards('SK')]);
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 1);
  assert.equal(r.points, 10); // 仅 SK 10 分（A/王无分）
});

test('对子墩：大对赢，拆单不争胜', () => {
  // 玩家2 出 S5+S6 两单（结构不对应）→ 不争胜
  const t = trick(cardsD('S7'), [cardsD('S8'), cards('S5', 'S6'), cardsD('S3')]);
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 1);
});

test('对子墩：主对将吃赢', () => {
  const t = trick(cardsD('SA'), [cardsD('H3'), cards('S5', 'S6'), cardsD('SK')]);
  // 玩家1 主对 H3H3 有效将吃
  t.plays[1].isEffectiveTrump = true;
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 1);
});

test('对子墩：主牌结构不对应（两张主单）视为垫牌不争胜', () => {
  const t = trick(cardsD('SA'), [cards('H3', 'H7'), cards('S5', 'S6'), cardsD('SK')]);
  // 玩家1 两张主单：非对 → 垫牌；玩家3 SK 对压不过 SA 对 → 领出者(0) 赢
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 0);
});

test('拖拉机墩：大拖赢', () => {
  const t = trick(cardsD('S5', 'S6'), [cardsD('S7', 'S8'), cardsD('S9', 'S10'), cards('S3', 'S4')]);
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 2);
});

test('拖拉机墩：主拖将吃赢', () => {
  const t = trick(cardsD('S9', 'S10'), [cardsD('HA', 'HK'), cards('S3', 'S4'), cardsD('S5', 'S6')]);
  // 玩家1 主拖 AA-KK 有效将吃
  t.plays[1].isEffectiveTrump = true;
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 1);
});

test('甩牌墩：逐单元压过者胜', () => {
  // 领出 SA+SK 甩；玩家2 用 SA单+SJ 单不构成全压；玩家3 SK单+SQ单 → SA 被压?SA vs SK 领出SA>SK
  const t = trick(cards('SA', 'SK'), [cards('S2', 'S3'), cards('SJ', 'SQ'), cards('S9', 'S8')]);
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 0); // 无人全压 → 领出者赢
});

test('分牌收集：5/10/K 计入赢家阵营', () => {
  const t = trick(cards('S5'), [cards('S10'), cards('SK'), cards('S3')]);
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  // 玩家2 SK 最大赢墩：S5(5)+S10(10)+SK(10)=25 分
  assert.equal(r.winnerIdx, 2);
  assert.equal(r.points, 25);
});

test('后压过者胜（同强度不压，先出为大）', () => {
  // 两家出同名单张（不可能同牌，但同强度不同 id：H9 deck0 vs deck1）
  const t = trick([C('H', '9', 0)], [[C('H', '9', 1)], cards('S3'), cards('S4')]);
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 0); // 同强度不压 → 领出者赢
});

test('playContendInfo：缺门垫牌 contending=false', () => {
  const p = play(1, cards('D3'));
  const leadCombo = parseCombo(cards('S7'), TI, DEFAULT_CONFIG);
  const info = playContendInfo(p, leadCombo, TI, DEFAULT_CONFIG);
  assert.equal(info.contending, false);
  assert.equal(info.kind, 'discard');
});

test('lastTrickShape：牌型识别（R10）', () => {
  const t1 = trick(cards('S7'), []);
  assert.equal(lastTrickShape(t1, TI, DEFAULT_CONFIG), 'single');
  const t2 = trick(cardsD('S7'), []);
  assert.equal(lastTrickShape(t2, TI, DEFAULT_CONFIG), 'pair');
  const t3 = trick(cardsD('S7', 'S8'), []);
  assert.equal(lastTrickShape(t3, TI, DEFAULT_CONFIG), 'tractor');
  const t4 = trick([cards('SA')[0], cards('SK')[0], ...cardsD('S5')], []);
  assert.equal(lastTrickShape(t4, TI, DEFAULT_CONFIG), 'pair'); // 甩牌取最大单元（对5? SA单SK单S5对 → 最大=对）
});

test('主牌域墩（领出主牌）：主牌大者胜、副牌垫不争胜', () => {
  const t = trick(cards('H3'), [cards('H5'), cards('S9'), cards('H2')]);
  // 领出主3；玩家1 主5 压；玩家2 垫副牌；玩家3 主级牌 2 压 H5
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 3);
});
