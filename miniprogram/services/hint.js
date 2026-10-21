/**
 * services/hint.js —— 出牌提示生成（F-10，P1）：合法集合中选较优组合。
 *
 * 复用 AI 的贪心打分（同一 legalMoves 真值源），取 Top1 作为提示。
 */

'use strict';

const { legalMoves } = require('../engine/validate');
const { createAI } = require('../ai/strategy');

/**
 * 生成提示。
 * @param {object} state GameState
 * @param {number} playerIdx
 * @returns {{cards: Array<object>|null, reason: string}} 提示牌与理由文案
 */
function getHint(state, playerIdx) {
  const moves = legalMoves(state, playerIdx);
  if (moves.length === 0) {
    return { cards: null, reason: '当前无合法出牌' };
  }
  if (moves.length === 1) {
    return { cards: moves[0], reason: '唯一合法选择' };
  }
  const ai = createAI('normal');
  const pick = ai.decidePlay(state, playerIdx, null);
  const isLead = !state.currentTrick || state.currentTrick.plays.length === 0;
  return {
    cards: pick,
    reason: isLead ? '建议领出该组合' : '建议跟出该组合'
  };
}

module.exports = { getHint };
