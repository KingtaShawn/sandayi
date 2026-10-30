/**
 * tests/test-h5-bundle-throw-kill.js —— H5 bundle 端到端回归：
 * bundle 是引擎的手工同步副本，此文件保证「甩牌将吃」修复（610bee0/fe579ce）
 * 在用户实际运行的 bundle 代码路径上不回退。
 *
 * 场景来源（用户报告 2026-10-30）：
 * 「别家甩两张单牌，我用对子毙，系统显示毙牌失败，甩牌方得分」
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GameService, createConfig } = require('../h5/js/game-bundle.js');
const { parseCombo } = require('../miniprogram/engine/combo');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { cards, cardsD, makeState, C } = require('./fixtures');

const JOKERS = [C('JOKER', 'BJ', 0), C('JOKER', 'RJ', 0)];

/** 构造 P0 已甩出 lead（两手牌即各家唯一牌）的 bundle 局面并打完本墩 */
function playTrick(hands, followMoves) {
  const svc = new GameService();
  const st = makeState({ hands, turnIdx: 1 });
  st.config = createConfig({ gameMode: 'san_da_yi' });
  const TI = buildTrumpInfo('H', '2', st.config);
  const lead = hands[0].slice();
  st.currentTrick = {
    leadPlayerIdx: 0,
    leadCombo: parseCombo(lead, TI, st.config),
    plays: [{
      playerIdx: 0, cards: lead,
      combo: parseCombo(lead, TI, st.config),
      isDiscard: false, isEffectiveTrump: false
    }],
    winnerIdx: null, points: 0
  };
  st.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  st.roundHistory = st.roundHistory || [];
  st.passedBidders = [];
  svc.state = st;
  for (const [idx, cs] of followMoves) {
    svc.dispatch({ type: 'PLAY', playerIdx: idx, cards: cs, ts: Date.now() });
  }
  const done = svc.state.completedTricks[0];
  assert.ok(done, '四家出完应有完整墩');
  return done;
}

test('BUNDLE-甩毙1：两单甩缺门——主对拆计两张毙成功，毙牌者赢墩（用户主诉场景）', () => {
  const done = playTrick(
    [cards('SA', 'SK'), cardsD('H9'), cards('C3', 'C4'), cards('D3', 'D4')],
    [[1, cardsD('H9')], [2, cards('C3', 'C4')], [3, cards('D3', 'D4')]]
  );
  assert.equal(done.winnerIdx, 1);
  assert.equal(done.plays[1].isEffectiveTrump, true);
});

test('BUNDLE-甩毙2：两单甩缺门——对王毙成功赢墩', () => {
  const done = playTrick(
    [cards('SA', 'SK'), [C('JOKER', 'BJ', 0), C('JOKER', 'BJ', 1)], cards('C3', 'C4'), cards('D3', 'D4')],
    [[1, [C('JOKER', 'BJ', 0), C('JOKER', 'BJ', 1)]], [2, cards('C3', 'C4')], [3, cards('D3', 'D4')]]
  );
  assert.equal(done.winnerIdx, 1);
  assert.equal(done.plays[1].isEffectiveTrump, true);
});

test('BUNDLE-甩毙3：双将吃——先毙者大王+小王两单 vs 后毙者主对对2，槽位比较先出者守住', () => {
  const done = playTrick(
    [cards('SA', 'SK'), JOKERS, cardsD('H2'), cards('C3', 'C4')],
    [[1, JOKERS], [2, cardsD('H2')], [3, cards('C3', 'C4')]]
  );
  assert.equal(done.winnerIdx, 1);
});

test('BUNDLE-甩毙4：双将吃——用户主对对2先毙，后毙者主A主K两单压不过（逐张更小）', () => {
  const done = playTrick(
    [cards('SA', 'SK'), cardsD('H2'), cards('HA', 'HK'), cards('C3', 'C4')],
    [[1, cardsD('H2')], [2, cards('HA', 'HK')], [3, cards('C3', 'C4')]]
  );
  assert.equal(done.winnerIdx, 1);
});
