'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sweepPosition } = require('./fixtures/suit-defense');
const { SharedAttackStrategy } = require('../miniprogram/ai/strategy-shared');
const { domainOf, parseCombo } = require('../miniprogram/engine/combo');
const { validatePlay, legalMoves } = require('../miniprogram/engine/validate');
const { transition } = require('../miniprogram/core/statemachine');

function playTrick(state, ai) {
  let st = state;
  for (let i = 0; i < 3; i++) {
    const seat = st.turnIdx, before = structuredClone(st), cards = ai.decidePlay(st, seat);
    assert.deepEqual(st, before); assert.equal(validatePlay(st, seat, cards).ok, true);
    st = transition(st, { type: 'PLAY', playerIdx: seat, cards, ts: 0 });
  }
  return st;
}

function finishSweep(ai, direction) {
  let st = sweepPosition(direction, false, false, true);
  const play = (cards) => {
    assert.equal(validatePlay(st, st.turnIdx, cards).ok, true);
    st = transition(st, { type: 'PLAY', playerIdx: st.turnIdx, cards, ts: 0 });
  };
  for (let round = 0; round < 7; round++) {
    if (round) play([st.players[0].hand.find((c) => domainOf(c, st.trumpInfo) === 'TRUMP')]);
    for (let i = 0; i < 3; i++) play(ai.decidePlay(st, st.turnIdx));
  }
  const kept = st.players[st.playOrder[1]].hand.map((c) => c.suit + c.rank);
  for (const rank of ['A', 'K']) {
    play([st.players[0].hand.find((c) => c.suit === 'S' && c.rank === rank)]);
    for (let i = 0; i < 3; i++) play(ai.decidePlay(st, st.turnIdx));
  }
  while (st.phase === 'PLAYING') play(ai.decidePlay(st, st.turnIdx));
  return { kept, settle: st.lastSettle };
}

for (const direction of ['clockwise', 'counterclockwise']) test(`防满分守门高于囤分/${direction}：留三张10会输200，保SA/Q/J能跑25分`, () => {
  const old = new SharedAttackStrategy();
  old._finalizeAttackerPlay = (state, seat, ctx, candidates, pick) => pick;
  const before = finishSweep(old, direction), after = finishSweep(new SharedAttackStrategy(), direction);
  assert.deepEqual(before.kept, ['C10', 'C10', 'D10']);
  assert.equal(before.settle.dealerPoints, 200);
  assert.deepEqual(after.kept, ['SA', 'SQ', 'SJ']);
  assert.equal(after.settle.attackerPoints, 25);
  assert.equal(after.settle.dealerPoints + after.settle.attackerPoints, 200);
});

test('后续局部策略不能把垫牌重新改回拆守门小牌', () => {
  class BadLatePick extends SharedAttackStrategy {
    _chooseThrowSupport(state, seat, ctx, candidates, pick) {
      return candidates.find((cs) => cs.every((c) => c.suit === ctx.suitDefense.suit)) || pick;
    }
  }
  const st = sweepPosition('counterclockwise', false, false, true), ai = new BadLatePick();
  const seat = st.turnIdx, ctx = ai._buildCtx(st, seat), before = structuredClone(st);
  assert.equal(ai._hasSweepRisk(st, ctx), true);
  assert.ok(ai.decidePlay(st, seat).every((c) => c.suit !== ctx.suitDefense.suit));
  assert.deepEqual(st, before);
});

test('本轮可确定跑分时先收分或喂分，不能为守门放弃当前窗口', () => {
  const ai = new SharedAttackStrategy();
  for (const feed of [false, true]) {
    let st = sweepPosition('counterclockwise', false, false, true);
    // 从同一副完整牌局改为庄家先领S8/SK，所有牌仍恰好出现一次。
    st.players[0].hand.push(...st.currentTrick.plays[0].cards);
    st.currentTrick = null; st.turnIdx = 0;
    st = transition(st, { type: 'PLAY', playerIdx: 0,
      cards: [st.players[0].hand.find((c) => c.suit === 'S' && c.rank === (feed ? '8' : 'K'))], ts: 0 });
    if (feed) st = transition(st, { type: 'PLAY', playerIdx: st.turnIdx,
      cards: [st.players[st.turnIdx].hand.find((c) => c.suit === 'S' && c.rank === 'A')], ts: 0 });
    const seat = st.turnIdx, ctx = ai._buildCtx(st, seat), candidates = legalMoves(st, seat);
    assert.ok(ctx.suitDefense && ai._hasSweepRisk(st, ctx));
    const small = candidates.find((cs) => cs[0].rank === (feed ? '3' : '4'));
    assert.ok(small);
    const pick = ai._finalizeAttackerPlay(st, seat, ctx, candidates, small);
    assert.equal(pick[0].rank, feed ? 'K' : 'A');
    assert.equal(validatePlay(st, seat, pick).ok, true);
  }
});

test('已有实际跑分、庄家已不可能满分时，不强制按守门底线覆盖原选择', () => {
  const st = sweepPosition('counterclockwise', false, false, true), ai = new SharedAttackStrategy();
  const paid = st.completedTricks.find((t) => t.points > 0);
  paid.winnerIdx = st.playOrder[1];
  const seat = st.turnIdx, ctx = ai._buildCtx(st, seat), candidates = legalMoves(st, seat);
  assert.equal(ai._hasSweepRisk(st, ctx), false);
  const small = candidates.find((cs) => cs.every((c) => c.suit === ctx.suitDefense.suit));
  assert.equal(ai._finalizeAttackerPlay(st, seat, ctx, candidates, small), small);
});

for (const direction of ['clockwise', 'counterclockwise']) test(`庄家连续AA/KK后，守门家保留小对缓冲并以QQ吃JJ/${direction}`, () => {
  let st = sweepPosition(direction, false, true);
  const ai = new SharedAttackStrategy(), guard = st.playOrder[1];
  st = playTrick(st, ai);
  const kings = st.players[0].hand.filter((c) => c.rank === 'BJ');
  st = transition(st, { type: 'PLAY', playerIdx: 0, cards: kings, ts: 0 });
  st = playTrick(st, ai);
  assert.ok(st.players[guard].hand.filter((c) => c.suit === 'S').length >= 6);
  for (const rank of ['A', 'K', 'J']) {
    st = transition(st, { type: 'PLAY', playerIdx: 0,
      cards: st.players[0].hand.filter((c) => c.suit === 'S' && c.rank === rank), ts: 0 });
    const ctx = ai._buildCtx(st, st.turnIdx);
    if (rank !== 'J') assert.ok(ctx.suitDefense, '庄家副牌展开后仍继续分工守门');
    st = playTrick(st, ai);
  }
  assert.equal(st.completedTricks.at(-1).winnerIdx, guard);
  while (st.phase === 'PLAYING') st = transition(st, { type: 'PLAY', playerIdx: st.turnIdx,
    cards: ai.decidePlay(st, st.turnIdx), ts: 0 });
  assert.ok(st.lastSettle.dealerPoints < 200);
  assert.ok(st.lastSettle.attackerPoints > 0, 'QQ接回领出权后应当实际跑分或收底，而不只是赢白墩');
  assert.equal(st.lastSettle.dealerPoints + st.lastSettle.attackerPoints, 200);
});

for (const direction of ['clockwise', 'counterclockwise']) test(`无主后三家各留一门/${direction}：连续清主后保住长门，A领后仍能用A吃K破满分`, () => {
  const ai = new SharedAttackStrategy();
  let st = sweepPosition(direction);
  const first = st.playOrder[1];
  assert.equal(ai._buildCtx(st, first).sdy.trumpWatch, true);
  assert.equal(ai._buildCtx(st, first).knowledge.consistent, true);
  for (let round = 0; round < 7; round++) {
    if (round) {
      const card = st.players[0].hand.find((c) => domainOf(c, st.trumpInfo) === 'TRUMP');
      st = transition(st, { type: 'PLAY', playerIdx: 0, cards: [card], ts: 0 });
    }
    st = playTrick(st, ai);
  }
  for (const [i, seat] of st.playOrder.slice(1).entries()) {
    const suit = ['S', 'C', 'D'][i];
    assert.equal(st.players[seat].hand.length, 3);
    assert.equal(st.players[seat].hand.filter((c) => c.suit === suit).length, 3,
      `不能只保各门孤张大牌，${seat}应主留${suit}`);
  }
  for (const rank of ['A', 'K']) {
    const c = st.players[0].hand.find((c) => c.suit === 'S' && c.rank === rank);
    st = transition(st, { type: 'PLAY', playerIdx: 0, cards: [c], ts: 0 });
    st = playTrick(st, ai);
  }
  assert.equal(st.completedTricks.at(-1).winnerIdx, first);
  assert.ok(st.completedTricks.at(-1).points >= 10, '保留小牌缓冲后反压K，阻止庄家拿满200分');
  while (st.phase === 'PLAYING') st = transition(st, { type: 'PLAY', playerIdx: st.turnIdx,
    cards: ai.decidePlay(st, st.turnIdx), ts: 0 });
  assert.ok(st.lastSettle.dealerPoints < 200);
  assert.equal(st.lastSettle.dealerPoints + st.lastSettle.attackerPoints, 200);
});

test('三家都偏爱同一门时仍协调覆盖三门，不按固定座位机械指定', () => {
  const st = sweepPosition('counterclockwise', true), ai = new SharedAttackStrategy();
  const ctx = ai._buildCtx(st, st.turnIdx);
  assert.ok(ctx.suitDefense);
  assert.equal(new Set(ctx.suitDefense.roles.values()).size, 3);
});

test('同一轮连续清主期间守门角色稳定，只共享花色意向，庄家与底牌始终不可读', () => {
  let st = sweepPosition();
  const ai = new SharedAttackStrategy(), expectedRoles = ai._buildCtx(st, st.turnIdx).suitDefense.roles;
  for (let i = 0; i < 3; i++) {
    const seat = st.turnIdx, ctx = ai._buildCtx(st, seat);
    assert.deepEqual(ctx.suitDefense.roles, expectedRoles);
    assert.deepEqual(Object.keys(ctx.suitDefense).sort(), ['roles', 'suit']);
    const before = structuredClone(st), expected = ai.decidePlay(st, seat);
    const sealed = structuredClone(st); let reads = 0;
    Object.defineProperty(sealed.players[0], 'hand', { get() { reads++; throw Error('庄家暗牌'); } });
    Object.defineProperty(sealed, 'bottomCards', { get() { reads++; throw Error('底牌'); } });
    assert.deepEqual(ai.decidePlay(sealed, seat), expected); assert.equal(reads, 0);
    assert.deepEqual(st, before);
    st = transition(st, { type: 'PLAY', playerIdx: seat, cards: expected, ts: 0 });
  }
});

test('尚未公开证明三家全无主时，不交换守门意向或读取其他手牌', () => {
  const st = sweepPosition(), ai = new SharedAttackStrategy(), ctx = ai._buildCtx(st, st.turnIdx);
  const { buildSuitDefense } = require('../miniprogram/ai/suit-defense');
  ctx.knowledge.seats[st.playOrder[2]].domains.get('TRUMP').count.max = 1;
  let reads = 0;
  for (const s of st.playOrder.slice(1).filter((s) => s !== st.turnIdx)) Object.defineProperty(st.players[s], 'hand', {
    get() { reads++; throw Error('仍有主的队友'); }
  });
  assert.equal(buildSuitDefense(st, st.turnIdx, ctx), null); assert.equal(reads, 0);
});

test('多张主牌的垫牌候选也能保副牌长度，不能只给出拆短主守门的组合', () => {
  const ai = new SharedAttackStrategy(); let st = sweepPosition();
  for (let round = 0; round < 2; round++) {
    if (round) st = transition(st, { type: 'PLAY', playerIdx: 0,
      cards: [st.players[0].hand.find((c) => domainOf(c, st.trumpInfo) === 'TRUMP')], ts: 0 });
    st = playTrick(st, ai);
  }
  const lead = st.players[0].hand.filter((c) => domainOf(c, st.trumpInfo) === 'TRUMP').slice(0, 4);
  assert.ok(parseCombo(lead, st.trumpInfo, st.config));
  st = transition(st, { type: 'PLAY', playerIdx: 0, cards: lead, ts: 0 });
  const seat = st.turnIdx, moves = legalMoves(st, seat), suit = ai._buildCtx(st, seat).suitDefense.suit;
  assert.ok(moves.every((cs) => validatePlay(st, seat, cs).ok));
  assert.ok(moves.some((cs) => cs.filter((c) => c.suit === suit).length === 2));
  const pick = ai.decidePlay(st, seat);
  const kept = st.players[seat].hand.filter((c) => c.suit === suit && !pick.some((p) => p.id === c.id));
  assert.ok(kept.length >= 3, '跟多张主也不能只留下主守门孤张大牌');
});

test('真人是闲家时不启用额外守门协同，其他手牌全部不可读取', () => {
  const st = sweepPosition(), seat = st.turnIdx, ai = new SharedAttackStrategy();
  st.players.forEach((p, s) => { p.isHuman = s === seat; });
  const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
  const expected = new GreedyStrategy().decidePlay(st, seat); let reads = 0;
  for (const s of st.playOrder.filter((s) => s !== seat)) Object.defineProperty(st.players[s], 'hand', {
    get() { reads++; throw Error('其他暗牌'); }
  });
  Object.defineProperty(st, 'bottomCards', { get() { reads++; throw Error('底牌'); } });
  assert.deepEqual(ai.decidePlay(st, seat), expected); assert.equal(reads, 0);
});

test('H5无process环境也保持三门守牌，并和源码完整对局逐手一致', () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const browser = { window: {}, console };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../h5/js/game-bundle.js'), 'utf8'), browser);
  const web = new browser.window.GameCore.GameService().ai, source = new SharedAttackStrategy();
  let st = sweepPosition();
  const play = (cards) => { st = transition(st, { type: 'PLAY', playerIdx: st.turnIdx, cards, ts: 0 }); };
  const same = () => {
    const a = source.decidePlay(st, st.turnIdx), b = web.decidePlay(st, st.turnIdx);
    assert.deepEqual(a.map((c) => c.id), Array.from(b, (c) => c.id)); play(a);
  };
  for (let round = 0; round < 7; round++) {
    if (round) play([st.players[0].hand.find((c) => domainOf(c, st.trumpInfo) === 'TRUMP')]);
    for (let i = 0; i < 3; i++) same();
  }
  for (const rank of ['A', 'K']) {
    play([st.players[0].hand.find((c) => c.suit === 'S' && c.rank === rank)]);
    for (let i = 0; i < 3; i++) same();
  }
  while (st.phase === 'PLAYING') same();
  assert.ok(st.lastSettle.dealerPoints < 200);
  const guarded = finishSweep(web, 'counterclockwise');
  assert.deepEqual(guarded.kept, ['SA', 'SQ', 'SJ']);
  assert.equal(guarded.settle.attackerPoints, 25);
});
