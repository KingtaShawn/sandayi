'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeState } = require('./fixtures');
const { createConfig } = require('../miniprogram/engine/config');
const { buildDeck } = require('../miniprogram/engine/deck');
const { domainOf, parseCombo, pointsOf } = require('../miniprogram/engine/combo');
const { validatePlay } = require('../miniprogram/engine/validate');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { createInitialState } = require('../miniprogram/core/state');
const { runRoundToScoring } = require('../miniprogram/core/dealer-ai-loop');
const { createRng } = require('../miniprogram/utils/random');

// 全副牌账目平衡的残局。未列出的牌均已公开；未知手牌和底牌只供检查推断的边界。
function position(specs, { viewer = 1, bottom = [], history = [], current = null, config = {} } = {}) {
  const cfg = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest', ...config });
  const pool = buildDeck(cfg);
  const take = (sp) => {
    const suit = ['BJ', 'RJ'].includes(sp) ? 'JOKER' : sp[0];
    const rank = suit === 'JOKER' ? sp : sp.slice(1);
    const idx = pool.findIndex((c) => c.suit === suit && c.rank === rank);
    assert.ok(idx >= 0, `重复或不存在的牌 ${sp}`);
    return pool.splice(idx, 1)[0];
  };
  const state = makeState({ hands: specs.map((ss) => ss.map(take)), turnIdx: viewer });
  state.config = cfg;
  state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  state.contractScore = 90;
  const trick = (records) => {
    const plays = records.map(([playerIdx, ss]) => {
      const cards = ss.map(take);
      return { playerIdx, cards, combo: parseCombo(cards, state.trumpInfo, cfg) };
    });
    return { leadPlayerIdx: plays[0].playerIdx, leadCombo: plays[0].combo, plays,
      winnerIdx: 1, points: pointsOf(plays.flatMap((p) => p.cards), cfg) };
  };
  state.completedTricks = history.map(trick);
  state.currentTrick = current && trick(current);
  state.bottomCards = bottom.map(take);
  while (state.bottomCards.length < cfg.bottomCards) state.bottomCards.push(pool.shift());
  // 此记录只作为公开牌账本，不引入跟牌/缺门证据。
  state.completedTricks.unshift({ leadCombo: null, plays: [{ playerIdx: 1, cards: pool }],
    winnerIdx: 1, points: pointsOf(pool, cfg) });
  return state;
}

const ctxOf = (state, viewer = state.turnIdx) => new GreedyStrategy()._buildCtx(state, viewer);
const trumpsOf = (ctx) => ctx.knowledge.seats[0].domains.get('TRUMP');
function choose(state) {
  const before = structuredClone(state);
  const pick = new GreedyStrategy().decidePlay(state, state.turnIdx);
  assert.equal(validatePlay(state, state.turnIdx, pick).ok, true);
  assert.deepEqual(state, before, '公开记牌和配合评估不得修改真实牌局');
  return pick.map((c) => c.suit + c.rank);
}

test('未知主牌包括底牌，不能把队友缺主后的全部未见主牌算在庄家手里', () => {
  const state = position([
    ['H8', 'H9', 'D3', 'C3'], ['S3', 'S4', 'D4', 'C4'],
    ['S6', 'S7', 'D6', 'C6'], ['S8', 'S9', 'D7', 'C7']
  ], { bottom: ['H10', 'HJ', 'HQ', 'HK', 'SA', 'CA', 'DA', 'D8'],
    history: [[[0, ['H3']], [2, ['S10']], [3, ['C10']]]] });
  const ctx = ctxOf(state), tr = trumpsOf(ctx);
  assert.equal(ctx.knowledge.consistent, true);
  assert.deepEqual([tr.count.min, tr.count.max], [0, 4]);
  assert.ok(tr.count.expected >= 0 && tr.count.expected <= 4);
  assert.equal(ctx.knowledge.domains.get('TRUMP').unseen, 6);
});

test('公开容量足以确定时，庄家剩余主牌数应收敛为确数', () => {
  const state = position([
    ['H8', 'H9', 'H10', 'HJ'], ['S3', 'S4', 'D4', 'C4'],
    ['S6', 'S7', 'D6', 'C6'], ['S8', 'S9', 'D7', 'C7']
  ], { bottom: ['HQ', 'HK', 'HA', 'H2', 'S2', 'C2', 'BJ', 'RJ'],
    history: [[[0, ['H3']], [2, ['S10']], [3, ['C10']]]] });
  const tr = trumpsOf(ctxOf(state));
  assert.deepEqual([tr.count.min, tr.count.max, tr.count.expected], [4, 4, 4]);
});

test('当前墩已出的牌立即从庄家容量和主牌/主对计数扣除', () => {
  const state = position([
    ['H8'], ['S3', 'S4', 'D4'], ['S6', 'S7', 'D6'], ['S8', 'S9', 'D7']
  ], { current: [[0, ['H10', 'H10']]] });
  const ctx = ctxOf(state), tr = trumpsOf(ctx);
  assert.equal(ctx.knowledge.consistent, true);
  assert.equal(ctx.knowledge.seats[0].handCount, 1);
  assert.equal(tr.count.max, 1);
  assert.equal(tr.pairs.max, 0);
  assert.equal(ctx.knowledge.domains.get('TRUMP').entries.find((e) => e.key === 'H-10').n, 0);
});

test('庄家主对墩散跟：仍可能有主散张，但主对上界已为0', () => {
  const state = position([
    ['H8', 'H9', 'D3'], ['S3', 'S3', 'CK'], ['S6', 'S7', 'D6'], ['S8', 'S9', 'D7']
  ], { history: [[[2, ['H4', 'H4']], [0, ['H6', 'H7']]]] });
  const ctx = ctxOf(state), tr = trumpsOf(ctx);
  assert.ok(tr.count.max > 0);
  assert.deepEqual(tr.pairs, { min: 0, max: 0, expected: 0 });
  assert.equal(new GreedyStrategy()._dealerCanRuff(parseCombo(state.players[1].hand.slice(0, 2), state.trumpInfo, state.config), ctx), false);
});

for (const domain of ['H', 'S']) {
  test(`${domain}对子半跟后，该门已出尽，当前墩也应立即用于记牌`, () => {
    const state = position([
      ['D3', 'D4'], ['C3', 'C4', 'C6', 'C7'], ['D6', 'D7'], ['D8', 'D9', 'DJ', 'DQ']
    ], { current: [[2, [`${domain}4`, `${domain}4`]], [0, [`${domain}6`, 'CK']]] });
    const dom = ctxOf(state).knowledge.seats[0].domains.get(domain === 'H' ? 'TRUMP' : domain);
    assert.equal(dom.count.max, 0);
    assert.equal(dom.pairs.max, 0);
  });
}

test('各门剩余分包括自己手牌和未见底牌，级牌分要归到主牌域', () => {
  const state = position([
    ['S5', 'D3'], ['SK', 'C4'], ['D10', 'S6'], ['C5', 'D7']
  ], { bottom: ['S10', 'H5', 'C10', 'CK', 'D5', 'DK', 'S8', 'S9'] });
  // 将级别改为5：四门的5都属于主。
  state.trumpInfo = require('../miniprogram/engine/trump').buildTrumpInfo('H', '5', state.config);
  const k = ctxOf(state).knowledge;
  assert.equal(k.domains.get('S').remainingPoints, 20);
  assert.equal(k.domains.get('S').unseenPoints, 10);
  assert.equal(k.domains.get('TRUMP').remainingPoints, 20);
  assert.equal([...k.domains.values()].reduce((n, d) => n + d.remainingPoints, 0),
    200 - ctxOf(state).mem.pointsPlayed);
});

for (const hasPoints of [false, true]) {
  test(`队友J暂领先：该门${hasPoints ? '还有K分，应以A接力保分' : '分已出尽，不再烧A抢白墩'}`, () => {
    const state = position([
      [hasPoints ? 'SK' : 'SQ', 'D3', 'D4', 'D6'], ['SA', 'S3', 'H2', 'C3'],
      ['D7', 'D8', 'D9'], ['CJ', 'CQ', 'CA', 'C7']
    ], { current: [[2, ['SJ']]], bottom: ['C3', 'C4', 'C6', 'C7', 'C8', 'C9', 'D9', 'DJ'] });
    assert.equal(ctxOf(state).knowledge.domains.get('S').remainingPoints, hasPoints ? 10 : 0);
    assert.deepEqual(choose(state), [hasPoints ? 'SA' : 'S3']);
  });
}

test('副牌还有桌面分时仍须用A接分，不能把剩余分为0误当成本墩没有分', () => {
  const state = position([
    ['SQ', 'D3', 'D4', 'D6'], ['SA', 'S3', 'H2', 'C3'],
    ['D7', 'D8', 'D9'], ['CJ', 'CQ', 'CA', 'C7']
  ], { current: [[2, ['S10']]], bottom: ['C3', 'C4', 'C6', 'C7', 'C8', 'C9', 'D9', 'DJ'] });
  assert.equal(ctxOf(state).knowledge.domains.get('S').remainingPoints, 0);
  assert.deepEqual(choose(state), ['SA']);
});

test('庄家已无主且同门大牌已尽，主动跑K分', () => {
  const state = position([
    ['S4', 'D3', 'D4'], ['SK', 'S3', 'DA'], ['S6', 'D6', 'C6'], ['S7', 'D7', 'C7']
  ], { bottom: ['C3', 'C4', 'C8', 'C9', 'CJ', 'CQ', 'D8', 'D9'] });
  assert.equal(trumpsOf(ctxOf(state)).count.max, 0);
  assert.deepEqual(choose(state), ['SK']);
});

test('庄家无主对时敢走副牌分对，大主散张不能形成将吃威胁', () => {
  const state = position([
    ['HA', 'H2', 'D3'], ['S10', 'S10', 'CA'], ['S3', 'D6', 'C6'], ['S4', 'D7', 'C7']
  ], { bottom: ['C3', 'C4', 'C8', 'C9', 'CJ', 'CQ', 'D8', 'D9'],
    history: [[[2, ['H4', 'H4']], [0, ['H6', 'H7']]]] });
  assert.deepEqual(choose(state), ['S10', 'S10']);
});

test('队友副牌小对锁墩，庄家缺该门且无主对时提前喂20分', () => {
  const state = position([
    ['HA', 'H2', 'D3', 'D4'], ['D6', 'D7'], ['D10', 'DK', 'C3', 'C4'], ['S4', 'D8', 'C7', 'C8']
  ], { viewer: 2, current: [[1, ['S3', 'S3']]],
    history: [[[2, ['H4', 'H4']], [0, ['H6', 'H7']]], [[1, ['S6']], [0, ['C6']]]] });
  assert.equal(new GreedyStrategy()._teamLocked(state, 2, ctxOf(state), state.currentTrick), true);
  assert.equal(pointsOf(new GreedyStrategy().decidePlay(state, 2), state.config), 20);
  choose(state);
});

test('空牌仍可逼庄烧主：主牌尚在时，分牌不轻送', () => {
  const state = position([
    ['HA', 'H2', 'D3'], ['SK', 'S3', 'C4'], ['S6', 'D6', 'C6'], ['S7', 'D7', 'C7']
  ], { bottom: ['C3', 'C4', 'C8', 'C9', 'CJ', 'CQ', 'D8', 'D9'],
    history: [[[2, ['S8']], [0, ['H6']]]] });
  assert.ok(trumpsOf(ctxOf(state)).count.max > 0);
  assert.ok(!choose(state).includes('SK'));
  const ai = new GreedyStrategy();
  assert.ok(ai._scoreLead(state, 1, [state.players[1].hand[1]], ctxOf(state)) >= 6);
});

test('临近末墩有大王接手入口时保留副牌控制对拿底；只剩最后这对时应立即打出', () => {
  const state = position([
    ['HA', 'H2', 'D3', 'D4'], ['S3', 'S3', 'BJ', 'D6'], ['S6', 'D7', 'C6', 'C8'], ['S7', 'D8', 'C7', 'C9']
  ], { bottom: ['S10', 'SK', 'D5', 'DK', 'C10', 'CK', 'D9', 'DJ'],
    history: [[[2, ['H4', 'H4']], [0, ['H6', 'H7']]]] });
  const ai = new GreedyStrategy(), ctx = ctxOf(state), pair = state.players[1].hand.slice(0, 2);
  assert.ok(ai._lastTrickReserve(state, 1, pair, ctx, 0) > 0, '小副对也是末墩控制资产');
  assert.equal(ai._lastTrickReserve(state, 1, pair, ctx, 40), 0, '本墩大分可抵消留底机会成本');
  state.players[1].hand = pair;
  assert.equal(ai._lastTrickReserve(state, 1, pair, ctx, 0), 0, '末墩不再省控制牌');
});

test('主牌散跟证据约束后续采样，不能再给庄家分配主对', () => {
  const state = position([
    ['H8', 'H9', 'D3', 'D4'], ['S3', 'S3', 'C4', 'D6'], ['S6', 'D7', 'C6', 'C8'], ['S7', 'D8', 'C7', 'C9']
  ], { bottom: ['HA', 'HA', 'D5', 'DK', 'C10', 'CK', 'D9', 'DJ'],
    history: [[[2, ['H4', 'H4']], [0, ['H6', 'H7']]]] });
  const ai = new GreedyStrategy(), ctx = ctxOf(state);
  const groups = [0, 2, 3].map((seat) => ({ seat, size: 4, voids: new Set() }));
  ai._constrainPublicGroups(ctx, groups);
  const samples = ai._r5Assignments(ai._r5UnseenCards(state, 1), groups, state.trumpInfo, 24);
  assert.ok(samples.length > 0);
  for (const asg of samples) {
    const trumps = asg.hands[0].filter((c) => domainOf(c, state.trumpInfo) === 'TRUMP');
    assert.equal(new Set(trumps.map((c) => c.suit + c.rank)).size, trumps.length);
  }
});

test('副牌两单甩被队友主对毙，不能按对子锁墩：庄家更大主散张仍可超毙', () => {
  const state = position([
    ['HA', 'HK', 'D3', 'D4'], ['D6', 'D7'], ['C6', 'C7'], ['D10', 'DK', 'C3', 'C4']
  ], { viewer: 3, current: [[1, ['SA', 'SK']], [2, ['H9', 'H9']]],
    bottom: ['C3', 'C4', 'C8', 'C9', 'CJ', 'CQ', 'D8', 'D9'] });
  const ctx = ctxOf(state);
  assert.equal(trumpsOf(ctx).pairs.max, 0);
  assert.equal(new GreedyStrategy()._teamLocked(state, 3, ctx, state.currentTrick), false);
});

for (const h of [2, 4, 12]) {
  test(`${h}张阶段记牌/推演不读取真实庄家、队友手牌或底牌`, () => {
    const cfg = createConfig({ gameMode: 'san_da_yi' }), deck = buildDeck(cfg);
    const choices = ['S3', 'D4', 'C6', 'H7', 'S8', 'D9', 'CJ', 'HQ', 'SA', 'D3', 'C4', 'H6'];
    const mine = choices.slice(0, h).map((sp) => deck.find((c) => c.suit + c.rank === sp));
    const pool = deck.filter((c) => !mine.includes(c));
    const state = makeState({ hands: [pool.splice(0, h), mine, pool.splice(0, h), pool.splice(0, h)], turnIdx: 1 });
    state.config = cfg; state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] }; state.contractScore = 5;
    state.bottomCards = pool.splice(0, 8);
    state.completedTricks = [{ leadCombo: null, plays: [{ playerIdx: 1, cards: pool }], winnerIdx: 1, points: pointsOf(pool, cfg) }];
    const ai = new GreedyStrategy(), ctx = ai._buildCtx(state, 1), pick = [mine[0]];
    let hiddenReads = 0;
    for (const s of [0, 2, 3]) Object.defineProperty(state.players[s], 'hand', {
      get() { hiddenReads++; throw new Error('偷看隐藏手牌'); }
    });
    Object.defineProperty(state, 'bottomCards', { get() { hiddenReads++; throw new Error('偷看底牌'); } });
    assert.deepEqual(ai._buildCtx(state, 1).knowledge, ctx.knowledge);
    let sampled = 0;
    const assign = ai._r5Assignments;
    ai._r5Assignments = function (...args) { sampled++; return assign.apply(this, args); };
    if (h === 2) assert.ok(ai._solveEndgame(state, 1, ctx), '残局须实际完成求解，不能由catch吞掉偷看异常');
    if (h === 4) ai._solvePIMC(state, 1, ctx, pick);
    if (h <= 4) assert.ok(sampled > 0, '隐藏信息隔离须实际进入采样路径');
    assert.equal(hiddenReads, 0, '即使异常被推演回退捕获，也不允许读取隐藏牌');
  });
}

test('残局多家缺门且底牌容量紧约束时，软估计仍须满足各家剩余张数', () => {
  const state = position([['D6'], ['DJ', 'CA'], ['S10'], ['H6']], {
    bottom: ['S5', 'S10', 'CK', 'S4', 'C3', 'S8', 'C4', 'C6'],
    current: [[2, ['CA']], [3, ['H4']], [0, ['H5']]],
    history: [[[1, ['S3']], [0, ['D3']], [3, ['D4']]], [[1, ['D3']], [2, ['S3']]]]
  });
  const k = ctxOf(state).knowledge;
  assert.equal(k.consistent, true);
  for (let seat = 0; seat < 4; seat++) {
    const expected = [...k.seats[seat].domains.values()].reduce((n, d) => n + d.count.expected, 0);
    assert.ok(Math.abs(expected - state.players[seat].hand.length) < 1e-5, `seat=${seat} 估计容量`);
  }
});

test('双方向10局：持牌范围包含真值，浏览器bundle逐手一致，零非法且200分守恒', () => {
  let checked = 0;
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../h5/js/game-bundle.js'), 'utf8'), browser);
  assert.equal(browser.process, undefined);
  const bundleAI = new browser.window.GameCore.GameService().ai;
  for (const playDirection of ['clockwise', 'counterclockwise']) {
    const cfg = createConfig({ gameMode: 'san_da_yi', playDirection, throwPenalty: 'penalty_smallest' });
    const ai = new (require('../miniprogram/services/game-service').GameService)().ai, build = ai._buildCtx;
    const sourceDecide = ai.decidePlay;
    ai.decidePlay = function (state, seat, rng) {
      const pick = sourceDecide.call(this, state, seat, rng);
      const bundled = bundleAI.decidePlay(state, seat, rng);
      assert.equal(bundled.map((c) => c.id).sort().join('|'), pick.map((c) => c.id).sort().join('|'));
      return pick;
    };
    ai._buildCtx = function (state, seat) {
      const ctx = build.call(this, state, seat);
      if (ctx.knowledge) {
        assert.equal(ctx.knowledge.consistent, true);
        const k = ctx.knowledge, actualBottom = pointsOf(state.bottomCards, state.config);
        assert.ok(actualBottom >= k.bottom.points.min && actualBottom <= k.bottom.points.max);
        for (const [dom, d] of k.domains) {
          const expected = [0, 1, 2, 3].filter((s) => s !== seat)
            .reduce((n, s) => n + k.seats[s].domains.get(dom).count.expected, 0)
            + k.bottom.domains.get(dom).expected;
          assert.ok(Math.abs(expected - d.unseen) < 1e-5, `联合估计 ${dom} 守恒`);
        }
        for (const s of [0, 1, 2, 3]) {
          const byDomain = ctx.knowledge.seats[s].domains;
          const expected = [...byDomain.values()].reduce((n, d) => n + d.count.expected, 0);
          assert.ok(Math.abs(expected - state.players[s].hand.length) < 1e-5, `seat=${s} 估计容量`);
          for (const [d, b] of byDomain) {
            const hand = state.players[s].hand.filter((c) => domainOf(c, state.trumpInfo) === d);
            const keys = new Map();
            hand.forEach((c) => { const k = c.suit + c.rank; keys.set(k, (keys.get(k) || 0) + 1); });
            const pairs = [...keys.values()].reduce((n, k) => n + Math.floor(k / 2), 0);
            assert.ok(hand.length >= b.count.min && hand.length <= b.count.max, `seat=${s} ${d} count`);
            assert.ok(pairs >= b.pairs.min && pairs <= b.pairs.max, `seat=${s} ${d} pairs`);
          }
        }
        checked++;
      }
      return ctx;
    };
    for (let seed = 1; seed <= 5; seed++) {
      let state = createInitialState(cfg, null, createRng(seed));
      for (let guard = 1; guard <= 10; guard++) {
        const result = runRoundToScoring(state, ai, createRng(seed * 13 + guard));
        assert.equal(result.illegalCount, 0);
        state = result.state;
        if (state.phase !== 'INIT_DEAL') break;
      }
      assert.equal(state.phase, 'SCORING');
      assert.equal(state.lastSettle.dealerPoints + state.lastSettle.attackerPoints, 200);
    }
  }
  assert.ok(checked > 500);
});
