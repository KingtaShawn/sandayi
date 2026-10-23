/**
 * engine/bid.js —— 亮主 / 反主规则（R8/R13/R17/R20/R21）。
 *
 * 优先级（高 → 低）：
 *   joker_pair 对王反主（无主局，需 R8）  priority 3
 *   pair_rank  两张同花色级牌反主          priority 2
 *   single_rank 一张级牌亮主               priority 1
 *   single_joker 单王反主（需 R21，默认关） priority 1（同 single_rank，不可反已亮同级）
 *
 * 约束：
 *   - 后亮优先级必须 > 当前最高；同级只允许出现一次；
 *   - 反主后原亮主者不可再反回（由优先级单调性自然保证）；
 *   - 单张级牌亮主只能在没有更高级亮主时进行；
 *   - 同优先级 pair_rank 可反 pair_rank？——否：同一优先级只能出现一次（PRD §5.5）。
 */

'use strict';

const { cardKey } = require('./card');
const { result } = require('./errors');

/** 亮/反主类型优先级 */
const BID_PRIORITY = {
  single_rank: 1,
  single_joker: 1,
  pair_rank: 2,
  joker_pair: 3
};

/**
 * 亮主类型优先级数值。
 * @param {string} bidType
 * @returns {number}
 */
function bidPriority(bidType) {
  return BID_PRIORITY[bidType] || 0;
}

/**
 * 当前最高亮主优先级。
 * @param {Array<object>} bids BidRecord[]
 * @returns {number} 无亮主返回 0
 */
function currentPriority(bids) {
  return bids.reduce((m, b) => Math.max(m, bidPriority(b.type)), 0);
}

/**
 * 识别一组牌的亮主类型。
 * @param {Array<object>} cards
 * @param {string} levelRank
 * @param {object} cfg
 * @returns {{type: string, trumpSuit: string|null, isNoTrump: boolean}|null}
 */
function classifyBidCards(cards_, levelRank, cfg) {
  if (!cards_ || cards_.length === 0 || cards_.length > 2) return null;
  if (cards_.length === 1) {
    const c = cards_[0];
    if (c.isJoker) {
      if (!cfg.allowSingleJokerOverride) return null; // R21 默认关
      return { type: 'single_joker', trumpSuit: null, isNoTrump: true };
    }
    if (c.rank === levelRank) {
      return { type: 'single_rank', trumpSuit: c.suit, isNoTrump: false };
    }
    return null;
  }
  // 两张
  const [a, b] = cards_;
  if (a.isJoker && b.isJoker && a.rank === b.rank) {
    if (!cfg.allowNoTrump) return null; // R8 关 → 王不可反主
    return { type: 'joker_pair', trumpSuit: null, isNoTrump: true };
  }
  if (!a.isJoker && !b.isJoker && a.rank === levelRank && b.rank === levelRank
      && a.suit === b.suit) {
    return { type: 'pair_rank', trumpSuit: a.suit, isNoTrump: false };
  }
  return null;
}

/**
 * 亮主/反主总校验。
 * @param {object} state GameState（phase=BIDDING、bids、players）
 * @param {number} playerIdx
 * @param {Array<object>} cards 亮出的牌（1~2 张）
 * @param {object} cfg
 * @returns {{ok: boolean, reason?: string, errorCode?: string, meta?: object}}
 */
function canBid(state, playerIdx, cards_, cfg) {
  if (state.phase !== 'BIDDING') {
    return result(false, '亮主窗口已关闭（已进入下一阶段）', 'E111');
  }
  const hand = state.players[playerIdx].hand;
  // 牌必须在手
  const handIds = new Set(hand.map((c) => c.id));
  for (const c of cards_) {
    if (!handIds.has(c.id)) return result(false, '亮主牌不在手牌中', 'E105');
  }
  const level = state.levels[`team${state.players[playerIdx].team}`];
  const cls = classifyBidCards(cards_, level, cfg);
  if (!cls) {
    return result(false, '亮主牌型不合法（需一张级牌 / 对级牌 / 对王）', 'E109');
  }
  const cur = currentPriority(state.bids);
  const pri = bidPriority(cls.type);
  if (pri <= cur) {
    return result(false, '反主优先级不足（已被更高级亮/反主占据）', 'E110');
  }
  return result(true, null, null, cls);
}

/**
 * 亮主截止判定（R17：before_bottom_flip / after_deal）。
 * @param {object} state
 * @param {object} cfg
 * @returns {boolean} 是否仍可亮主
 */
function bidWindowOpen(state, cfg) {
  if (state.phase !== 'BIDDING') return false;
  if (cfg.bidDeadLine === 'before_bottom_flip') {
    return !state.bottomRevealed;
  }
  // after_deal：发完牌即止（由状态机在发完时立即关闭，这里兜底）
  return state.deck.length === 0 && !state.bottomRevealed;
}

module.exports = {
  BID_PRIORITY,
  bidPriority,
  currentPriority,
  classifyBidCards,
  canBid,
  bidWindowOpen,
  // —— 三打一（san_da_yi）——
  canScoreBid,
  scoreBidOptions
};

/* ==================== 三打一：叫分竞价（R26） ==================== */

/**
 * 叫分可选项（用户规则：90 起，步长 10，到 200 封顶）。
 * 放弃者出局；未放弃者可循环加价（已被超过者轮回来仍可再加）。
 * 加价必须高于当前最高，步长为最小单位（可跳档，如 90→130）。
 * @param {object} state GameState（bids 中 score_bid 记录）
 * @param {number} playerIdx
 * @param {object} cfg
 * @returns {Array<number>} 可叫的分值（升序）；无可叫（已封顶）返回 []
 */
function scoreBidOptions(state, playerIdx, cfg) {
  const start = cfg.sanDaYiBidStart;
  const step = cfg.sanDaYiBidStep;
  const cap = cfg.sanDaYiBidCap;
  let cur = 0;
  (state.bids || []).forEach((b) => {
    if (b.type === 'score_bid' && b.score > cur) cur = b.score;
  });
  const opts = [];
  const from = cur === 0 ? start : cur + step;
  // 无人叫分：全部档位可选；有人叫过：全部更高档位可选（可跳档）
  for (let v = from; v <= cap; v += step) opts.push(v);
  return opts;
}

/**
 * 报分校验（未放弃者可循环加价）。
 * @param {object} state
 * @param {number} playerIdx
 * @param {number} score 报的分值
 * @param {object} cfg
 * @returns {{ok: boolean, reason?: string, errorCode?: string, meta?: {type: 'score_bid', score: number}}}
 */
function canScoreBid(state, playerIdx, score, cfg) {
  if (state.phase !== 'BIDDING') {
    return result(false, '报分窗口已关闭', 'E111');
  }
  // 已 pass 者失去本局叫分资格（放弃后不可再叫）
  if ((state.passedBidders || []).includes(playerIdx)) {
    return result(false, '已放弃叫分，本局不可再报', 'E114');
  }
  const opts = scoreBidOptions(state, playerIdx, cfg);
  if (!opts.includes(score)) {
    return result(false, `叫分不合法（当前可选：${opts.length ? opts.join('/') : '无（已封顶）'}）`, 'E113');
  }
  return result(true, null, null, { type: 'score_bid', score });
}
