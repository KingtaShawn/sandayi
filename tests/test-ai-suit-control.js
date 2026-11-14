'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeState } = require('./fixtures');
const { createConfig } = require('../miniprogram/engine/config');
const { buildDeck } = require('../miniprogram/engine/deck');
const { domainOf, parseCombo } = require('../miniprogram/engine/combo');
const { validatePlay } = require('../miniprogram/engine/validate');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { buildSuitControl } = require('../miniprogram/ai/suit-control');

function earlyDefense() {
  const cfg = createConfig({ gameMode: 'san_da_yi' }), pool = buildDeck(cfg);
  const take = (suit, rank) => pool.splice(pool.findIndex((c) => c.suit === suit && c.rank === rank), 1)[0];
  const history = [take('D', '10'), take('D', '3'), take('D', '6'), take('D', '7')];
  const led = take('H', '3');
  const mine = [take('D', 'A'), take('D', '9'), take('D', '9'), take('D', '4'), take('D', '8')];
  while (mine.length < 24) mine.push(pool.splice(pool.findIndex((c) => ['S', 'C'].includes(c.suit) && c.rank !== '2'), 1)[0]);
  const st = makeState({ hands: [pool.splice(0, 23), pool.splice(0, 24), pool.splice(0, 24), mine], turnIdx: 3 });
  st.config = cfg; st.bottomCards = pool; st.contractScore = 90;
  st.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  const plays = history.map((c, playerIdx) => ({ playerIdx, cards: [c], combo: parseCombo([c], st.trumpInfo, cfg) }));
  st.completedTricks = [{ leadPlayerIdx: 0, leadCombo: plays[0].combo, plays, winnerIdx: 0, points: 10 }];
  const combo = parseCombo([led], st.trumpInfo, cfg);
  st.currentTrick = { leadPlayerIdx: 0, leadCombo: combo, plays: [{ playerIdx: 0, cards: [led], combo }] };
  return st;
}

test('尚未三家无主时，看到庄家展开方块后保住A和小牌长度，不等180分才防满分', () => {
  const st = earlyDefense(), ai = new GreedyStrategy(), before = structuredClone(st);
  const ctx = ai._buildCtx(st, 3);
  assert.ok(ctx.knowledge.consistent && ctx.suitControl.has('D'));
  assert.equal(ctx.sdy.trumpWatch, false);
  const pick = ai.decidePlay(st, 3);
  assert.ok(pick.every((c) => domainOf(c, st.trumpInfo) !== 'D'));
  assert.equal(validatePlay(st, 3, pick).ok, true);
  assert.deepEqual(st, before);
});

test('公开绝门后不再为庄家留该门控制牌；过去出过该门不能推翻绝门证据', () => {
  const st = earlyDefense(), ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 3);
  ctx.sdy.voids.dealer.add('D');
  assert.equal(buildSuitControl(st, 3, ctx).has('D'), false);
});

test('前期副牌控制决策不读取庄家、队友暗牌或底牌', () => {
  const st = earlyDefense(), ai = new GreedyStrategy(), expected = ai.decidePlay(st, 3);
  for (const seat of [0, 1, 2]) Object.defineProperty(st.players[seat], 'hand', {
    get() { throw new Error('其他暗牌不可读'); }
  });
  Object.defineProperty(st, 'bottomCards', { get() { throw new Error('底牌不可读'); } });
  assert.deepEqual(ai.decidePlay(st, 3), expected);
});
