/**
 * tests/test-qa-follow-trump.js —— QA 对抗性测试：跟牌结构对应 / 将吃结构 / 缺门 / R11/R12。
 *
 * 覆盖（R11 / R12）：
 *   1. 缺门跟对子：主对将吃有效争胜；两张主单=垫牌不争胜（墩胜负验证）
 *   2. 缺门跟拖：主 k 对拖将吃赢；4 张主无拖结构=垫牌
 *   3. 有对必跟对：有♠对却出主对 → E103（有门必须跟门）
 *   4. 该门不足全出 + 垫牌补齐（partial）；张数不符 E106
 *   5. 多主单将吃按主牌序比较（主3 vs 副级牌 S2 → S2 大）
 *   6. 1张跟门+主单垫（partial，主牌不将吃）
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../miniprogram/engine/config');
const { parseCombo } = require('../miniprogram/engine/combo');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { validatePlay } = require('../miniprogram/engine/validate');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { cards, cardsD, makeState } = require('./fixtures');

const TI = buildTrumpInfo('H', '2', DEFAULT_CONFIG);

/** 构造已领出一墩的 state */
function stateWithLead(leadCards, hands) {
  const st = makeState({ hands });
  st.currentTrick = {
    leadPlayerIdx: 0,
    leadCombo: parseCombo(leadCards, TI, DEFAULT_CONFIG),
    plays: [{ playerIdx: 0, cards: leadCards, combo: null, isDiscard: false, isEffectiveTrump: false }],
    winnerIdx: 0,
    points: 0
  };
  return st;
}

function play(idx, cs) {
  return { playerIdx: idx, cards: cs, combo: parseCombo(cs, TI, DEFAULT_CONFIG), isDiscard: false, isEffectiveTrump: false };
}

test('QA-跟1：缺门对子墩——主对有效将吃赢墩', () => {
  const lead = cardsD('S7');
  const t = {
    leadPlayerIdx: 0,
    leadCombo: parseCombo(lead, TI, DEFAULT_CONFIG),
    plays: [play(0, lead), play(1, cardsD('H9')), play(2, cardsD('SK')), play(3, cards('C3', 'C4'))],
    winnerIdx: null, points: 0
  };
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 1);
  assert.equal(r.detail[1].kind, 'trump');
});

test('QA-跟2：缺门对子墩——两张主单视为垫牌（合法但不争胜），同门大对赢', () => {
  const lead = cardsD('S7');
  const t = {
    leadPlayerIdx: 0,
    leadCombo: parseCombo(lead, TI, DEFAULT_CONFIG),
    plays: [play(0, lead), play(1, cards('H9', 'H5')), play(2, cardsD('SK')), play(3, cards('C3', 'C4'))],
    winnerIdx: null, points: 0
  };
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.detail[1].kind, 'discard'); // 主单不争胜
  assert.equal(r.winnerIdx, 2); // SK 对 > S7 对
});

test('QA-跟3：缺门拖墩——主 k 对拖将吃赢', () => {
  const lead = cardsD('S7', 'S8');
  const t = {
    leadPlayerIdx: 0,
    leadCombo: parseCombo(lead, TI, DEFAULT_CONFIG),
    plays: [play(0, lead), play(1, cardsD('H5', 'H6')), play(2, cards('C2', 'C3')), play(3, cards('C4', 'C5'))],
    winnerIdx: null, points: 0
  };
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.winnerIdx, 1);
  assert.equal(r.detail[1].kind, 'trump');
});

test('QA-跟4：缺门拖墩——4 张主但无 k 对拖结构（HAA 对+两主单）= 垫牌，领出者赢', () => {
  const lead = cardsD('S7', 'S8');
  const t = {
    leadPlayerIdx: 0,
    leadCombo: parseCombo(lead, TI, DEFAULT_CONFIG),
    plays: [play(0, lead), play(1, [...cardsD('HA'), ...cards('H3', 'H5')]), play(2, cards('C2', 'C3')), play(3, cards('C4', 'C5'))],
    winnerIdx: null, points: 0
  };
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.detail[1].kind, 'discard');
  assert.equal(r.winnerIdx, 0);
});

test('QA-跟5：有♠对却出两张主牌 → E103（有门优先跟门）', () => {
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'),
    cardsD('S9').concat(cards('H3', 'H5')),
    cards('C2', 'C3'),
    cards('C4', 'C5')
  ]);
  const r = validatePlay(st, 1, cards('H3', 'H5'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E103');
});

test('QA-跟6：R11 有对必跟对——拆对出对+单非法', () => {
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'),
    [...cardsD('S9'), ...cards('S2', 'S3')],
    cards('C5', 'C6'),
    cards('C8', 'C9')
  ]);
  const r = validatePlay(st, 1, cards('S9', 'S2'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E103');
  assert.equal(validatePlay(st, 1, cardsD('S9')).ok, true);
});

test('QA-跟7：领出 2 对拖、跟牌者该门仅 3 张 → 全出 3 张+垫 1 张合法（partial）', () => {
  const lead = cardsD('S7', 'S8');
  const st = stateWithLead(lead, [
    lead,
    [...cardsD('S9'), ...cards('S3'), ...cards('C5')],
    cards('C2', 'C3'),
    cards('C4', 'C5')
  ]);
  const r = validatePlay(st, 1, [...cardsD('S9'), ...cards('S3', 'C5')]);
  assert.equal(r.ok, true);
  assert.equal(r.meta.followKind, 'partial');
  // 张数不符：只出 2 张 → E106
  const r2 = validatePlay(st, 1, cardsD('S9'));
  assert.equal(r2.ok, false);
  assert.equal(r2.errorCode, 'E106');
});

test('QA-跟8：该门不足时藏对少给（出 2♠+2 垫）→ 非法', () => {
  const lead = cardsD('S7', 'S8');
  const st = stateWithLead(lead, [
    lead,
    [...cardsD('S9'), ...cards('S3'), ...cards('C5', 'C6')],
    cards('C2', 'C3'),
    cards('C4', 'C5')
  ]);
  // 该门有 3 张（99+3）须至少出 min(4,3)=3 张该门
  const r = validatePlay(st, 1, [...cards('S9', 'S3', 'C5', 'C6')]); // 只出 2 张♠
  assert.equal(r.ok, false);
});

test('QA-跟9：多主单将吃按主牌序——H3(主3) vs S2(副级牌) → S2 大者赢', () => {
  const t = {
    leadPlayerIdx: 0,
    leadCombo: parseCombo(cards('SA'), TI, DEFAULT_CONFIG),
    plays: [play(0, cards('SA')), play(1, cards('H3')), play(2, cards('S2')), play(3, cards('SK'))],
    winnerIdx: null, points: 0
  };
  const r = resolveTrick(t, TI, DEFAULT_CONFIG);
  assert.equal(r.detail[1].kind, 'trump');
  assert.equal(r.detail[2].kind, 'trump');
  assert.equal(r.winnerIdx, 2); // 副级牌 > 主3
});

test('QA-跟10：跟门 1 张+主单垫牌合法（partial，主牌不做将吃）', () => {
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'),
    [...cards('S9'), ...cards('H3')],
    cards('C2', 'C3'),
    cards('C4', 'C5')
  ]);
  const r = validatePlay(st, 1, cards('S9', 'H3'));
  assert.equal(r.ok, true);
  assert.equal(r.meta.followKind, 'partial');
});
