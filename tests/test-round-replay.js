'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GameService } = require('../miniprogram/services/game-service');
const { createConfig } = require('../miniprogram/engine/config');
const { deserializeState } = require('../miniprogram/core/state');
const { transition } = require('../miniprogram/core/statemachine');

function setup() {
  const rounds = new Map();
  const options = {
    config: createConfig({ gameMode: 'san_da_yi', sanDaYiNoBidAction: 'redeal' }),
    difficulty: 'easy', seed: 11,
    saveReplay: replay => rounds.set(replay.id, JSON.parse(JSON.stringify(replay)))
  };
  return { rounds, options };
}

test('归档真人和 AI 的整副牌，续玩后可逐手重放到同一结算', () => {
  const { rounds, options } = setup();
  let service = new GameService(options);
  const dealt = service.startGame();
  const dealer = dealt.turnIdx;
  service.dispatch({ type: 'SCORE_BID', playerIdx: dealer, score: dealt.config.sanDaYiBidCap });
  assert.throws(() => service.dispatch({ type: 'PLAY', playerIdx: dealer, cards: [] }));
  const saved = JSON.parse(JSON.stringify(service.serialize()));
  service = new GameService(options);
  service.resume(saved);
  for (let i = 0; i < 120 && service.state.phase !== 'SCORING'; i++) {
    if (service.tick().acted) continue;
    const st = service.state;
    if (st.phase === 'CHOOSE_TRUMP') assert.ok(service.chooseTrump('S').ok);
    else if (st.phase === 'BURYING') assert.ok(service.bury(st.players[dealer].hand.slice(0, 8)).ok);
    else assert.ok(service.play(st.turnIdx, service.ai.decidePlay(st, st.turnIdx, service.rng)).ok);
  }
  assert.equal(rounds.size, 1);
  const [record] = rounds.values();
  assert.equal(record.phase, 'SCORING');
  let state = deserializeState(record.initial);
  assert.equal(state.bottomCards.length, 8);
  assert.equal(state.players.flatMap(p => p.hand).length, 100);
  for (const action of record.actions) {
    const cards = action.cards?.map(id => state.players[action.playerIdx].hand.find(card => card.id === id));
    state = transition(state, { ...action, cards });
    if (action.type === 'PLAY') {
      const trick = state.currentTrick || state.completedTricks.at(-1);
      assert.deepEqual(action.played, trick.plays.at(-1).cards.map(card => card.id));
      if (!state.currentTrick) assert.equal(action.winnerIdx, trick.winnerIdx);
    }
  }
  assert.deepEqual(state.completedTricks, service.state.completedTricks);
  assert.deepEqual(record.settlement, service.state.lastSettle);
  service.nextRound();
  assert.equal(rounds.size, 2);
  assert.deepEqual(rounds.get(record.id), record);
});

test('无人叫分重发和手动重开均保留此前牌路，旧续玩存档从现有局面开始', () => {
  const { rounds, options } = setup();
  const service = new GameService(options);
  service.startGame();
  for (let i = 0; i < 4; i++) service.dispatch({ type: 'PASS_BID', playerIdx: service.state.turnIdx });
  assert.equal(service.state.phase, 'INIT_DEAL');
  service.dispatch({ type: 'DEAL', rng: service.rng });
  assert.equal([...rounds.values()][0].actions.length, 4);
  service.startGame();
  assert.equal(rounds.size, 3);
  const legacy = service.serialize();
  delete legacy.roundReplay;
  service.resume(legacy);
  assert.equal(service.replay.fromDeal, false);
  assert.deepEqual(service.replay.initial.players, legacy.players);
});
