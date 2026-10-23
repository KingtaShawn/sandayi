/**
 * tests/test-validate-play.js —— 跟牌 / 垫牌 / 将吃 / 甩牌校验（R11/R12/R14）。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG, createConfig } = require('../miniprogram/engine/config');
const { validatePlay, validateBury, legalMoves } = require('../miniprogram/engine/validate');
const { parseCombo } = require('../miniprogram/engine/combo');
const { cards, cardsD, makeState, C } = require('./fixtures');

/** 构造一墩已领出的局面 */
function stateWithLead(leadCards, hands, opts) {
  const o = Object.assign({ level: '2', suit: 'H' }, opts || {});
  const st = makeState({ level: o.level, suit: o.suit, noTrump: o.noTrump, hands });
  const lead = parseCombo(leadCards, st.trumpInfo, DEFAULT_CONFIG);
  st.currentTrick = {
    leadPlayerIdx: 0,
    leadCombo: lead,
    plays: [{ playerIdx: 0, cards: leadCards, combo: lead, isDiscard: false, isEffectiveTrump: false }],
    winnerIdx: 0,
    points: 0
  };
  return st;
}

test('领出：任意同域组合合法（单/对/拖）', () => {
  const st = makeState({ hands: [cardsD('S5', 'S6', 'S9'), [], [], []] });
  assert.equal(validatePlay(st, 0, cards('S5')).ok, true);
  assert.equal(validatePlay(st, 0, cardsD('S9')).ok, true);
  assert.equal(validatePlay(st, 0, cardsD('S5', 'S6')).ok, true);
});

test('领出：跨域混合非法（E112）', () => {
  const st = makeState({ hands: [cards('S5', 'H9'), [], [], []] });
  const r = validatePlay(st, 0, cards('S5', 'H9'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E112');
});

test('领出甩牌：比其他三家大 → 成立', () => {
  // 玩家0 ♠A+♠K 甩，其余三家 ♠ 最大 Q
  const hands = [
    cards('SA', 'SK'),
    cards('SQ', 'H3'),
    cards('SJ', 'H4'),
    cards('S9', 'H5')
  ];
  const st = makeState({ hands });
  const r = validatePlay(st, 0, cards('SA', 'SK'));
  assert.equal(r.ok, true);
  assert.equal(r.meta.combo.type, 'throw');
});

test('领出甩牌：有人可压 → reject 模式 E102', () => {
  const hands = [
    cards('SA', 'SK'),
    cards('SA', 'SQ'), // 对手有 ♠A
    cards('SJ', 'H4'),
    cards('S9', 'H5')
  ];
  const st = makeState({ hands });
  const r = validatePlay(st, 0, cards('SA', 'SK'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E102');
});

test('R14=smallest：甩牌不成立只出所选牌中被压住的最小单张', () => {
  const cfg = createConfig({ throwPenalty: 'smallest' });
  const hands = [
    cards('SA', 'SK', 'S3', 'S4'),
    cards('SA', 'SQ'),
    cards('SJ', 'H4'),
    cards('S9', 'H5')
  ];
  const st = makeState({ hands });
  st.config = cfg;
  const r = validatePlay(st, 0, cards('SA', 'SK'));
  assert.equal(r.ok, false);
  assert.ok(r.meta.replacement);
  assert.equal(r.meta.replacement.length, 1);
  assert.equal(r.meta.replacement.map((c) => c.rank).join(','), 'K'); // A 同大不能压 A，但能压 K
});

test('跟单张：缺门时垫非主牌为 discard', () => {
  const st = stateWithLead(cards('S7'), [
    cards('S9', 'H3'), cards('D5', 'C9'), cards('SK', 'C2'), cards('S3', 'H7')
  ]);
  const r = validatePlay(st, 1, cards('D5')); // 玩家1 无♠，垫♦5（非主）
  assert.equal(r.ok, true);
  assert.equal(r.meta.followKind, 'discard');
});

test('跟单张：有该门出他门非法（E103）', () => {
  const st = stateWithLead(cards('S7'), [
    cards('S9', 'H3'), cards('S5', 'D5'), cards('SK', 'C2'), cards('S3', 'H7')
  ]);
  const r = validatePlay(st, 1, cards('D5'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E103');
  assert.equal(validatePlay(st, 1, cards('S5')).ok, true);
});

test('R11 有对必跟对：领出对子有对必须出对（E103）', () => {
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'), cardsD('S9'), cards('S5', 'S6'), cards('S3', 'H7')
  ]);
  // 玩家1 有 ♠99 对 → 拆对垫两单非法
  const bad = validatePlay(st, 1, cards('S9', 'C(' + ')' )); // 占位，下面用真实牌
  void bad;
  const st2 = stateWithLead(cardsD('S7'), [
    cardsD('S7'), [...cardsD('S9'), ...cards('S2', 'S3')], cards('S5', 'S6'), cards('S3', 'H7')
  ]);
  const r = validatePlay(st2, 1, cards('S9', 'S2'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E103');
  assert.equal(validatePlay(st2, 1, cardsD('S9')).ok, true);
});

test('R11 关闭：可拆对跟两单', () => {
  const cfg = createConfig({ mustFollowPairAsPair: false });
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'), [...cardsD('S9'), ...cards('S4', 'S5')], cards('S5', 'S6'), cards('S3', 'H7')
  ]);
  st.config = cfg;
  assert.equal(validatePlay(st, 1, cards('S9', 'S4')).ok, true);
});

test('无对可跟两单', () => {
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'), cards('S9', 'S2'), cards('S5', 'S6'), cards('S3', 'H7')
  ]);
  assert.equal(validatePlay(st, 1, cards('S9', 'S2')).ok, true);
});

test('R12 有拖必跟拖：有拖不跟拖 → E103；无拖跟对+单合法', () => {
  const st = stateWithLead(cardsD('S7', 'S8'), [
    cardsD('S7', 'S8'), [...cardsD('S9', 'S10'), ...cards('S3', 'S4')], cards('S5', 'S6'), cards('S3', 'H7')
  ]);
  // 玩家1 有 99-1010 拖拉机，却出对99+两单 → E103
  const r = validatePlay(st, 1, [...cardsD('S9'), ...cards('S3', 'S4')]);
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E103');
  assert.equal(validatePlay(st, 1, cardsD('S9', 'S10')).ok, true);

  // 玩家2 无拖有对：55+99 两对（非拖）
  const st3 = stateWithLead(cardsD('S7', 'S8'), [
    cardsD('S7', 'S8'), cardsD('S9', 'S10'), cardsD('S5', 'S9'), cards('S4', 'H7')
  ]);
  assert.equal(validatePlay(st3, 2, [...cardsD('S5'), ...cardsD('S9')]).ok, true); // 55+99 两对（非拖）
});

test('跟更长拖（3 对拖跟 2 对拖需求）合法', () => {
  const st = stateWithLead(cardsD('S7', 'S8'), [
    cardsD('S7', 'S8'), cardsD('S8', 'S9', 'S10'), cards('S5', 'S6'), cards('S3', 'H7')
  ]);
  // 注意：♠88109 中的窗口 8-9-10，抽 7-8 长度的连续窗口含 S8S9/S9S10；S7S8 需要 77/78
  const lm = legalMoves(st, 1);
  // 只要有拖拉机选项即满足"有拖必跟拖"
  assert.ok(lm.some((p) => p.length === 4));
});

test('无拖（有对）跟对+单补齐（该门不足时全出+垫牌）', () => {
  const st = stateWithLead(cardsD('S7', 'S8'), [
    cardsD('S7', 'S8'), [...cardsD('S9'), ...cards('S3'), ...cards('C8')], cards('S5', 'S6'), cards('S3', 'H7')
  ]);
  // 玩家1 ♠ 仅 3 张（99+3），须全出 + 垫 1 张
  const r = validatePlay(st, 1, [...cardsD('S9'), ...cards('S3'), ...cards('C8')]);
  assert.equal(r.ok, true);
});

test('缺门将吃：对子须主对，两张主单视为垫牌（合法但不争胜）', () => {
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'), cards('H9', 'H5', 'S2'), cards('SK', 'C2'), cards('S3', 'H7')
  ]);
  // 玩家1 无♠：主单+主单 合法（垫牌）
  const rDiscard = validatePlay(st, 1, cards('H9', 'H5'));
  assert.equal(rDiscard.ok, true);
  assert.equal(rDiscard.meta.followKind, 'discard');
  assert.equal(rDiscard.meta.isEffectiveTrump, false);
});

test('缺门将吃：主对结构对应（有效将吃）', () => {
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'), cardsD('H9'), cards('SK', 'C2'), cards('S3', 'H7')
  ]);
  const r = validatePlay(st, 1, cardsD('H9'));
  assert.equal(r.ok, true);
  assert.equal(r.meta.followKind, 'trump');
  assert.equal(r.meta.isEffectiveTrump, true);
});

test('缺门垫任意副牌合法', () => {
  const st = stateWithLead(cards('S7'), [
    cards('S7'), cards('H9', 'C5'), cards('SK', 'C2'), cards('S3', 'H7')
  ]);
  assert.equal(validatePlay(st, 1, cards('C5')).ok, true);
});

test('跟牌张数不符（E106）', () => {
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'), cardsD('S9'), cards('SK', 'C2'), cards('S3', 'H7')
  ]);
  const r = validatePlay(st, 1, cards('S9'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E106');
});

test('所出牌不在手（E105）', () => {
  const st = makeState({ hands: [cards('S5'), [], [], []] });
  const r = validatePlay(st, 0, cards('H9'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E105');
});

test('legalMoves：领出含单/对/拖候选且全部合法', () => {
  const st = makeState({ hands: [cardsD('S5', 'S6', 'S9'), [], [], []] });
  const lm = legalMoves(st, 0);
  assert.ok(lm.some((p) => p.length === 1));
  assert.ok(lm.some((p) => p.length === 2 && p[0].suit === 'S'));
  assert.ok(lm.some((p) => p.length === 4)); // 5566 拖
  // 全部候选经 validatePlay 复核合法
  lm.forEach((p) => assert.equal(validatePlay(st, 0, p).ok, true));
});

test('legalMoves：reject 模式下不成立甩牌不出现', () => {
  const hands = [
    cards('SA', 'SK'),
    cards('SA', 'SQ'),
    cards('SJ', 'H4'),
    cards('S9', 'H5')
  ];
  const st = makeState({ hands });
  const lm = legalMoves(st, 0);
  const throwAK = lm.find((p) => p.length === 2 && p.every((c) => c.suit === 'S' && ['A', 'K'].includes(c.rank)));
  assert.equal(throwAK, undefined); // SA+SK 甩被过滤
});

test('legalMoves：跟牌候选满足结构约束', () => {
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'), cardsD('S9'), cards('SK', 'C2'), cards('S3', 'H7')
  ]);
  const lm = legalMoves(st, 1);
  assert.equal(lm.length, 1); // 只有对 99
  assert.deepEqual(lm[0].map((c) => c.rank), ['9', '9']);
});

test('legalMoves：无对时提供两单组合', () => {
  const st = stateWithLead(cardsD('S7'), [
    cardsD('S7'), cards('S9', 'S3'), cards('SK', 'C2'), cards('S3', 'H7')
  ]);
  const lm = legalMoves(st, 1);
  assert.ok(lm.length >= 1);
  assert.ok(lm.every((p) => p.length === 2));
});

test('validateBury：张数/庄家/在手校验', () => {
  const st = makeState({ phase: 'BURYING', dealerIdx: 0 });
  st.players[0].hand = cardsD('S5', 'S6', 'S7', 'H9', 'C2', 'D3', 'H4', 'S9');
  st.bottomCards = cardsD('H2');
  assert.equal(validateBury(st, 0, cardsD('S5', 'S6')).ok, false); // 4 张 ≠ 8
  assert.equal(validateBury(st, 0, st.players[0].hand.slice(0, 8)).ok, true);
  assert.equal(validateBury(st, 1, st.players[0].hand.slice(0, 8)).ok, false); // 非庄家
  st.phase = 'PLAYING';
  assert.equal(validateBury(st, 0, st.players[0].hand.slice(0, 8)).ok, false); // 阶段
});

test('主牌域领出甩牌成立性：主单甩被更大主压 → E102', () => {
  const hands = [
    cards('BJ', 'H2'), // 领出者：大王+主级牌甩
    cards('BJ', 'RJ'), // 对手大王不能压同大的大王，但能压主级牌 H2
    cards('H5', 'H4'),
    cards('H3', 'C9')
  ];
  const st = makeState({ hands });
  const r = validatePlay(st, 0, cards('BJ', 'H2'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E102');
});

test('主牌甩牌成立：各单元最大', () => {
  const hands = [
    cards('BJ', 'RJ'), // 对王甩（两单元）
    [C('H', '2'), C('JOKER', 'RJ', 1)], // 对手有另一张同大的小王
    cards('H5', 'H4'),
    cards('H3', 'C9')
  ];
  const st = makeState({ hands });
  // BJ+RJ 是两个单张单元；对手另一张 RJ 同大，不能压先出的小王。
  const r = validatePlay(st, 0, cards('BJ', 'RJ'));
  assert.equal(r.ok, true);
});
