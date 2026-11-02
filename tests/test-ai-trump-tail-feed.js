'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDeck } = require('../miniprogram/engine/deck');
const { createConfig } = require('../miniprogram/engine/config');
const { domainOf, parseCombo, pointsOf, strengthInDomain } = require('../miniprogram/engine/combo');
const { validatePlay } = require('../miniprogram/engine/validate');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { transition } = require('../miniprogram/core/statemachine');
const { SharedAttackStrategy } = require('../miniprogram/ai/strategy-shared');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { makeState } = require('./fixtures');

/** 完整108张：庄家合法清过8轮单主并赢墩，前两家已经无主，末家留1～2张大主。 */
function clearing({ direction = 'counterclockwise', lead = 'H9', tail = ['JOKERBJ', 'JOKERRJ'] } = {}) {
  const config = createConfig({ gameMode: 'san_da_yi', playDirection: direction, throwPenalty: 'penalty_smallest' });
  const pool = buildDeck(config), state = makeState();
  const take = (name) => {
    const i = pool.findIndex((c) => c.suit + c.rank === name);
    assert.ok(i >= 0, name); return pool.splice(i, 1)[0];
  };
  const order = direction === 'clockwise' ? [0, 3, 2, 1] : [0, 1, 2, 3];
  const first = order[1], second = order[2], last = order[3];
  const led = take(lead), hands = [[], [], [], []];
  hands[0].push(take('H10'));
  hands[last].push(...tail.map(take));
  hands[first].push(take('D10'), take('S3'));
  hands[second].push(take('C10'), take('D3'));
  if (hands[last].filter((c) => domainOf(c, state.trumpInfo) === 'TRUMP').length === 1) hands[0].push(take('H4'));
  const trumps = pool.filter((c) => domainOf(c, state.trumpInfo) === 'TRUMP')
    .sort((a, b) => strengthInDomain(b, state.trumpInfo) - strengthInDomain(a, state.trumpInfo));
  assert.equal(trumps.length, 32);
  const past = [];
  for (let round = 0; round < 8; round++) {
    const plays = order.map((playerIdx, i) => {
      const c = i === 0 ? trumps.shift() : trumps.pop();
      pool.splice(pool.findIndex((p) => p.id === c.id), 1);
      const cards = [c]; return { playerIdx, cards, combo: parseCombo(cards, state.trumpInfo, config) };
    });
    const trick = { leadPlayerIdx: 0, leadCombo: plays[0].combo, plays };
    resolveTrick(trick, state.trumpInfo, config); assert.equal(trick.winnerIdx, 0);
    past.push(trick);
  }
  for (const seat of order) while (hands[seat].length < (seat === 0 ? 16 : 17)) {
    let i = pool.findIndex((c) => !hands[seat].some((p) => p.suit === c.suit && p.rank === c.rank));
    if (i < 0) i = 0;
    hands[seat].push(pool.splice(i, 1)[0]);
  }
  assert.equal(pool.length, 8);
  state.config = config; state.playOrder = order;
  state.players.forEach((p, seat) => { p.hand = hands[seat]; });
  state.sanDaYiTeams = { dealer: 0, attackers: order.slice(1) }; state.contractScore = 90;
  state.completedTricks = past; state.bottomCards = pool; state.turnIdx = first;
  state.roundHistory = []; state.bottomMerged = true;
  const combo = parseCombo([led], state.trumpInfo, config);
  state.currentTrick = { leadPlayerIdx: 0, leadCombo: combo, plays: [{ playerIdx: 0, cards: [led], combo }] };
  const all = hands.flat().concat(pool, [led], past.flatMap((t) => t.plays.flatMap((p) => p.cards)));
  assert.equal(all.length, 108); assert.equal(new Set(all.map((c) => c.id)).size, 108);
  return { state, first, second, last };
}

for (const direction of ['clockwise', 'counterclockwise']) test(`清主末段/${direction}：两家提前跑10，末家大主接回20分`, () => {
  const { state, first, second, last } = clearing({ direction }), ai = new SharedAttackStrategy();
  const before = structuredClone(state);
  assert.equal(ai._buildCtx(state, first).knowledge.consistent, true);
  const pick = ai.decidePlay(state, first);
  assert.equal(pointsOf(pick, state.config), 10, '不能因庄家暂时在压而垫零分');
  assert.equal(validatePlay(state, first, pick).ok, true);
  assert.deepEqual(state, before);
  let st = transition(state, { type: 'PLAY', playerIdx: first, cards: pick, ts: 0 });
  assert.equal(st.turnIdx, second);
  const secondPick = ai.decidePlay(st, second);
  assert.equal(pointsOf(secondPick, st.config), 10, '庄家下下家也应识别最后一家的接手能力');
  st = transition(st, { type: 'PLAY', playerIdx: second, cards: secondPick, ts: 0 });
  assert.equal(st.turnIdx, last);
  const take = ai.decidePlay(st, last);
  assert.ok(take[0].isJoker);
  st = transition(st, { type: 'PLAY', playerIdx: last, cards: take, ts: 0 });
  assert.equal(st.completedTricks.at(-1).winnerIdx, last);
  assert.equal(st.completedTricks.at(-1).points, 20);
});

test('末家只留一张小王，也能识别接分，不能要求一定有两张王', () => {
  const { state, first } = clearing({ tail: ['JOKERRJ', 'S4'] });
  const ai = new SharedAttackStrategy();
  assert.equal(pointsOf(ai.decidePlay(state, first), state.config), 10);
});

test('新增信息只有能否接手这一位，不共享王的种类、牌面或整手牌', () => {
  const { state, first, last } = clearing(), ai = new SharedAttackStrategy();
  const ctx = ai._buildCtx(state, first);
  assert.deepEqual(ctx.trumpTail, { canCash: true });
  const expected = ai.decidePlay(state, first);
  // 大王改在庄家暗手、队友改持小主但仍有小王，公共信息和“能接当前单主”不变。
  [state.players[0].hand[0], state.players[last].hand[0]] = [state.players[last].hand[0], state.players[0].hand[0]];
  assert.deepEqual(ai._buildCtx(state, first).trumpTail, ctx.trumpTail);
  assert.deepEqual(ai.decidePlay(state, first), expected);
  let reads = 0;
  Object.defineProperty(state.players[0], 'hand', { get() { reads++; throw Error('庄家暗牌不可读'); } });
  Object.defineProperty(state, 'bottomCards', { get() { reads++; throw Error('底牌不可读'); } });
  assert.deepEqual(ai.decidePlay(state, first), expected);
  assert.equal(reads, 0);
});

test('只有两轮主牌或仍有很多未知主时，不额外读取队友的大牌能力', () => {
  const { state, first } = clearing(), ai = new SharedAttackStrategy(), ctx = ai._buildCtx(state, first);
  let reads = 0;
  for (const seat of [0, 1, 2, 3].filter((s) => s !== first)) Object.defineProperty(state.players[seat], 'hand', {
    get() { reads++; throw Error('未到读牌阶段'); }
  });
  assert.equal(ai._readTrumpTail(state, first, ctx, { exposure: new Map([['TRUMP', 2]]) }), null);
  ctx.knowledge.domains.get('TRUMP').unseen = 7;
  assert.equal(ai._readTrumpTail(state, first, ctx, { exposure: new Map([['TRUMP', 8]]) }), null);
  assert.equal(reads, 0);
});

test('队友还留三张主时，不提前开放这一项末段能力信息', () => {
  const { state, first, last } = clearing();
  [state.players[0].hand[0], state.players[last].hand[2]] = [state.players[last].hand[2], state.players[0].hand[0]];
  assert.equal(new SharedAttackStrategy()._buildCtx(state, first).trumpTail, null);
});

test('主对子不能套用单主接分判断，散张王不能冒充可压主对', () => {
  const { state, first } = clearing(), ai = new SharedAttackStrategy(), ctx = ai._buildCtx(state, first);
  state.currentTrick.leadCombo = { ...state.currentTrick.leadCombo, type: 'pair', n: 2 };
  assert.equal(ai._readTrumpTail(state, first, ctx, { exposure: new Map([['TRUMP', 8]]) }), null);
});

test('末家没有能压牌的大主，庄家在压时不能继续追加副牌分', () => {
  const { state, first } = clearing({ lead: 'JOKERRJ', tail: ['JOKERRJ', 'H3'] });
  const pick = new SharedAttackStrategy().decidePlay(state, first);
  assert.equal(pointsOf(pick, state.config), 0, '同大的小王不能压先出的小王');
});

test('大王小王实际在底牌，不能把未见的大主误认作后位队友必持有', () => {
  const { state, first, last } = clearing();
  for (let i = 0; i < 2; i++) [state.players[last].hand[i], state.bottomCards[i]] = [state.bottomCards[i], state.players[last].hand[i]];
  assert.equal(pointsOf(new SharedAttackStrategy().decidePlay(state, first), state.config), 0);
});

test('有主必须跟主，接分不能让前家违规改垫副牌10', () => {
  const { state, first } = clearing();
  [state.players[0].hand[0], state.players[first].hand[1]] = [state.players[first].hand[1], state.players[0].hand[0]];
  const pick = new SharedAttackStrategy().decidePlay(state, first);
  assert.equal(domainOf(pick[0], state.trumpInfo), 'TRUMP');
  assert.equal(validatePlay(state, first, pick).ok, true);
});

test('真人是闲家时不开放额外大主接手信息，继续使用公开信息策略', () => {
  const { state, first } = clearing();
  state.players.forEach((p, seat) => { p.isHuman = seat === first; });
  const expected = new GreedyStrategy().decidePlay(state, first);
  let reads = 0;
  for (const seat of [0, 1, 2, 3].filter((s) => s !== first)) Object.defineProperty(state.players[seat], 'hand', {
    get() { reads++; throw Error('其他玩家暗牌不可读'); }
  });
  Object.defineProperty(state, 'bottomCards', { get() { reads++; throw Error('底牌不可读'); } });
  assert.deepEqual(new SharedAttackStrategy().decidePlay(state, first), expected);
  assert.equal(reads, 0);
});

