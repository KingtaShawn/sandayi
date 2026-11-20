'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfig } = require('../miniprogram/engine/config');
const { buildDeck } = require('../miniprogram/engine/deck');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { parseCombo, domainOf, pointsOf } = require('../miniprogram/engine/combo');
const { resolveTrick } = require('../miniprogram/engine/trick');
const { validatePlay, legalMoves } = require('../miniprogram/engine/validate');
const { createInitialState } = require('../miniprogram/core/state');
const { transition } = require('../miniprogram/core/statemachine');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { SharedAttackStrategy } = require('../miniprogram/ai/strategy-shared');
const fixture = require('./fixtures/free-void-discard-replay.json');

// seed 86005：模拟庄家白墩优先垫最短门、遇分再毙。保留第14墩之前的真实公开历史。
function replay(record = fixture) {
  const cfg = createConfig({ gameMode: 'san_da_yi', playDirection: record.direction, throwPenalty: 'penalty_smallest' });
  const st = createInitialState(cfg, null, null, { dealerIdx: record.dealer });
  const deck = new Map(buildDeck(cfg).map((c) => [c.id, c]));
  const take = (ids) => ids.map((id) => { const c = deck.get(id); assert.ok(c, id); deck.delete(id); return c; });
  st.phase = 'PLAYING'; st.turnIdx = record.turn; st.contractScore = record.contract;
  st.bottomMerged = true; st.buryDone = true;
  st.sanDaYiTeams = { dealer: record.dealer, attackers: [0, 1, 2, 3].filter((s) => s !== record.dealer) };
  st.trumpInfo = buildTrumpInfo(record.trump, record.level, cfg);
  st.players.forEach((p, s) => { p.hand = record.hands[s] ? take(record.hands[s]) : []; p.isHuman = s === record.dealer; });
  st.bottomCards = record.bottom ? take(record.bottom) : [];
  st.completedTricks = record.tricks.map((rows) => {
    const plays = rows.map(([playerIdx, ids]) => {
      const cards = take(ids); return { playerIdx, cards, combo: parseCombo(cards, st.trumpInfo, cfg) };
    });
    const t = { leadPlayerIdx: plays[0].playerIdx, leadCombo: plays[0].combo, plays };
    resolveTrick(t, st.trumpInfo, cfg); return t;
  });
  if (record.bottom) assert.equal(deck.size, 0);
  return st;
}

// 早先红桃单墩由Q换成10（仍由K赢），使剩余红桃分已全部公开打完。
// 庄家最近只从梅花垫过一轮，也必须及时比较梅花跑分窗口。
function dryReplay(pair = false) {
  const st = replay(), old = st.completedTricks[5], lead = old.plays[0];
  const index = st.bottomCards.findIndex((c) => c.suit === 'H' && c.rank === '10');
  [lead.cards[0], st.bottomCards[index]] = [st.bottomCards[index], lead.cards[0]];
  lead.combo = parseCombo(lead.cards, st.trumpInfo, st.config); old.leadCombo = lead.combo;
  resolveTrick(old, st.trumpInfo, st.config);
  const dropped = st.completedTricks[12].plays.find((p) => p.playerIdx === fixture.dealer);
  const jack = dropped.cards.findIndex((c) => c.suit === 'C');
  const six = st.players[1].hand.findIndex((c) => c.suit === 'S' && c.rank === '6');
  [dropped.cards[jack], st.players[1].hand[six]] = [st.players[1].hand[six], dropped.cards[jack]];
  dropped.combo = parseCombo(dropped.cards, st.trumpInfo, st.config);
  if (pair) {
    const mine = st.players[fixture.turn].hand;
    const give = mine.findIndex((c) => c.suit === 'C' && c.rank === '4');
    const take = st.players[0].hand.findIndex((c) => c.suit === 'H' && c.rank === 'A');
    [mine[give], st.players[0].hand[take]] = [st.players[0].hand[take], mine[give]];
    const give2 = mine.findIndex((c) => c.suit === 'C' && c.rank === '8');
    const take2 = st.bottomCards.findIndex((c) => c.suit === 'H' && c.rank === 'A');
    [mine[give2], st.bottomCards[take2]] = [st.bottomCards[take2], mine[give2]];
  }
  return st;
}

const names = (cards) => cards.map((c) => c.suit + c.rank);
function advance(st, cards) {
  assert.equal(validatePlay(st, st.turnIdx, cards).ok, true);
  return transition(st, { type: 'PLAY', playerIdx: st.turnIdx, cards, ts: 0 });
}
function played(st, labels) {
  return labels.reduce((s, label) => {
    const card = s.players[s.turnIdx].hand.find((c) => c.suit + c.rank === label);
    assert.ok(card, label); return advance(s, [card]);
  }, st);
}
function playTrick(st, ai, lead) {
  let next = advance(st, lead);
  while (next.currentTrick) {
    const seat = next.turnIdx;
    // 此局庄家仍有梅花时必须跟最后的♣J。
    const cards = seat === fixture.dealer ? legalMoves(next, seat)[0] : ai.decidePlay(next, seat);
    next = advance(next, cards);
  }
  return next.completedTricks.at(-1);
}

test('续红桃白墩会让庄家垫掉最后梅花J：新策略先出梅花Q，队友K收10分', () => {
  const st = replay(), ai = new SharedAttackStrategy(), before = structuredClone(st);
  const pick = ai.decidePlay(st, st.turnIdx);
  assert.deepEqual(names(pick), ['CQ']);
  const trick = playTrick(st, ai, pick);
  assert.equal(trick.winnerIdx, 1); assert.equal(trick.points, 10);
  assert.deepEqual(names(trick.plays.find((p) => p.playerIdx === fixture.dealer).cards), ['CJ']);
  assert.deepEqual(st, before);
});

test('同牌对照：续红桃后梅花K的10分会被庄家的主2拿走', () => {
  let st = played(replay(), ['H4', 'H2', 'HA', 'CJ']);
  assert.equal(st.completedTricks.at(-1).points, 0);
  assert.equal(st.players[fixture.dealer].hand.some((c) => domainOf(c, st.trumpInfo) === 'C'), false);
  st = played(st, ['CK', 'C6', 'S2', 'C8']);
  assert.equal(st.completedTricks.at(-1).winnerIdx, fixture.dealer);
  assert.equal(st.completedTricks.at(-1).points, 10);
});

test('上一轮同样打红桃小单已逼出庄家主牌时，继续保留原逼主攻法', () => {
  let st = replay();
  const hand = st.players[st.turnIdx].hand;
  const give = hand.findIndex((c) => c.suit === 'C' && c.rank === '4');
  const take = st.bottomCards.findIndex((c) => c.suit === 'H' && c.rank === '8');
  assert.ok(give >= 0 && take >= 0);
  [hand[give], st.bottomCards[take]] = [st.bottomCards[take], hand[give]];
  st = played(st, ['H4', 'C8', 'HA', 'D6', 'CJ', 'CQ', 'C9', 'C6']);
  assert.equal(st.turnIdx, fixture.turn);
  const ai = new SharedAttackStrategy(), ctx = ai._buildCtx(st, st.turnIdx), candidates = ai._legalPlays(st, st.turnIdx, ctx);
  const smallHeart = candidates.find((cs) => names(cs).join() === 'H8');
  assert.ok(smallHeart && ctx.sdy.voids.dealer.has('H') && ctx.knowledge.consistent);
  assert.equal(ai._switchAfterFreeDiscard(st, st.turnIdx, ctx, candidates, smallHeart), null);
});

test('只有不安全的分牌可换时，不因庄家垫过该门就直接领分', () => {
  const st = replay(), ai = new SharedAttackStrategy(), ctx = ai._buildCtx(st, st.turnIdx);
  const candidates = ai._legalPlays(st, st.turnIdx, ctx);
  const pick = candidates.find((cs) => names(cs).join() === 'H4');
  const point = candidates.find((cs) => names(cs).join() === 'C5');
  assert.ok(pick && point && ai._dealerCanBeat(parseCombo(point, st.trumpInfo, st.config), ctx));
  assert.equal(ai._switchAfterFreeDiscard(st, st.turnIdx, ctx, [pick, point], pick), null);
});

test('换门依赖公开线索，封住其他三家的手牌和底牌仍会先出梅花Q', () => {
  const st = replay(), ai = new GreedyStrategy(); let reads = 0;
  for (const s of [0, 1, 2, 3].filter((s) => s !== st.turnIdx)) Object.defineProperty(st.players[s], 'hand', {
    get() { reads++; throw Error('不能读暗牌'); }
  });
  Object.defineProperty(st, 'bottomCards', { get() { reads++; throw Error('不能读底牌'); } });
  assert.deepEqual(names(ai.decidePlay(st, st.turnIdx)), ['CQ']); assert.equal(reads, 0);
});

test('H5浏览器逻辑包在换门回归局中同样领梅花Q', () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../h5/js/game-bundle.js'), 'utf8'), browser);
  const st = replay(), cards = new browser.window.GameCore.GameService().ai.decidePlay(st, st.turnIdx);
  assert.deepEqual(Array.from(cards, (c) => c.suit + c.rank), ['CQ']);
});

for (const pair of [false, true]) test(`红桃已无分且庄家可垫梅花：${pair ? '大对子' : '白单'}不再靠绝门加成抢占梅花跑分窗口`, () => {
  const st = dryReplay(pair), ai = new SharedAttackStrategy(), before = structuredClone(st);
  const ctx = ai._buildCtx(st, st.turnIdx), candidates = ai._legalPlays(st, st.turnIdx, ctx);
  assert.ok(ctx.knowledge.consistent);
  assert.equal(ctx.knowledge.domains.get('H').remainingPoints, 0);
  const source = candidates.find((cs) => cs.length === (pair ? 2 : 1) && cs.every((c) => domainOf(c, st.trumpInfo) === 'H'));
  assert.ok(source);
  assert.ok(ai._unproductiveVoidLead(st, st.turnIdx, parseCombo(source, st.trumpInfo, st.config), ctx));
  const relay = ai._switchAfterFreeDiscard(st, st.turnIdx, ctx, candidates, source);
  assert.ok(relay && relay.every((c) => c.suit === 'C'), '不等庄家把梅花垫第二次才换门');
  const pick = ai.decidePlay(st, st.turnIdx);
  assert.ok(pick.every((c) => c.suit === 'C'));
  const trick = playTrick(st, ai, pick);
  assert.notEqual(trick.winnerIdx, fixture.dealer);
  assert.ok(trick.points >= 10);
  assert.deepEqual(st, before);
});

test('自己的白牌不等于全门无分：未知分可能还在队友或底牌，不偷看推断为空', () => {
  const st = replay(), ai = new GreedyStrategy(), ctx = ai._buildCtx(st, st.turnIdx);
  const h = st.players[st.turnIdx].hand.filter((c) => domainOf(c, st.trumpInfo) === 'H');
  assert.equal(pointsOf(h, st.config), 0);
  assert.equal(ctx.knowledge.domains.get('H').remainingPoints, 10);
  assert.equal(ai._unproductiveVoidLead(st, st.turnIdx, parseCombo(h, st.trumpInfo, st.config), ctx), false);
});

test('无分绝门推演允许庄家垫掉梅花J，不再虚构每次白墩都会消耗主牌', () => {
  const st = played(dryReplay(), ['H4', 'H2', 'HA']);
  st.emptyVoidSuits = new Set(['H']);
  const ai = new GreedyStrategy(), legal = legalMoves(st, fixture.dealer);
  assert.deepEqual(names(ai._freeDiscardInSimulation(st, fixture.dealer, legal)), ['CJ']);
  assert.deepEqual(names(ai._r3RolloutMove(st, fixture.dealer, { n: 0 })), ['CJ']);
  st.emptyVoidSuits.clear();
  assert.equal(ai._freeDiscardInSimulation(st, fixture.dealer, legal), null);
});

test('无分门换门同样不读取暗牌，浏览器与源码决策一致', () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../h5/js/game-bundle.js'), 'utf8'), browser);
  const st = dryReplay(), source = new GreedyStrategy();
  st.players.forEach((p) => { p.isHuman = false; }); // 本用例检查公开决策路径，关闭既有的训练模式队友读牌。
  const expected = source.decidePlay(st, st.turnIdx);
  for (const seat of [0, 1, 3]) Object.defineProperty(st.players[seat], 'hand', { get() { throw Error('暗牌不可读'); } });
  Object.defineProperty(st, 'bottomCards', { get() { throw Error('底牌不可读'); } });
  assert.deepEqual(source.decidePlay(st, st.turnIdx), expected);
  const web = new browser.window.GameCore.GameService().ai.decidePlay(st, st.turnIdx);
  assert.deepEqual(Array.from(web, (c) => c.id), expected.map((c) => c.id));
});

test('白副对可能让庄家垫短门时先兑现旁门顶单，保留有分对子和仍需保护的顶对', () => {
  const ai = new GreedyStrategy();
  const cfg = createConfig({ gameMode: 'san_da_yi' });
  const ti = buildTrumpInfo('C', '2', cfg);
  const deck = new Map(buildDeck(cfg).map(c => [c.id, c]));
  const cards = (...ids) => ids.map(id => deck.get(id));
  const pair = cards('0H7', '1H7'), ace = cards('0DA'), scored = cards('0H10', '1H10');
  const hand = [...pair, ...ace, ...cards('0S3', '1S8', '1D5')];
  const hidden = { get hand() { throw Error('暗牌不可读'); } };
  const state = { config: cfg, trumpInfo: ti, players: [hidden, hidden, { hand }, hidden],
    get bottomCards() { throw Error('底牌不可读'); },
    completedTricks: [{ leadPlayerIdx: 0, leadCombo: parseCombo(cards('0D9'), ti, cfg),
      plays: [{ playerIdx: 0, cards: cards('0D9') }] }] };
  const range = (max, expected) => ({ count: { max, expected } });
  const ranges = new Map([['TRUMP', range(4, 2)], ['D', range(4, 1.4)], ['H', range(5, 1.6)]]);
  const ctx = { sdy: { dealerIdx: 0 }, di: { byDomain: new Map() },
    knowledge: { consistent: true, seats: [{ domains: ranges }], domains: new Map([['D', { unseenPoints: 20 }]]) } };
  const choose = (lead) => ai._cashBeforePair(state, 2, ctx, [lead, ace], lead);
  assert.equal(choose(pair), ace);
  assert.equal(choose(scored), scored);
  hand.push(deck.get('1DA'));
  assert.equal(choose(pair), pair, '不能拆开旁门顶对');
  hand.pop();
  ranges.set('D', range(0, 0));
  assert.equal(choose(pair), pair, '庄家已断目标门');
  ranges.set('D', range(4, 1.4));
  ranges.set('H', range(0, 0));
  assert.equal(choose(pair), pair, '已知断门交给既有的逼主与垫牌判断');
  ranges.set('H', range(5, 3));
  assert.equal(choose(pair), pair, '庄家有足够的同门牌可跟对子');
});

test('独立发牌第11墩：闲家保留梅花J对，先兑现黑桃Q；公开决策无需其他三家的牌或底牌', () => {
  const state = replay(require('./fixtures/short-suit-lead.json'));
  for (const [seat, player] of state.players.entries()) {
    if (seat !== state.turnIdx) Object.defineProperty(player, 'hand', { get() { throw Error('暗牌不可读'); } });
  }
  Object.defineProperty(state, 'bottomCards', { get() { throw Error('底牌不可读'); } });
  assert.deepEqual(names(new GreedyStrategy().decidePlay(state, state.turnIdx)), ['SQ']);
});
