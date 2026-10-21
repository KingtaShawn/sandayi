/**
 * ai/memory.js —— 记牌器：已出牌 / 剩余牌 / 分牌统计跟踪（P1 困难难度用，结构先行）。
 *
 * 事件订阅 logger 或直接从 GameState 派生（纯函数）：
 *   - 已出牌（completedTricks + currentTrick）
 *   - 各域剩余张数（108 - 已出 - 自己手牌）
 *   - 分牌已出统计
 */

'use strict';

const { pointValue } = require('../engine/card');
const { domainOf } = require('../engine/combo');

/**
 * 从状态构建记牌视图。
 * @param {object} state GameState
 * @param {number} viewerIdx 观察者（AI）视角
 * @returns {object} memory view
 */
function buildMemory(state, viewerIdx) {
  const cfg = state.config;
  const played = [];
  state.completedTricks.forEach((t) => {
    t.plays.forEach((p) => played.push(...p.cards));
  });
  if (state.currentTrick) {
    state.currentTrick.plays.forEach((p) => played.push(...p.cards));
  }
  const myHand = state.players[viewerIdx].hand;

  // 剩余牌 = 全副牌 - 已出 - 我的手牌（对其他三家可见性=概率分布）
  const total = 54 * cfg.deckCount;
  const playedKeys = new Map();
  played.forEach((c) => {
    const k = `${c.suit}-${c.rank}`;
    playedKeys.set(k, (playedKeys.get(k) || 0) + 1);
  });
  const myKeys = new Map();
  myHand.forEach((c) => {
    const k = `${c.suit}-${c.rank}`;
    myKeys.set(k, (myKeys.get(k) || 0) + 1);
  });

  // 分牌统计
  const pointsPlayed = played.reduce((s, c) => s + pointValue(c, cfg), 0);
  const pointsInHand = myHand.reduce((s, c) => s + pointValue(c, cfg), 0);

  // 按域统计已出
  const playedByDomain = { TRUMP: 0, S: 0, H: 0, C: 0, D: 0 };
  played.forEach((c) => {
    if (state.trumpInfo) playedByDomain[domainOf(c, state.trumpInfo)]++;
  });

  return {
    playedCount: played.length,
    played,
    pointsPlayed,
    pointsInHand,
    totalPoints: total / 54 * 100, // 每副 100 分
    playedByDomain,
    remainingCount: total - played.length - myHand.length,
    isKeyPlayed: (key) => (playedKeys.get(key) || 0) >= cfg.deckCount,
    remainingOfKey: (key) => Math.max(0, cfg.deckCount - (playedKeys.get(key) || 0) - (myKeys.get(key) || 0))
  };
}

module.exports = { buildMemory };
