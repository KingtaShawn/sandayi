/**
 * core/statemachine.js —— 状态机主体：transition(state, action) → newState。
 *
 * phase 路由（架构 §5.2）：
 *   INIT_DEAL : DEAL → BIDDING
 *   BIDDING   : BID → 定主（首次亮主暂定庄；反主换定主者）
 *               FLIP_BOTTOM → R20 翻底定主 + 随机庄
 *   BURYING   : BURY → PLAYING（庄家领出）
 *   PLAYING   : PLAY → 4 家齐 resolveTrick → 下一墩 / 最后一墩 → SCORING(settleRound)
 *   SCORING   : NEXT_ROUND → INIT_DEAL（新庄/新级数）或 GAME_OVER
 *
 * 纯函数约定：返回新 state（结构共享浅拷贝）；非法 action 抛 RuleError 并返回原 state。
 * 每次成功变更写 logger（由服务层注入 onTransition 回调，保持本模块纯逻辑）。
 */

'use strict';

const { canBid, classifyBidCards, bidPriority, currentPriority, bidWindowOpen, canScoreBid } = require('../engine/bid');
const { validatePlay, validateBury } = require('../engine/validate');
const { parseCombo } = require('../engine/combo');
const { resolveTrick } = require('../engine/trick');
const { settleRound } = require('../engine/settle');
const { buildTrumpInfo } = require('../engine/trump');
const { RuleError } = require('../engine/errors');
const { prepareDeck, dealHands, cloneState } = require('./state');
const { createRng } = require('../utils/random');

const PHASES = ['INIT_DEAL', 'BIDDING', 'CHOOSE_TRUMP', 'BURYING', 'PLAYING', 'SCORING', 'GAME_OVER'];

/**
 * 出牌顺序下一个座位（R19）。
 * @param {object} state
 * @param {number} idx
 * @returns {number}
 */
function nextSeat(state, idx) {
  const order = state.playOrder;
  const pos = order.indexOf(idx);
  return order[(pos + 1) % order.length];
}

/**
 * 状态机转移（纯函数）。
 * @param {object} state
 * @param {object} action {type, playerIdx?, cards?, payload?, ts?}
 * @returns {object} 新 state（失败时原样返回）
 * @throws {RuleError} 非法 action（E2xx/E1xx）
 */
function transition(state, action) {
  if (!action || !action.type) {
    throw new RuleError('E201', 'action 缺少 type');
  }
  const s = cloneState(state);
  try {
    switch (action.type) {
      case 'DEAL':
        return doDeal(s, action);
      case 'BID':
        return doBid(s, action);
      case 'SCORE_BID':
        return doScoreBid(s, action);
      case 'CHOOSE_TRUMP':
        return doChooseTrump(s, action);
      case 'PASS_BID':
        return doPassBid(s, action);
      case 'FLIP_BOTTOM':
        return doFlipBottom(s, action);
      case 'BURY':
        return doBury(s, action);
      case 'PLAY':
        return doPlay(s, action);
      case 'NEXT_ROUND':
        return doNextRound(s, action);
      default:
        throw new RuleError('E201', `未知 action 类型：${action.type}`);
    }
  } catch (e) {
    if (e instanceof RuleError) throw e;
    throw new RuleError('E203', e.message);
  }
}

/**
 * 校验 action 可否派发（不执行）。
 * @param {object} state
 * @param {object} action
 * @returns {boolean}
 */
function canDispatch(state, action) {
  try {
    transition(state, action);
    return true;
  } catch (e) {
    return false;
  }
}

/* ============================ handlers ============================ */

/** INIT_DEAL → 发牌 → BIDDING */
function doDeal(s, action) {
  if (s.phase !== 'INIT_DEAL') {
    throw new RuleError('E202', `阶段 ${s.phase} 不允许 DEAL`);
  }
  const rng = action && action.rng ? action.rng : createRng(action && action.seed);
  prepareDeck(s, rng);
  dealHands(s);
  s.phase = 'BIDDING';
  if (s.config.gameMode === 'san_da_yi') {
    // 三打一：上局赢家先报（sanDaYiFirstBidder 由上局结算写入；首局/重发从庄家位开始）
    const first = s.sanDaYiFirstBidder !== undefined ? s.sanDaYiFirstBidder : s.dealerIdx;
    s.sanDaYiFirstBidder = first;
    s.turnIdx = first;
    s.scoreBidHighest = null;
    s.contractScore = null;
    s.sanDaYiTeams = null;
  } else {
    s.turnIdx = nextSeat(s, s.dealerIdx); // 亮主窗口从庄家下家开始轮询（任意持牌者可亮）
  }
  return s;
}

/** BIDDING：亮主/反主 */
function doBid(s, action) {
  if (s.phase !== 'BIDDING') {
    throw new RuleError('E202', `阶段 ${s.phase} 不允许 BID`);
  }
  const cfg = s.config;
  const idx = action.playerIdx;
  if (idx === undefined || idx === null || idx < 0 || idx > 3) {
    throw new RuleError('E201', 'BID 缺少 playerIdx');
  }
  if (!bidWindowOpen(s, cfg)) {
    throw new RuleError('E111', '亮主窗口已关闭');
  }
  const r = canBid(s, idx, action.cards, cfg);
  if (!r.ok) {
    throw new RuleError(r.errorCode || 'E109', r.reason);
  }
  const cls = r.meta;
  // 每次有效亮主/反主 → 最终定主者坐庄（PRD §5.5，含反主后 dealer 更新）
  s.dealerIdx = idx;
  s.attackTeam = s.players[idx].team === 0 ? 1 : 0;
  s.bids.push({
    playerIdx: idx,
    type: cls.type,
    cards: action.cards.slice(),
    trumpSuit: cls.trumpSuit,
    isNoTrump: cls.isNoTrump,
    ts: action.ts || Date.now()
  });
  s.bidWinnerIdx = idx;
  // 定主（暂定）：更高优先级 BID 仍可反（phase 保持 BIDDING）
  const finalBid = s.bids[s.bids.length - 1];
  s.trumpInfo = buildTrumpInfo(finalBid.trumpSuit, s.levels[`team${s.players[s.dealerIdx].team}`], cfg);
  s.turnIdx = idx;
  // 新更高亮主出现 → 其他人重新获得表态机会（清空 pass）
  s.passedBidders = [];
  return s;
}

/** BIDDING（三打一）：报分加价（SCORE_BID）—— QQ 规则：放弃者出局，其余人可反复加价 */
function doScoreBid(s, action) {
  if (s.phase !== 'BIDDING') {
    throw new RuleError('E202', `阶段 ${s.phase} 不允许 SCORE_BID`);
  }
  if (s.config.gameMode !== 'san_da_yi') {
    throw new RuleError('E202', 'SCORE_BID 仅三打一模式可用');
  }
  const idx = action.playerIdx;
  if (idx === undefined || idx === null || idx < 0 || idx > 3) {
    throw new RuleError('E201', 'SCORE_BID 缺少 playerIdx');
  }
  // 轮转顺位校验：当前应轮到 turnIdx（跳过已 pass 者）
  if (idx !== s.turnIdx) {
    throw new RuleError('E104', `轮到第 ${s.turnIdx + 1} 位报分`);
  }
  const r = canScoreBid(s, idx, action.score, s.config);
  if (!r.ok) {
    throw new RuleError(r.errorCode || 'E113', r.reason);
  }
  s.bids.push({
    playerIdx: idx,
    type: 'score_bid',
    score: action.score,
    cards: [],
    ts: action.ts || Date.now()
  });
  s.scoreBidHighest = { playerIdx: idx, score: action.score };
  // 报满上限 → 直接成交
  if (action.score >= s.config.sanDaYiBidCap) {
    return enterSanDaYiPlay(s);
  }
  // 循环加价：放弃者出局；未放弃者（含已被超过者）轮回来仍可再加。
  // 有资格者 = 未 pass 且不是当前最高报价者
  const eligible = [0, 1, 2, 3].filter((i) =>
    i !== idx && !(s.passedBidders || []).includes(i));
  if (eligible.length === 0) {
    return enterSanDaYiPlay(s); // 其他人全出局 → 成交
  }
  // 轮转到下一位有资格者
  let next = nextSeat(s, idx);
  let guard = 0;
  while (!eligible.includes(next) && guard++ < 4) {
    next = nextSeat(s, next);
  }
  s.turnIdx = next;
  return s;
}

/** 三打一：下一位未放弃叫分者 */
function nextActiveBidder(s, fromIdx) {
  let next = nextSeat(s, fromIdx);
  let guard = 0;
  while ((s.passedBidders || []).includes(next) && guard++ < 4) {
    next = nextSeat(s, next);
  }
  return next;
}

/** BIDDING：放弃亮主（升级模式全员表态后进埋底；三打一 pass 逻辑独立走 sanDaYiPass） */
function doPassBid(s, action) {
  if (s.phase !== 'BIDDING') {
    throw new RuleError('E202', `阶段 ${s.phase} 不允许 PASS_BID`);
  }
  const idx = action.playerIdx;
  if (idx === undefined || idx === null || idx < 0 || idx > 3) {
    throw new RuleError('E201', 'PASS_BID 缺少 playerIdx');
  }
  if (s.config.gameMode === 'san_da_yi') {
    return doPassScoreBid(s, idx);
  }
  if (!s.passedBidders.includes(idx)) {
    s.passedBidders.push(idx);
  }
  // 全员已表态（亮过或放弃）：有亮主 → 埋底；无人亮 → 保持 BIDDING 待 FLIP_BOTTOM（R20）
  const allDecided = s.players.every((p, i) => s.bids.some((b) => b.playerIdx === i) || s.passedBidders.includes(i));
  if (allDecided && s.bids.length > 0) {
    return enterBurying(s);
  }
  return s;
}

/** 三打一：pass（放弃叫分，本局出局）——全员放弃则重发（或 force_lowest 强制打最低分） */
function doPassScoreBid(s, idx) {
  if (!s.passedBidders.includes(idx)) {
    s.passedBidders.push(idx);
  }
  const hasBid = (s.bids || []).some((b) => b.type === 'score_bid');
  if (!hasBid && s.passedBidders.length >= 4) {
    // 全员放弃：redeal = 重发（首报者轮到原首报者的下家）；force_lowest = 首位强制打最低分
    if (s.config.sanDaYiNoBidAction === 'redeal') {
      s.phase = 'INIT_DEAL';
      const first = s.sanDaYiFirstBidder !== undefined ? s.sanDaYiFirstBidder : 0;
      s.sanDaYiFirstBidder = nextSeat(s, first);
      s.turnIdx = s.sanDaYiFirstBidder;
      s.bids = [];
      s.passedBidders = [];
      s.scoreBidHighest = null;
      s.redEalCount = (s.redEalCount || 0) + 1;
      return s;
    }
    const forced = s.sanDaYiFirstBidder !== undefined ? s.sanDaYiFirstBidder : 0;
    s.bids.push({ playerIdx: forced, type: 'score_bid', score: s.config.sanDaYiBidStart, cards: [], ts: Date.now() });
    s.scoreBidHighest = { playerIdx: forced, score: s.config.sanDaYiBidStart };
    return enterSanDaYiPlay(s);
  }
  if (hasBid) {
    // 成交判定：除最高报价者外，其余人全部 pass（循环加价下"叫过"≠出局）
    const highest = s.scoreBidHighest;
    const allOut = [0, 1, 2, 3].every((i) =>
      i === highest.playerIdx || s.passedBidders.includes(i));
    if (allOut) {
      return enterSanDaYiPlay(s);
    }
    // 轮到下一位有资格者（未 pass 且非当前最高者）
    let next = nextSeat(s, idx);
    let guard = 0;
    while (guard++ < 4 && (next === highest.playerIdx || s.passedBidders.includes(next))) {
      next = nextSeat(s, next);
    }
    s.turnIdx = next;
    return s;
  }
  // 无人叫分：轮到下一位未 pass 者
  s.turnIdx = nextActiveBidder(s, idx);
  return s;
}

/** 三打一：竞价成交 → CHOOSE_TRUMP（庄家选主花色，不受手牌限制） */
function enterSanDaYiPlay(s) {
  const cfg = s.config;
  const highest = s.scoreBidHighest;
  if (!highest) {
    throw new RuleError('E203', '三打一成交失败：无最高报价');
  }
  // 庄家 = 最高报价者；合同分 = 报分
  s.dealerIdx = highest.playerIdx;
  s.bidWinnerIdx = highest.playerIdx;
  s.contractScore = highest.score;
  // 底牌查看权：成交分 ≤ peek 阈值（QQ：60/65）闲家可看
  const peekMax = cfg.sanDaYiPeekBottomMaxBid;
  s.bottomPeekable = typeof peekMax === 'number' && peekMax >= 0 && highest.score <= peekMax;
  // 阵营动态化：庄家单独一队 vs 三家
  s.sanDaYiTeams = {
    dealer: s.dealerIdx,
    attackers: [0, 1, 2, 3].filter((i) => i !== s.dealerIdx)
  };
  s.attackTeam = -1;
  // 三打一：成交后庄家立即拿到底牌（并入手牌 25+8=33），先看底再报主
  // （顺序约定：必须先拿底、看过底牌，才允许 CHOOSE_TRUMP 报主花色）
  if (!s.bottomMerged) {
    s.players[s.dealerIdx].hand = s.players[s.dealerIdx].hand.concat(s.bottomCards);
    s.bottomMerged = true;
  }
  // 进入选主阶段（庄家此时已持底牌，自由选花色，不需持有该花色的 2）
  s.phase = 'CHOOSE_TRUMP';
  s.turnIdx = s.dealerIdx;
  return s;
}

/** 三打一：庄家选主花色（S/H/C/D 任选，主牌=王+全部2+所选花色） */
function doChooseTrump(s, action) {
  if (s.phase !== 'CHOOSE_TRUMP') {
    throw new RuleError('E202', `阶段 ${s.phase} 不允许 CHOOSE_TRUMP`);
  }
  if (s.config.gameMode !== 'san_da_yi') {
    throw new RuleError('E202', 'CHOOSE_TRUMP 仅三打一模式可用');
  }
  const idx = action.playerIdx === undefined ? s.dealerIdx : action.playerIdx;
  if (idx !== s.dealerIdx) {
    throw new RuleError('E104', '只有庄家可以决定主牌花色');
  }
  const suit = action.suit;
  if (!['S', 'H', 'C', 'D'].includes(suit)) {
    throw new RuleError('E201', `非法主花色：${suit}`);
  }
  // 主牌 = 大小王 + 全部 2 + 所选花色（buildTrumpInfo 用有主局构造：级牌=2）
  s.trumpInfo = buildTrumpInfo(suit, '2', s.config);
  return enterBurying(s);
}

/** BIDDING：无人亮主 → 翻底定主（R20 flip_bottom）*/
function doFlipBottom(s, action) {
  if (s.phase !== 'BIDDING') {
    throw new RuleError('E202', `阶段 ${s.phase} 不允许 FLIP_BOTTOM`);
  }
  if (s.bids.length > 0) {
    throw new RuleError('E202', '已有亮主，无需翻底定主');
  }
  const cfg = s.config;
  if (cfg.noBidFallback !== 'flip_bottom') {
    throw new RuleError('E202', `R20=${cfg.noBidFallback} 不支持翻底定主`);
  }
  const rng = action && action.rng ? action.rng : createRng(action && action.seed);
  // 翻底牌第一张非王牌的花色为主花色（若为王继续翻）
  let i = 0;
  while (i < s.bottomCards.length && s.bottomCards[i].isJoker) i++;
  if (i >= s.bottomCards.length) {
    // 全为王（理论不可能，8 张底含 4 王最多）——退化：随机主花色
    const flipSuit = ['S', 'H', 'C', 'D'][rng.int(4)];
    s.trumpInfo = buildTrumpInfo(flipSuit, s.levels[`team${s.players[s.dealerIdx].team}`], cfg);
  } else {
    s.trumpInfo = buildTrumpInfo(s.bottomCards[i].suit, s.levels[`team${s.players[s.dealerIdx].team}`], cfg);
  }
  s.bottomRevealed = true;
  s.bidWinnerIdx = null;
  s.dealerIdx = rng.int(4); // 随机庄家（R20/Q11）
  s.attackTeam = s.players[s.dealerIdx].team === 0 ? 1 : 0;
  return enterBurying(s);
}

/**
 * 进入埋底阶段（定主后统一入口）：切换到 BURYING 阶段，庄家从 33 张手牌中埋回 8 张。
 * 注：三打一已在成交时（enterSanDaYiPlay）把底牌并入手牌（bottomMerged=true），
 * 此处兜底并底仅用于升级模式「无人亮主翻底定主」路径。
 * @param {object} s 当前 state（就地修改）
 * @returns {object} s
 */
function enterBurying(s) {
  if (s.phase !== 'BIDDING' && s.phase !== 'CHOOSE_TRUMP') {
    throw new RuleError('E202', `阶段 ${s.phase} 不能进入埋底`);
  }
  if (!s.trumpInfo) {
    throw new RuleError('E203', '定主后才能埋底');
  }
  if (!s.bottomMerged) {
    s.players[s.dealerIdx].hand = s.players[s.dealerIdx].hand.concat(s.bottomCards);
    s.bottomMerged = true;
  }
  s.phase = 'BURYING';
  s.turnIdx = s.dealerIdx;
  return s;
}

/** BURYING：庄家埋底 → PLAYING */
function doBury(s, action) {
  if (s.phase !== 'BURYING') {
    throw new RuleError('E202', `阶段 ${s.phase} 不允许 BURY`);
  }
  // 防御：确保已并底（跳过 enterBurying 的调用路径兜底）
  if (!s.bottomMerged) {
    s.players[s.dealerIdx].hand = s.players[s.dealerIdx].hand.concat(s.bottomCards);
    s.bottomMerged = true;
  }
  const idx = action.playerIdx === undefined ? s.dealerIdx : action.playerIdx;
  const r = validateBury(s, idx, action.cards);
  if (!r.ok) {
    throw new RuleError(r.errorCode || 'E107', r.reason);
  }
  const hand = s.players[idx].hand;
  const buryIds = new Set(action.cards.map((c) => c.id));
  s.players[idx].hand = hand.filter((c) => !buryIds.has(c.id));
  s.bottomCards = action.cards.slice();
  s.buryDone = true;
  s.phase = 'PLAYING';
  s.turnIdx = s.dealerIdx; // 庄家领出第一墩
  s.currentTrick = null;
  return s;
}

/** 三打一罚分记账：出牌者被罚 → 分加给对方阵营 */
function addPenaltyPoints(s, payerIdx, points) {
  s.penaltyPoints = Object.assign({ dealer: 0, attackers: 0 }, s.penaltyPoints);
  const teams = s.sanDaYiTeams;
  if (teams) {
    // 三打一：payer 是庄家 → 罚分给攻方；否则给庄家
    if (payerIdx === teams.dealer) s.penaltyPoints.attackers += points;
    else s.penaltyPoints.dealer += points;
  } else {
    // 升级模式（若启用 penalty_smallest）：记入攻守语义（attacker=非庄方）
    const dealerTeam = s.players[s.dealerIdx].team;
    if (s.players[payerIdx].team === dealerTeam) s.penaltyPoints.attackers += points;
    else s.penaltyPoints.dealer += points;
  }
}

/** BIDDING → BURYING 的推进由 Bid 后自动判定（无显式 action，见 advanceAfterBid） */
function advanceToBuryIfReady(s) {
  if (s.phase === 'BIDDING' && s.trumpInfo && s.bids.length > 0) {
    // 简化模型：亮主即定主（AI/真人可反主窗口由 Presenter 控制节奏；
    // 一旦有更高优先级 bid 到来即换主）。定主后直接进入埋底。
    s.phase = 'BURYING';
    s.turnIdx = s.dealerIdx;
    return true;
  }
  return false;
}

/** PLAYING：出牌 */
function doPlay(s, action) {
  if (s.phase !== 'PLAYING') {
    throw new RuleError('E202', `阶段 ${s.phase} 不允许 PLAY`);
  }
  const idx = action.playerIdx;
  if (idx !== s.turnIdx) {
    throw new RuleError('E104', `轮到第 ${s.turnIdx + 1} 位玩家出牌`);
  }
  const cfg = s.config;
  let cards_ = action.cards;
  // 先校验原选牌，只有成立性失败才允许替换；不在手中/跨域等错误不能被罚则掩盖。
  let v = validatePlay(s, idx, cards_);
  let penaltyPoints = 0;
  if (!v.ok && v.errorCode === 'E102' && cfg.throwPenalty !== 'reject' && v.meta && v.meta.replacement) {
    cards_ = v.meta.replacement;
    penaltyPoints = v.meta.penaltyPoints || 0;
    // 替换牌是原甩牌中的一个完整单元，正常校验即可，不再绕过甩牌检查。
    v = validatePlay(s, idx, cards_);
  }
  if (!v.ok) {
    throw new RuleError(v.errorCode || 'E101', v.reason);
  }
  if (penaltyPoints > 0) addPenaltyPoints(s, idx, penaltyPoints);
  // 从手牌移除
  const ids = new Set(cards_.map((c) => c.id));
  s.players[idx].hand = s.players[idx].hand.filter((c) => !ids.has(c.id));

  const isLead = !s.currentTrick || s.currentTrick.plays.length === 0;
  if (isLead) {
    const combo = v.meta && v.meta.combo ? v.meta.combo : parseCombo(cards_, s.trumpInfo, cfg);
    s.currentTrick = {
      leadPlayerIdx: idx,
      leadCombo: combo,
      plays: [{
        playerIdx: idx,
        cards: cards_.slice(),
        combo,
        isDiscard: false,
        isEffectiveTrump: false
      }],
      winnerIdx: null,
      points: 0
    };
  } else {
    const lead = s.currentTrick.leadCombo;
    const combo = parseCombo(cards_, s.trumpInfo, cfg);
    const isTrumpPlay = cards_.every((c) => require('../engine/combo').domainOf(c, s.trumpInfo) === 'TRUMP');
    const { isEffectiveTrumpFollow } = require('../engine/follow');
    const effective = isTrumpPlay && !lead.isTrump
      ? isEffectiveTrumpFollow(lead, cards_, s.trumpInfo, cfg) : false;
    s.currentTrick.plays.push({
      playerIdx: idx,
      cards: cards_.slice(),
      combo,
      isDiscard: !effective && combo && combo.suit !== lead.suit,
      isEffectiveTrump: effective
    });
  }

  if (s.currentTrick.plays.length === 4) {
    // 墩结算
    const result = resolveTrick(s.currentTrick, s.trumpInfo, cfg);
    const winnerTeam = s.players[result.winnerIdx].team;
    s.scores[`team${winnerTeam}`] += result.points;
    s.completedTricks.push(s.currentTrick);
    const wasLastTrick = s.players.every((p) => p.hand.length === 0);
    s.currentTrick = null;
    if (wasLastTrick) {
      // 一局结束 → 结算
      s.lastSettle = settleRound(s);
      s.phase = 'SCORING';
      s.turnIdx = -1;
    } else {
      s.turnIdx = result.winnerIdx; // 赢家领出下一墩
    }
  } else {
    s.turnIdx = nextSeat(s, idx);
  }
  return s;
}

/** SCORING → 下一局 / GAME_OVER */
function doNextRound(s, action) {
  if (s.phase !== 'SCORING') {
    throw new RuleError('E202', `阶段 ${s.phase} 不允许 NEXT_ROUND`);
  }
  void action;
  const settle = s.lastSettle;
  if (!settle) {
    throw new RuleError('E203', '缺少结算结果');
  }
  if (settle.gameOver) {
    s.phase = 'GAME_OVER';
    s.gameOver = true;
    s.roundHistory.push({
      roundNo: s.roundNo,
      levels: Object.assign({}, s.levels),
      settle: { attackPoints: settle.attackPoints, winnerTeam: settle.winnerTeam, passedA: settle.passedA }
    });
    return s;
  }
  // 推进级数、庄家、roundNo
  s.levels = settle.nextLevels;
  s.lastDealerIdx = s.dealerIdx;
  s.dealerIdx = settle.nextDealerIdx;
  if (s.config.gameMode === 'san_da_yi') {
    // 三打一：下局首报者 = 上局赢家（settle.nextFirstBidder）；级数不动（恒打2）；阵营重置
    s.sanDaYiFirstBidder = settle.nextFirstBidder !== undefined ? settle.nextFirstBidder : settle.nextDealerIdx;
    s.attackTeam = -1;
    s.sanDaYiTeams = null;
    s.contractScore = null;
    s.scoreBidHighest = null;
    s.penaltyPoints = null;
  } else {
    s.attackTeam = s.players[s.dealerIdx].team === 0 ? 1 : 0;
  }
  s.roundNo += 1;
  s.roundHistory.push({
    roundNo: s.roundNo - 1,
    levels: Object.assign({}, s.levels),
    settle: { attackPoints: settle.attackPoints, winnerTeam: settle.winnerTeam, passedA: settle.passedA }
  });
  // 重置一局字段
  s.phase = 'INIT_DEAL';
  s.bids = [];
  s.trumpInfo = null;
  s.bidWinnerIdx = null;
  s.passedBidders = [];
  s.bottomRevealed = false;
  s.bottomMerged = false;
  s.buryDone = false;
  s.currentTrick = null;
  s.completedTricks = [];
  s.scores = { team0: 0, team1: 0 };
  s.lastSettle = null;
  s.players.forEach((p) => { p.hand = []; });
  s.deck = [];
  s.bottomCards = [];
  return s;
}

module.exports = { transition, canDispatch, nextSeat, PHASES, advanceToBuryIfReady, enterBurying };
