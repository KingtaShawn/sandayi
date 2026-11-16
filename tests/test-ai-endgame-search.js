'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeState, cards, cardsD, C } = require('./fixtures');
const { createConfig } = require('../miniprogram/engine/config');
const { buildDeck } = require('../miniprogram/engine/deck');
const { parseCombo } = require('../miniprogram/engine/combo');
const { validatePlay } = require('../miniprogram/engine/validate');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { createRng } = require('../miniprogram/utils/random');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');

function simulation(hands, direction = 'counterclockwise', dealer = 0) {
  const st = makeState({ hands, dealerIdx: dealer });
  st.config = createConfig({ gameMode: 'san_da_yi', playDirection: direction });
  st.playOrder = direction === 'clockwise' ? [0, 3, 2, 1] : [0, 1, 2, 3];
  return Object.assign(st, { tricks: [], bankDealerPts: 55, bottomPts: 35,
    contractScore: 90, winObjective: true, exactEndgame: true,
    endgameCache: new Map(), endgameMoveCache: new Map() });
}

const key = (cs) => cs.map((c) => c.suit + c.rank).sort().join(',');

test('小残局补齐所有合法甩牌子集，不能只看整门和最大两张', () => {
  const st = simulation([cards('SA', 'SK', 'SQ', 'SJ'), cards('C3', 'D3', 'H3', 'C4'),
    cards('C6', 'D6', 'H6', 'C7'), cards('C8', 'D8', 'H8', 'C9')]);
  const ai = new GreedyStrategy(), moves = ai._endgameMoves(st, 0);
  assert.equal(moves.length, 15);
  for (const wanted of [cards('SA', 'SJ'), cards('SK', 'SQ', 'SJ'), cards('SA', 'SQ')]) {
    assert.ok(moves.some((cs) => key(cs) === key(wanted)));
  }
  assert.ok(moves.every((cs) => validatePlay(st, 0, cs).ok));
  st.players[1].hand = [C('S', 'A', 1), ...cards('D3', 'H3', 'C4')];
  assert.ok(!ai._endgameMoves(st, 0).some((cs) => key(cs) === 'SJ,SK'), '甩牌缓存必须随对手余牌改变');
});

test('跟对子的全部候选仍遵守有对跟对，重复副数不制造重复分支', () => {
  const st = simulation([cardsD('S3'), [...cardsD('S5'), ...cards('S7', 'S9')], [], []]);
  const cs = st.players[0].hand, combo = parseCombo(cs, st.trumpInfo, st.config);
  st.currentTrick = { leadPlayerIdx: 0, leadCombo: combo, plays: [{ playerIdx: 0, cards: cs, combo }] };
  const ai = new GreedyStrategy();
  assert.deepEqual(ai._endgameMoves(st, 1).map(key), ['S5,S5']);
  st.config = { ...st.config, mustFollowPairAsPair: false };
  st.endgameMoveCache.clear();
  assert.equal(ai._endgameMoves(st, 1).length, 4);
});

test('闲家推演不能因手牌顺序漏看第九个候选中的唯一压庄牌', () => {
  const st = simulation([[], cards('C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'BJ'), [], []]);
  const cs = cards('SA'), combo = parseCombo(cs, st.trumpInfo, st.config);
  st.currentTrick = { leadPlayerIdx: 0, leadCombo: combo, plays: [{ playerIdx: 0, cards: cs, combo }] };
  const ai = new GreedyStrategy();
  assert.notEqual(key(ai._r3RolloutMove(st, 1, { n: 0 })), 'JOKERBJ');
  st.fullRollout = true;
  assert.equal(key(ai._r3RolloutMove(st, 1, { n: 0 })), 'JOKERBJ');
  st.players[1].hand.reverse();
  assert.equal(key(ai._r3RolloutMove(st, 1, { n: 0 })), 'JOKERBJ');
});

// 独立的穷举裁判：复制状态、不剪枝、不使用AI的apply/search/terminal或候选生成器。
function oracle(st, seat, memo = new Map()) {
  if (!st.currentTrick && st.players.every((p) => !p.hand.length)) {
    const last = st.tricks[st.tricks.length - 1];
    const points = st.bankDealerPts + st.tricks.filter((t) => t.winnerIdx === st.dealerIdx)
      .reduce((n, t) => n + t.points, 0) + (last.winnerIdx === st.dealerIdx ? st.bottomPts : 0);
    const margin = points - st.contractScore;
    return (st.winObjective ? (margin >= 0 ? 100 : -100) + margin * 0.1 : margin)
      + (points >= 200 ? 100 : points === 0 ? -100 : 0);
  }
  const cacheKey = JSON.stringify([seat, st.players.map((p) => p.hand.map((c) => c.id).sort()),
    st.currentTrick && st.currentTrick.plays.map((p) => [p.playerIdx, p.cards.map((c) => c.id).sort()]),
    st.tricks.filter((t) => t.winnerIdx === st.dealerIdx).reduce((n, t) => n + t.points, 0)]);
  if (memo.has(cacheKey)) return memo.get(cacheKey);
  const hand = st.players[seat].hand, choices = [];
  function subsets(i, chosen) {
    if (i === hand.length) {
      if (chosen.length && validatePlay(st, seat, chosen).ok) choices.push(chosen);
      return;
    }
    subsets(i + 1, chosen);
    subsets(i + 1, chosen.concat(hand[i]));
  }
  subsets(0, []);
  const values = choices.map((cs) => {
    const next = structuredClone(st), ids = new Set(cs.map((c) => c.id));
    next.players[seat].hand = next.players[seat].hand.filter((c) => !ids.has(c.id));
    const combo = parseCombo(cs, st.trumpInfo, st.config);
    next.currentTrick ||= { leadPlayerIdx: seat, leadCombo: combo, plays: [] };
    next.currentTrick.plays.push({ playerIdx: seat, cards: cs, combo });
    let actor = next.playOrder[(next.playOrder.indexOf(seat) + 1) % 4];
    if (next.currentTrick.plays.length === 4) {
      const result = resolveTrick(next.currentTrick, st.trumpInfo, st.config);
      next.tricks.push(result); next.currentTrick = null; actor = result.winnerIdx;
    }
    return oracle(next, actor, memo);
  });
  assert.ok(values.length);
  const value = seat === st.dealerIdx ? Math.max(...values) : Math.min(...values);
  memo.set(cacheKey, value);
  return value;
}

for (const direction of ['clockwise', 'counterclockwise']) {
  test(`三/四张完整搜索与独立穷举裁判一致：${direction}，覆盖所有庄位及合同/分数目标`, () => {
    const ai = new GreedyStrategy(), deck = buildDeck(createConfig());
    for (let i = 0; i < 8; i++) {
      const h = i < 6 ? 3 : 4, pool = createRng(111701 + i).shuffle(deck);
      const st = simulation([0, 1, 2, 3].map((s) => pool.slice(s * h, (s + 1) * h)), direction, i % 4);
      st.winObjective = i % 2 === 0;
      const before = st.players.map((p) => p.hand.map((c) => c.id));
      const expected = oracle(st, i % 4);
      assert.equal(ai._r5Search(st, i % 4, { n: 0 }, -Infinity, Infinity), expected);
      // 窄窗口缓存只能当作界，随后完整窗口仍必须恢复正确值。
      st.endgameCache.clear();
      ai._r5Search(st, i % 4, { n: 0 }, expected - 2, expected - 1);
      assert.equal(ai._r5Search(st, i % 4, { n: 0 }, -Infinity, Infinity), expected);
      assert.deepEqual(st.players.map((p) => p.hand.map((c) => c.id)), before);
      assert.equal(st.currentTrick, null); assert.equal(st.tricks.length, 0);
    }
  });
}

test('采样证据不足、单个极端假设或细小收益均不能推翻已有策略', () => {
  const ai = new GreedyStrategy();
  assert.equal(ai._endgameEvidence([100, 100]), false);
  assert.equal(ai._endgameEvidence([200, ...Array(31).fill(0)]), false);
  assert.equal(ai._endgameEvidence(Array(32).fill(1)), false);
  assert.equal(ai._endgameEvidence(Array(32).fill(-10)), false);
  assert.equal(ai._endgameEvidence(Array(32).fill(10)), true);
});

test('耗尽节点预算必须恢复已出牌，不能污染下一候选或真实手牌', () => {
  const st = simulation([cards('SA', 'H10', 'C5'), cards('S7', 'H9', 'C4'),
    cards('S8', 'H8', 'C6'), cards('S9', 'H7', 'C7')]);
  const before = st.players.map((p) => p.hand.map((c) => c.id)), ai = new GreedyStrategy();
  assert.throws(() => ai._r5Search(st, 0, { n: 119998 }, -Infinity, Infinity), (e) => e.r5Abort === true);
  assert.deepEqual(st.players.map((p) => p.hand.map((c) => c.id)), before);
  assert.equal(st.currentTrick, null); assert.equal(st.tricks.length, 0);
});

test('完整108张训练回放：补全推演候选后抢回45分底牌并守住合同，H5结果一致', () => {
  const path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
  const { loadStrategy, dealerProfile, prepare, play } = require('../tools/ai-arena');
  const file = path.resolve(__dirname, '../miniprogram/ai/strategy-greedy.js');
  const scenario = { seed: 110109, profile: 'normal', direction: 'clockwise', firstBidder: 1 };
  const dealer = dealerProfile(file, scenario.profile), start = prepare(scenario, dealer, dealer);
  const previous = loadStrategy(file, { AI_ENDGAME_DEPTH: '2', AI_ROLLOUT_FULL: '0' });
  const before = play(start, scenario, dealer, previous);
  const after = play(start, scenario, dealer, loadStrategy(file));
  assert.equal(before.win, false); assert.equal(before.points, 65);
  assert.equal(after.win, true); assert.equal(after.points, 135);
  assert.equal(before.bottom, false); assert.equal(after.bottomPoints, 45);
  const sandbox = { console, window: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../h5/js/game-bundle.js'), 'utf8'), sandbox);
  const browser = play(start, scenario, dealer, new sandbox.window.GameCore.GameService().ai);
  assert.equal(browser.win, after.win); assert.equal(browser.points, after.points);
  assert.equal(browser.bottomPoints, after.bottomPoints);
});

test('残局双重复核实际触发：不改变已赢合同，继续从庄家手里多收5分', () => {
  const { loadStrategy, dealerProfile, prepare, play } = require('../tools/ai-arena');
  const file = require('node:path').resolve(__dirname, '../miniprogram/ai/strategy-greedy.js');
  const scenario = { seed: 110052, profile: 'low-bottom', direction: 'counterclockwise', firstBidder: 2 };
  const dealer = dealerProfile(file, scenario.profile), start = prepare(scenario, dealer, dealer);
  const before = play(start, scenario, dealer, loadStrategy(file, { AI_ENDGAME_DEPTH: '2' }));
  const ai = loadStrategy(file), solve = ai._solveEndgame;
  let accepted = 0;
  ai._solveEndgame = function (...args) {
    const result = solve.apply(this, args);
    if (args[3] && result) accepted++;
    return result;
  };
  const after = play(start, scenario, dealer, ai);
  assert.equal(before.win, true); assert.equal(after.win, true);
  assert.equal(before.points, 165); assert.equal(after.points, 170);
  assert.ok(accepted > 0);
});
