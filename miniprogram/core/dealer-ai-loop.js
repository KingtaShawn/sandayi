/**
 * core/dealer-ai-loop.js —— 对局循环驱动器（纯逻辑）。
 *
 * 职责（架构 §2.2）：驱动非真人行动——
 *   BIDDING：为每个 AI 询问亮/反主决策；无人亮主时执行 R20 翻底定主；
 *   BURYING：庄家 AI 埋底；
 *   PLAYING：AI 轮流出牌。
 *
 * 由 GameService.tick() 调用 stepAI(state)；每 tick 至多推进一个 AI 动作，
 * 节奏（R23 setTimeout）由 Presenter 控制。
 */

'use strict';

const { transition, enterBurying } = require('./statemachine');
const { Logger } = require('./logger');
const { createRng } = require('../utils/random');
const { RuleError } = require('../engine/errors');

/**
 * 单步 AI 推进。
 * @param {object} state 当前状态（会被 transition 产出新状态）
 * @param {object} ai AIStrategy 实例
 * @param {object} [rng]
 * @returns {{state: object, acted: boolean, what: string|null}}
 *   acted=false 表示当前无 AI 行动需求（等待真人）
 */
function stepAI(state, ai, rng) {
  const rand = rng || createRng();
  // 三打一：庄家 AI 选主花色
  if (state.phase === 'CHOOSE_TRUMP') {
    const dealer = state.players[state.dealerIdx];
    if (dealer.isHuman) return { state, acted: false, what: null };
    const suit = ai.decideTrumpSuit ? ai.decideTrumpSuit(state, state.dealerIdx) : 'S';
    const next = transition(state, { type: 'CHOOSE_TRUMP', playerIdx: state.dealerIdx, suit, ts: Date.now() });
    return { state: next, acted: true, what: `CHOOSE_TRUMP:${suit}` };
  }
  // BIDDING：三打一 → 报分竞价
  if (state.phase === 'BIDDING' && state.config.gameMode === 'san_da_yi') {
    return stepSanDaYiBid(state, ai, rand);
  }
  // BIDDING：轮询 AI 亮主（升级模式）
  if (state.phase === 'BIDDING') {
    for (let i = 0; i < 4; i++) {
      const p = state.players[i];
      if (p.isHuman) continue;
      const decided = state.bids.some((b) => b.playerIdx === i) || (state.passedBidders || []).includes(i);
      if (decided) continue;
      const opts = aiBidOptions(state, i);
      const decision = opts.length ? ai.decideBid(state, i, opts, rand) : null;
      if (decision) {
        const next = transition(state, { type: 'BID', playerIdx: i, cards: decision.cards, ts: Date.now() });
        return { state: next, acted: true, what: `BID:${i}` };
      }
      // 不亮 → 放弃表态（全员放弃且无人亮 → 真人是否表态由 Presenter 判断；
      // stepAI 语义：AI 全放弃且无人亮主时交还 acted=false 等真人，或翻底）
      const next = transition(state, { type: 'PASS_BID', playerIdx: i, ts: Date.now() });
      // 放弃后若全员已表态且有亮主 → PASS_BID 内部自动进入 BURYING
      return { state: next, acted: true, what: `PASS_BID:${i}` };
    }
    // 全部 AI 已表态：若真人也未亮且无人亮主 → 翻底定主（R20）
    const humanDecided = state.bids.some((b) => b.playerIdx === 0) || (state.passedBidders || []).includes(0);
    if (state.bids.length === 0 && !humanDecided) {
      // 真人尚未表态：仅当真人也放弃后翻底——由 Presenter 在真人 pass 后触发；
      // 压测循环（runRoundToScoring）直接翻底
      return { state, acted: false, what: null };
    }
    if (state.bids.length === 0) {
      const next = transition(state, { type: 'FLIP_BOTTOM', rng: rand, ts: Date.now() });
      return { state: next, acted: true, what: 'FLIP_BOTTOM' };
    }
    return { state: finishBidding(state), acted: true, what: 'TO_BURY' };
  }
  // BURYING：AI 庄家埋底
  if (state.phase === 'BURYING') {
    const dealer = state.players[state.dealerIdx];
    if (dealer.isHuman) {
      return { state, acted: false, what: null };
    }
    const cards = ai.decideBury(state, state.dealerIdx, rand);
    const next = transition(state, { type: 'BURY', playerIdx: state.dealerIdx, cards, ts: Date.now() });
    return { state: next, acted: true, what: `BURY:${state.dealerIdx}` };
  }
  // PLAYING：AI 出牌
  if (state.phase === 'PLAYING') {
    const cur = state.players[state.turnIdx];
    if (cur.isHuman) {
      return { state, acted: false, what: null };
    }
    const cards = ai.decidePlay(state, state.turnIdx, rand);
    const next = transition(state, { type: 'PLAY', playerIdx: state.turnIdx, cards, ts: Date.now() });
    return { state: next, acted: true, what: `PLAY:${state.turnIdx}` };
  }
  return { state, acted: false, what: null };
}

/**
 * 三打一 BIDDING 推进：当前 turnIdx 为 AI 时报分或 pass。
 * 顺位轮转由状态机维护；真人回合返回 acted=false 等待。
 */
function stepSanDaYiBid(state, ai, rand) {
  const cur = state.turnIdx;
  const p = state.players[cur];
  if (p.isHuman) return { state, acted: false, what: null };
  const { scoreBidOptions } = require('../engine/bid');
  const opts = scoreBidOptions(state, cur, state.config);
  const decision = ai.decideScoreBid ? ai.decideScoreBid(state, cur, opts, rand) : null;
  if (decision) {
    const next = transition(state, { type: 'SCORE_BID', playerIdx: cur, score: decision, ts: Date.now() });
    return { state: next, acted: true, what: `SCORE_BID:${cur}:${decision}` };
  }
  const next = transition(state, { type: 'PASS_BID', playerIdx: cur, ts: Date.now() });
  return { state: next, acted: true, what: `PASS_BID:${cur}` };
}

/**
 * 亮主后进入 BURYING（状态机 BID/FLIP_BOTTOM 已内置 enterBurying；此处兜底旧状态）。
 * @param {object} state
 */
function finishBidding(state) {
  if (state.phase === 'BIDDING' && state.trumpInfo) {
    try {
      return enterBurying(Object.assign({}, state));
    } catch (e) {
      return state;
    }
  }
  return state;
}

/**
 * AI 的亮主可选项。
 * @param {object} state
 * @param {number} playerIdx
 * @returns {Array<object>} BidOption[] {type, cards, trumpSuit, isNoTrump, priority}
 */
function aiBidOptions(state, playerIdx) {
  const { classifyBidCards, bidPriority } = require('../engine/bid');
  const hand = state.players[playerIdx].hand;
  const level = state.levels[`team${state.players[playerIdx].team}`];
  const cfg = state.config;
  const opts = [];
  // 单级牌 / 对级牌 / 对王候选
  const byKey = new Map();
  hand.forEach((c) => {
    const k = `${c.suit}-${c.rank}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  });
  byKey.forEach((list) => {
    if (list.length >= 2) {
      const cls = classifyBidCards([list[0], list[1]], level, cfg);
      if (cls) opts.push({ type: cls.type, cards: [list[0], list[1]], trumpSuit: cls.trumpSuit, isNoTrump: cls.isNoTrump });
    }
  });
  hand.forEach((c) => {
    const cls = classifyBidCards([c], level, cfg);
    if (cls) opts.push({ type: cls.type, cards: [c], trumpSuit: cls.trumpSuit, isNoTrump: cls.isNoTrump });
  });
  // 过滤被现有更高优先级压制的
  const cur = state.bids.reduce((m, b) => Math.max(m, bidPriority(b.type)), 0);
  return opts.filter((o) => bidPriority(o.type) > cur);
}

/**
 * 完整跑完一局到 SCORING（压测/测试用，跳过节奏等待；真人位由 AI 代打）。
 * @param {object} state0 初始状态（INIT_DEAL）
 * @param {object} ai AIStrategy
 * @param {object} [rng]
 * @param {object} [logger]
 * @returns {{state: object, steps: number, illegalCount: number}}
 */
function runRoundToScoring(state0, ai, rng, logger) {
  const rand = rng || createRng();
  const log = logger || new Logger();
  let state = state0;
  let steps = 0;
  let illegalCount = 0;
  const MAX_STEPS = 5000;
  // 发牌
  state = transition(state, { type: 'DEAL', rng: rand });
  log.log('DEAL', { roundNo: state.roundNo });
  steps++;
  while (state.phase !== 'SCORING' && state.phase !== 'GAME_OVER' && steps < MAX_STEPS) {
    try {
      if (state.phase === 'BIDDING' && state.config.gameMode === 'san_da_yi') {
        // 三打一报分（真人代理：AI 决策）
        const cur = state.turnIdx;
        const { scoreBidOptions } = require('../engine/bid');
        const opts = scoreBidOptions(state, cur, state.config);
        const decision = ai.decideScoreBid ? ai.decideScoreBid(state, cur, opts, rand) : null;
        if (decision) {
          state = transition(state, { type: 'SCORE_BID', playerIdx: cur, score: decision, ts: Date.now() });
        } else {
          state = transition(state, { type: 'PASS_BID', playerIdx: cur, ts: Date.now() });
        }
        steps++;
        continue;
      }
      if (state.phase === 'CHOOSE_TRUMP') {
        // AI 庄家选主（压测循环，真人代理）
        const suit = ai.decideTrumpSuit ? ai.decideTrumpSuit(state, state.dealerIdx) : 'S';
        state = transition(state, { type: 'CHOOSE_TRUMP', playerIdx: state.dealerIdx, suit, ts: Date.now() });
        steps++;
        continue;
      }
      if (state.phase === 'INIT_DEAL') {
        // 三打一重发（全员不报 redeal 回到 INIT_DEAL）
        state = transition(state, { type: 'DEAL', rng: rand });
        log.log('DEAL', { roundNo: state.roundNo, redeal: true });
        steps++;
        continue;
      }
      if (state.phase === 'BIDDING') {
        // 逐玩家表态（AI 决策 + 真人代理：有高优先级亮则亮，否则 PASS）
        const decided = (i) => state.bids.some((b) => b.playerIdx === i) || (state.passedBidders || []).includes(i);
        let advanced = false;
        for (let i = 0; i < 4 && !advanced; i++) {
          if (decided(i)) continue;
          const opts = aiBidOptions(state, i);
          const decision = opts.length ? ai.decideBid(state, i, opts, rand) : null;
          if (decision) {
            state = transition(state, { type: 'BID', playerIdx: i, cards: decision.cards, ts: Date.now() });
          } else {
            state = transition(state, { type: 'PASS_BID', playerIdx: i, ts: Date.now() });
          }
          steps++;
          advanced = true;
        }
        if (advanced) continue;
        // 全员已表态：无人亮 → 翻底；有亮 → PASS_BID 已自动进 BURYING
        if (state.bids.length === 0) {
          state = transition(state, { type: 'FLIP_BOTTOM', rng: rand, ts: Date.now() });
          steps++;
        } else {
          state = finishBidding(state);
        }
        steps++;
        continue;
      }
      if (state.phase === 'BURYING') {
        // 庄家手牌已在 enterBurying 并底（33 张）
        const buryCards = ai.decideBury(state, state.dealerIdx, rand);
        state = transition(state, { type: 'BURY', playerIdx: state.dealerIdx, cards: buryCards, ts: Date.now() });
        steps++;
        continue;
      }
      if (state.phase === 'PLAYING') {
        // 真人位由 AI 代打（压测语义：全部走 legalMoves→validatePlay 铁律）
        const cards = ai.decidePlay(state, state.turnIdx, rand);
        state = transition(state, { type: 'PLAY', playerIdx: state.turnIdx, cards, ts: Date.now() });
        steps++;
        continue;
      }
      break;
    } catch (e) {
      illegalCount++;
      log.log('ILLEGAL', { step: steps, phase: state.phase, turn: state.turnIdx, err: e.message });
      throw e;
    }
  }
  return { state, steps, illegalCount };
}

module.exports = { stepAI, aiBidOptions, finishBidding, runRoundToScoring };
