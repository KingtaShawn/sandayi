'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfig } = require('../miniprogram/engine/config');
const { buildDeck } = require('../miniprogram/engine/deck');
const { parseCombo, pointsOf } = require('../miniprogram/engine/combo');
const { validatePlay } = require('../miniprogram/engine/validate');
const { makeState } = require('./fixtures');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { resolveTrick } = require('../miniprogram/engine/trick');

function position(specs, bottom = [], current = []) {
  const cfg = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const pool = buildDeck(cfg);
  const take = (sp) => {
    const i = pool.findIndex((c) => c.suit + c.rank === sp);
    assert.ok(i >= 0, sp); return pool.splice(i, 1)[0];
  };
  const st = makeState({ hands: specs.map((h) => h.map(take)), turnIdx: 1 });
  st.config = cfg; st.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] }; st.contractScore = 90;
  const trick = (rows) => {
    const plays = rows.map(([playerIdx, names]) => { const cards = names.map(take);
      return { playerIdx, cards, combo: parseCombo(cards, st.trumpInfo, cfg) }; });
    return { leadPlayerIdx: plays[0].playerIdx, leadCombo: plays[0].combo, plays };
  };
  const previous = trick([[0, ['S4']], [1, ['SA']], [2, ['S6']], [3, ['S7']]]);
  resolveTrick(previous, st.trumpInfo, cfg);
  assert.equal(previous.winnerIdx, 1);
  st.currentTrick = current.length ? trick(current) : null;
  st.bottomCards = bottom.map(take);
  while (st.bottomCards.length < cfg.bottomCards) st.bottomCards.push(pool.shift());
  st.completedTricks = [{ leadCombo: null, plays: [{ playerIdx: 3, cards: pool }],
    winnerIdx: 3, points: pointsOf(pool, cfg) }, previous];
  return st;
}

function strongPosition(pair = false) {
  return position([
    ['H5', 'H7', 'H9', 'H10', 'HJ', 'HQ', 'HK', 'HA', 'C2', 'D2', 'D4', 'D6'],
    ['H3', 'H4', 'H6', 'H8', 'H2', 'S2', pair ? 'JOKERBJ' : 'JOKERRJ', 'JOKERBJ', 'S3', 'D3', 'C3', 'C4'],
    ['C5', 'C6', 'C7', 'C8', 'C9', 'CJ', 'CQ', 'CA', 'D7', 'D8', 'D9', 'DJ'],
    ['S5', 'S8', 'S9', 'SJ', 'SQ', 'SK', 'D5', 'D10', 'DQ', 'DK', 'DA', 'C10']
  ], ['S10', 'SK', 'D5', 'DK', 'C10', 'CK', 'C5', 'D10']);
}

test('副牌赢得领出权、尚余12张且本家主足：用其他主推进，留单大王作后手', () => {
  const st = strongPosition(), ai = new GreedyStrategy(), before = structuredClone(st);
  const ctx = ai._buildCtx(st, 1), king = st.players[1].hand.filter((c) => c.rank === 'BJ');
  assert.equal(ai._lastTrickReserve(st, 1, king, ctx, 0), 0, '覆盖原有五墩储备尚未触发的阶段');
  const pick = ai.decidePlay(st, 1);
  assert.equal(validatePlay(st, 1, pick).ok, true);
  assert.ok(pick.every((c) => c.rank !== 'BJ'));
  assert.deepEqual(st, before);
});

test('实际决策和rollout都计单大王机会成本，不能模拟未来时又自动烧掉', () => {
  const st = strongPosition(), ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 1);
  const king = st.players[1].hand.filter((c) => c.rank === 'BJ'), small = [st.players[1].hand[0]];
  assert.ok(ai._scoreLead(st, 1, small, ctx) > ai._scoreLead(st, 1, king, ctx));
  assert.ok(ai._scoreLead(st, 1, small, null) > ai._scoreLead(st, 1, king, null));
});

test('对大王保持对子结构，不能套用单大王规则而拆王对', () => {
  const st = strongPosition(true), pick = new GreedyStrategy().decidePlay(st, 1);
  assert.equal(pick.length, 2);
  assert.ok(pick.every((c) => c.rank === 'BJ'));
  assert.equal(validatePlay(st, 1, pick).ok, true);
});

test('末墩只剩大王时必须出大王，不会为留底继续省牌', () => {
  const st = position([['H3'], ['JOKERBJ'], ['C3'], ['D3']]);
  assert.equal(new GreedyStrategy().decidePlay(st, 1)[0].rank, 'BJ');
});

test('跟主墩只有大王可跟时仍必须出，储备不能绕过跟牌规则', () => {
  const st = position([['H4', 'H6'], ['JOKERBJ', 'C3', 'D3'], ['C4', 'C6', 'C7'], ['D4', 'D6', 'D7']], [], [[0, ['H3']]]);
  const pick = new GreedyStrategy().decidePlay(st, 1);
  assert.deepEqual(pick.map((c) => c.rank), ['BJ']);
  assert.equal(validatePlay(st, 1, pick).ok, true);
});

test('临近末墩储备与大王机会成本取最大值，不重复叠加', () => {
  const st = position([['HA', 'HK', 'D3', 'D4'], ['JOKERBJ', 'H3', 'H2', 'JOKERRJ'],
    ['C4', 'C6', 'C7', 'C8'], ['D4', 'D6', 'D7', 'D8']],
  ['S10', 'SK', 'D5', 'DK', 'C10', 'CK', 'D9', 'DJ']);
  const ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 1), king = [st.players[1].hand[0]];
  const reserve = ai._lastTrickReserve(st, 1, king, ctx, 0);
  assert.ok(reserve >= ai._jokerLeadCost(st, 1, king));
  assert.equal(ai._scoreLead(st, 1, king, ctx), 15 - reserve + ai._trumpFeedValue(ctx) * 0.75);
});

test('队友已无主且有分可跑时，仍允许领大王锁墩接分', () => {
  const st = position([
    ['S3', 'S5', 'S8', 'S9', 'SJ', 'SQ', 'D3', 'D4', 'D6', 'D7', 'D8', 'D9'],
    ['JOKERBJ', 'SA', 'S8', 'S9', 'SJ', 'SQ', 'C3', 'C4', 'C6', 'D3', 'D4', 'D6'],
    ['S10', 'SK', 'C5', 'C7', 'C8', 'C9', 'CJ', 'CQ', 'D7', 'D8', 'D9', 'DJ'],
    ['D10', 'DK', 'D5', 'C10', 'CK', 'C5', 'CA', 'D10', 'DQ', 'DA', 'C7', 'C8']
  ], ['C3', 'C4', 'C6', 'C9', 'CJ', 'CQ', 'D5', 'DJ']);
  const ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 1);
  assert.ok(ai._trumpFeedValue(ctx) >= 15, '公开无主及未见分牌支持接分机会');
  assert.deepEqual(ai.decidePlay(st, 1).map((c) => c.rank), ['BJ']);
});

test('大王储备与喂分估计不能读取真实庄家、队友手牌或底牌', () => {
  const st = strongPosition(), ai = new GreedyStrategy(), expected = ai.decidePlay(st, 1);
  let reads = 0;
  for (const s of [0, 2, 3]) Object.defineProperty(st.players[s], 'hand', { get() { reads++; throw Error('hidden'); } });
  Object.defineProperty(st, 'bottomCards', { get() { reads++; throw Error('hidden'); } });
  assert.deepEqual(ai.decidePlay(st, 1), expected);
  assert.equal(reads, 0);
});
