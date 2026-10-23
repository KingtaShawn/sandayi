/**
 * services/game-service.js —— 对局门面：组装状态机 + AI + 日志（纯逻辑，禁 wx.*）。
 */

'use strict';

const { createInitialState, serializeState, deserializeState, cloneState } = require('../core/state');
const { transition } = require('../core/statemachine');
const { stepAI, aiBidOptions } = require('../core/dealer-ai-loop');
const { Logger } = require('../core/logger');
const { createAI } = require('../ai/strategy');
const { validatePlay, validateBury } = require('../engine/validate');
const { canBid } = require('../engine/bid');
const { RuleError } = require('../engine/errors');
const { createRng } = require('../utils/random');
const { DEFAULT_CONFIG } = require('../engine/config');

class GameService {
  /**
   * @param {object} [options] {config, difficulty, rng, players, dealerIdx, levels}
   */
  constructor(options) {
    const o = options || {};
    this.config = o.config || DEFAULT_CONFIG;
    this.difficulty = o.difficulty || 'normal';
    this.ai = createAI(this.difficulty);
    this.logger = new Logger();
    this.rng = o.rng || createRng(o.seed);
    this.state = null;
  }

  /**
   * 开始整轮（第一局）。
   * @returns {object} GameState
   */
  startGame() {
    this.state = createInitialState(this.config, null, this.rng, {
      dealerIdx: this.rng.int(4),
      levels: { team0: this.config.rankStart, team1: this.config.rankStart }
    });
    this.logger.clear();
    this.logger.log('START_GAME', { dealerIdx: this.state.dealerIdx });
    this.dispatch({ type: 'DEAL', rng: this.rng });
    return this.state;
  }

  /**
   * 派发 action（带日志）。
   * @param {object} action
   * @returns {object} 新 state
   */
  dispatch(action) {
    const next = transition(this.state, action);
    this.state = next;
    this.logger.log(action.type, {
      playerIdx: action.playerIdx,
      phase: next.phase,
      n: action.cards ? action.cards.length : undefined
    });
    return next;
  }

  /**
   * 真人亮主/反主。
   * @param {number} playerIdx
   * @param {Array<object>} cards
   * @returns {{ok: boolean, reason?: string, errorCode?: string}}
   */
  bid(playerIdx, cards_) {
    const r = canBid(this.state, playerIdx, cards_, this.state.config);
    if (!r.ok) return r;
    try {
      this.dispatch({ type: 'BID', playerIdx, cards: cards_, ts: Date.now() });
      // 亮主后若 AI 有更高优先级反主，由 tick 推进
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message, errorCode: e.code };
    }
  }

  /**
   * 三打一：真人报分。
   * @param {number} playerIdx
   * @param {number} score
   * @returns {{ok: boolean, reason?: string, errorCode?: string}}
   */
  scoreBid(playerIdx, score) {
    try {
      this.dispatch({ type: 'SCORE_BID', playerIdx, score, ts: Date.now() });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message, errorCode: e.code };
    }
  }

  /**
   * 三打一：庄家选主花色。
   * @param {string} suit 'S'|'H'|'C'|'D'
   * @returns {{ok: boolean, reason?: string, errorCode?: string}}
   */
  chooseTrump(suit) {
    try {
      this.dispatch({ type: 'CHOOSE_TRUMP', playerIdx: this.state.dealerIdx, suit, ts: Date.now() });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message, errorCode: e.code };
    }
  }

  /**
   * 真人庄家埋底。
   * @param {Array<object>} cards
   * @returns {{ok: boolean, reason?: string, errorCode?: string}}
   */
  bury(cards_) {
    const idx = this.state.dealerIdx;
    const r = validateBury(this.state, idx, cards_);
    if (!r.ok) return r;
    try {
      this.dispatch({ type: 'BURY', playerIdx: idx, cards: cards_, ts: Date.now() });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message, errorCode: e.code };
    }
  }

  /**
   * 真人出牌。
   * @param {number} playerIdx
   * @param {Array<object>} cards
   * @returns {{ok: boolean, reason?: string, errorCode?: string}}
   */
  play(playerIdx, cards_) {
    const v = validatePlay(this.state, playerIdx, cards_);
    // R14 罚则模式（smallest/penalty_smallest）：甩牌不成立（E102）不拦截——
    // 引擎 doPlay 将只出本次甩牌中被压住的最小单元（+罚分记账）；
    // 其余错误（跨域 E112/张数不符 E106/不在手牌 E105 等）仍直接拒绝
    if (!v.ok && v.errorCode !== 'E102') return v;
    if (!v.ok && v.errorCode === 'E102' && this.state.config.throwPenalty === 'reject') return v;
    try {
      this.dispatch({ type: 'PLAY', playerIdx, cards: cards_, ts: Date.now() });
      // 罚则触达提示：实际出牌与所选不一致（被替换为最小牌）
      const st = this.state;
      if (st.currentTrick && st.currentTrick.plays.length) {
        const last = st.currentTrick.plays[st.currentTrick.plays.length - 1];
        if (last.playerIdx === playerIdx) {
          const chosenIds = cards_.map((c) => c.id).sort().join(',');
          const playedIds = last.cards.map((c) => c.id).sort().join(',');
          if (chosenIds !== playedIds) {
            return {
              ok: true, replaced: true, playedCards: last.cards,
              penaltyPoints: v.meta.penaltyPoints || 0, reason: v.reason
            };
          }
        }
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message, errorCode: e.code };
    }
  }

  /**
   * AI 心跳：推进一个 AI 动作（BIDDING 亮主 / BURYING 埋底 / PLAYING 出牌）。
   * @returns {{acted: boolean, what: string|null}}
   */
  tick() {
    const r = stepAI(this.state, this.ai, this.rng);
    if (r.acted) {
      this.state = r.state;
      this.logger.log('AI_' + (r.what || ''), { phase: this.state.phase, turnIdx: this.state.turnIdx });
    }
    return { acted: r.acted, what: r.what };
  }

  /**
   * 连续 tick 直到轮到真人或阶段推进稳定（BIDDING 全 AI 决策完→BURYING AI 埋完）。
   * 用于界面一次刷新到位（跳过逐个 AI 节奏的调试模式）。
   * @param {number} [maxTicks=32]
   */
  tickUntilHuman(maxTicks) {
    const limit = maxTicks || 32;
    for (let i = 0; i < limit; i++) {
      const before = this.state;
      const r = this.tick();
      if (!r.acted) break;
      // 停止条件：轮到真人出牌 / SCORING / GAME_OVER
      if (this.state.phase === 'SCORING' || this.state.phase === 'GAME_OVER') break;
      if (this.state.phase === 'PLAYING' && this.state.players[this.state.turnIdx].isHuman) break;
      if (this.state.phase === 'BURYING' && this.state.players[this.state.dealerIdx].isHuman) break;
      if (this.state === before && !r.acted) break;
    }
  }

  /**
   * 下一局。
   */
  nextRound() {
    this.dispatch({ type: 'NEXT_ROUND', ts: Date.now() });
    if (this.state.phase === 'INIT_DEAL') {
      this.dispatch({ type: 'DEAL', rng: this.rng });
    }
  }

  /**
   * 当前状态（只读视图）。
   * @returns {object}
   */
  getState() {
    return this.state;
  }

  /**
   * 真人可用亮主选项（UI 渲染）。
   * @param {number} playerIdx
   */
  bidOptions(playerIdx) {
    return aiBidOptions(this.state, playerIdx);
  }

  /**
   * 序列化（断线续玩存档）。
   * @returns {object}
   */
  serialize() {
    return serializeState(this.state);
  }

  /**
   * 恢复。
   * @param {object|string} saved
   */
  resume(saved) {
    this.state = deserializeState(saved);
    this.logger.log('RESUME', { phase: this.state.phase, roundNo: this.state.roundNo });
  }
}

module.exports = { GameService };
