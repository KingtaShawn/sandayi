'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { SharedAttackStrategy, canShareHands, readingProgress } = require('../miniprogram/ai/strategy-shared');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { GameService } = require('../miniprogram/services/game-service');
const { domainOf } = require('../miniprogram/engine/combo');
const { validatePlay } = require('../miniprogram/engine/validate');
const { transition } = require('../miniprogram/core/statemachine');
const { prepare, dealerProfile } = require('../tools/ai-arena');
const FILE = path.resolve(__dirname, '../miniprogram/ai/strategy-greedy.js');

function position(seed = 47001, direction = 'counterclockwise') {
  const scenario = { seed, profile: 'normal', firstBidder: seed % 4, direction };
  const dealer = dealerProfile(FILE, scenario.profile), st = prepare(scenario, dealer, dealer);
  st.players.forEach((p, seat) => { p.isHuman = seat === st.dealerIdx; });
  return st;
}
function actor(st) { return (st.dealerIdx + 1) % 4; }
function seal(st, seats) {
  let reads = 0;
  seats.forEach((s) => Object.defineProperty(st.players[s], 'hand', {
    get() { reads++; throw Error('读取禁止的手牌'); }
  }));
  Object.defineProperty(st, 'bottomCards', { get() { reads++; throw Error('读取禁止的底牌'); } });
  return () => reads;
}
let middle;
function midPosition() {
  if (!middle) {
    let st = position();
    const ai = new GreedyStrategy(), training = new SharedAttackStrategy();
    for (let step = 0; step < 180 && st.phase === 'PLAYING'; step++) {
      if (st.turnIdx !== st.dealerIdx) {
        const ctx = training._buildCtx(st, st.turnIdx);
        if (ctx.teamReadings && ctx.teamReadings.size) { middle = st; break; }
      }
      st = transition(st, { type: 'PLAY', playerIdx: st.turnIdx, cards: ai.decidePlay(st, st.turnIdx), ts: 0 });
    }
    assert.ok(middle, '实际牌局必须能进入有限协同阶段');
  }
  return structuredClone(middle);
}

test('正常对局默认使用渐进算牌，简单难度维持原行为', () => {
  assert.ok(new GameService().ai instanceof SharedAttackStrategy);
  assert.ok(!(new GameService({ difficulty: 'easy' }).ai instanceof SharedAttackStrategy));
});

test('共享只用于真人独自坐庄；真人闲家、全AI、升级与多人均关闭', () => {
  const st = position(), seat = actor(st);
  assert.equal(canShareHands(st, seat), true);
  assert.equal(canShareHands(st, st.dealerIdx), false);
  st.players[st.dealerIdx].isHuman = false;
  assert.equal(canShareHands(st, seat), false);
  st.players[seat].isHuman = true;
  assert.equal(canShareHands(st, (seat + 1) % 4), false);
  st.players[st.dealerIdx].isHuman = true;
  assert.equal(canShareHands(st, (seat + 1) % 4), false);
  st.players[seat].isHuman = false;
  st.config = { ...st.config, gameMode: 'shengji' };
  assert.equal(canShareHands(st, seat), false);
});

test('开局零共享：隐藏所有其他手牌和底牌仍与普通AI逐牌相同', () => {
  const st = position(), seat = actor(st), ai = new SharedAttackStrategy();
  const expected = new GreedyStrategy().decidePlay(st, seat);
  const reads = seal(st, [0, 1, 2, 3].filter((s) => s !== seat));
  assert.deepEqual(ai.decidePlay(st, seat), expected);
  assert.equal(ai._buildCtx(st, seat).teamReadings, undefined);
  assert.equal(reads(), 0);
});

test('精度由公开历史渐进提高，一次大甩牌不能解锁整手，未出过的门不开放', () => {
  const trick = (n = 1) => ({ leadCombo: { suit: 'S', type: 'single' },
    plays: [0, 1, 2, 3].map(() => ({ cards: Array(n).fill({}) })) });
  assert.equal(readingProgress({ completedTricks: [trick(8)] }).stage, 0);
  const early = readingProgress({ completedTricks: Array.from({ length: 4 }, () => trick()) });
  assert.equal(early.stage, 1); assert.equal(early.width, 4);
  assert.equal(early.exposure.has('TRUMP'), false);
  const mid = readingProgress({ completedTricks: Array.from({ length: 6 }, () => trick(2)) });
  assert.equal(mid.stage, 2); assert.equal(mid.width, 3);
  const late = readingProgress({ completedTricks: Array.from({ length: 8 }, () => trick(2)) });
  assert.equal(late.stage, 3); assert.equal(late.width, 2);
});

test('中期只开放已反复出过的门的宽区间；不改变公开威胁、锁墩或持牌硬边界', () => {
  const st = midPosition(), seat = st.turnIdx, ai = new SharedAttackStrategy();
  const ctx = ai._buildCtx(st, seat), publicCtx = new GreedyStrategy()._buildCtx(st, seat);
  const progress = readingProgress(st);
  assert.ok(ctx.teamReadings.size > 0);
  assert.deepEqual(ctx.di, publicCtx.di);
  assert.deepEqual(ctx.knowledge, publicCtx.knowledge);
  for (const [mate, readings] of ctx.teamReadings) for (const [dom, range] of readings) {
    assert.ok(progress.exposure.get(dom) >= 2);
    assert.ok(range.max > range.min);
    const n = st.players[mate].hand.filter((c) => domainOf(c, st.trumpInfo) === dom).length;
    assert.ok(n >= range.min && n <= range.max);
    assert.deepEqual(Object.keys(range).sort(), ['max', 'min']);
  }
});

test('中期没有庄家、底牌或牌堆读取通道；交换真实庄底暗牌不影响选择', () => {
  const st = midPosition(), seat = st.turnIdx, ai = new SharedAttackStrategy(), expected = ai.decidePlay(st, seat);
  const swapped = structuredClone(st);
  [swapped.players[swapped.dealerIdx].hand[0], swapped.bottomCards[0]] =
    [swapped.bottomCards[0], swapped.players[swapped.dealerIdx].hand[0]];
  assert.deepEqual(ai.decidePlay(swapped, seat), expected);
  const reads = seal(st, [st.dealerIdx]);
  Object.defineProperty(st, 'deck', { get() { throw Error('读取隐藏牌堆'); } });
  assert.deepEqual(ai.decidePlay(st, seat), expected);
  assert.equal(reads(), 0);
});

test('队友同门换牌但长短相同，不能看穿其具体大牌、对子和牌面', () => {
  const st = midPosition(), ai = new SharedAttackStrategy(), seat = st.turnIdx;
  const expected = ai.decidePlay(st, seat), mates = [0, 1, 2, 3].filter((s) => s !== seat && s !== st.dealerIdx);
  let swapped = false;
  for (let i = 0; i < st.players[mates[0]].hand.length && !swapped; i++) {
    const c = st.players[mates[0]].hand[i];
    const j = st.players[mates[1]].hand.findIndex((d) => d.rank !== c.rank
      && domainOf(c, st.trumpInfo) === domainOf(d, st.trumpInfo));
    if (j < 0) continue;
    [st.players[mates[0]].hand[i], st.players[mates[1]].hand[j]] = [st.players[mates[1]].hand[j], c];
    swapped = true;
  }
  assert.equal(swapped, true);
  assert.deepEqual(ai.decidePlay(st, seat), expected);
});

test('真人转为闲家后，同一个AI实例立即关闭额外协同，其他手牌全部不可读', () => {
  const st = midPosition(), seat = st.turnIdx, ai = new SharedAttackStrategy();
  assert.ok(ai._buildCtx(st, seat).teamReadings.size);
  st.players.forEach((p, s) => { p.isHuman = s === seat; });
  const expected = new GreedyStrategy().decidePlay(st, seat);
  const reads = seal(st, [0, 1, 2, 3].filter((s) => s !== seat));
  assert.deepEqual(ai.decidePlay(st, seat), expected);
  assert.equal(reads(), 0);
});

test('所有推演路径保留队友多种可能手牌，不把真实手牌固定给模拟器', () => {
  const st = midPosition(), ai = new SharedAttackStrategy(), seat = st.turnIdx, ctx = ai._buildCtx(st, seat);
  const groups = [0, 1, 2, 3].filter((s) => s !== seat).map((s) => ({
    seat: s, size: st.players[s].hand.length, voids: new Set()
  }));
  ai._constrainPublicGroups(ctx, groups);
  const asgs = ai._r5Assignments(ai._r5UnseenCards(st, seat), groups, st.trumpInfo, 24, ai._beliefSpec(ctx, groups));
  assert.ok(asgs.length >= 3);
  for (const [mate] of ctx.teamReadings) {
    const i = groups.findIndex((g) => g.seat === mate);
    const signatures = new Set(asgs.map((a) => a.hands[i].map((c) => c.suit + c.rank).sort().join('|')));
    assert.ok(signatures.size > 1);
  }
});

for (const direction of ['clockwise', 'counterclockwise']) test(`完整对局/${direction}：渐进阶段合法、纯函数、庄底隔离`, () => {
  const ai = new SharedAttackStrategy(), dealer = dealerProfile(FILE, 'normal');
  let st = position(direction === 'clockwise' ? 47003 : 47004, direction);
  for (let step = 0; step < 180 && st.phase === 'PLAYING'; step++) {
    const seat = st.turnIdx, attacker = seat !== st.dealerIdx, snapshot = JSON.stringify(st);
    const pick = (attacker ? ai : dealer).decidePlay(st, seat);
    assert.equal(JSON.stringify(st), snapshot);
    assert.equal(validatePlay(st, seat, pick).ok, true);
    if (attacker) {
      const hidden = structuredClone(st), early = !readingProgress(st).stage;
      const reads = seal(hidden, early ? [0, 1, 2, 3].filter((s) => s !== seat) : [st.dealerIdx]);
      assert.deepEqual(ai.decidePlay(hidden, seat), pick); assert.equal(reads(), 0);
    }
    st = transition(st, { type: 'PLAY', playerIdx: seat, cards: pick, ts: 0 });
  }
  assert.equal(st.phase, 'SCORING');
});

test('H5无process环境与小程序在开局和中期共用相同渐进算牌策略', () => {
  const sandbox = { console, window: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../h5/js/game-bundle.js'), 'utf8'), sandbox);
  const ai = new GameService().ai, browserAI = new sandbox.window.GameCore.GameService().ai;
  for (const st of [position(), midPosition()]) {
    const seat = st.turnIdx === st.dealerIdx ? actor(st) : st.turnIdx;
    assert.deepEqual(Array.from(browserAI.decidePlay(st, seat), (c) => c.id), ai.decidePlay(st, seat).map((c) => c.id));
  }
});
