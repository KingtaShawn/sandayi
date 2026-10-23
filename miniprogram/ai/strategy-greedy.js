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
const { parseCombo, domainOf, pointsOf, strengthInDomain } = require('../engine/combo');
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
      // 大牌对子（AA/KK/QQ/JJ）控制力翻倍
      const byRank = new Map();
      cards.forEach((c) => byRank.set(c.rank, (byRank.get(c.rank) || 0) + 1));
      byRank.forEach((n, r) => { if (n >= 2 && { A: 1, K: 1, Q: 1, J: 1 }[r]) sc += 4; });
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
    // 估价已标定 ≈ 当庄期望得分（含全埋副牌分埋底）：
    //   首报 90 放宽 15 分门槛（估算≥75）——单家约 43% 开叫、全 AI 桌
    //   90% 直接成交（防弃叫重发拖节奏），达标率约 44%；
    //   加价必须实打实（估算≥叫分+2），只有真强牌才抬价
    const opened = (state.bids || []).some((b) => b.type === 'score_bid');
    const floorNeed = options[0] - 15;
    let best = null;
    for (const v of options) {
      if (estimate >= (!opened && v === options[0] ? floorNeed : v + 2)) best = v;
    }
    if (rng && this.difficulty === 'easy' && rng.next() < 0.2) return null;
    return best;
  }

  /**
   * 三打一竞价手牌估价（0~200，标定≈新 AI 自对弈当庄期望得分）。
   * 数据：1000 局随机手牌强制当庄（报 90，含「全埋副牌分」埋底策略）回归拟合，
   * r≈0.49、分位严格单调；旧模型（主牌数×6+长门档位）r 仅 0.15 且低估 14 分。
   */
  estimateSanDaYiPoints(state, playerIdx) {
    const hand = state.players[playerIdx].hand;
    // 竞价阶段 trumpInfo 未建：固定主牌 = 王 + 2，最长门 ≈ 未来主花色
    let bj = 0, rj = 0;
    const twoBySuit = new Map();
    const bySuit = { S: [], H: [], C: [], D: [] };
    hand.forEach((c) => {
      if (c.isJoker) { if (c.rank === 'BJ') bj++; else rj++; return; }
      if (c.rank === '2') { twoBySuit.set(c.suit, (twoBySuit.get(c.suit) || 0) + 1); return; }
      bySuit[c.suit].push(c.rank);
    });
    let trumps = bj + rj;
    twoBySuit.forEach((n) => { trumps += n; });
    // 最长门（并列取 AKQ 多者，贴近选主逻辑）：长度/AKQ/对子都是主门控制力
    let L1 = null;
    Object.keys(bySuit).forEach((su) => {
      const rs = bySuit[su];
      const akq = rs.filter((r) => r === 'A' || r === 'K' || r === 'Q').length;
      if (!L1 || rs.length > L1.len || (rs.length === L1.len && akq > L1.akq)) {
        L1 = { suit: su, len: rs.length, akq, pairs: rs.length - new Set(rs).size };
      }
    });
    const lens = Object.keys(bySuit).map((su) => bySuit[su].length).sort((a, b) => b - a);
    const L2 = lens[1] || 0;
    let offA = 0;
    Object.keys(bySuit).forEach((su) => {
      if (su === L1.suit) return;
      offA += bySuit[su].filter((r) => r === 'A').length;
    });
    const jokerPair = (bj >= 2 ? 1 : 0) + (rj >= 2 ? 1 : 0);
    const pts = -60 + trumps * 13.5 + jokerPair * 11
      + L1.len * 7.5 + L1.akq * 3.8 + L1.pairs * 3.7
      + L2 * 3.3 + offA * 3;
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

    // 三打一：底分归末墩赢家 ×1。实测（400 局同种子 A/B）：
    //   副牌分牌 1v3 下几乎护不住（攻方 A/将吃抢墩），埋底只承担末墩被抠的
    //   ~49% 风险——全埋副牌分比只埋废牌：庄分 +8.4、达标率 +14.8pp、
    //   赢末墩率 40%→49%（手上全留小垫牌，主牌更留得住）。
    //   保留价值：短门 < 长门、小牌 < 大牌、分牌一律优先埋。
    if (cfg.gameMode === 'san_da_yi') {
      const suitLen = new Map();
      offSuit.forEach((c) => suitLen.set(c.suit, (suitLen.get(c.suit) || 0) + 1));
      const keepVal = (c) => (suitLen.get(c.suit) || 0) * 2 + rankNum(c) / 2
        - (pointValue(c, cfg) > 0 ? 10 : 0);
      const picked = offSuit.slice()
        .sort((a, b) => keepVal(a) - keepVal(b))
        .slice(0, cfg.bottomCards);
      // 副牌不足 8 张 → 最小非分主牌（保王与 2）
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
    const ctx = state.config.gameMode === 'san_da_yi' ? this._buildCtx(state, playerIdx) : null;
    const scored = candidates.map((cards_) => ({
      cards: cards_,
      score: isLead
        ? this._scoreLead(state, playerIdx, cards_, ctx)
        : this._scoreFollow(state, playerIdx, cards_, ctx)
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
  _scoreLead(state, playerIdx, cards_, ctx) {
    // 三打一：仅庄家用增强领出；攻方沿用贪心基线（自对弈实测更优）
    if (ctx && ctx.sdy.isDealer) return this._scoreLeadSdy(state, playerIdx, cards_, ctx);
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
  _scoreFollow(state, playerIdx, cards_, ctx) {
    if (ctx) return this._scoreFollowSdy(state, playerIdx, cards_, ctx);
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

    const canWin = this._wouldWin(state, trick, playerIdx, cards_, combo);

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

  /* --------------------- 三打一增强：记牌 + 合同意识 --------------------- */

  /**
   * 决策上下文（每手牌构建一次）：记牌器 + 各域未见牌强度表 + 庄家得分形势。
   * 未见牌 = 全副牌 - 已出 - 我手牌（含底牌，视为在对手处，略保守但诚实——不偷看）。
   */
  _buildCtx(state, playerIdx) {
    const ti = state.trumpInfo;
    const mem = buildMemory(state, playerIdx);
    const di = { byDomain: new Map(), total: mem.remainingCount };
    const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    const keys = [];
    ['S', 'H', 'C', 'D'].forEach((su) => RANKS.forEach((r) => keys.push({ suit: su, rank: r, isJoker: false })));
    keys.push({ suit: 'JOKER', rank: 'BJ', isJoker: true });
    keys.push({ suit: 'JOKER', rank: 'RJ', isJoker: true });
    keys.forEach((k) => {
      const unseen = mem.remainingOfKey(`${k.suit}-${k.rank}`);
      if (unseen <= 0) return;
      const fake = { suit: k.suit, rank: k.rank, isJoker: k.isJoker };
      const d = domainOf(fake, ti);
      if (!di.byDomain.has(d)) di.byDomain.set(d, []);
      di.byDomain.get(d).push({ s: strengthInDomain(fake, ti), unseen });
    });
    return { mem, di, sdy: this._sdyCtx(state, playerIdx) };
  }

  /** 庄家形势：dealerIdx / 已得分 / 距合同差 / 剩余手牌 */
  _sdyCtx(state, playerIdx) {
    const dealerIdx = state.sanDaYiTeams ? state.sanDaYiTeams.dealer : state.dealerIdx;
    let dealerPts = 0;
    (state.completedTricks || []).forEach((t) => {
      if (t.winnerIdx === dealerIdx) dealerPts += t.points;
    });
    return {
      dealerIdx,
      isDealer: playerIdx === dealerIdx,
      dealerPts,
      need: (state.contractScore || 0) - dealerPts,
      handLen: state.players[playerIdx].hand.length
    };
  }

  /** 域内未见更强牌的张数（0 = 我这单元在剩余牌里已无对手） */
  _unseenHigher(di, domain, strength) {
    const list = di.byDomain.get(domain);
    if (!list) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].s > strength) n += list[i].unseen;
    }
    return n;
  }

  /** 组合的每个单元在剩余牌里都无更大者（副牌仍可能被将吃，配 _ruffFactor 折减） */
  _isSureCombo(combo, di) {
    if (!combo) return false;
    return combo.units.every((u) => this._unseenHigher(di, combo.suit, u.strength) === 0);
  }

  /** 副牌被将吃风险折减（0.4~1）：该门占剩余牌比例越低，缺门将吃概率越高 */
  _ruffFactor(di, domain) {
    const list = di.byDomain.get(domain);
    const inDom = list ? list.reduce((s, e) => s + e.unseen, 0) : 0;
    if (inDom === 0 || di.total === 0) return 1;
    return Math.max(0.4, Math.min(1, (inDom / di.total) * 3));
  }

  /**
   * 三打一庄家领出打分（v3，基准实测校准）：
   * 基线骨架不动（领出手里大单/大对逼对手消耗拦牌——实测有效，保留其
   * 「手牌内最大」判定），在其上叠加真·稳赢（记牌器未见更大牌）加成、
   * 1/3 手牌主牌控制阈值（三打一主牌池 36 张，庄家常拿长门）、
   * 短门小单加成（制造缺门后续将吃）。攻方领出走基线原逻辑。
   */
  _scoreLeadSdy(state, playerIdx, cards_, ctx) {
    const cfg = state.config;
    const ti = state.trumpInfo;
    const { di } = ctx;
    const combo = parseCombo(cards_, ti, cfg);
    if (!combo) return 0;
    const hand = state.players[playerIdx].hand;
    const trumps = hand.filter((c) => domainOf(c, ti) === 'TRUMP');
    const sure = this._isSureCombo(combo, di);
    const strength = this._maxStrength(cards_, ti);
    const domainCards_ = hand.filter((c) => domainOf(c, ti) === combo.suit);
    let score = 0;

    // 末墩抠底意识（庄家）：攻方有（基线），庄家此前没有——底牌是自己
    // 埋的、分值门儿清，≥10 分就值得用最大牌抢末墩（末墩赢家收底分 ×1）
    if (hand.length === cards_.length) {
      const bp = (state.bottomCards || []).reduce((s, c) => s + pointValue(c, cfg), 0);
      if (bp >= 10) score += 50 + strength / 100;
    }

    if (combo.isTrump) {
      if (trumps.length > hand.length / 2) score += 15; // 主极多：清主消耗攻方
      else if (trumps.length > hand.length / 3) score += 8;
      if (combo.type === 'tractor') score += 12;
      if (combo.type === 'pair') score += 6;
      if (combo.type === 'single' && cards_[0].rank === 'BJ') score += 8; // 大王控场
      score += strength / 200; // 同型先出大主
    } else {
      // 基线：手牌内最大（逼近顶部，逼对手用真大牌压、消耗拦牌）
      if (combo.type === 'tractor' && this._isBiggestInDomain(cards_, domainCards_, ti, cfg)) score += 14;
      if (combo.type === 'pair' && this._isBiggestPair(cards_, domainCards_, ti)) score += 10;
      if (combo.type === 'single' && this._isBiggestSingle(cards_, domainCards_, ti)) score += 7;
      // 叠加：真·稳赢（剩余牌无更大单元）确定性加成，副牌按被将吃风险折减
      const rf = this._ruffFactor(di, combo.suit);
      if (sure) {
        if (combo.type === 'tractor') score += 6 * rf;
        else if (combo.type === 'pair') score += 5 * rf;
        else if (combo.type === 'single') score += 4 * rf;
      }
      // 甩牌在三打一合法即同门无更大单元，小额 + 风险折减
      if (combo.type === 'throw') score += (sure ? 8 : 4) * rf;
      // 庄家小单领出保控制 + 短门加成（制造缺门后续将吃）
      if (combo.type === 'single') {
        score += (14 - strength) / 14 * 5 + (5 - Math.min(5, domainCards_.length)) * 1.2;
      }
      score -= pointsOf(cards_, cfg) / 2; // 不送分
    }
    return score;
  }

  /**
   * 三打一跟牌打分（v2，基准实测校准）：
   * 攻方 = 贪心基线原逻辑（自对弈实测优于全面位置感知版）+ 一处升级：
   *   庄家已出且队友领先 → 喂分系数 1.5 → 3（此时喂分 100% 安全）；
   * 庄家 = 合同意识版：有分墩出强牌锁墩（身后攻方专压小赢牌），
   *   稳赢组合再加成；白墩仍最小赢；输墩绝不送分。
   */
  _scoreFollowSdy(state, playerIdx, cards_, ctx) {
    const cfg = state.config;
    const ti = state.trumpInfo;
    const trick = state.currentTrick;
    const lead = trick.leadCombo;
    const { sdy, di } = ctx;
    const combo = parseCombo(cards_, ti, cfg);
    const pts = pointsOf(cards_, cfg);
    const trickPts = trick.plays.reduce((s, p) => s + pointsOf(p.cards, cfg), 0);
    const isLast = trick.plays.length === 3;
    const strength = this._maxStrength(cards_, ti);
    const canWin = this._wouldWin(state, trick, playerIdx, cards_, combo);
    const dealerInPlay = trick.leadPlayerIdx === sdy.dealerIdx
      || trick.plays.some((p) => p.playerIdx === sdy.dealerIdx);
    const curWinnerTeam = this._currentWinnerTeam(state, trick, ti, cfg);
    const teamWinning = curWinnerTeam === this._camp(state, playerIdx);
    const allTrump = cards_.every((c) => domainOf(c, ti) === 'TRUMP');
    let score = 0;

    if (sdy.isDealer) {
      if (canWin) {
        if (isLast) {
          score += 30 + pts * 2 + trickPts; // 末家稳收：连自己分一起算
        } else if (trickPts + pts >= 10) {
          // 有分墩：出强牌锁墩（身后攻方专压庄家的小赢牌）
          score += 24 + strength / 150 + Math.min(pts, 10) + trickPts / 2;
          if (this._isSureCombo(combo, di)) score += 6; // 剩余牌无更大 → 后手也压不过
        } else {
          score += 20 - strength / 100; // 白墩最小赢（庄家将吃抢节奏，不罚）
        }
      } else {
        if (allTrump) score -= 20; // 输墩浪费主牌
        score -= pts; // 输墩绝不送分
        score += (20 - strength) / 20 * 6; // 垫最小
      }
    } else {
      // 攻方：贪心基线原逻辑
      if (canWin) {
        if (isLast) {
          score += 30 + pts * 2 + trickPts;
        } else {
          score += 20 - strength / 100 + Math.min(pts, 10);
          if (teamWinning && trickPts >= TRUMP_IN_THRESHOLD) score += 8;
        }
        score += trickPts / 2 + pts; // 攻方收分意识
        // 主牌经济：赢墩要花主牌时按墩内分值「付费」——
        // 无分墩不烧主（主牌留着后手将吃大分墩），小分墩少烧
        if (allTrump && !lead.isTrump) {
          score -= Math.max(0, 18 - trickPts - pts);
        } else if (allTrump && lead.isTrump && !isLast && trickPts + pts < 10) {
          // 庄家清主小分墩：能输就输，留大主后手夺分
          score -= Math.max(0, 16 - trickPts - pts);
        }
      } else {
        // 缺门垫主 = 纯浪费（跟主牌领出被迫出主不算）
        if (allTrump && !lead.isTrump) score -= 20;
        if (teamWinning) {
          score += pts * (dealerInPlay ? 3 : 1.5); // 庄家已出 → 喂分绝对安全
        } else {
          score -= pts;
        }
        score += (20 - strength) / 20 * 6;
      }
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

  /** 我这样出能否赢下当前墩（resolveTrick 探针，精确到引擎规则） */
  _wouldWin(state, trick, playerIdx, cards_, combo) {
    const { resolveTrick } = require('../engine/trick');
    try {
      const probe = {
        leadPlayerIdx: trick.leadPlayerIdx,
        leadCombo: trick.leadCombo,
        plays: trick.plays.concat([{
          playerIdx, cards: cards_, combo, isDiscard: false, isEffectiveTrump: false
        }]),
        winnerIdx: null,
        points: 0
      };
      resolveTrick(probe, state.trumpInfo, state.config);
      return probe.winnerIdx === playerIdx;
    } catch (e) {
      return false;
    }
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
