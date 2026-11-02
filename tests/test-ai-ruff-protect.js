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
const { legalMoves, validatePlay } = require('../miniprogram/engine/validate');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');

// 全副牌账本平衡：庄家已公开缺黑桃；队友领小黑桃，后位队友仍可跟分。
// 其余王/主2已公开，副2足以封住庄家，不必消耗大王。
function ruffPosition({ lead = 'S10', pair = false, clockwise = false, allTrump = false } = {}) {
  const config = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest' });
  const pool = buildDeck(config);
  const take = (name) => {
    const idx = pool.findIndex((c) => c.suit + c.rank === name);
    assert.ok(idx >= 0, name);
    return pool.splice(idx, 1)[0];
  };
  const specs = [
    ['HA', 'HQ', 'H9', 'H7', 'H6', 'H5', 'H10', 'HJ', 'DK', 'DQ', 'DJ', 'D8'],
    ['S3', 'S4', 'S6', 'S7', 'S9', 'SJ', 'SQ', 'SA', 'C3', 'C4', 'C6'],
    ['H3', 'S2', 'JOKERBJ', 'C3', 'C4', 'C6', 'C7', 'C8', 'C9', 'CJ', 'CQ', 'CA'],
    ['S10', 'SK', 'S5', 'D3', 'D4', 'D6', 'D7', 'D9', 'D10', 'D5', 'DK', 'DA']
  ];
  if (pair) {
    specs[0] = ['HA', 'HA', 'HQ', 'H9', 'H7', 'H6', 'H5', 'H10', 'HJ', 'DK', 'DQ', 'DJ'];
    specs[1].pop();
    specs[2] = ['H3', 'H3', 'S2', 'S2', 'JOKERBJ', 'JOKERBJ', 'C3', 'C4', 'C6', 'C7', 'C9', 'CQ'];
    specs[3][0] = 'SK';
  }
  if (allTrump) {
    specs[0][8] = 'D2';
    specs[2] = ['H3', 'H4', 'H6', 'H8', 'H9', 'HJ', 'HQ', 'HA', 'H2', 'S2', 'JOKERRJ', 'JOKERBJ'];
  }
  const state = makeState({ hands: specs.map((names) => names.map(take)), turnIdx: 2 });
  state.config = config;
  state.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  state.contractScore = 90;
  const trick = (rows) => {
    const plays = rows.map(([playerIdx, names]) => {
      const cards = names.map(take);
      return { playerIdx, cards, combo: parseCombo(cards, state.trumpInfo, config) };
    });
    return { leadPlayerIdx: plays[0].playerIdx, leadCombo: plays[0].combo, plays };
  };
  const voidTrick = trick([[3, ['S4']], [0, ['H4']], [1, ['S6']], [2, ['C8']]]);
  resolveTrick(voidTrick, state.trumpInfo, config);
  state.currentTrick = trick([[1, pair ? [lead, lead] : [lead]]]);
  state.bottomCards = ['C5', 'C10', 'CK', 'D5', 'D10', 'D8', 'D9', 'DQ'].map(take);
  // 其余牌仅作为已公开账本，不制造额外的缺门或跟牌证据。
  state.completedTricks = [{ leadCombo: null, plays: [{ playerIdx: 1, cards: pool }],
    winnerIdx: 1, points: pointsOf(pool, config) }, voidTrick];
  if (clockwise) {
    state.config = createConfig({ ...config, playDirection: 'clockwise' });
    state.playOrder = [0, 3, 2, 1];
    [state.players[1].hand, state.players[3].hand] = [state.players[3].hand, state.players[1].hand];
    const mirror = (seat) => seat % 2 ? 4 - seat : seat;
    for (const t of state.completedTricks.concat(state.currentTrick)) {
      if (t.leadPlayerIdx !== undefined) t.leadPlayerIdx = mirror(t.leadPlayerIdx);
      if (t.winnerIdx !== undefined) t.winnerIdx = mirror(t.winnerIdx);
      t.plays.forEach((p) => { p.playerIdx = mirror(p.playerIdx); });
    }
  }
  return state;
}

function choose(state) {
  const before = structuredClone(state), ai = new GreedyStrategy();
  assert.equal(ai._buildCtx(state, 2).knowledge.consistent, true);
  const pick = ai.decidePlay(state, 2);
  assert.equal(validatePlay(state, 2, pick).ok, true);
  assert.deepEqual(state, before, '不得修改真实牌局');
  return pick;
}

for (const clockwise of [false, true]) {
  test(`${clockwise ? '顺' : '逆'}时针：庄家已缺门、后位队友可出分时，用副2将吃保分，保留大王`, () => {
    const state = ruffPosition({ clockwise });
    const pick = choose(state);
    assert.deepEqual(pick.map((c) => c.suit + c.rank), ['S2']);
    // 用引擎实际结墩：小主会丢掉两张10，副2则能挡住庄家的Q。
    const mateIdx = clockwise ? 1 : 3;
    const finish = (cards) => {
      const t = structuredClone(state.currentTrick);
      for (const [playerIdx, cs] of [[2, cards],
        [mateIdx, state.players[mateIdx].hand.filter((c) => c.suit + c.rank === 'S10')],
        [0, state.players[0].hand.filter((c) => c.suit + c.rank === 'HQ')]]) {
        t.plays.push({ playerIdx, cards: cs, combo: parseCombo(cs, state.trumpInfo, state.config) });
      }
      resolveTrick(t, state.trumpInfo, state.config);
      return t;
    };
    assert.equal(finish([state.players[2].hand[0]]).winnerIdx, 0);
    assert.equal(finish(pick).winnerIdx, 2);
    assert.equal(finish(pick).points, 20);
  });
}

test('桌面暂时无分，也应考虑后位队友可能跟出的10/K，用副2提前护分', () => {
  assert.deepEqual(choose(ruffPosition({ lead: 'S8', allTrump: true })).map((c) => c.suit + c.rank), ['S2']);
});

test('原计划垫小牌时，不为假设的队友分牌强行消耗大主', () => {
  assert.deepEqual(choose(ruffPosition({ lead: 'S8' })).map((c) => c.suit + c.rank), ['C3']);
});

test('中间主A已足以挡住庄家时，保留副2和大王', () => {
  const state = ruffPosition();
  [state.players[2].hand[3], state.players[0].hand[0]] = [state.players[0].hand[0], state.players[2].hand[3]];
  assert.deepEqual(choose(state).map((c) => c.suit + c.rank), ['HA']);
});

test('对子副牌同样防超毙：用副2对接分，不能以小主对送庄家A对', () => {
  assert.deepEqual(choose(ruffPosition({ pair: true })).map((c) => c.suit + c.rank), ['S2', 'S2']);
});

test('对子墩缺门时合法的混门垫牌不触发护主，也不应因无牌型而报错', () => {
  const state = ruffPosition({ pair: true }), ai = new GreedyStrategy();
  const candidates = legalMoves(state, 2);
  const mixed = candidates.find((cs) => parseCombo(cs, state.trumpInfo, state.config) === null);
  assert.ok(mixed);
  assert.equal(validatePlay(state, 2, mixed).ok, true);
  assert.equal(ai._chooseRuffProtection(state, 2, ai._buildCtx(state, 2), candidates, mixed), null);
});

test('中盘8张也要防庄家超毙，不能只在前期保护分牌', () => {
  const state = ruffPosition();
  for (const p of state.players) state.completedTricks[0].plays[0].cards.push(...p.hand.splice(-4));
  state.completedTricks[0].points = pointsOf(state.completedTricks[0].plays[0].cards, state.config);
  assert.deepEqual(choose(state).map((c) => c.suit + c.rank), ['S2']);
});

// 与公开账本交换牌，不改变全副牌数量、暗牌容量及已经示出的缺门。
function expose(state, predicate) {
  const publicCards = state.completedTricks[0].plays[0].cards;
  for (const hand of [state.players[0].hand, state.players[1].hand, state.players[3].hand, state.bottomCards]) {
    for (let i = 0; i < hand.length; i++) {
      if (!predicate(hand[i])) continue;
      const j = publicCards.findIndex((c) => !predicate(c) && pointsOf([c], state.config) === 0
        && (hand !== state.players[0].hand || c.suit !== 'S'));
      assert.ok(j >= 0);
      [hand[i], publicCards[j]] = [publicCards[j], hand[i]];
    }
  }
  state.completedTricks[0].points = pointsOf(publicCards, state.config);
}

test('庄家已无主时，不再为防超毙烧副2或大王', () => {
  const state = ruffPosition();
  expose(state, (c) => domainOf(c, state.trumpInfo) === 'TRUMP');
  assert.ok(choose(state).every((c) => c.rank !== '2' && !c.isJoker));
});

test('桌面无分且余下分牌已出尽，不为虚构的队友分牌烧大主', () => {
  const state = ruffPosition({ lead: 'S8' });
  expose(state, (c) => pointsOf([c], state.config) > 0);
  assert.ok(choose(state).every((c) => c.rank !== '2' && !c.isJoker));
});

test('防超毙仅按公开牌和自己手牌推断，不读取真实庄家、队友手牌或底牌', () => {
  const state = ruffPosition(), expected = choose(state);
  let reads = 0;
  for (const seat of [0, 1, 3]) Object.defineProperty(state.players[seat], 'hand', {
    get() { reads++; throw Error('hidden hand'); }
  });
  Object.defineProperty(state, 'bottomCards', { get() { reads++; throw Error('hidden bottom'); } });
  assert.deepEqual(new GreedyStrategy().decidePlay(state, 2), expected);
  assert.equal(reads, 0);
});

test('H5打包实际决策也应以副2防超毙', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../h5/js/game-bundle.js'), 'utf8'), sandbox);
  const state = ruffPosition();
  const hint = sandbox.window.GameCore.getHint(state, 2);
  assert.deepEqual(Array.from(hint.cards, (c) => c.suit + c.rank), ['S2']);
});
