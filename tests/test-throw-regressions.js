'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfig } = require('../miniprogram/engine/config');
const { validatePlay } = require('../miniprogram/engine/validate');
const { parseCombo } = require('../miniprogram/engine/combo');
const { transition } = require('../miniprogram/core/statemachine');
const { GameService } = require('../miniprogram/services/game-service');
const { C, cards, cardsD, makeState } = require('./fixtures');

function state(hands, throwPenalty = 'penalty_smallest') {
  const st = makeState({ hands });
  st.config = createConfig({ gameMode: 'san_da_yi', throwPenalty });
  st.sanDaYiTeams = { dealer: 0, attackers: [1, 2, 3] };
  st.roundHistory = [];
  return st;
}

function ids(hand) {
  return hand.map(c => c.id).sort();
}

test('甩牌：同大的副牌单张不能压住先出的 A，不应误罚', () => {
  const selected = [...cards('SA'), ...cardsD('SK')];
  const st = state([selected, [C('S', 'A', 1)], cardsD('SQ'), cards('SJ')]);
  assert.equal(validatePlay(st, 0, selected).ok, true);
  const next = transition(st, { type: 'PLAY', playerIdx: 0, cards: selected });
  assert.deepEqual(ids(next.currentTrick.plays[0].cards), ids(selected));
  assert.equal(next.penaltyPoints, undefined);
});

test('甩牌：大小相同的不同花色副级牌对子不能互相压住', () => {
  const selected = [...cardsD('S2'), ...cardsD('BJ')];
  const st = state([selected, cardsD('C2'), cards('H9'), cards('D9')]);
  assert.equal(validatePlay(st, 0, selected).ok, true);
});

test('甩牌：对手的小单张不能遮蔽藏在对子中的大单张', () => {
  const selected = cards('SK', 'SQ');
  const st = state([selected, [...cardsD('SA'), ...cards('S3')], cards('D9'), cards('C9')], 'reject');
  const r = validatePlay(st, 0, selected);
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'E102');
});

test('甩牌：对手的小对子不能遮蔽更大拖拉机中的对子', () => {
  const selected = [...cards('SA'), ...cardsD('S9')];
  const st = state([selected, cardsD('S3', 'SJ', 'SQ'), cards('D9'), cards('C9')], 'reject');
  assert.equal(validatePlay(st, 0, selected).errorCode, 'E102');
});

test('甩牌失败：只出所选牌中被压住的最小单张，未选的小牌留在手中', () => {
  const selected = cards('SK', 'SQ');
  const st = state([[...selected, ...cards('S3', 'S4')], cards('SA'), cards('D9'), cards('C9')]);
  const next = transition(st, { type: 'PLAY', playerIdx: 0, cards: selected });
  assert.deepEqual(ids(next.currentTrick.plays[0].cards), ids(cards('SQ')));
  assert.deepEqual(ids(next.players[0].hand), ids(cards('SK', 'S3', 'S4')));
  assert.equal(next.currentTrick.leadCombo.n, 1);
});

test('甩牌失败：对子被压时保留对子，只出被压住的最小对子', () => {
  const selected = [...cards('SA'), ...cardsD('S5')];
  const st = state([[...selected, ...cards('S3')], cardsD('S7'), cards('D9'), cards('C9')]);
  const r = validatePlay(st, 0, selected);
  assert.deepEqual(ids(r.meta.replacement), ids(cardsD('S5')));
  const next = transition(st, { type: 'PLAY', playerIdx: 0, cards: selected });
  assert.equal(next.currentTrick.leadCombo.type, 'pair');
  assert.equal(next.currentTrick.leadCombo.n, 2);
  assert.deepEqual(ids(next.players[0].hand), ids(cards('SA', 'S3')));
});

test('甩牌失败：有单张和对子同时被压，优先出被压住的最小单张', () => {
  const selected = [...cardsD('S5'), ...cards('SK', 'SQ')];
  const st = state([selected, [...cardsD('S7'), ...cards('SA')], cards('D9'), cards('C9')]);
  assert.deepEqual(ids(validatePlay(st, 0, selected).meta.replacement), ids(cards('SQ')));
});

test('甩牌失败：强制单张以后，其他三家按实际一张跟牌并正确结墩', () => {
  const selected = cards('SK', 'SQ');
  let st = state([[...selected, ...cards('S3')], cards('SA', 'D3'), cards('S9', 'D4'), cards('S8', 'D5')]);
  st = transition(st, { type: 'PLAY', playerIdx: 0, cards: selected });
  for (const [playerIdx, spec] of [[1, 'SA'], [2, 'S9'], [3, 'S8']]) {
    st = transition(st, { type: 'PLAY', playerIdx, cards: cards(spec) });
  }
  assert.equal(st.completedTricks.length, 1);
  assert.equal(st.completedTricks[0].winnerIdx, 1);
  assert.ok(st.completedTricks[0].plays.every(p => p.cards.length === 1));
});

test('甩牌失败：服务层返回真实强制出牌和真实罚分，smallest 模式不谎报罚分', () => {
  const selected = cards('SK', 'SQ');
  const st = state([[...selected, ...cards('S3')], cards('SA'), cards('D9'), cards('C9')], 'smallest');
  const service = new GameService({ config: st.config });
  service.state = st;
  const r = service.play(0, selected);
  assert.equal(r.ok, true);
  assert.equal(r.replaced, true);
  assert.deepEqual(ids(r.playedCards), ids(cards('SQ')));
  assert.equal(r.penaltyPoints, 0);
  assert.match(r.reason, /Q/);
});

test('甩牌：状态机的 reject 模式也必须校验成立性', () => {
  const selected = cards('SK', 'SQ');
  const st = state([selected, cards('SA'), cards('D9'), cards('C9')], 'reject');
  assert.throws(() => transition(st, { type: 'PLAY', playerIdx: 0, cards: selected }), /E102|甩牌不成立/);
});

test('甩牌：不在手中的甩牌不能通过罚则转换成合法出牌', () => {
  const st = state([cards('S3', 'S4'), cards('SA'), cards('D9'), cards('C9')]);
  assert.throws(() => transition(st, { type: 'PLAY', playerIdx: 0, cards: cards('SK', 'SQ') }), /E105|不在手牌/);
});

test('三打一默认无拖拉机：99+1010 按两对子甩牌，外面有 QQ 就失败并只出 99', () => {
  const selected = cardsD('S9', 'S10');
  const st = state([selected, cardsD('SQ'), cards('D9'), cards('C9')]);
  const combo = parseCombo(selected, st.trumpInfo, st.config);
  assert.equal(combo.type, 'throw');
  assert.deepEqual(combo.units.map(u => u.type), ['pair', 'pair']);
  const r = validatePlay(st, 0, selected);
  assert.equal(r.errorCode, 'E102');
  assert.deepEqual(ids(r.meta.replacement), ids(cardsD('S9')));
  const next = transition(st, { type: 'PLAY', playerIdx: 0, cards: selected });
  assert.equal(next.currentTrick.leadCombo.type, 'pair');
  assert.deepEqual(ids(next.currentTrick.plays[0].cards), ids(cardsD('S9')));
  assert.deepEqual(ids(next.players[0].hand), ids(cardsD('S10')));
});

test('三打一默认无拖拉机：两个对子都最大时，连对可作为甩牌成立', () => {
  const selected = cardsD('SK', 'SA');
  const st = state([selected, cardsD('SQ'), cardsD('SJ'), cards('S10')]);
  const r = validatePlay(st, 0, selected);
  assert.equal(r.ok, true);
  assert.equal(r.meta.combo.type, 'throw');
  assert.ok(r.meta.combo.units.every(u => u.type === 'pair'));
});

test('三打一默认无拖拉机：不能用连对整体掩盖混合甩牌中可被压住的对子', () => {
  const selected = [...cardsD('S9', 'S10'), ...cards('SA')];
  const st = state([selected, cardsD('SQ'), cards('D9'), cards('C9')]);
  const r = validatePlay(st, 0, selected);
  assert.equal(r.errorCode, 'E102');
  assert.deepEqual(ids(r.meta.replacement), ids(cardsD('S9')));
});

test('三打一旧存档未携带新配置时，连对也默认按对子甩牌检查', () => {
  const selected = cardsD('S9', 'S10');
  const st = state([selected, cardsD('SQ'), cards('D9'), cards('C9')]);
  st.config = Object.assign({}, st.config);
  delete st.config.sanDaYiAllowTractor;
  assert.equal(validatePlay(st, 0, selected).errorCode, 'E102');
});

test('传统升级保留拖拉机；三打一可通过规则配置显式开启', () => {
  const selected = cardsD('S9', 'S10');
  const st = makeState({ hands: [selected, cardsD('SQ'), cards('D9'), cards('C9')] });
  assert.equal(validatePlay(st, 0, selected).meta.combo.type, 'tractor');
  st.config = createConfig({ gameMode: 'san_da_yi', sanDaYiAllowTractor: true });
  assert.equal(validatePlay(st, 0, selected).meta.combo.type, 'tractor');
  assert.throws(() => createConfig({ gameMode: 'san_da_yi', sanDaYiAllowTractor: 'false' }), /sanDaYiAllowTractor/);
});

test('甩牌罚分：累计罚分不能修改出牌前的原始状态', () => {
  const selected = cards('SK', 'SQ');
  const st = state([[...selected, ...cards('S3')], cards('SA'), cards('D9'), cards('C9')]);
  st.penaltyPoints = { dealer: 0, attackers: 10 };
  const next = transition(st, { type: 'PLAY', playerIdx: 0, cards: selected });
  assert.deepEqual(st.penaltyPoints, { dealer: 0, attackers: 10 });
  assert.deepEqual(next.penaltyPoints, { dealer: 0, attackers: 30 });
});

test('三打一跟甩牌：领出连对（两对甩）、该门有对 → 有对必逐对跟（min(k,m)）', () => {
  const lead = [...cardsD('SA', 'S9')]; // AA+99 连对（三打一无拖拉机 → 两对甩，n=4）
  const st = state([lead, [...cardsD('SK'), ...cards('S7', 'S8', 'S6')], cards('D9'), cards('C9')]);
  const combo = parseCombo(lead, st.trumpInfo, st.config);
  assert.equal(combo.type, 'throw'); // 两对单元，非拖拉机
  st.currentTrick = {
    leadPlayerIdx: 0,
    leadCombo: combo,
    plays: [{ playerIdx: 0, cards: lead, combo, isDiscard: false, isEffectiveTrump: false }],
    winnerIdx: 0,
    points: 0
  };
  // 玩家1 只有 KK 一对（m=1 < k=2）→ 须含 KK；拆对出 K+三单 → E103
  assert.equal(validatePlay(st, 1, cards('SK', 'S7', 'S8', 'S6')).ok, false);
  assert.equal(validatePlay(st, 1, cards('SK', 'S7', 'S8', 'S6')).errorCode, 'E103');
  assert.equal(validatePlay(st, 1, cardsD('SK').concat(cards('S7', 'S8'))).ok, true);
});

test('网页引擎与小程序一致：同大不误罚，连对默认逐对检查，失败只出原甩牌中的对子', () => {
  const h5 = require('../h5/js/game-bundle');
  assert.equal(h5.createConfig(h5.ruleConfig).sanDaYiAllowTractor, false);
  const scenarios = [
    { selected: [...cards('SA'), ...cardsD('SK')], others: [[C('S', 'A', 1)], cardsD('SQ'), cards('SJ')] },
    { selected: cardsD('S9', 'S10'), others: [cardsD('SQ'), cards('D9'), cards('C9')] },
    { selected: cardsD('SK', 'SA'), others: [cardsD('SQ'), cards('D9'), cards('C9')] }
  ];
  for (const { selected, others } of scenarios) {
    const st = state([[...selected, ...cards('S3')], ...others]);
    const source = new GameService({ config: st.config });
    const browser = new h5.GameService({ config: st.config });
    source.state = st;
    browser.state = JSON.parse(JSON.stringify(source.serialize()));
    browser.resume(browser.state);
    assert.deepEqual(browser.play(0, selected), source.play(0, selected));
    assert.deepEqual(browser.serialize(), source.serialize());
  }
});
