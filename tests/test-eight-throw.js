/**
 * tests/test-eight-throw.js —— 八张同点甩牌（R26 sanDaYiEightThrow）。
 *
 * 规则：握有同一点数全部 8 张可整甩；别家有对必逐对跟（跨门 min(4,m) 对），
 * 但任何跟牌都压不过（含主牌对王），唯有更大的八张同点（级牌八张最高）能压。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfig } = require('../miniprogram/engine/config');
const { parseCombo } = require('../miniprogram/engine/combo');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { validatePlay, legalMoves } = require('../miniprogram/engine/validate');
const { transition } = require('../miniprogram/core/statemachine');
const { C, cards, cardsD, trump, makeState } = require('./fixtures');

const CFG = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });

function state(hands) {
  const st = makeState({ hands });
  st.config = CFG;
  st.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  st.roundHistory = [];
  return st;
}

/** 同点全 8 张（四门 × 两副） */
function eightOf(rank) {
  return cardsD(`S${rank}`, `H${rank}`, `C${rank}`, `D${rank}`);
}

function ids(hand) {
  return hand.map(c => c.id).sort();
}

/* ─────────────────────── 牌型识别 ─────────────────────── */

test('八张同点：识别为 eight 牌型，级牌八张为主牌且强度最高', () => {
  const ti = trump(); // 打 2、♥主
  const sixes = parseCombo(eightOf('6'), ti, CFG);
  assert.equal(sixes.type, 'eight');
  assert.equal(sixes.n, 8);
  assert.equal(sixes.strength, 6);
  assert.equal(sixes.isTrump, false); // 副点八张（含 ♥6 两张主门）整体非主

  const twos = parseCombo(eightOf('2'), ti, CFG);
  assert.equal(twos.type, 'eight');
  assert.equal(twos.isTrump, true);
  assert.equal(twos.strength, 200); // 级牌八张压一切八甩
});

test('八张同点：跨域普通组合仍非法；配置关闭或升级模式不识别', () => {
  const ti = trump();
  assert.equal(parseCombo(eightOf('6').slice(0, 7), ti, CFG), null); // 7 张跨门非法
  assert.equal(parseCombo(eightOf('6'), ti, createConfig({ gameMode: 'san_da_yi', sanDaYiEightThrow: false })), null);
  assert.equal(parseCombo(eightOf('6'), ti, createConfig({ gameMode: 'shengji' })), null);
});

/* ─────────────────────── 领出 ─────────────────────── */

test('八张同点领出成立：对手有对王也压不住（不触发甩牌罚则）', () => {
  const selected = eightOf('6');
  const st = state([
    [...selected, ...cards('SA', 'SK')],
    [...cardsD('BJ'), ...cards('S3', 'S4', 'D5', 'D7', 'C8', 'C9')], // 对大王
    [...cardsD('SK'), ...cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10')],
    [...eightOf('5'), ...cards('H8', 'H9')]
  ]);
  const r = validatePlay(st, 0, selected);
  assert.equal(r.ok, true);
  assert.equal(r.meta.combo.type, 'eight');
});

test('八张同点出现在合法领出候选中', () => {
  const st = state([[...eightOf('10'), ...cards('SA', 'SK')], cards('S3'), cards('D4'), cards('C5')]);
  const moves = legalMoves(st, 0);
  const key = ids(eightOf('10')).join(',');
  assert.ok(moves.some(m => ids(m).join(',') === key));
});

/* ─────────────────────── 跟牌义务 ─────────────────────── */

test('跟八甩：有对必逐对跟（跨门合计），1 对须跟 1 对，8 单非法', () => {
  const lead = [...eightOf('6')];
  const followHand = [...cardsD('BJ'), ...cards('S3', 'S4', 'D5', 'D7', 'C8', 'C9', 'H8', 'S8')];
  const st = state([
    [...lead, ...cards('SA')],
    followHand,
    cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10', 'S9', 'D8'), // 无对
    [...eightOf('7')]
  ]);
  const next = transition(st, { type: 'PLAY', playerIdx: 0, cards: lead });
  // 拆对出 8 单（拆一张大王 + 7 小单）→ 非法
  const eightSingles = [followHand.find(c => c.rank === 'BJ'),
    ...cards('S3', 'S4', 'D5', 'D7', 'C8', 'C9', 'H8')];
  assert.equal(eightSingles.length, 8);
  assert.equal(validatePlay(next, 1, eightSingles).ok, false);
  // 对王 + 6 单 → 合法
  const withPair = [...cardsD('BJ'), ...cards('S3', 'S4', 'D5', 'D7', 'C8', 'C9')];
  assert.equal(validatePlay(next, 1, withPair).ok, true);
  // 无对者任意 8 张合法
  assert.equal(validatePlay(next, 2, cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10', 'S9', 'D8')).ok, true);
});

test('跟八甩：多对须按 min(4, 对数) 跟足，少跟非法', () => {
  const lead = [...eightOf('6')];
  const hand1 = [...cardsD('S7', 'D8'), ...cards('S3', 'H4', 'C5', 'H9', 'H8', 'S8')]; // 2 对 + 6 单
  const st = state([
    [...lead, ...cards('SA')],
    hand1,
    cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10', 'S8', 'S9'),
    [...eightOf('5')]
  ]);
  const next = transition(st, { type: 'PLAY', playerIdx: 0, cards: lead });
  // 手中 2 对只跟 1 对（S7 对 + 6 单）→ 非法：须至少跟 2 对
  const bad = [...cardsD('S7'), ...cards('S3', 'H4', 'C5', 'H9', 'H8', 'S8')];
  assert.equal(bad.length, 8);
  assert.equal(validatePlay(next, 1, bad).ok, false);
  // 2 对 + 4 单 → 合法
  const good = [...cardsD('S7', 'D8'), ...cards('S3', 'H4', 'C5', 'H9')];
  assert.equal(validatePlay(next, 1, good).ok, true);
});

/* ─────────────────────── 压制与结墩 ─────────────────────── */

function trickOf(leadCards, follows, trumpInfo) {
  const leadCombo = parseCombo(leadCards, trumpInfo, CFG);
  return {
    leadPlayerIdx: 0,
    leadCombo,
    plays: [
      { playerIdx: 0, cards: leadCards, combo: leadCombo, isDiscard: false, isEffectiveTrump: false },
      ...follows.map((f, i) => ({
        playerIdx: i + 1,
        cards: f,
        combo: parseCombo(f, trumpInfo, CFG),
        isDiscard: false,
        isEffectiveTrump: false
      }))
    ],
    winnerIdx: null,
    points: 0
  };
}

test('八甩结墩：对大王 + 主牌也压不住，领出者赢', () => {
  const ti = trump();
  const followers = [
    [...cardsD('BJ'), ...cardsD('H3'), ...cards('S3', 'S4', 'C5', 'C8')], // 全主牌垫
    [...cardsD('SK'), ...cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10')].slice(0, 8),
    cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10', 'S8', 'S9')
  ];
  // 第二家保证 8 张
  followers[1] = [...cardsD('SK'), ...cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10')];
  const t = trickOf(eightOf('6'), followers, ti);
  const r = resolveTrick(t, ti, CFG);
  assert.equal(r.winnerIdx, 0);
  assert.ok(r.points > 0); // 跟牌分照收
});

test('八甩结墩：更大的八张同点可压（8 个 7 压 8 个 6），级牌八张封顶', () => {
  const ti = trump();
  const t1 = trickOf(eightOf('6'), [eightOf('7'), cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10', 'S8', 'S9'), cards('S3', 'S4', 'D5', 'D7', 'C8', 'C9', 'H8', 'H9')], ti);
  assert.equal(resolveTrick(t1, ti, CFG).winnerIdx, 1);

  // 8 个 5 压不过 8 个 6
  const t2 = trickOf(eightOf('6'), [eightOf('5'), cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10', 'S8', 'S9'), cards('S3', 'S4', 'D5', 'D7', 'C8', 'C9', 'H8', 'H9')], ti);
  assert.equal(resolveTrick(t2, ti, CFG).winnerIdx, 0);

  // 8 个 A 压不过级牌 8 个 2
  const t3 = trickOf(eightOf('2'), [eightOf('A'), cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10', 'S8', 'S9'), cards('S3', 'S4', 'D5', 'D7', 'C8', 'C9', 'H8', 'H9')], ti);
  assert.equal(resolveTrick(t3, ti, CFG).winnerIdx, 0);
});

test('整墩流转：八甩领出 → 三家跟牌 → 更大八甩者收墩收分', () => {
  const st = state([
    [...eightOf('6'), ...cards('SA')],
    [...cardsD('BJ'), ...cards('S3', 'S4', 'D5', 'D7', 'C8', 'C9')],
    [...cardsD('SK'), ...cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10')],
    [...eightOf('10')]
  ]);
  let s = transition(st, { type: 'PLAY', playerIdx: 0, cards: eightOf('6') });
  s = transition(s, { type: 'PLAY', playerIdx: 1, cards: [...cardsD('BJ'), ...cards('S3', 'S4', 'D5', 'D7', 'C8', 'C9')] });
  s = transition(s, { type: 'PLAY', playerIdx: 2, cards: [...cardsD('SK'), ...cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10')] });
  s = transition(s, { type: 'PLAY', playerIdx: 3, cards: eightOf('10') });
  const done = s.completedTricks[s.completedTricks.length - 1];
  assert.equal(done.winnerIdx, 3); // 8 个 10 > 8 个 6
  assert.equal(done.points, 80 + 5 + 40); // 八个 10 自带 80 + P1 垫 D5 5 分 + P2 垫 SK 对/H5/C5/D10 40 分
});

test('跟八甩候选：全部合法且非空（AI/提示不卡死）', () => {
  const st = state([
    [...eightOf('6'), ...cards('SA')],
    [...cardsD('BJ'), ...cards('S3', 'S4', 'D5', 'D7', 'C8', 'C9')],
    cards('H4', 'H5', 'C5', 'C8', 'D9', 'D10', 'S8', 'S9'),
    [...eightOf('7'), ...cards('H8', 'H9')]
  ]);
  const next = transition(st, { type: 'PLAY', playerIdx: 0, cards: eightOf('6') });
  [1, 2, 3].forEach((i) => {
    const moves = legalMoves(next, i);
    assert.ok(moves.length > 0, `P${i} 无合法候选`);
    moves.forEach((m) => assert.equal(validatePlay(next, i, m).ok, true));
  });
  // 握有更大八张的 P3：候选应包含整八反压
  const hasEight = legalMoves(next, 3).some(m => ids(m).join(',') === ids(eightOf('7')).join(','));
  assert.ok(hasEight);
});
