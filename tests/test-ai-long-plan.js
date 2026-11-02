'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeState } = require('./fixtures');
const { createConfig } = require('../miniprogram/engine/config');
const { buildDeck } = require('../miniprogram/engine/deck');
const { parseCombo, pointsOf, domainOf } = require('../miniprogram/engine/combo');
const { validatePlay } = require('../miniprogram/engine/validate');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { handTempo } = require('../miniprogram/ai/hand-plan');
const { createRng } = require('../miniprogram/utils/random');

const names = (cs) => cs.map((c) => c.suit + c.rank);

/** 全副牌账目平衡；未列牌公开为账本，不虚构这些牌的跟牌证据。 */
function position(specs, { viewer = 1, bottom = [], current = [], bank = 0, contract = 90 } = {}) {
  const cfg = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const pool = buildDeck(cfg);
  const take = (sp) => {
    const i = pool.findIndex((c) => c.suit + c.rank === sp);
    assert.ok(i >= 0, sp);
    return pool.splice(i, 1)[0];
  };
  const st = makeState({ hands: specs.map((h) => h.map(take)), turnIdx: viewer });
  st.config = cfg; st.contractScore = contract;
  st.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  st.bottomCards = bottom.map(take);
  const plays = current.map(([playerIdx, ss]) => {
    const cards = ss.map(take);
    return { playerIdx, cards, combo: parseCombo(cards, st.trumpInfo, cfg) };
  });
  st.currentTrick = plays.length ? { leadPlayerIdx: plays[0].playerIdx, leadCombo: plays[0].combo, plays } : null;
  while (st.bottomCards.length < cfg.bottomCards) st.bottomCards.push(pool.shift());
  const bankCards = [];
  for (let i = pool.length - 1; i >= 0 && pointsOf(bankCards, cfg) < bank; i--) {
    const p = pointsOf([pool[i]], cfg);
    if (p && pointsOf(bankCards, cfg) + p <= bank) bankCards.push(pool.splice(i, 1)[0]);
  }
  assert.equal(pointsOf(bankCards, cfg), bank);
  st.completedTricks = [
    { leadCombo: null, plays: [{ playerIdx: 0, cards: bankCards }], winnerIdx: 0, points: bank },
    { leadCombo: null, plays: [{ playerIdx: 3, cards: pool }], winnerIdx: 3, points: pointsOf(pool, cfg) }
  ];
  return st;
}

function entryPosition(relay = false) {
  return position(relay ? [ ['HA', 'HK', 'H2'], ['C3', 'C4', 'C6'],
    ['SA', 'S3', 'D10', 'D10'], ['S7', 'C7', 'C8', 'C9'] ]
    : [ ['HA', 'HK', 'H2'], ['SA', 'S3', 'D10', 'D10'],
      ['S6', 'C3', 'C4', 'C6'], ['S7', 'C7', 'C8', 'C9'] ], {
    viewer: relay ? 2 : 1, bank: 70,
    current: relay ? [[0, ['SJ']], [1, ['SQ']]] : [[0, ['SJ']]],
    bottom: ['DA', 'DQ', 'DK', 'CQ', 'CA', 'D3', 'D4', 'D6']
  });
}

for (const relay of [false, true]) test(relay ? '锁墩仍比较下一墩：用A接管后兑现分对' : '白墩可换后续20分：用A接手而不误省牌', () => {
  const st = entryPosition(relay), ai = new GreedyStrategy(), seat = st.turnIdx;
  const before = structuredClone(st), ctx = ai._buildCtx(st, seat);
  assert.equal(ctx.knowledge.domains.get('S').remainingPoints, 0);
  const a = st.players[seat].hand.filter((c) => c.rank === 'A');
  assert.equal(ai._cashPlan(st, seat, a, ctx).points, 20);
  assert.deepEqual(names(ai.decidePlay(st, seat)), ['SA']);
  assert.deepEqual(st, before);
});

test('兑现对子不会再把相同的两张10按单张重复计分', () => {
  const st = entryPosition(), ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 1);
  const plan = ai._cashPlan(st, 1, st.players[1].hand.slice(0, 1), ctx);
  assert.equal(plan.points, 20);
  assert.ok(plan.runs.some((cs) => cs.length === 2));
});

test('对局继续到手牌空：接回牌权后安全兑现分对', () => {
  const st = entryPosition(), ai = new GreedyStrategy();
  let seat = st.turnIdx;
  const newTricks = [];
  for (let guard = 0; guard < 40 && st.players.some((p) => p.hand.length); guard++) {
    const pick = ai.decidePlay(st, seat);
    assert.equal(validatePlay(st, seat, pick).ok, true);
    const ids = new Set(pick.map((c) => c.id));
    st.players[seat].hand = st.players[seat].hand.filter((c) => !ids.has(c.id));
    const combo = parseCombo(pick, st.trumpInfo, st.config);
    st.currentTrick ||= { leadPlayerIdx: seat, leadCombo: combo, plays: [] };
    st.currentTrick.plays.push({ playerIdx: seat, cards: pick, combo });
    if (st.currentTrick.plays.length === 4) {
      resolveTrick(st.currentTrick, st.trumpInfo, st.config);
      newTricks.push(st.currentTrick); st.completedTricks.push(st.currentTrick);
      seat = st.currentTrick.winnerIdx; st.currentTrick = null;
    } else seat = (seat + 1) % 4;
  }
  assert.ok(st.players.every((p) => !p.hand.length));
  assert.ok(newTricks.some((t) => t.leadCombo.type === 'pair' && t.winnerIdx === 1 && t.points >= 20));
});

for (const h of [2, 4]) test(`${h}张推演不能漏掉手中及当前墩分，也不能在合同已定后停止争分`, () => {
  for (const contract of [5, 90]) {
    const st = position(h === 2
      ? [['HA'], ['C10', 'D10'], ['S4'], ['C4']]
      : [['HA', 'HK', 'H2'], ['C10', 'D10', 'C3', 'D3'], ['S4', 'S6', 'C4'], ['C6', 'C7', 'C8']],
    { bank: 20, contract, current: [[0, ['H10']]],
      bottom: ['S10', 'SK', 'D5', 'DK', 'C5', 'CK', 'S3', 'D4'] });
    // 已跟者须同步少一张；另外两家尚未出，在本夹具补回一张公开零分牌。
    for (const seat of [2, 3]) {
      const ledger = st.completedTricks[1].plays[0].cards;
      const i = ledger.findIndex((c) => pointsOf([c], st.config) === 0);
      st.players[seat].hand.push(ledger.splice(i, 1)[0]);
    }
    const ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 1);
    let sampled = 0;
    ai._r5Assignments = () => { sampled++; return []; };
    if (h === 2) ai._solveEndgame(st, 1, ctx);
    else ai._solvePIMC(st, 1, ctx, [st.players[1].hand[0]]);
    assert.ok(sampled > 0, `合同=${contract}须实际进入采样`);
  }
});

test('三家与底牌的软张数估计同时遵守行列总量', () => {
  const st = entryPosition(), ctx = new GreedyStrategy()._buildCtx(st, 1), k = ctx.knowledge;
  assert.equal(k.consistent, true);
  for (const seat of [0, 2, 3]) {
    const total = [...k.seats[seat].domains.values()].reduce((n, d) => n + d.count.expected, 0);
    assert.ok(Math.abs(total - k.seats[seat].handCount) < 1e-5);
  }
  for (const [dom, d] of k.domains) {
    const total = [0, 2, 3].reduce((n, seat) => n + k.seats[seat].domains.get(dom).count.expected, 0)
      + k.bottom.domains.get(dom).expected;
    assert.ok(Math.abs(total - d.unseen) < 1e-5, dom);
  }
  const actual = pointsOf(st.bottomCards, st.config);
  assert.ok(actual >= k.bottom.points.min && actual <= k.bottom.points.max);
});

test('整副未见牌只剩20分时，底分期望不能仍按35分估计', () => {
  const st = position([['H3', 'H4'], ['S3', 'S4'], ['C3', 'C4'], ['D3', 'D4']],
    { bottom: ['S10', 'SK', 'C6', 'C7', 'D6', 'D7', 'D8', 'D9'] });
  const k = new GreedyStrategy()._buildCtx(st, 1).knowledge;
  assert.ok(k.bottom.points.expected <= 20);
});

test('庄家已经获得的甩牌罚分计入合同距离，剩余实牌分不受罚分影响', () => {
  const st = entryPosition(), ai = new GreedyStrategy();
  const before = ai._buildCtx(st, 1);
  st.penaltyPoints = { dealer: 20, attackers: 0 };
  const after = ai._buildCtx(st, 1);
  assert.equal(after.sdy.need, before.sdy.need - 20);
  assert.equal(ai._remainingPoints(st, after), ai._remainingPoints(st, before));
});

test('留底对子需要接手入口；没有入口时应先兑现，不为假想末墩囤牌', () => {
  const st = position([['HA', 'HK', 'H2', 'H3'], ['S10', 'S10', 'C3', 'D3'],
    ['C4', 'C6', 'C7', 'C8'], ['C9', 'CJ', 'CQ', 'D4']],
  { bottom: ['SA', 'SK', 'SQ', 'SJ', 'DA', 'DK', 'DQ', 'D6'] });
  const ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 1), pair = st.players[1].hand.slice(0, 2);
  assert.equal(ai._lastTrickReserve(st, 1, pair, ctx, 20), 0);
  assert.deepEqual(names(ai.decidePlay(st, 1)), ['S10', 'S10']);
  assert.equal(handTempo(st.players[1].hand), 3);
});

function sealHidden(st, viewer) {
  let reads = 0;
  for (let s = 0; s < 4; s++) if (s !== viewer) Object.defineProperty(st.players[s], 'hand', {
    get() { reads++; throw Error('hidden hand'); }
  });
  Object.defineProperty(st, 'bottomCards', { get() { reads++; throw Error('hidden bottom'); } });
  return () => reads;
}

test('甩牌候选与未知A在庄家还是底牌无关，最终校验也不访问隐藏牌', () => {
  const st = position([['SA', 'D3'], ['SA', 'SK'], ['S4', 'D4'], ['S6', 'D6']],
    { bottom: ['C3', 'C4', 'C6', 'C7', 'C8', 'C9', 'CJ', 'CQ'] });
  const ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 1);
  const before = ai._legalPlays(st, 1, ctx).map(names);
  [st.players[0].hand[0], st.bottomCards[0]] = [st.bottomCards[0], st.players[0].hand[0]];
  assert.deepEqual(ai._legalPlays(st, 1, ai._buildCtx(st, 1)).map(names), before);
  const reads = sealHidden(st, 1);
  ai.decidePlay(st, 1);
  assert.equal(reads(), 0);
});

test('公开证据足以证明甩牌安全时仍保留候选，无需读取隐藏手牌', () => {
  const st = position([['D3', 'D4'], ['SA', 'SK'], ['C3', 'C4'], ['C6', 'C7']],
    { bottom: ['D6', 'D7', 'D8', 'D9', 'DJ', 'DQ', 'DA', 'C8'] });
  const ai = new GreedyStrategy(), reads = sealHidden(st, 1);
  const choices = ai._legalPlays(st, 1, ai._buildCtx(st, 1));
  assert.ok(choices.some((cs) => cs.length === 2));
  ai.decidePlay(st, 1);
  assert.equal(reads(), 0);
});

test('25张前期领出实际推进到第二墩，隐藏手牌保持隔离', () => {
  const cfg = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const deck = createRng(77).shuffle(buildDeck(cfg));
  const mine = ['H10', 'H10', 'HJ', 'HQ', 'HK', 'HA', 'H2', 'S2', 'C2', 'D2', 'JOKERRJ', 'JOKERBJ']
    .map((name) => deck.splice(deck.findIndex((c) => c.suit + c.rank === name), 1)[0]);
  mine.push(...deck.splice(0, 25 - mine.length));
  const st = makeState({ hands: [deck.splice(0, 25), mine, deck.splice(0, 25), deck.splice(0, 25)], turnIdx: 1 });
  st.config = cfg; st.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] }; st.contractScore = 90;
  st.bottomCards = deck;
  const ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 1);
  const candidates = ai._legalPlays(st, 1, ctx);
  let evaluated = 0;
  const leaf = ai._planValue;
  ai._planValue = function (ss) { assert.equal(ss.tricks.length, 2); evaluated++; return leaf.call(this, ss); };
  const reads = sealHidden(st, 1);
  ai._solveEarlyPlan(st, 1, ctx, candidates, candidates[0]);
  assert.ok(evaluated >= 6, '不能通过catch回退伪装推演成功');
  assert.equal(reads(), 0);
});

test('埋底先验提高分牌入底的采样权重，并且每份假设仍满足公开容量', () => {
  const cfg = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const deck = createRng(77).shuffle(buildDeck(cfg));
  const st = makeState({ hands: [deck.splice(0, 25), deck.splice(0, 25), deck.splice(0, 25), deck.splice(0, 25)], turnIdx: 1 });
  st.config = cfg; st.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] }; st.contractScore = 90; st.bottomCards = deck;
  const ai = new GreedyStrategy(), ctx = ai._buildCtx(st, 1);
  const groups = [0, 2, 3].map((seat) => ({ seat, size: 25, voids: new Set() }));
  ai._constrainPublicGroups(ctx, groups);
  const unseen = ai._r5UnseenCards(st, 1), belief = ai._beliefSpec(ctx, groups);
  const old = ai._r5Assignments(unseen, groups, st.trumpInfo, 48);
  const weighted = ai._r5Assignments(unseen, groups, st.trumpInfo, 48, belief);
  const mean = (xs) => xs.reduce((n, a) => n + pointsOf(a.bottom, cfg), 0) / xs.length;
  assert.ok(mean(weighted) > mean(old) + 5);
  assert.ok(mean(weighted) <= ctx.knowledge.bottom.points.max);
  for (const asg of weighted) {
    assert.equal(asg.bottom.length, 8);
    asg.hands.forEach((hand, i) => {
      assert.equal(hand.length, 25);
      for (const [d, b] of groups[i].domains) {
        const count = hand.filter((c) => domainOf(c, st.trumpInfo) === d).length;
        assert.ok(count >= b.count.min && count <= b.count.max);
      }
    });
  }
});
