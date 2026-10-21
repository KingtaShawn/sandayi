/**
 * ai/strategy.js —— AIStrategy 接口定义 + createAI 工厂。
 *
 * 接口契约（架构 §4.4）：
 *   decideBid(state, playerIdx, options, rng) → BidOption | null
 *   decideBury(state, playerIdx, rng) → Card[]（bottomCards 张）
 *   decidePlay(state, playerIdx, rng) → Card[]（内部经 legalMoves + validatePlay 双保险）
 *
 * 实现可替换：greedy（P0）/ hard（P1）/ mcts（P2）。
 */

'use strict';

const { GreedyStrategy } = require('./strategy-greedy');

/** 难度 → 实现映射 */
const STRATEGY_REGISTRY = {
  easy: GreedyStrategy,
  normal: GreedyStrategy,
  hard: GreedyStrategy // P1 扩展（当前同 normal，strategy-greedy 内有难度分支）
};

/**
 * 创建 AI 实例。
 * @param {string} [difficulty='normal'] easy|normal|hard
 * @returns {object} AIStrategy
 */
function createAI(difficulty) {
  const Ctor = STRATEGY_REGISTRY[difficulty || 'normal'] || GreedyStrategy;
  return new Ctor(difficulty || 'normal');
}

module.exports = { createAI, STRATEGY_REGISTRY };
