'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadStrategy, dealerProfile, prepare, scenarios, pairedStats } = require('../tools/ai-arena');
const { transition } = require('../miniprogram/core/statemachine');
const { serializeState } = require('../miniprogram/core/state');
const { validatePlay } = require('../miniprogram/engine/validate');
const { domainOf, parseCombo } = require('../miniprogram/engine/combo');
const { createRng } = require('../miniprogram/utils/random');
const { createConfig } = require('../miniprogram/engine/config');
const { createInitialState } = require('../miniprogram/core/state');
const { buildDeck } = require('../miniprogram/engine/deck');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { play } = require('../tools/ai-arena');

const FILE = path.resolve(__dirname, '../miniprogram/ai/strategy-greedy.js');
const profiles = ['normal', 'pressure', 'cash', 'low-bottom'];
let checked = 0, sealed = 0;
const phases = new Set(), seats = new Set(), forms = new Set();

test('评测矩阵均衡覆盖四种庄家、双方向和四个首报位置，留出种子与调试种子分离', () => {
  const train = scenarios(256, 401), holdout = scenarios(1024, 10001);
  const seen = new Set(train.map((s) => s.seed));
  assert.ok(holdout.every((s) => !seen.has(s.seed)));
  for (const p of profiles) for (const dir of ['clockwise', 'counterclockwise']) for (let seat = 0; seat < 4; seat++) {
    assert.equal(train.filter((s) => s.profile === p && s.direction === dir && s.firstBidder === seat).length, 8);
  }
});

test('对照开关在同进程隔离：改变加载顺序不串改另一实例的胜率目标', () => {
  const a = loadStrategy(FILE, { AI_WIN_OBJECTIVE: 'off' });
  const b = loadStrategy(FILE, { AI_WIN_OBJECTIVE: 'all' });
  const c = loadStrategy(FILE, { AI_WIN_OBJECTIVE: 'off' });
  const ctx = { sdy: { isDealer: false, need: 10 } };
  assert.equal(a._useWinObjective(ctx, 4, 20), false);
  assert.equal(b._useWinObjective(ctx, 4, 20), true);
  assert.equal(c._useWinObjective(ctx, 4, 20), false);
});

test('胜率目标优先选择八成守住合同，不能被低平均庄分却六成输局的方案诱导', () => {
  const ai = loadStrategy(FILE);
  const value = (dPts, winObjective) => ai._r5TerminalOf({ dealerIdx: 0, bankDealerPts: dPts,
    contractScore: 90, bottomPts: 0, tricks: [], winObjective });
  const safe = [85, 85, 85, 85, 85, 85, 85, 85, 100, 100];
  const risky = [0, 0, 0, 0, 100, 100, 100, 100, 100, 100];
  const mean = (xs, flag) => xs.reduce((n, p) => n + value(p, flag), 0) / xs.length;
  assert.ok(mean(risky, false) < mean(safe, false), '旧平均分目标会选高风险方案');
  assert.ok(mean(safe, true) < mean(risky, true), '闲家最小化庄家合同胜率');
  assert.ok(value(90, true) > value(85, true), '庄家恰好到合同线也算赢');
});

test('配对统计保留一赢一输的抵消，不能把不同牌局当独立胜率差', () => {
  const rows = [
    { results: { points: { win: false, points: 90, bottom: false, bottomPoints: 0 }, next: { win: true, points: 110, bottom: true, bottomPoints: 20 } } },
    { results: { points: { win: true, points: 120, bottom: true, bottomPoints: 20 }, next: { win: false, points: 100, bottom: false, bottomPoints: 0 } } }
  ];
  const s = pairedStats(rows, 'next');
  assert.equal(s.gained, 1); assert.equal(s.lost, 1);
  assert.equal(s.win.mean, 0); assert.equal(s.points.mean, 0);
  assert.ok(s.win.ci95[0] < 0 && s.win.ci95[1] > 0);
});

test('胜率目标只用于闲家最后六张且合同未定，已经赢输确定后保留争分目标', () => {
  const ai = loadStrategy(FILE);
  for (const h of [2, 3, 4, 5, 6]) assert.equal(ai._useWinObjective({ sdy: { isDealer: false, need: 10 } }, h, 20), true);
  assert.equal(ai._useWinObjective({ sdy: { isDealer: false, need: 10 } }, 7, 20), false);
  assert.equal(ai._useWinObjective({ sdy: { isDealer: true, need: 10 } }, 4, 20), false);
  assert.equal(ai._useWinObjective({ sdy: { isDealer: false, need: 0 } }, 4, 20), false);
  assert.equal(ai._useWinObjective({ sdy: { isDealer: false, need: 25 } }, 4, 20), false);
});

function replayPosition(f) {
  const cfg = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest', playDirection: f.scenario.direction });
  const deck = new Map(buildDeck(cfg).map((c) => [c.id, c]));
  const take = (ids) => ids.map((id) => { assert.ok(deck.has(id), id); return deck.get(id); });
  const st = createInitialState(cfg, null, createRng(f.scenario.seed), { dealerIdx: f.dealer });
  st.phase = 'PLAYING'; st.contractScore = f.contract;
  st.turnIdx = f.seat; st.buryDone = true; st.bottomMerged = true;
  st.sanDaYiTeams = { dealer: f.dealer, attackers: [0, 1, 2, 3].filter((s) => s !== f.dealer) };
  st.trumpInfo = buildTrumpInfo(f.trump.trumpSuit, f.trump.levelRank, cfg);
  st.players.forEach((p, i) => { p.hand = take(f.hands[i]); });
  st.bottomCards = take(f.bottom);
  const trick = (records) => {
    const plays = records.map(([playerIdx, ids]) => { const cards = take(ids);
      return { playerIdx, cards, combo: parseCombo(cards, st.trumpInfo, cfg) }; });
    return { leadPlayerIdx: plays[0].playerIdx, leadCombo: plays[0].combo, plays };
  };
  st.completedTricks = f.past.map((t) => { const out = trick(t.plays); resolveTrick(out, st.trumpInfo, cfg);
    assert.equal(out.winnerIdx, t.winner); assert.equal(out.points, t.points); return out; });
  st.currentTrick = f.current.length ? trick(f.current) : null;
  const all = f.hands.flat().concat(f.bottom, f.past.flatMap((t) => t.plays.flatMap((p) => p[1])), f.current.flatMap((p) => p[1]));
  assert.equal(all.length, 108); assert.equal(new Set(all).size, 108);
  return st;
}

for (const fixture of require('./fixtures/ai-contract-replays.json')) {
  test(`训练失败回放seed=${fixture.scenario.seed}：同一完整残局由失合同改为守住合同`, () => {
    const st = replayPosition(fixture), points = loadStrategy(FILE, { AI_WIN_OBJECTIVE: 'off' }), next = loadStrategy(FILE);
    assert.deepEqual(points.decidePlay(st, fixture.seat).map((c) => c.id), fixture.previous);
    assert.deepEqual(next.decidePlay(st, fixture.seat).map((c) => c.id), fixture.expected);
    const dealer = dealerProfile(FILE, fixture.scenario.profile);
    assert.equal(play(st, fixture.scenario, dealer, points).win, false);
    assert.equal(play(st, fixture.scenario, dealer, next).win, true);
  });
}

for (const profile of profiles) for (const direction of ['clockwise', 'counterclockwise']) for (let firstBidder = 0; firstBidder < 4; firstBidder++) {
  test(`实战生成回归：${profile}/${direction}/首报${firstBidder}，合法、纯函数、暗牌隔离、记牌范围`, () => {
    const i = profiles.indexOf(profile) * 8 + (direction === 'clockwise' ? 4 : 0) + firstBidder;
    const scenario = { seed: 25001 + i, profile, direction, firstBidder,
      config: { mustFollowPairAsPair: firstBidder % 2 === 0, throwPenalty: firstBidder < 2 ? 'reject' : 'penalty_smallest',
        sanDaYiAllowTractor: firstBidder >= 2 } };
    const dealer = dealerProfile(FILE, profile), ai = loadStrategy(FILE);
    let st = prepare(scenario, dealer, dealer);
    seats.add(st.dealerIdx);
    for (let step = 0; step < 200 && st.phase === 'PLAYING'; step++) {
      const seat = st.turnIdx, attacker = seat !== st.dealerIdx;
      const before = JSON.stringify(serializeState(st));
      const pick = (attacker ? ai : dealer).decidePlay(st, seat, createRng(step));
      assert.equal(validatePlay(st, seat, pick).ok, true);
      assert.equal(JSON.stringify(serializeState(st)), before, `seed=${scenario.seed} step=${step} 决策改变状态`);
      if (attacker) {
        checked++;
        const h = st.players[seat].hand.length;
        phases.add(h > 10 ? 'early' : h > 2 ? 'middle' : 'end');
        const lead = st.currentTrick ? st.currentTrick.leadCombo : parseCombo(pick, st.trumpInfo, st.config);
        forms.add(lead.type);
        const ctx = ai._buildCtx(st, seat), k = ctx.knowledge;
        assert.equal(k.consistent, true);
        for (let s = 0; s < 4; s++) for (const [d, range] of k.seats[s].domains) {
          const hand = st.players[s].hand.filter((c) => domainOf(c, st.trumpInfo) === d);
          const keys = new Map();
          hand.forEach((c) => keys.set(c.suit + c.rank, (keys.get(c.suit + c.rank) || 0) + 1));
          const pairs = [...keys.values()].reduce((n, c) => n + Math.floor(c / 2), 0);
          assert.ok(hand.length >= range.count.min && hand.length <= range.count.max);
          assert.ok(pairs >= range.pairs.min && pairs <= range.pairs.max);
        }
        // 所有阶段均封住真实暗牌，catch回退也会留下读取计数。
        const view = structuredClone(st); let reads = 0;
        for (let s = 0; s < 4; s++) if (s !== seat) Object.defineProperty(view.players[s], 'hand', {
          get() { reads++; throw Error('读取真实对手手牌'); }
        });
        Object.defineProperty(view, 'bottomCards', { get() { reads++; throw Error('读取真实底牌'); } });
        const hiddenPick = ai.decidePlay(view, seat, createRng(step));
        assert.equal(reads, 0);
        assert.deepEqual(hiddenPick.map((c) => c.id), pick.map((c) => c.id));
        sealed++;
        // 每次推演撤销必须恢复原手牌顺序，否则会改变下一兄弟分支的候选。
        if (h <= 4) {
          const groups = [0, 1, 2, 3].filter((s) => s !== seat);
          const ss = ai._r5SimState(st, ctx, seat, groups,
            { hands: groups.map((s) => st.players[s].hand), bottom: st.bottomCards }, 0);
          const hands = ss.players.map((p) => p.hand.map((c) => c.id));
          const undo = ai._r5Apply(ss, seat, pick, parseCombo(pick, st.trumpInfo, st.config));
          undo();
          assert.deepEqual(ss.players.map((p) => p.hand.map((c) => c.id)), hands);
          assert.equal(ss.tricks.length, 0);
        }
      }
      st = transition(st, { type: 'PLAY', playerIdx: seat, cards: pick, ts: 0 });
    }
    assert.equal(st.phase, 'SCORING');
    assert.equal(st.lastSettle.attackerPoints + st.lastSettle.dealerPoints, 200);
  });
}

test('实战覆盖汇总：三阶段、四个庄位、单对拖甩都必须实际执行', () => {
  assert.ok(checked >= 1200, `实际覆盖 ${checked} 次闲家决策`);
  assert.equal(sealed, checked);
  assert.equal(phases.size, 3); assert.equal(seats.size, 4);
  for (const form of ['single', 'pair', 'tractor', 'throw']) assert.ok(forms.has(form), form);
  console.log(`[AI生成回归] 32局，${checked}次闲家决策，${sealed}次暗牌封锁检查`);
});
