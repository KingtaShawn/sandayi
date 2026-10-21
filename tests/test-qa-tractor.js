/**
 * tests/test-qa-tractor.js —— QA 对抗性测试：主牌拖拉机特殊情形 / 甩牌成立性 / R22 开关。
 *
 * 覆盖（PRD §5.7 / §5.15 / R22）：
 *   1. 王拖拉机：对大王+对小王（最大拖）；三对王拖延续（BJ+RJ+主X）
 *   2. 对王+对主级牌【不】构成拖拉机（中间隔小王 → 甩牌）
 *   3. 对副级牌（同花色两对?）——副级牌对+对主A 拖拉机
 *   4. 两张不同花色副级牌对不构成拖拉机（R22 默认）；R22 开启后构成
 *   5. 无主局拖拉机：BJ对+RJ对；RJ对+级牌对；级牌对+级牌对（R22 默认不构成）
 *   6. 主牌拖拉机与跟牌 R12（拆拖非法 / 主拖跟主拖合法）
 *   7. 甩牌成立性：单张单元被更大单张压 / 对子单元被更大对（含对手拖拆压）压 / 多对手分别压 / 全部无人压成立
 *   8. 主域甩牌：RJ 单元被对手 BJ 压
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG, createConfig } = require('../miniprogram/engine/config');
const { parseCombo, canBeat } = require('../miniprogram/engine/combo');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { validatePlay } = require('../miniprogram/engine/validate');
const { cards, cardsD, makeState } = require('./fixtures');

const TI = buildTrumpInfo('H', '2', DEFAULT_CONFIG); // ♥主打2
const TI_NT5 = buildTrumpInfo(null, '5', DEFAULT_CONFIG); // 无主打5

test('QA-拖1：王拖 BJ对+RJ对（最大拖拉机）且三对延续 BJ+RJ+主X', () => {
  const c2 = parseCombo([...cardsD('BJ'), ...cardsD('RJ')], TI);
  assert.equal(c2.type, 'tractor');
  assert.equal(c2.isTrump, true);
  // 三对延续：大王-小王-主2
  const c3 = parseCombo([...cardsD('BJ', 'RJ', 'H2')], TI);
  assert.equal(c3.type, 'tractor');
  assert.equal(c3.units[0].cards.length, 6);
});

test('QA-拖2：对大王+对主级牌【不】构成拖拉机（隔小王）→ 甩两对', () => {
  const c = parseCombo([...cardsD('BJ'), ...cardsD('H2')], TI);
  assert.equal(c.type, 'throw');
  assert.equal(c.units.filter((u) => u.type === 'pair').length, 2);
});

test('QA-拖3：对副级牌+对主A 构成主牌拖拉机；对副级牌+对主K 不相邻', () => {
  const ok = parseCombo([...cardsD('S2'), ...cardsD('HA')], TI);
  assert.equal(ok.type, 'tractor'); // step3(副X) → step4(主A) 相邻
  // 主K 是 step5：副X(step3) 与 主K(step5) 不相邻 → 甩
  const bad = parseCombo([...cardsD('S2'), ...cardsD('HK')], TI);
  assert.equal(bad.type, 'throw');
});

test('QA-拖4：R22 默认——两张不同花色副级牌对不构成拖拉机（甩两对）', () => {
  const c = parseCombo([...cardsD('S2'), ...cardsD('C2')], TI);
  assert.equal(c.type, 'throw');
  assert.equal(c.units.filter((u) => u.type === 'pair').length, 2);
});

test('QA-拖5：R22 开启——不同花色副级牌对构成拖拉机', () => {
  const cfg22 = createConfig({ offSuitRankPairAsTractor: true });
  const c = parseCombo([...cardsD('S2'), ...cardsD('C2')], TI, cfg22);
  assert.equal(c.type, 'tractor');
});

test('QA-拖6：无主局拖拉机——BJ对+RJ对 / RJ对+级牌对 相邻；级牌对+级牌对不构成', () => {
  assert.equal(parseCombo([...cardsD('BJ'), ...cardsD('RJ')], TI_NT5).type, 'tractor');
  // 无主序：BJ(0) > RJ(1) > 级牌(2 tie)
  assert.equal(parseCombo([...cardsD('RJ'), ...cardsD('S5')], TI_NT5).type, 'tractor');
  // 两门级牌对：tie 不相邻（R22 默认）
  const twoOff = parseCombo([...cardsD('S5'), ...cardsD('C5')], TI_NT5);
  assert.equal(twoOff.type, 'throw');
  // R22 开启后构成
  const cfg22 = createConfig({ offSuitRankPairAsTractor: true });
  assert.equal(parseCombo([...cardsD('S5'), ...cardsD('C5')], TI_NT5, cfg22).type, 'tractor');
});

test('QA-拖7：R12 主拖跟牌——有主拖拆拖出对+单非法；跟同长主拖合法', () => {
  const lead = [...cardsD('HA', 'HK')]; // 主拖 AA-KK
  const p1 = [...cardsD('HK', 'HQ'), ...cards('H3')];
  const st = makeState({
    hands: [lead.concat(cards('H9')), p1, cards('C2', 'C3'), cards('C4', 'C5')]
  });
  st.currentTrick = {
    leadPlayerIdx: 0,
    leadCombo: parseCombo(lead, TI, DEFAULT_CONFIG),
    plays: [{ playerIdx: 0, cards: lead, combo: null, isDiscard: false, isEffectiveTrump: false }],
    winnerIdx: 0,
    points: 0
  };
  const bad = validatePlay(st, 1, [...cardsD('HK'), ...cards('HQ', 'H3')]);
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, 'E103');
  const good = validatePlay(st, 1, [...cardsD('HK', 'HQ')]);
  assert.equal(good.ok, true);
});

test('QA-拖8：主拖大小比较——王拖 > 主X拖 > 主AA-KK', () => {
  const wj = parseCombo([...cardsD('BJ'), ...cardsD('RJ')], TI);
  const xA = parseCombo([...cardsD('H2'), ...cardsD('HA')], TI); // 主2-副? no: H2对+HA对 = 主X+主A 不相邻!
  void xA;
  const rx = parseCombo([...cardsD('H2'), ...cardsD('S2')], TI); // 主X+同花副X 拖
  const aa = parseCombo([...cardsD('HA'), ...cardsD('HK')], TI); // 主 AA-KK
  assert.ok(canBeat(aa, rx)); // 主X拖 > AA-KK
  assert.ok(canBeat(rx, wj)); // 王拖最大
  assert.ok(!canBeat(wj, rx));
});

test('QA-甩1：甩牌单张单元被对手更大单张压 → E102 reject', () => {
  const hands = [
    [...cards('SK', 'SQ'), ...cards('H3', 'H4')],
    [...cards('SA'), ...cards('C3', 'C4')],
    cards('C9', 'D3'),
    cards('C9', 'D4')
  ];
  const st = makeState({ hands });
  const r = validatePlay(st, 0, cards('SK', 'SQ'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E102');
});

test('QA-甩2：甩牌对子单元被对手更大对（藏在拖拉机中）压 → E102', () => {
  // 甩 S55对+S9单；对手持主域? 副牌域: 对手 S77+S88 拖 → 拆拖头 88 >= 55 → 压制
  const hands = [
    [...cardsD('S5'), ...cards('S9'), ...cards('H3', 'H4')],
    [...cardsD('S7'), ...cardsD('S8'), ...cards('C3', 'C4')],
    cards('C9', 'D3'),
    cards('C9', 'D4')
  ];
  const st = makeState({ hands });
  const r = validatePlay(st, 0, [...cardsD('S5'), ...cards('S9')]);
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E102');
});

test('QA-甩3：多对手分别压制单张/对子单元 → 甩牌不成立', () => {
  const hands = [
    [...cards('SK'), ...cardsD('S5'), ...cards('H3', 'H4')],
    [...cards('SA'), ...cards('C3', 'C4')], // P1 SA 压 SK 单
    [...cardsD('S7'), ...cards('D3', 'D4')], // P2 S77 压 S55 对
    cards('C9', 'D9')
  ];
  const st = makeState({ hands });
  const r = validatePlay(st, 0, [...cards('SK'), ...cardsD('S5')]);
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E102');
});

test('QA-甩4：全部单元无人可压 → 甩牌成立', () => {
  const hands = [
    [...cards('SK'), ...cardsD('S5'), ...cards('H3', 'H4')],
    cards('SQ', 'SJ', 'C3'),
    cards('S4', 'S3', 'D3'),
    cards('C9', 'D4')
  ];
  const st = makeState({ hands });
  const r = validatePlay(st, 0, [...cards('SK'), ...cardsD('S5')]);
  assert.equal(r.ok, true);
  assert.equal(r.meta.combo.type, 'throw');
});

test('QA-甩5：主域甩牌——RJ 单元被对手 BJ 单压 → E102', () => {
  const hands = [
    [...cards('RJ', 'S2'), ...cards('H3', 'H4')],
    [...cards('BJ', 'H5'), ...cards('C3', 'C4')],
    cards('C9', 'D3'),
    cards('C9', 'D4')
  ];
  const st = makeState({ hands });
  const r = validatePlay(st, 0, cards('RJ', 'S2'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E102');
});

test('QA-甩6：主域甩牌——BJ 对单元对手仅两单王不可压；但 RJ 单单元被压 → 整体不成立', () => {
  const hands = [
    [...cardsD('BJ'), ...cards('RJ', 'H2'), ...cards('H3', 'H4')],
    [...cards('BJ', 'RJ'), ...cards('C3', 'C4')], // 对手 BJ RJ 两单：RJ 单元被压
    cards('C9', 'D3'),
    cards('C9', 'D4')
  ];
  const st = makeState({ hands });
  const r = validatePlay(st, 0, [...cardsD('BJ'), ...cards('RJ', 'H2')]);
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E102');
});

test('QA-甩7：主域甩牌——对单元被对手主拖拆头压（H33 对 vs 对手 H55-H66 拖）→ E102', () => {
  const hands = [
    [...cardsD('H3'), ...cards('H9', 'S4')],
    [...cardsD('H5', 'H6'), ...cards('C3', 'C4')],
    cards('C9', 'D3'),
    cards('C9', 'D4')
  ];
  const st = makeState({ hands });
  const r = validatePlay(st, 0, [...cardsD('H3'), ...cards('H9')]);
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E102');
});

test('QA-甩8：R14=smallest——甩牌不成立返回该门最小等量替换牌', () => {
  const cfg = createConfig({ throwPenalty: 'smallest' });
  const hands = [
    [...cards('SK', 'SQ', 'S3', 'S4'), ...cards('H9')],
    [...cards('SA'), ...cards('C3', 'C4')],
    cards('C9', 'D3'),
    cards('C9', 'D4')
  ];
  const st = makeState({ hands });
  st.config = cfg;
  const r = validatePlay(st, 0, cards('SK', 'SQ'));
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E102');
  assert.ok(r.meta.replacement);
  assert.equal(r.meta.replacement.length, 2);
  assert.deepEqual(r.meta.replacement.map((c) => c.rank).sort(), ['3', '4']);
});
