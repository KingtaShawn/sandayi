'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeState } = require('./fixtures');
const { buildDeck } = require('../miniprogram/engine/deck');
const { createConfig } = require('../miniprogram/engine/config');
const { domainOf, parseCombo, pointsOf } = require('../miniprogram/engine/combo');
const { legalMoves, validatePlay } = require('../miniprogram/engine/validate');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');

// 完整公开牌账本：未指定的牌都已公开，未知底牌仍由推断单独分配。
function position(mine, { pending = false, dealer = ['HA', 'HK'], lead = ['SA', 'SK'],
  mate = ['C6', 'C7', 'C8', 'C9', 'CJ', 'CQ'], history = [], config = {}, rescue = null } = {}) {
  const cfg = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest', ...config });
  const pool = buildDeck(cfg);
  const take = (sp) => {
    const suit = ['BJ', 'RJ'].includes(sp) ? 'JOKER' : sp[0];
    const rank = suit === 'JOKER' ? sp : sp.slice(1);
    const idx = pool.findIndex((c) => c.suit === suit && c.rank === rank);
    assert.ok(idx >= 0, `牌不存在或重复：${sp}`);
    return pool.splice(idx, 1)[0];
  };
  const n = lead.length, h = mine.length;
  const state = makeState({ hands: [[], mine.map(take), pending ? mate.map(take) : [], []], turnIdx: 1 });
  state.config = cfg;
  state.contractScore = 90;
  state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  const trick = (records) => {
    const plays = records.map(([playerIdx, specs]) => {
      const cards = specs.map(take);
      return { playerIdx, cards, combo: parseCombo(cards, state.trumpInfo, cfg) };
    });
    return { leadPlayerIdx: plays[0].playerIdx, leadCombo: plays[0].combo, plays,
      winnerIdx: 2, points: pointsOf(plays.flatMap((p) => p.cards), cfg) };
  };
  state.currentTrick = trick(pending ? [[3, lead], [0, dealer]] : rescue
    ? [[2, lead], [0, dealer], [3, rescue]]
    : [[2, lead], [3, Array.from({ length: n }, (_, i) => `S${i + 3}`)], [0, dealer]]);
  state.completedTricks = history.map(trick);
  for (const seat of [0, 2, 3]) {
    const count = h - (state.currentTrick.plays.some((p) => p.playerIdx === seat) ? n : 0);
    const voids = new Set();
    for (const t of state.completedTricks.concat([state.currentTrick])) {
      const p = t.plays.find((p) => p.playerIdx === seat);
      if (p && seat !== t.leadPlayerIdx
          && p.cards.filter((c) => domainOf(c, state.trumpInfo) === t.leadCombo.suit).length < t.leadCombo.n) {
        voids.add(t.leadCombo.suit);
      }
    }
    while (state.players[seat].hand.length < count) {
      const i = pool.findIndex((c) => !voids.has(domainOf(c, state.trumpInfo)));
      assert.ok(i >= 0);
      state.players[seat].hand.push(pool.splice(i, 1)[0]);
    }
    assert.equal(state.players[seat].hand.length, count);
  }
  state.bottomCards = pool.splice(0, cfg.bottomCards);
  state.completedTricks.unshift({ leadCombo: null, plays: [{ playerIdx: 2, cards: pool }],
    winnerIdx: 2, points: pointsOf(pool, cfg) });
  return state;
}

const specs = (cs) => cs.map((c) => c.suit === 'JOKER' ? c.rank : c.suit + c.rank).sort();
function choose(state, ai = new GreedyStrategy()) {
  const before = structuredClone(state);
  const pick = ai.decidePlay(state, 1);
  assert.equal(validatePlay(state, 1, pick).ok, true);
  assert.deepEqual(state, before, '决策不得修改牌局');
  return pick;
}

test('闲家两单甩被庄家毙，末家应垫小主保10/K，候选须含副牌加小主', () => {
  const state = position(['C3', 'D10', 'DK', 'D5', 'H3', 'H4']);
  const moves = legalMoves(state, 1);
  assert.ok(moves.some((cs) => specs(cs).join() === 'C3,H3'), '必须有零分混垫候选');
  assert.deepEqual(specs(choose(state)), ['C3', 'H3']);
});

test('庄家毙四张甩牌，闲家不能为保两张小主而整包垫出分牌', () => {
  const state = position(['C3', 'C4', 'H3', 'H4', 'D10', 'DK'], {
    lead: ['SA', 'SK', 'SQ', 'SJ'], dealer: ['HA', 'HK', 'HQ', 'HJ']
  });
  assert.equal(pointsOf(choose(state), state.config), 0);
});

test('半跟甩牌已无法争胜：必须跟出的分照跟，其余用小主补齐保分', () => {
  const state = position(['S5', 'H3', 'H4', 'D10', 'DK', 'D5']);
  assert.deepEqual(specs(choose(state)), ['H3', 'S5']);
});

test('尚可超毙两单甩时应抢回已有分，不能只生成最小主牌组合后放弃', () => {
  const state = position(['H3', 'H4', 'S2', 'C2', 'D10', 'DK']);
  const pick = choose(state);
  assert.ok(pick.every((c) => domainOf(c, state.trumpInfo) === 'TRUMP'));
  const trick = structuredClone(state.currentTrick);
  trick.plays.push({ playerIdx: 1, cards: pick, combo: parseCombo(pick, state.trumpInfo, state.config) });
  assert.equal(resolveTrick(trick, state.trumpInfo, state.config).winnerIdx, 1);
});

test('主牌结构不足以超毙：留住大王后手，允许牺牲5分而非机械保所有分牌', () => {
  const state = position(['C3', 'C4', 'BJ', 'D5', 'D10', 'DK'], {
    lead: ['SA', 'SA', 'SK'], dealer: ['HA', 'HA', 'HK']
  });
  assert.deepEqual(specs(choose(state)), ['C3', 'C4', 'D5']);
});

test('若再送5分就让庄家达标，应优先保分，不能为了留大王直接送掉合同', () => {
  const state = position(['C3', 'C4', 'BJ', 'D5', 'D10', 'DK'], {
    lead: ['SA', 'SA', 'SK'], dealer: ['HA', 'HA', 'HK']
  });
  state.penaltyPoints = { dealer: 60, attackers: 0 };
  assert.equal(pointsOf(choose(state), state.config), 0);
});

test('同门有对必跟对：被庄家毙后也不能为保分扣住必须跟的1010', () => {
  const state = position(['S10', 'S10', 'S3', 'S4', 'SQ', 'SJ', 'D5'], {
    lead: ['SA', 'SA', 'SK'], dealer: ['HA', 'HA', 'HK']
  });
  const pick = choose(state);
  assert.equal(pick.filter((c) => c.suit + c.rank === 'S10').length, 2);
  assert.equal(pointsOf(pick, state.config), 20);
});

test('队友已成功超毙且庄家出过，仍应放心跑分', () => {
  const state = position(['C3', 'C4', 'D10', 'DK', 'H3', 'H4'], { rescue: ['S2', 'C2'] });
  assert.equal(pointsOf(choose(state), state.config), 20);
});

test('后位队友无力接手时，甩牌接力评估也必须比较保分候选', () => {
  const state = position(['C3', 'D10', 'DK', 'D5', 'H3', 'H4'], { pending: true });
  const ai = new GreedyStrategy(), ctx = ai._buildCtx(state, 1);
  const moves = legalMoves(state, 1);
  const pick = moves.find((cs) => pointsOf(cs, state.config) === 20);
  assert.ok(pick);
  ai._r5Assignments = () => [{ hands: [state.players[0].hand, state.players[2].hand, state.players[3].hand],
    bottom: state.bottomCards }];
  const safer = ai._chooseTeamFollow(state, 1, ctx, moves, pick);
  assert.ok(safer, '复杂甩牌不能跳过本墩接力评估');
  assert.equal(pointsOf(safer, state.config), 0);
});

test('后位队友能超毙接稳时，应把10/K交给队友收分', () => {
  const state = position(['C3', 'D10', 'DK', 'D5', 'H3', 'H4'], {
    pending: true, mate: ['BJ', 'H6', 'C6', 'C7', 'C8', 'C9']
  });
  const ai = new GreedyStrategy(), ctx = ai._buildCtx(state, 1), moves = legalMoves(state, 1);
  ai._r5Assignments = () => [{ hands: [state.players[0].hand, state.players[2].hand, state.players[3].hand],
    bottom: state.bottomCards }];
  const cautious = moves.find((cs) => specs(cs).join() === 'C3,H3');
  const fed = ai._chooseTeamFollow(state, 1, ctx, moves, cautious);
  assert.ok(fed);
  assert.equal(pointsOf(fed, state.config), 20);
});

test('自己待跑分多、两队友已公开无主时，应留住最后一张控制主接后续分', () => {
  const mine = ['C3', 'C4', 'HA', 'D5', 'D10', 'DK', 'D10'];
  const options = { pending: true, mate: ['C8', 'C9', 'CJ', 'CQ', 'D3', 'D4', 'D6'],
    lead: ['SA', 'SA', 'SK'], dealer: ['H2', 'H2', 'HK'] };
  const withSupport = position(mine, options);
  assert.deepEqual(specs(choose(withSupport)), ['C3', 'C4', 'HA']);
  const withoutSupport = position(mine, { ...options,
    history: [[[0, ['H6']], [2, ['C6']], [3, ['C7']], [1, ['H7']]]] });
  assert.deepEqual(specs(choose(withoutSupport)), ['C3', 'C4', 'D5']);
});

test('自己剩余分较少时，同样的队友无主证据也不应机械保住最后一张主', () => {
  const state = position(['C3', 'C4', 'HA', 'D5', 'D5', 'C5', 'C5'], {
    pending: true, mate: ['C8', 'C9', 'CJ', 'CQ', 'D3', 'D4', 'D6'],
    lead: ['SA', 'SA', 'SK'], dealer: ['H2', 'H2', 'HK'],
    history: [[[0, ['H6']], [2, ['C6']], [3, ['C7']], [1, ['H7']]]]
  });
  assert.deepEqual(specs(choose(state)), ['C3', 'C4', 'HA']);
});

test('反向出牌顺序下，甩牌被毙后的接力也遵循真实席位顺序', () => {
  const state = position(['C3', 'D10', 'DK', 'D5', 'H3', 'H4'], { pending: true });
  // 将席位1与3交换，得到1领出、0毙、3决策、2尚未出牌。
  [state.players[1], state.players[3]] = [state.players[3], state.players[1]];
  state.playOrder = [0, 3, 2, 1];
  state.turnIdx = 3;
  state.currentTrick.leadPlayerIdx = 1;
  state.currentTrick.plays[0].playerIdx = 1;
  const before = structuredClone(state), ai = new GreedyStrategy();
  const pick = ai.decidePlay(state, 3);
  assert.equal(pointsOf(pick, state.config), 0);
  assert.equal(validatePlay(state, 3, pick).ok, true);
  assert.deepEqual(state, before);
});

test('甩牌保分决策只读取公开牌及自己的手牌，不读取真实暗牌/底牌', () => {
  const state = position(['C3', 'D10', 'DK', 'D5', 'H3', 'H4'], { pending: true });
  const ai = new GreedyStrategy();
  const expected = specs(ai.decidePlay(state, 1));
  const reads = [];
  for (const seat of [0, 2, 3]) {
    const length = state.players[seat].hand.length;
    state.players[seat].hand = new Proxy([], { get(target, key) {
      if (key === 'length') return length;
      reads.push(`seat${seat}:${String(key)}`);
      throw new Error(`偷看席位${seat}暗牌：${String(key)}`);
    } });
  }
  Object.defineProperty(state, 'bottomCards', { get() { reads.push('bottom'); throw new Error('偷看底牌'); } });
  assert.deepEqual(specs(ai.decidePlay(state, 1)), expected);
  assert.deepEqual(reads, [], '推演静默回退也不能掩盖读取真实暗牌');
});

test('H5浏览器打包策略与共享引擎都不再为保小主向庄家送分', () => {
  const state = position(['C3', 'D10', 'DK', 'D5', 'H3', 'H4']);
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../h5/js/game-bundle.js'), 'utf8'), browser);
  const ai = new browser.window.GameCore.GameService().ai;
  assert.deepEqual(Array.from(specs(choose(state, ai))), ['C3', 'H3']);
});
