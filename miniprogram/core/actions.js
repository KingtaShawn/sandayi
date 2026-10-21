/**
 * core/actions.js —— Action 类型常量 + 工厂函数（状态机唯一输入）。
 */

'use strict';

const ACTION_TYPES = {
  START_GAME: 'START_GAME',       // 开始整轮（建初始局）
  DEAL: 'DEAL',                   // 一次性完成发牌 → BIDDING
  BID: 'BID',                     // 亮主/反主（playerIdx + cards）
  PASS_BID: 'PASS_BID',           // 放弃亮主（playerIdx）
  FLIP_BOTTOM: 'FLIP_BOTTOM',     // 翻底定主（无人亮主 R20）
  BURY: 'BURY',                   // 埋底（庄家 cards）
  PLAY: 'PLAY',                   // 出牌（playerIdx + cards）
  NEXT_ROUND: 'NEXT_ROUND',       // 下一局（SCORING → INIT_DEAL/GAME_OVER）
  RESUME: 'RESUME'                // 恢复存档（payload=serialized state）
};

/**
 * 工厂：亮主。
 * @param {number} playerIdx
 * @param {Array<object>} cards
 */
function bidAction(playerIdx, cards_) {
  return { type: ACTION_TYPES.BID, playerIdx, cards: cards_, ts: Date.now() };
}

/**
 * 工厂：放弃亮主。
 * @param {number} playerIdx
 */
function passBidAction(playerIdx) {
  return { type: ACTION_TYPES.PASS_BID, playerIdx, ts: Date.now() };
}

/**
 * 工厂：翻底定主。
 */
function flipBottomAction() {
  return { type: ACTION_TYPES.FLIP_BOTTOM, ts: Date.now() };
}

/**
 * 工厂：埋底。
 * @param {number} playerIdx
 * @param {Array<object>} cards
 */
function buryAction(playerIdx, cards_) {
  return { type: ACTION_TYPES.BURY, playerIdx, cards: cards_, ts: Date.now() };
}

/**
 * 工厂：出牌。
 * @param {number} playerIdx
 * @param {Array<object>} cards
 */
function playAction(playerIdx, cards_) {
  return { type: ACTION_TYPES.PLAY, playerIdx, cards: cards_, ts: Date.now() };
}

/**
 * 工厂：下一局。
 */
function nextRoundAction() {
  return { type: ACTION_TYPES.NEXT_ROUND, ts: Date.now() };
}

/**
 * 工厂：恢复存档。
 * @param {object} savedState
 */
function resumeAction(savedState) {
  return { type: ACTION_TYPES.RESUME, payload: savedState, ts: Date.now() };
}

module.exports = { ACTION_TYPES, bidAction, passBidAction, flipBottomAction, buryAction, playAction, nextRoundAction, resumeAction };
