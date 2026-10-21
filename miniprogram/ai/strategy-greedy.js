/**
 * ai/strategy-greedy.js —— 贪心启发式 AI（P0，PRD §8.1）。
 *
 * 铁律（架构 §8.9）：
 *   1. 出牌候选 = engine.validate.legalMoves(state, idx)（已含 validatePlay 过滤）；
 *   2. 选定后再 validatePlay 二次校验，失败则回退到候选[0]（防御）；
 *   3. 绝不手改 GameState。
 *
 * 策略要点：
 *   - 亮主：对级牌/对王必抢；单级牌首局倾向早亮；
 *   - 埋底：主强（≥1/3 手牌为主或有大拖）→ 分牌埋底藏分；主弱 → 埋短门废牌；
 *   - 出牌（贪心打分）：
 *     · 领出：庄家/主多 → 大拖/大对清主；有绝对大主 → 出主收墩；
 *       攻方末墩意识（剩 1 墩且能赢 → 最大牌抠底）；
 *     · 跟牌：末家必赢 → 甩分牌收分；能小赢 → 最小能赢牌；赢不了 → 垫最小/喂分给稳赢队友；
 *     · 缺门：墩内分 ≥ threshold → 主牌将吃（结构对应优先），否则垫分/垫小。
 */

'use strict';

const { legalMoves, validatePlay } = require('../engine/validate');
const { parseCombo, domainOf, pointsOf } = require('../engine/combo');
const { pointValue, sortHand } = require('../engine/card');
const { buildMemory } = require('./memory');

/** 将吃意愿门槛（墩内已有分） */
const TRUMP_IN_THRESHOLD = 10;

class GreedyStrategy {
  /**
   * @param {string} [difficulty='normal'] easy 时打分加随机扰动
   */
  constructor(difficulty) {
    this.difficulty = difficulty || 'normal';
  }

  /* ------------------------- 亮主/反主 ------------------------- */

  /**
   * 亮主决策（升级模式）。
   * @param {object} state
   * @param {number} playerIdx
   * @param {Array<object>} options aiBidOptions 产物
   * @param {object} rng
   * @returns {object|null} BidOption
   */
  decideBid(state, playerIdx, options, rng) {
    if (!options || options.length === 0) return null;
    // 优先级排序：对王 > 对级牌 > 单级牌
    const byPri = { joker_pair: 3, pair_rank: 2, single_rank: 1, single_joker: 1 };
    options.sort((a, b) => (byPri[b.type] || 0) - (byPri[a.type] || 0));
    const best = options[0];
    // 对王/对级牌必抢
    if (best.type === 'joker_pair' || best.type === 'pair_rank') return best;
    // 单级牌：非首局且我方已坐庄 → 不抢（保持己方底）；否则 70% 早亮
    const myTeam = state.players[playerIdx].team;
    const dealerTeam = state.players[state.dealerIdx].team;
    if (state.roundNo > 1 && myTeam === dealerTeam && rng) {
      return rng.next() < 0.7 ? best : null;
    }
    return best;
  }

  /* ------------------------- 三打一：庄家选主 ------------------------- */

  /**
   * 庄家选主花色（不受手牌限制，自由选）：
   * 策略 = 选"加权牌力最强"的花色（长门 + 大牌 + 该门 2/王可配合）。
   * @param {object} state CHOOSE_TRUMP 阶段
   * @param {number} playerIdx 庄家
   * @returns {string} 'S'|'H'|'C'|'D'
   */
  decideTrumpSuit(state, playerIdx) {
    const hand = state.players[playerIdx].hand;
    const suits = ['S', 'H', 'C', 'D'];
    let best = suits[0];
    let bestScore = -1;
    suits.forEach((su) => {
      const cards = hand.filter((c) => !c.isJoker && c.rank !== '2' && c.suit === su);
      let sc = cards.length * 4; // 长门基础分
      cards.forEach((c) => {
        const v = { A: 6, K: 4, Q: 3, J: 2 }[c.rank] || 0;
        sc += v + (pointValue(c, state.config) > 0 ? 2 : 0); // 大牌+分牌
      });
      // 同门有 2（配合级牌控制）
      const twos = hand.filter((c) => !c.isJoker && c.rank === '2' && c.suit === su).length;
      sc += twos * 5;
      if (sc > bestScore) { bestScore = sc; best = su; }
    });
    return best;
  }

  /* ------------------------- 三打一：报分 ------------------------- */

  /**
   * 三打一报分决策（可反复加价）。
   * 估算手牌强度（大王/2/对王/长门 → 预期能拿的分），报出可选项中 ≤ 预期分的最高价；
   * 预期分不足起报分 → 不报（返回 null，由调用方 PASS）。
   * @param {object} state
   * @param {number} playerIdx
   * @param {Array<number>} options 可报分值（升序）
   * @param {object} [rng]
   * @returns {number|null} 报的分值；null=不报
   */
  decideScoreBid(state, playerIdx, options, rng) {
    if (!options || options.length === 0) return null;
    const estimate = this.estimateSanDaYiPoints(state, playerIdx);
    // 90 起叫（庄家需拿 45% 分）：估算 ≥ 叫分+12 才叫（安全边际）
    let best = null;
    for (const v of options) {
      if (estimate >= v + 12) best = v;
    }
    if (rng && this.difficulty === 'easy' && rng.next() < 0.2) return null;
    return best;
  }

  /**
   * 三打一手牌强度估算（0~200，直接标定=1v3 可期望拿到的分）：
   * 核心洞察：1v3 下副牌大牌会被三家主牌围杀，庄家牌力≈主牌控制力。
   * 标定：主牌数 × 控制分 + 长门补偿，输出即预期得分。
   */
  estimateSanDaYiPoints(state, playerIdx) {
    const hand = state.players[playerIdx].hand;
    // 三打一主牌 = 王 + 2（竞价阶段 trumpInfo 未建，手动识别）
    let bj = 0, rj = 0, twos = 0;
    const bySuit = new Map();
    hand.forEach((c) => {
      if (c.isJoker) { if (c.rank === 'BJ') bj++; else rj++; return; }
      if (c.rank === '2') { twos++; return; }
      bySuit.set(c.suit, (bySuit.get(c.suit) || 0) + 1);
    });
    const trumps = bj + rj + twos;
    // 主牌控制力：每张主 ≈ 6 分基础；王更强
    let pts = trumps * 6 + bj * 5 + rj * 3;
    // 主牌对子（两张同 2 / 对王）额外控制
    pts += Math.max(0, twos - 1) * 2 + (bj >= 1 && rj >= 1 ? 6 : 0);
    // 长门（≥6 张副门）可立套收墩
    bySuit.forEach((n) => {
      if (n >= 7) pts += 16;
      else if (n >= 6) pts += 9;
      else if (n >= 5) pts += 4;
    });
    // 25 张基准修正（手牌 25 张，主牌均值 3 张；低于均值惩罚）
    if (trumps <= 2) pts -= 10;
    return Math.max(0, Math.min(200, Math.round(pts)));
  }

  /* ------------------------- 埋底 ------------------------- */

  /**
   * 埋底决策。
   * @param {object} state
   * @param {number} playerIdx
   * @param {object} [rng]
   * @returns {Array<object>} bottomCards 张
   */
  decideBury(state, playerIdx, rng) {
    const cfg = state.config;
    const hand = state.players[playerIdx].hand;
    const ti = state.trumpInfo;
    const trumps = hand.filter((c) => domainOf(c, ti) === 'TRUMP');
    const offSuit = hand.filter((c) => domainOf(c, ti) !== 'TRUMP');

    // 三打一：底分归末墩赢家（×1）——庄家埋分 = 白送，只埋绝对废牌（短门最小非分牌）
    if (cfg.gameMode === 'san_da_yi') {
      const picked = [];
      const bySuit = new Map();
      offSuit.forEach((c) => {
        if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
        bySuit.get(c.suit).push(c);
      });
      // 全副牌按门分组；短门优先、门内小牌优先、分牌最后兜底
      const suits = [...bySuit.entries()].sort((a, b) => a[1].length - b[1].length);
      for (const [, list] of suits) {
        list.sort((a, b) => (pointValue(a, cfg) - pointValue(b, cfg)) || (rankNum(a) - rankNum(b)));
        for (const c of list) {
          if (picked.length >= cfg.bottomCards) break;
          if (pointValue(c, cfg) > 0 && picked.length < cfg.bottomCards - 1) continue; // 分牌仅最后兜底
          picked.push(c);
        }
        if (picked.length >= cfg.bottomCards) break;
      }
      // 不足 → 最小非分主牌（保大王与 2）
      if (picked.length < cfg.bottomCards) {
        for (const c of sortHand(trumps, ti)) {
          if (picked.length >= cfg.bottomCards) break;
          if (c.isJoker || c.rank === ti.levelRank || pointValue(c, cfg) > 0) continue;
          picked.push(c);
        }
      }
      // 还不足 → 任何最小牌
      if (picked.length < cfg.bottomCards) {
        const rest = sortHand(hand, ti).filter((c) => !picked.some((p) => p.id === c.id));
        for (const c of rest) {
          if (picked.length >= cfg.bottomCards) break;
          picked.push(c);
        }
      }
      return picked;
    }

    const strongTrump = trumps.length >= Math.ceil(hand.length / 3);

    const picked = [];
    const ids = new Set();

    if (strongTrump) {
      // 主强：埋短门副牌（废牌优先）+ 部分分牌藏分
      const bySuit = new Map();
      offSuit.forEach((c) => {
        if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
        bySuit.get(c.suit).push(c);
      });
      // 短门先埋，门内小牌先埋
      const suits = [...bySuit.entries()].sort((a, b) => a[1].length - b[1].length);
      for (const [, list] of suits) {
        list.sort((a, b) => rankNum(a) - rankNum(b));
        for (const c of list) {
          if (picked.length >= cfg.bottomCards) break;
          picked.push(c);
          ids.add(c.id);
        }
        if (picked.length >= cfg.bottomCards) break;
      }
      // 仍不足 → 埋最小主牌（保大王/级牌）
      if (picked.length < cfg.bottomCards) {
        const spareTrumps = sortHand(trumps, ti);
        for (const c of spareTrumps) {
          if (picked.length >= cfg.bottomCards) break;
          if (ids.has(c.id)) continue;
          // 保留大牌：只埋主牌域尾部小牌
          if (pointValue(c, cfg) === 0 && !c.isJoker && c.rank !== ti.levelRank) {
            picked.push(c);
            ids.add(c.id);
          }
        }
      }
    } else {
      // 主弱：埋废牌（非分小牌优先，保护手上灵活）
      const all = sortHand(hand, ti);
      const noPoint = all.filter((c) => pointValue(c, cfg) === 0 && !c.isJoker);
      const points = all.filter((c) => pointValue(c, cfg) > 0);
      // 先埋非分小牌（副牌最小者）
      const offs = noPoint.filter((c) => domainOf(c, ti) !== 'TRUMP')
        .sort((a, b) => rankNum(a) - rankNum(b));
      for (const c of offs) {
        if (picked.length >= cfg.bottomCards) break;
        picked.push(c);
        ids.add(c.id);
      }
      // 不足 → 埋最小分牌（避免被抠大分）
      const pts = points.filter((c) => domainOf(c, ti) !== 'TRUMP')
        .sort((a, b) => pointValue(a, cfg) - pointValue(b, cfg));
      for (const c of pts) {
        if (picked.length >= cfg.bottomCards) break;
        picked.push(c);
        ids.add(c.id);
      }
      // 还不足 → 最小主牌
      if (picked.length < cfg.bottomCards) {
        for (const c of sortHand(trumps, ti)) {
          if (picked.length >= cfg.bottomCards) break;
          if (ids.has(c.id)) continue;
          picked.push(c);
          ids.add(c.id);
        }
      }
    }
    return picked.slice(0, cfg.bottomCards);
  }

  /* ------------------------- 出牌 ------------------------- */

  /**
   * 出牌决策（legalMoves 枚举 + 贪心打分）。
   * @param {object} state
   * @param {number} playerIdx
   * @param {object} [rng] easy 难度扰动
   * @returns {Array<object>} Card[]
   */
  decidePlay(state, playerIdx, rng) {
    const candidates = legalMoves(state, playerIdx);
    if (candidates.length === 0) {
      throw new Error(`AI 无合法出牌（player ${playerIdx}，phase ${state.phase}）`);
    }
    const isLead = !state.currentTrick || state.currentTrick.plays.length === 0;
    const scored = candidates.map((cards_) => ({
      cards: cards_,
      score: isLead
        ? this._scoreLead(state, playerIdx, cards_)
        : this._scoreFollow(state, playerIdx, cards_)
    }));
    scored.sort((a, b) => b.score - a.score);
    let pick = scored[0].cards;
    if (this.difficulty === 'easy' && rng && scored.length > 1 && rng.next() < 0.25) {
      pick = scored[Math.min(1, scored.length - 1)].cards; // 25% 次优
    }
    // 铁律：二次校验；失败回退首个候选
    const check = validatePlay(state, playerIdx, pick);
    if (!check.ok) {
      pick = candidates[0];
    }
    return pick;
  }

  /**
   * 领出打分。
   * @param {object} state
   * @param {number} playerIdx
   * @param {Array<object>} cards
   * @returns {number}
   */
  _scoreLead(state, playerIdx, cards_) {
    const cfg = state.config;
    const ti = state.trumpInfo;
    const combo = parseCombo(cards_, ti, cfg);
    const myTeam = this._camp(state, playerIdx);
    const isDealerTeam = myTeam === 0;
    const hand = state.players[playerIdx].hand;
    const trumps = hand.filter((c) => domainOf(c, ti) === 'TRUMP');
    const mem = buildMemory(state, playerIdx);
    let score = 0;

    // 末墩抠底意识：剩最后一墩（手牌=领出张数）且攻方 → 最大牌
    const isLastTrick = hand.length === cards_.length;
    if (isLastTrick && !isDealerTeam) {
      score += 50 + this._maxStrength(cards_, ti) / 100;
    }

    if (combo.isTrump) {
      // 主牌领出
      if (trumps.length > hand.length / 2) {
        score += 15; // 主多清主
      }
      if (combo.type === 'tractor') score += 12;
      if (combo.type === 'pair') score += 6;
      if (combo.type === 'single' && cards_[0].rank === 'BJ') score += 8; // 大王控场
    } else {
      // 副牌领出
      const domainCards_ = hand.filter((c) => domainOf(c, ti) === combo.suit);
      if (combo.type === 'tractor' && this._isBiggestInDomain(cards_, domainCards_, ti, cfg)) {
        score += 14; // 大拖几乎必赢
      }
      if (combo.type === 'pair' && this._isBiggestPair(cards_, domainCards_, ti)) {
        score += 10;
      }
      if (combo.type === 'single' && this._isBiggestSingle(cards_, domainCards_, ti)) {
        score += 7;
      }
      // 庄家方副牌领出倾向小牌（保控制）
      if (isDealerTeam && combo.type === 'single') {
        score += (14 - this._maxStrength(cards_, ti)) / 14 * 5;
      }
      // 分牌不领出（送分风险）
      score -= pointsOf(cards_, cfg) / 2;
    }
    return score;
  }

  /**
   * 跟牌打分。
   * @param {object} state
   * @param {number} playerIdx
   * @param {Array<object>} cards
   * @returns {number}
   */
  _scoreFollow(state, playerIdx, cards_) {
    const cfg = state.config;
    const ti = state.trumpInfo;
    const trick = state.currentTrick;
    const lead = trick.leadCombo;
    const myTeam = this._camp(state, playerIdx);
    const isLast = trick.plays.length === 3; // 我是末家
    const mem = buildMemory(state, playerIdx);

    const combo = parseCombo(cards_, ti, cfg);
    const pts = pointsOf(cards_, cfg);
    const trickPts = trick.plays.reduce((s, p) => s + pointsOf(p.cards, cfg), 0);
    const curWinnerTeam = this._currentWinnerTeam(state, trick, ti, cfg);
    const teamWinning = curWinnerTeam === myTeam;

    // 能否压过当前最大
    const { resolveTrick } = require('../engine/trick');
    let canWin = false;
    try {
      const probe = {
        leadPlayerIdx: trick.leadPlayerIdx,
        leadCombo: lead,
        plays: trick.plays.concat([{
          playerIdx, cards: cards_, combo, isDiscard: false, isEffectiveTrump: false
        }]),
        winnerIdx: null,
        points: 0
      };
      resolveTrick(probe, ti, cfg);
      canWin = probe.winnerIdx === playerIdx;
    } catch (e) {
      canWin = false;
    }

    let score = 0;
    if (canWin) {
      // 末家必赢 → 最大分收益
      if (isLast) {
        score += 30 + pts * 2 + trickPts;
      } else {
        // 非末家能赢：用最小能赢牌（省大牌）
        const strength = this._maxStrength(cards_, ti);
        score += 20 - strength / 100 + Math.min(pts, 10);
        // 中家已方领先且墩分高 → 大概率保留控制
        if (teamWinning && trickPts >= TRUMP_IN_THRESHOLD) score += 8;
      }
      // 攻方收分意识
      if (myTeam !== 0) {
        score += trickPts / 2 + pts;
      }
    } else {
      // 赢不了：垫牌策略
      const isTrumpPlay = cards_.every((c) => domainOf(c, ti) === 'TRUMP');
      if (isTrumpPlay) {
        score -= 20; // 浪费主牌
      }
      // 队友稳赢 → 喂分
      if (teamWinning) {
        score += pts * 1.5;
      } else {
        score -= pts; // 对手可能赢 → 不送分
      }
      // 垫最小
      score += (20 - this._maxStrength(cards_, ti)) / 20 * 6;
    }
    return score;
  }

  /* ------------------------- 辅助 ------------------------- */

  /**
   * 阵营归属（双模式统一）：
   * 升级模式 → team 0/1；三打一 → dealer 单阵营 vs attackers（记 dealer=0/attacker=1）。
   * @returns {number} 0=庄家方 / 1=攻方
   */
  _camp(state, playerIdx) {
    if (state.config.gameMode === 'san_da_yi' && state.sanDaYiTeams) {
      return playerIdx === state.sanDaYiTeams.dealer ? 0 : 1;
    }
    return state.players[playerIdx].team === state.players[state.dealerIdx].team ? 0 : 1;
  }

  _maxStrength(cards_, ti) {
    const { strengthInDomain } = require('../engine/combo');
    return Math.max(...cards_.map((c) => strengthInDomain(c, ti)));
  }

  _isBiggestSingle(cards_, domainCards_, ti) {
    const { strengthInDomain } = require('../engine/combo');
    const s = strengthInDomain(cards_[0], ti);
    return domainCards_.every((c) => strengthInDomain(c, ti) <= s);
  }

  _isBiggestPair(cards_, domainCards_, ti) {
    const { strengthInDomain } = require('../engine/combo');
    const s = strengthInDomain(cards_[0], ti);
    const higher = domainCards_.filter((c) => strengthInDomain(c, ti) > s);
    if (higher.length === 0) return true;
    // 高牌不成对（仅一张）→ 仍是最大对
    const byKey = new Map();
    domainCards_.forEach((c) => {
      const k = `${c.suit}-${c.rank}`;
      byKey.set(k, (byKey.get(k) || 0) + 1);
    });
    return higher.every((c) => byKey.get(`${c.suit}-${c.rank}`) < 2);
  }

  _isBiggestInDomain(cards_, domainCards_, ti, cfg) {
    // 拖拉机头是该门最大对 → 近似最大拖
    return this._isBiggestPair(cards_.slice(0, 2), domainCards_, ti);
  }

  _currentWinnerTeam(state, trick, ti, cfg) {
    const { resolveTrick } = require('../engine/trick');
    const probe = {
      leadPlayerIdx: trick.leadPlayerIdx,
      leadCombo: trick.leadCombo,
      plays: trick.plays.slice(),
      winnerIdx: null,
      points: 0
    };
    try {
      resolveTrick(probe, ti, cfg);
    } catch (e) {
      return -1;
    }
    return this._camp(state, probe.winnerIdx);
  }
}

/** 牌面数值辅助（非规则数值，排序用） */
function rankNum(card) {
  const v = { J: 11, Q: 12, K: 13, A: 14 };
  return v[card.rank] || (card.isJoker ? 16 : parseInt(card.rank, 10));
}

module.exports = { GreedyStrategy, rankNum };
