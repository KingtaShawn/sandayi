// 逐副记录起点和引擎接受的动作。牌 ID 区分两副牌中的同花同点。
'use strict';

const { serializeState } = require('../core/state');

function beginReplay(state, fromDeal) {
  const startedAt = Date.now();
  return {
    version: 1, id: startedAt.toString(36) + '-' + Math.random().toString(36).slice(2),
    startedAt, fromDeal, initial: serializeState(state), actions: [],
    phase: state.phase, settlement: state.lastSettle
  };
}

function recordAction(replay, action, state) {
  const entry = { type: action.type, playerIdx: action.playerIdx };
  if (action.score !== undefined) entry.score = action.score;
  if (action.suit !== undefined) entry.suit = action.suit;
  if (action.cards) entry.cards = action.cards.map(card => card.id);
  if (action.type === 'PLAY') {
    const trick = state.currentTrick || state.completedTricks[state.completedTricks.length - 1];
    const play = trick.plays[trick.plays.length - 1];
    entry.played = play.cards.map(card => card.id);
    if (!state.currentTrick) {
      entry.winnerIdx = trick.winnerIdx;
      entry.points = trick.points;
    }
  }
  replay.actions.push(entry);
  replay.phase = state.phase;
  replay.settlement = state.lastSettle;
}

module.exports = { beginReplay, recordAction };
