/**
 * ai/strategy-greedy.js —— 贪心启发式 AI（P0）。
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
 *     · 领出：庄家/主多 → 大拖/大对清主；顶主守底（非末墩不领「剩余牌
 *       无敌」的顶主——单大王换不来分，留作后手压分墩与末墩抠底）；
 *       攻方末墩意识（剩 1 墩且能赢 → 最大牌抠底）+ 末墩储备
 *       （剩 ≤5 墩不把无敌大主花在小分墩上，留力抠底）
 *       + 配合领出（往庄家示缺门领空牌逼烧主——三家主牌碾压一家）；
 *     · 跟牌：末家必赢 → 甩分牌收分；能小赢 → 最小能赢牌；赢不了 → 垫最小/喂分给稳赢队友；
 *       结构防守（v6）：庄家垫牌/领出拆对罚 + JQKA 大单保护（AI_PAIR）、
 *       主牌战已输（三家主牌耗尽/庄家仍持主）即刻满分防守——垫牌保
 *       副牌无敌大牌、抢分豁免省牌罚（AI_SWEEP）；
 *     · 缺门：墩内分 ≥ threshold → 主牌将吃（结构对应优先），否则垫分/垫小。
 */

'use strict';

const { legalMoves, validatePlay } = require('../engine/validate');
const { parseCombo, domainOf, pointsOf, strengthInDomain } = require('../engine/combo');
const { pointValue, sortHand } = require('../engine/card');
const { buildMemory } = require('./memory');
const { createRng } = require('../utils/random');

/** 将吃意愿门槛（墩内已有分） */
const TRUMP_IN_THRESHOLD = 10;

/** R5 残局求解预算（确定性：枚举上限 / 固定种子采样数 / 节点上限 / 剪枝宽度） */
const R5_ENUM_CAP = 240;
const R5_ENUM_NODE_CAP = 300000; // 枚举递归节点预算（缺门剪枝致结果稀产时的裸搜护栏）
const R5_SAMPLE_N = 48;
const R5_NODE_CAP = 120000;
const R5_K_ROOT = 6;
const R5_K_NODE = 3;
const R5_RNG_SEED = 20261024;

/** R3 PIMC 推演预算（确定性：固定种子采样 / 根候选宽度 / rollout 候选宽度 / rollout 步数总预算）
 * 采样数随手牌（≈rollout 长度）递减：实测 h≤6 时单决策 ~6ms、h≤10 约 ~100ms，
 * 每局触发 ~2.7 次，真机预算藏在 AI 思考延时内。 */
const R3_SAMPLES = { 4: 24, 6: 16, 8: 12, 10: 10 }; // h 上限 → 采样数
const R3_K_ROOT = 4;
const R3_TAU = Number(envFlag('AI_R3_TAU') !== undefined ? envFlag('AI_R3_TAU') : 8); // 覆盖阈值：最优候选期望 V 须优于贪心选择这么多分（v1 跟牌扫 τ∈{0,3,5,8,10,12} 定 10；v2 加领出覆盖后重标定 8：τ=8 攻方 −0.3pp 且庄家不动，τ=5 跟牌噪声覆盖伤庄家 −0.5pp）
const R3_ROLLOUT_K = 8;
const R3_EVENT_CAP = 2400;
const R3_RNG_SEED = 20261025;

/** R4 情报先验：庄家自选主花色 → 持主天然富集——400 局实测（h=5/8/12 稳定）
 * 合同 90 庄家占未见主牌 ~57%、合同 100 ~75%（均匀采样只给 ~25%）。
 * 重要性重采样：采 3× 候选，按「庄家持主数偏离目标」升序罚取前 N。 */
const R4_SHARE_BASE = 0.57;
const R4_SHARE_SLOPE = 0.02; // 合同每高 1 分 +2pp
const R4_SHARE_CAP = 0.8;

/** R7 选主 rollout 预算（确定性：固定种子采样数 / 单局 transition 上限） */
const R7_ROLLOUTS = 5;
const R7_STEP_CAP = 800;
const R7_RNG_SEED = 20261026;

/** 末墩储备：攻方看不见底牌，按庄家「全埋副牌分」实测平均埋底 ~36 分估 */
const BOTTOM_POINTS_EXP = 35;

/** Node 侧消融开关读取（浏览器/小程序无 process，恒返回 undefined → 默认开） */
function envFlag(name) {
  try {
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  } catch (e) {
    return undefined;
  }
}

/** R1 合同意识 / R2 甩牌风险管理 / R5 残局精确求解 消融开关（默认开；
 *  Node 下 AI_R1=0、AI_R2=0、AI_R5=0 单独关闭跑基准归因；
 *  R1 再分庄家侧 R1D（成庄墩）与攻方侧 R1A（卡点否决），可独立消融） */
const FEAT_R1 = envFlag('AI_R1') !== '0';
const FEAT_R1D = FEAT_R1 && envFlag('AI_R1D') !== '0';
const FEAT_R1A = FEAT_R1 && envFlag('AI_R1A') !== '0';
const FEAT_R2 = envFlag('AI_R2') !== '0';
const FEAT_R5 = envFlag('AI_R5') !== '0';
const FEAT_R3 = envFlag('AI_R3') !== '0';
const FEAT_R4 = envFlag('AI_R4') !== '0';
const FEAT_R6B = envFlag('AI_R6B') !== '0';
/** R3 v2：攻方领出推演（AI_R3_LEAD，默认开） */
const FEAT_R3_LEAD = envFlag('AI_R3_LEAD') !== '0';
const FEAT_R7 = envFlag('AI_R7') !== '0';
/** v6 结构防守（消融开关，默认开）：PAIR=庄家拆对/大单保护，SWEEP=满分破光 */
const FEAT_PAIR = envFlag('AI_PAIR') !== '0';
const FEAT_SWEEP = envFlag('AI_SWEEP') !== '0';
/** R12 送分风险（消融开关，默认开）：庄家未出、队友在压的副牌真的很弱
 *  （暗处更大 ≥4 张）或庄家已示缺门（将吃口）时，喂分收益按风险折减 */
const FEAT_FEEDRISK = envFlag('AI_FEEDRISK') !== '0';
// 攻方关键墩接力与甩牌候选保留，分别消融。
const FEAT_RELAY = envFlag('AI_RELAY') !== '0';
const FEAT_THROW_CHOICE = envFlag('AI_THROW_CHOICE') !== '0';
// 前期单墩接力判断：11~25张也评估；3~10张继续由R3整局推演接管。
const FEAT_TEAM_FOLLOW = envFlag('AI_TEAM_FOLLOW') !== '0';
const FEAT_TEAM_PROTECT = envFlag('AI_TEAM_PROTECT') !== '0';
const FEAT_TEAM_HANDOFF = envFlag('AI_TEAM_HANDOFF') !== '0';
const TEAM_FOLLOW_SAMPLES = 24;

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
   * 启发式 = 选"加权牌力最强"的花色（长门 + 大牌 + 该门 2/王可配合）；
   * normal 难度再用 R7 小样本 rollout 复核（打表实测启发式仅 51% 命中最优
   * 花色、平均每局差 16.7 分）。
   * @param {object} state CHOOSE_TRUMP 阶段
   * @param {number} playerIdx 庄家
   * @returns {string} 'S'|'H'|'C'|'D'
   */
  decideTrumpSuit(state, playerIdx) {
    const suits = ['S', 'H', 'C', 'D'];
    const scores = suits.map((su) => this._trumpSuitScore(state, playerIdx, su));
    let best = suits[0];
    let bestScore = -1;
    suits.forEach((su, i) => { if (scores[i] > bestScore) { bestScore = scores[i]; best = su; } });
    if (FEAT_R7 && this.difficulty !== 'easy') {
      const r7 = this._solveTrumpSuit(state, playerIdx, suits, scores);
      if (r7) return r7;
    }
    return best;
  }

  /** 启发式花色打分（rollout 失败回退 / tie-break 用） */
  _trumpSuitScore(state, playerIdx, su) {
    const hand = state.players[playerIdx].hand;
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
    return sc;
  }

  /* --------------------- R7 选主花色：小样本 rollout 复核 --------------------- */

  /**
   * 选主 rollout（打表实测启发式仅 51% 命中最优、平均差 16.7 分/局）：
   * CHOOSE_TRUMP 态庄家已并底持 33 张（底牌已知），未知=三家 25×3 →
   * 固定种子采样 R7_ROLLOUT 组三家手牌（共同随机数：同组采样评全部 4 花色），
   * 每花色逐组用基线贪心快打到 SCORING，取庄家得分均值 argmax；启发式分
   * 千分位做确定性 tie-break。确定性：固定种子+无时钟截断，bench 可复现。
   * @returns {string|null} 花色；null=异常/账目不平 → 回退启发式
   */
  _solveTrumpSuit(state, dealerIdx, suits, heurScores) {
    try {
      const unseen = this._r7Unseen(state, dealerIdx);
      if (unseen.length !== 3 * 25) return null; // 账目不平（防御）
      const rng = createRng(R7_RNG_SEED);
      const samples = [];
      for (let m = 0; m < R7_ROLLOUTS; m++) {
        const pool = rng.shuffle(unseen);
        samples.push([pool.slice(0, 25), pool.slice(25, 50), pool.slice(50, 75)]);
      }
      let best = null;
      let bestV = -Infinity;
      for (let si = 0; si < suits.length; si++) {
        let sum = 0;
        for (const hands3 of samples) {
          const ss = JSON.parse(JSON.stringify(state));
          let k = 0;
          for (let s = 0; s < 4; s++) {
            if (s === dealerIdx) continue;
            ss.players[s].hand = hands3[k++].slice();
          }
          const pts = this._r7Playout(ss, suits[si], dealerIdx);
          if (pts === null) return null; // 局内异常 → 整体回退启发式
          sum += pts;
        }
        const v = sum / samples.length + heurScores[si] / 1000; // 启发式分千分位 tie-break
        if (v > bestV) { bestV = v; best = suits[si]; }
      }
      return best;
    } catch (e) {
      return null; // 求解器是增强件，异常静默回退
    }
  }

  /** 庄家视角未见牌（全副 − 我 33 张；底牌已并入手，已知不采） */
  _r7Unseen(state, dealerIdx) {
    const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    const cnt = new Map();
    state.players[dealerIdx].hand.forEach((c) => {
      const k = `${c.suit}-${c.rank}`;
      cnt.set(k, (cnt.get(k) || 0) + 1);
    });
    const out = [];
    let uid = 0;
    const push = (n, suit, rank, isJoker) => {
      for (let i = 0; i < n; i++) out.push({ id: `r7${uid++}`, suit, rank, isJoker });
    };
    ['S', 'H', 'C', 'D'].forEach((su) => RANKS.forEach((r) => {
      push(state.config.deckCount - (cnt.get(`${su}-${r}`) || 0), su, r, false);
    }));
    push(state.config.deckCount - (cnt.get('JOKER-BJ') || 0), 'JOKER', 'BJ', true);
    push(state.config.deckCount - (cnt.get('JOKER-RJ') || 0), 'JOKER', 'RJ', true);
    return out;
  }

  /** 从 CHOOSE_TRUMP 态打到 SCORING（埋底=本策略规则、出牌=基线贪心 rollout） */
  _r7Playout(ss, suit, dealerIdx) {
    const { transition } = require('../core/statemachine');
    let st = transition(ss, { type: 'CHOOSE_TRUMP', playerIdx: dealerIdx, suit, ts: 0 });
    let steps = 0;
    while (steps++ < R7_STEP_CAP) {
      if (st.phase === 'SCORING' || st.phase === 'GAME_OVER') {
        return st.lastSettle ? st.lastSettle.dealerPoints : null;
      }
      if (st.phase === 'BURYING') {
        const cards = this.decideBury(st, dealerIdx, null);
        st = transition(st, { type: 'BURY', playerIdx: dealerIdx, cards, ts: 0 });
        continue;
      }
      if (st.phase === 'PLAYING') {
        const mv = this._r3RolloutMove(st, st.turnIdx, { n: 0 }); // 基线贪心（复用 R3）
        st = transition(st, { type: 'PLAY', playerIdx: st.turnIdx, cards: mv, ts: 0 });
        continue;
      }
      return null; // 未知相位（防御）
    }
    return null; // 超步数（防御）
  }

  /* ------------------------- 三打一：报分 ------------------------- */

  /**
   * 三打一报分决策（可反复加价）——英式拍卖：从低往高小步抬价。
   * 首报一律最低档（90，强牌不跳档，防一上来就报高分）；加价每次只抬
   * 最小步长（options[0] = 当前最高 + step），且实打实（估算 ≥ 叫分 + 2）；
   * 估算不足门槛 → 不报（返回 null，由调用方 PASS）。
   * 合同价由多家竞价自然抬出（≈ 次强估价 + 步长），而非直接拍出自己的估价。
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
    //   90% 有人开叫（防弃叫重发拖节奏）；
    //   加价必须实打实（估算≥叫分+2），只有真强牌才抬价
    const opened = (state.bids || []).some((b) => b.type === 'score_bid');
    const floorNeed = options[0] - 15;
    const ok = estimate >= (!opened ? floorNeed : options[0] + 2);
    if (!ok) return null;
    if (rng && this.difficulty === 'easy' && rng.next() < 0.2) return null;
    return options[0];
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
    // R5 末墩精确求解：有真实选择权时替换贪心选择（预算超限/异常静默回退）
    if (ctx && FEAT_R5 && this.difficulty !== 'easy') {
      const r5 = this._solveEndgame(state, playerIdx, ctx);
      if (r5) pick = r5;
    }
    // R3 中盘 PIMC 推演：大分墩/卡点墩的跟牌决策，仅当 rollout 期望值显著
    // 优于贪心选择（τ 阈值，小样本 EV 有噪声、贪心是大量基准校准的先验）
    // 才覆盖（R5 求解位手牌=2 与 R3 门互斥；超预算/异常同样静默回退）
    if (ctx && FEAT_R3 && this.difficulty !== 'easy') {
      const r3 = this._solvePIMC(state, playerIdx, ctx, pick);
      if (r3) pick = r3;
    }
    if (ctx && FEAT_TEAM_FOLLOW && !ctx.sdy.isDealer && !isLead
        && this.difficulty !== 'easy') {
      const teamPick = this._chooseTeamFollow(state, playerIdx, ctx, candidates, pick);
      if (teamPick) pick = teamPick;
    }
    // 铁律：二次校验；失败回退首个候选
    const check = validatePlay(state, playerIdx, pick);
    if (!check.ok) {
      pick = candidates[0];
    }
    return pick;
  }

  /**
   * 前期轻量接力：只模拟本墩后续席位，不模拟整局，不读取真实队友手牌。
   * 同一组公开信息约束的假设分布比较跑分、小垫、最小压庄/最大压庄。
   * 庄家未出时，未接稳的分牌另按失手概率计价，避免 10/K 一味吃喂分加成。
   */
  _chooseTeamFollow(state, playerIdx, ctx, candidates, pick) {
    const trick = state.currentTrick;
    if (!trick || trick.plays.length === 0 || trick.plays.length === 3
        || state.players[playerIdx].hand.length <= 10 || candidates.length < 2
        || !['single', 'pair'].includes(trick.leadCombo.type)) return null;
    if (this._currentWinnerTeam(state, trick, state.trumpInfo, state.config) === 1
        && this._teamLocked(state, playerIdx, ctx, trick)) return null;
    const estimates = this._teamFollowEstimates(state, playerIdx, ctx, candidates, pick);
    if (!estimates || estimates.length < 2) return null;
    const key = (cards) => cards.map((c) => c.id).sort().join('|');
    const current = estimates.find((e) => key(e.cards) === key(pick));
    if (!current) return null;
    const dealerPending = !trick.plays.some((p) => p.playerIdx === ctx.sdy.dealerIdx);
    const winner = this._currentWinnerPlay(state, trick, state.trumpInfo, state.config);
    const winnerDomain = winner && domainOf(winner.cards[0], state.trumpInfo);
    const higher = winner ? this._unseenHigher(ctx.di, winnerDomain,
      this._maxStrength(winner.cards, state.trumpInfo)) : 0;
    const exposedRuff = winnerDomain !== 'TRUMP' && ctx.sdy.voids.dealer.has(trick.leadCombo.suit);
    const utility = (e) => {
      // 顶主/副牌控制牌消耗需计价，不能只为本墩多收一分就拆光后手。
      let cost = 0;
      for (const c of e.cards) {
        const dom = domainOf(c, state.trumpInfo);
        const strength = strengthInDomain(c, state.trumpInfo);
        cost += dom === 'TRUMP' ? 2 + Math.max(0, strength - 914) / 15
          : Math.max(0, strength - 10) * 0.75;
      }
      const exposure = dealerPending ? pointsOf(e.cards, state.config) * (1 - e.teamWin) * 2 : 0;
      return e.signedPoints - cost - exposure;
    };
    let best = current;
    for (const e of estimates) {
      // 单墩评估只覆盖有证据的配合调整，不推翻所有全局控牌先验：
      // ① 庄家未出，当前正准备暴露10/K；② 庄家已出，后位队友高概率接手。
      const protectPoints = FEAT_TEAM_PROTECT && dealerPending && pointsOf(current.cards, state.config) >= 10
        && (higher >= 4 || exposedRuff) && e.teamWin >= current.teamWin - 0.25
        && pointsOf(e.cards, state.config) <= pointsOf(current.cards, state.config);
      const handOff = FEAT_TEAM_HANDOFF && !dealerPending && e.mateWin === 1 && e.teamWin >= current.teamWin;
      if ((protectPoints || handOff) && utility(e) > utility(best) + 1e-9) best = e;
    }
    return best !== current && utility(best) >= utility(current) + (dealerPending ? 4 : 2) ? best.cards : null;
  }

  /** 单墩接力概率（含后位队友接手率），只使用自己手牌、已出牌和各席位缺门。 */
  _teamFollowEstimates(state, playerIdx, ctx, candidates, pick) {
    const ti = state.trumpInfo;
    const cfg = state.config;
    const trick = state.currentTrick;
    const n = trick.leadCombo.n;
    const h = state.players[playerIdx].hand.length;
    const seatVoids = this._r5SeatVoids(state);
    const trumpVoids = this._trumpVoidSeats(state);
    const groups = [];
    for (let seat = 0; seat < 4; seat++) {
      if (seat === playerIdx) continue;
      const voids = new Set(seatVoids[seat]);
      if (trumpVoids[seat]) voids.add('TRUMP');
      groups.push({ seat, size: h - (trick.plays.some((p) => p.playerIdx === seat) ? n : 0), voids });
    }
    // 半跟已出尽该门；跟对子出散牌说明当时没有可跟对子。
    // 按时间倒推补回该家此后公开打出的牌，交给引擎校验每个假设是否可能。
    const later = [[], [], [], []];
    const observations = [];
    for (const t of (state.completedTricks || []).concat([trick]).slice().reverse()) {
      if (!t.leadCombo) continue;
      for (const p of t.plays.slice().reverse()) {
        const groupIdx = groups.findIndex((g) => g.seat === p.playerIdx);
        const followed = p.cards.filter((c) => domainOf(c, ti) === t.leadCombo.suit);
        if (groupIdx >= 0 && p.playerIdx !== t.leadPlayerIdx) {
          if (t.leadCombo.type !== 'eight' && followed.length < t.leadCombo.n) {
            groups[groupIdx].voids.add(t.leadCombo.suit);
          }
          const combo = parseCombo(p.cards, ti, cfg);
          if (t.leadCombo.n > 1 && !(t.leadCombo.type === 'pair'
              && followed.length === 2 && combo && combo.type === 'pair')) {
            observations.push({ groupIdx, seat: p.playerIdx, cards: p.cards,
              leadCombo: t.leadCombo, suffix: p.cards.concat(later[p.playerIdx]) });
          }
        }
        later[p.playerIdx].push(...p.cards);
      }
    }
    const unseen = this._r5UnseenCards(state, playerIdx);
    if (unseen.length !== groups.reduce((sum, g) => sum + g.size, 0) + cfg.bottomCards) return null;
    const { validateFollow } = require('../engine/follow');
    const assignments = this._r5Assignments(unseen, groups, ti,
      TEAM_FOLLOW_SAMPLES * (observations.length ? 4 : 1)).filter((asg) => observations.every((o) => {
      const players = [0, 1, 2, 3].map(() => ({ hand: [] }));
      players[o.seat].hand = asg.hands[o.groupIdx].concat(o.suffix);
      return validateFollow({ players, trumpInfo: ti, currentTrick: { leadCombo: o.leadCombo } },
        o.seat, o.cards, cfg).ok;
    })).slice(0, TEAM_FOLLOW_SAMPLES);
    if (assignments.length === 0) return null;
    const key = (cards) => cards.map((c) => c.id).sort().join('|');
    const evalSet = [];
    const add = (cards) => {
      if (cards && !evalSet.some((e) => key(e) === key(cards))) evalSet.push(cards);
    };
    add(pick);
    const cheap = candidates.slice().sort((a, b) => pointsOf(a, cfg) - pointsOf(b, cfg)
      || this._maxStrength(a, ti) - this._maxStrength(b, ti));
    add(cheap[0]);
    const winning = cheap.filter((cards) => this._wouldWin(state, trick, playerIdx, cards, parseCombo(cards, ti, cfg)))
      .sort((a, b) => this._maxStrength(a, ti) - this._maxStrength(b, ti)
        || pointsOf(a, cfg) - pointsOf(b, cfg));
    // 单/对的合法压牌均保留，尤其是够压庄、但不必烧大王的中间主牌。
    winning.forEach(add);
    add(cheap.slice().sort((a, b) => pointsOf(b, cfg) - pointsOf(a, cfg))[0]);
    const seats = groups.map((g) => g.seat);
    return evalSet.map((cards) => {
      let wins = 0, mateWins = 0, signedPoints = 0;
      for (const asg of assignments) {
        const ss = this._r5SimState(state, ctx, playerIdx, seats, asg, 0);
        this._r5Apply(ss, playerIdx, cards, parseCombo(cards, ti, cfg));
        let seat = this._nextSeat(state, playerIdx);
        while (ss.currentTrick) {
          const legal = legalMoves(ss, seat);
          if (!legal.length) return null;
          // 后续玩家只按其假设手牌及当前公开墩面选牌；不递归调用接力推演。
          let next = legal[0], bestScore = -Infinity;
          for (const c of legal) {
            const score = this._scoreFollow(ss, seat, c, null);
            if (score > bestScore) { bestScore = score; next = c; }
          }
          this._r5Apply(ss, seat, next, parseCombo(next, ti, cfg));
          seat = this._nextSeat(state, seat);
        }
        const result = ss.tricks[0];
        const attackWon = result.winnerIdx !== ctx.sdy.dealerIdx;
        if (attackWon) wins++;
        if (attackWon && result.winnerIdx !== playerIdx) mateWins++;
        signedPoints += result.points * (attackWon ? 1 : -1);
      }
      return { cards, teamWin: wins / assignments.length, mateWin: mateWins / assignments.length,
        signedPoints: signedPoints / assignments.length };
    }).filter(Boolean);
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
    // 八张同点甩：整墩必赢（无人能压），自带分一锅端（8 个 10 = 80 分）——压倒性优先
    if (combo && combo.type === 'eight') return 80 + combo.points * 2;
    const myTeam = this._camp(state, playerIdx);
    const isDealerTeam = myTeam === 0;
    const hand = state.players[playerIdx].hand;
    const trumps = hand.filter((c) => domainOf(c, ti) === 'TRUMP');
    let score = 0;

    // 末墩抠底意识：剩最后一墩（手牌=领出张数）且攻方 → 最大牌
    const isLastTrick = hand.length === cards_.length;
    if (isLastTrick && !isDealerTeam) {
      score += 50 + this._maxStrength(cards_, ti) / 100;
    }

    // 三打一攻方领出：末墩储备——剩墩 ≤5 时别把「剩余牌无敌」的大主领出去送墩，
    // 留着末墩将吃抠底（升级模式无记牌上下文，维持基线）
    if (ctx && !ctx.sdy.isDealer) {
      score -= this._lastTrickReserve(state, playerIdx, cards_, ctx, 0);
      // 配合领出（v4，实测校准）：庄家示缺门的副牌 → 领空牌逼庄烧主
      // （三家主牌总量碾压一家，庄主耗尽即攻方收割；400 局同种子 A/B
      // 对比「避让缺门 58.8% → 逼烧主 43.0% 庄胜率」，方向相反收益巨大）；
      // 领分仍罚——被将吃等于白送庄家分。
      // 缺门空甩张数加成已试删（v6.2 负结果：100 局仅 5 次攻方选甩，
      // 逐张小单逼烧主牌效更优，a-new 无变化）。
      if (!combo.isTrump && ctx.sdy.voids && ctx.sdy.voids.dealer.has(combo.suit)) {
        score += 6 - pointsOf(cards_, cfg) * 1.5;
      }
      // （v6.3 负结果存档：主牌战已输时「大牌走墩」领出加成 +8 实测
      // a-new 40.0→41.8——大牌对子自带 10~20 分进隐性缺门将吃白送庄家，
      // 且挤掉实证 +8.8pp 的逼烧主节奏（烧庄主的将吃额度优于自己走墩）。
      // 大牌的正确用法是留着跟牌反压庄家的控牌领出，不是领出去送检。）
      // R2 甩牌风险管理：legalMoves 经 validateThrow 引擎真值校验，AI 甩牌
      // 永不罚分，唯一败法=缺门家结构将吃整墩夺走（实测 400 局攻方副牌甩牌
      // 36% 被庄家将吃夺墩、全是缺门将吃；但总暴露仅 ~0.25 分/局，整体期望
      // 仍为正——庄家已示缺门的甩牌按上方「领分仍罚」计价已够）。此处只
      // 补隐性缺门：按该门未见牌密度估（3 家共需 3n 张才能全跟），只罚带分
      // 甩牌。主牌域甩牌不可能被将吃（validateThrow 已保证无更大主牌单元）。
      if (FEAT_R2 && combo.type === 'throw' && !combo.isTrump
          && !(ctx.sdy.voids && ctx.sdy.voids.dealer.has(combo.suit))) {
        const ptsT = pointsOf(cards_, cfg);
        const list = ctx.di.byDomain.get(combo.suit);
        const unseenSuit = list ? list.reduce((s, e) => s + e.unseen, 0) : 0;
        const risk = Math.max(0, Math.min(1, 1 - unseenSuit / (3 * combo.n)));
        score -= ptsT * 1.5 * risk;
      }
    }

    if (combo.isTrump) {
      // 主牌领出
      if (trumps.length > hand.length / 2) {
        score += 15; // 主多清主
      }
      if (combo.type === 'tractor') score += 12;
      if (combo.type === 'pair') score += 6;
      if (combo.type === 'pair' && cards_[0].rank === 'BJ') score += 12; // 对大王整对必赢：别拆成两单送墩
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
    const sdy = this._sdyCtx(state, playerIdx);
    // 缺门情报一次扫描出按席位集合，庄家/任意攻方视图由它派生（免二次扫描）
    sdy.voids = this._voidsFromSeats(this._r5SeatVoids(state), sdy.dealerIdx);
    // 主牌战已输侦查（v6.3 满分防守触发器）：我无主 + 两队友都已示主牌
    // 缺门 + 未见主牌 >0（只可能在庄家/底牌处）→ 剩余主牌权全归庄家。
    // 触发即防守（不等 180 分）：抢回每一分，1 分破满分、need 分否决合同。
    const tv = this._trumpVoidSeats(state);
    const myTr = state.players[playerIdx].hand
      .filter((c) => domainOf(c, ti) === 'TRUMP').length;
    const mates = [0, 1, 2, 3].filter((s) => s !== playerIdx && s !== sdy.dealerIdx);
    const unseenTr = (di.byDomain.get('TRUMP') || []).reduce((s, e) => s + e.unseen, 0);
    sdy.trumpWatch = FEAT_SWEEP && !sdy.isDealer && myTr === 0 && unseenTr > 0
      && mates.every((s) => tv[s]);
    return { mem, di, sdy };
  }

  /**
   * 已示主牌缺门（终身有效）：主牌领出墩上一张主都没跟 = 主牌缺门。
   * 与 _r5SeatVoids 的「整墩同门才算跟」判定不同：主牌墩只要含任意主牌
   * 即非缺门（半跟=手里有主），避开部分跟误判；独立成集不进 R3/R5 采样。
   */
  _trumpVoidSeats(state) {
    const ti = state.trumpInfo;
    const res = [false, false, false, false];
    (state.completedTricks || []).forEach((t) => {
      if (!t.leadCombo || !t.leadCombo.isTrump) return;
      t.plays.forEach((p) => {
        if (!p.cards.some((c) => domainOf(c, ti) === 'TRUMP')) res[p.playerIdx] = true;
      });
    });
    return res;
  }

  /**
   * 按席位缺门集 → 庄家/任意攻方两个聚合视图。
   * 缺门信息一经示出终身有效（三打一配合核心情报，见 _r5SeatVoids）。
   * @returns {{dealer:Set<string>, others:Set<string>}} 庄家缺门 / 任意攻方缺门
   */
  _voidsFromSeats(seatVoids, dealerIdx) {
    const res = { dealer: seatVoids[dealerIdx], others: new Set() };
    for (let s = 0; s < seatVoids.length; s++) {
      if (s !== dealerIdx) seatVoids[s].forEach((v) => res.others.add(v));
    }
    return res;
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
   * 末墩储备惩罚（三打一攻方）：底分归末墩赢家 ×1，庄家埋底几乎必埋分，
   * 攻方要为末墩留住「剩余未见牌中无敌」的大主。剩墩 ≤5 且候选动了这张资本：
   * 罚 = (期望底分 - 墩内可得) × 接近度（剩 2 墩 4/5、剩 3 墩 3/5、剩 5 墩 1/5）；
   * 末墩本身不罚（该用就用），墩分 ≥ 期望底分不罚（稳赚不亏）。
   * 实测（400 局同种子 A/B，攻方新 AI vs 庄家 baseline）：
   *   攻抠底率 36.0% → 38.0%，庄守底率 64.0% → 62.0%，
   *   庄胜率 51.2% → 50.0%（攻方变强的合理代价）。
   */
  _lastTrickReserve(state, playerIdx, cards_, ctx, trickValue) {
    if (!ctx) return 0;
    const ti = state.trumpInfo;
    const hand = state.players[playerIdx].hand;
    const tricksLeft = hand.length / cards_.length;
    if (tricksLeft > 5 || tricksLeft <= 1) return 0;
    const { di } = ctx;
    const hitsReserve = cards_.some((c) => domainOf(c, ti) === 'TRUMP'
      && this._unseenHigher(di, 'TRUMP', strengthInDomain(c, ti)) <= 1);
    if (!hitsReserve) return 0;
    return Math.max(0, BOTTOM_POINTS_EXP - trickValue) * (6 - tricksLeft) / 5;
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
    // 八张同点甩：整墩必赢 + 自带分收走 + 逼三家跟对（跟牌对子分也进囊中）
    if (combo.type === 'eight') return 80 + combo.points * 2;
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
      if (combo.type === 'pair' && cards_[0].rank === 'BJ') score += 12; // 对大王整对必赢：别拆成两单送墩
      // 顶主守底（v4，替代旧「单大王控场 +8」）：领出单大王/顶级主，
      // 攻方压不过只会全垫小牌——白墩一张，得分≈0，还失去后手压制与
      // 末墩守底/抠底资本。非末墩领出「剩余牌无敌」顶主按底分罚；
      // 末墩本身不罚（该抠底就抠底）。
      // 注：曾试 R1「差≤20 分就解除囤顶主罚」（近败局直觉：顶主=成庄手段），
      // 实测 d-new 54.3%→50.0%（−4.3pp）——庄家提前烧顶主后攻方垫空牌，
      // 控制与底分双失，囤主罚不能动。
      const tricksLeft = hand.length / cards_.length;
      if (tricksLeft > 1 && this._unseenHigher(di, 'TRUMP', combo.units[0].strength) === 0) {
        const bp = (state.bottomCards || []).reduce((s2, c) => s2 + pointValue(c, cfg), 0);
        score -= (8 + Math.min(16, bp / 2)) * (tricksLeft >= 4 ? 1 : 0.6);
      }
      score += strength / 200; // 同型先出大主（小主清主仍可选）
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
        // 拆对罚（v6 AI_PAIR）：清场甩牌收割靠对子结构，小单优先领真散单
        if (FEAT_PAIR && hand.some((h) => h !== cards_[0] && h.suit === cards_[0].suit && h.rank === cards_[0].rank)) {
          score -= 3;
        }
      }
      // 攻方已示缺门 → 该门领出易被将吃/白送，轻罚
      if (ctx.sdy.voids && ctx.sdy.voids.others.has(combo.suit)) score -= 4;
      score -= pointsOf(cards_, cfg) / 2; // 不送分
    }
    return score;
  }

  /**
   * 三打一跟牌打分（v4，基准实测校准）：
   * 攻方 = 贪心基线 + 团队配合：
   *   锁墩（庄家夺不走的墩）→ 全力喂分、垫废牌、绝不超压队友——
   *   攻分是三家团队总分，谁赢墩无所谓（_teamLocked）；
   *   队友领先未锁墩时 0 分超压小罚（赢牌留着防庄家）；R6 让路——
   *   队友在压王/2 级主（≥950）时超压重罚（烧顶级主抢已近乎到手的墩）；
   *   末墩储备——剩 ≤5 墩不把「剩余牌无敌」大主花在小分墩（_lastTrickReserve）；
   * 庄家 = 合同意识版：有分墩锁墩但省力（记牌器稳赢时最小稳赢即可），
   *   白墩仍最小赢；输墩绝不送分。
   */
  _scoreFollowSdy(state, playerIdx, cards_, ctx) {
    const cfg = state.config;
    const ti = state.trumpInfo;
    const trick = state.currentTrick;
    const lead = trick.leadCombo;
    const { sdy, di } = ctx;
    const hand = state.players[playerIdx].hand;
    const combo = parseCombo(cards_, ti, cfg);
    const pts = pointsOf(cards_, cfg);
    const trickPts = trick.plays.reduce((s, p) => s + pointsOf(p.cards, cfg), 0);
    const isLast = trick.plays.length === 3;
    const strength = this._maxStrength(cards_, ti);
    const canWin = this._wouldWin(state, trick, playerIdx, cards_, combo);
    const curWinnerTeam = this._currentWinnerTeam(state, trick, ti, cfg);
    const teamWinning = curWinnerTeam === this._camp(state, playerIdx);
    const allTrump = cards_.every((c) => domainOf(c, ti) === 'TRUMP');
    // 满分破光（AI_SWEEP，v6.3 触发重设计）：
    //   ① 主牌战已输（trumpWatch）：三家主牌耗尽、庄家仍持主——满分在望，
    //      此刻即防守，不等 180 分：抢回每一分（1 分破满分、need 分否决合同）。
    //   ② 庄家已成庄且 ≥180 分（攻方 ≤20）：终局抢分模式，拿一分即破光
    //      （app.js 满分坐庄全网榜计数）。
    // 两种触发下抢分都优先于省牌：豁免主牌经济/末墩储备罚，垫分加倍罚。
    const sweep = FEAT_SWEEP
      && ((sdy.need <= 0 && sdy.dealerPts >= 180) || sdy.trumpWatch);
    let score = 0;

    if (sdy.isDealer) {
      // R1D 合同意识（庄家侧）：落后时的「成庄墩」——赢下这墩即跨过
      // 合同线。阶跃胜负制下这一墩的边际价值=整场胜负（400 局实测：
      // need≤墩分时刻 121 次，庄家仅 42% 真赢下该墩）。
      const seal = FEAT_R1D && sdy.need > 0 && trickPts + pts >= sdy.need;
      if (canWin) {
        if (isLast) {
          score += 30 + pts * 2 + trickPts; // 末家稳收：连自己分一起算
        } else if (trickPts + pts >= 10) {
          // 有分墩：锁墩但省力——记牌器稳赢（剩余牌无更大）时最小稳赢即可，
          // 未必稳赢才上大牌防身后攻方压过（大牌留着换后面的分）
          score += 24 + Math.min(pts, 10) + trickPts / 2;
          if (this._isSureCombo(combo, di)) score += 6 - strength / 150; // 后手也压不过
          else score += strength / 150; // 有被压风险 → 大牌锁墩
        } else {
          score += 20 - strength / 100; // 白墩最小赢（庄家将吃抢节奏，不罚）
        }
        if (seal) {
          // 成庄墩：非末家还要防身后攻方超压——稳赢组合确定性大幅上调，
          // 未必稳赢就直接上最大牌（这一墩丢了=后面全白搭）
          score += 10;
          if (!isLast) score += this._isSureCombo(combo, di) ? 8 : strength / 80;
        }
      } else {
        if (allTrump) score -= 20; // 输墩浪费主牌
        score -= pts; // 输墩绝不送分
        if (sweep) score -= pts * 2; // 破光期：垫分=亲手送庄家满分榜
        score += (20 - strength) / 20 * 6 + this._discardKeep(cards_, hand, ti, ctx); // 垫最小（+结构保护）
      }
    } else {
      // 攻方：贪心基线 + 团队配合（v4）
      // R1A 卡点防守（攻方侧）：庄家 need ≤ 墩内潜在分 → 这墩若归庄即
      // 成庄，攻方夺墩=直接否决合同（阶跃胜负制，95 场/400 局胜负差
      // ≤15 分）。否决价值高于末墩抠底期望与省牌 → 豁免储备/经济罚、
      // 全力夺墩；垫分重罚（分进庄家兜里）。庄家已出且未在压 → 墩已
      // 否决，无需烧资本。
      const dealerPlayed = trick.plays.some((p) => p.playerIdx === sdy.dealerIdx);
      const deny = FEAT_R1A && sdy.need > 0 && trickPts + pts >= sdy.need
        && (!dealerPlayed || curWinnerTeam === 0);
      // 锁墩：这墩已稳进我方（庄家出过且队友在压；或庄家未出但队友顶主
      // 且剩余牌无更大主）→ 归属与我出什么无关
      const lock = teamWinning && this._teamLocked(state, playerIdx, ctx, trick);
      if (lock) {
        // 配合核心：三打一攻分是团队总分，谁赢墩无所谓——全力喂分、
        // 垫最废牌；绝不超压队友（赢牌留着对付庄家），(20-strength) 项
        // 天然压制烧主牌（主留着后手将吃/末墩抠底）
        score += pts * 4 + (20 - strength) / 20 * 6 + this._discardKeep(cards_, hand, ti, ctx);
      } else if (canWin) {
        if (isLast) {
          score += 30 + pts * 2 + trickPts;
        } else {
          score += 20 - strength / 100 + Math.min(pts, 10);
          if (teamWinning && trickPts >= TRUMP_IN_THRESHOLD) score += 8;
          // 队友领先但未锁墩：0 分超压小罚——我的赢牌留着防庄家更有价值
          if (teamWinning && pts === 0) score -= 6;
          // [R12 负结果归档] 非无敌副牌不超压队友（K 压队友 J 而 A 在暗处）：
          // 单开 a-new 37.5→37.0 有效、探针风险超压 89→42 减半，但与
          // FEEDRISK 叠加攻方在未锁墩上全面不敢接盘（严苛版合体 38.3、
          // 软化版合体 37.0，均劣于 FEEDRISK 单开 36.0）——已回退勿再叠。
          // R6 高主让路（走到这分支时庄家必未出，否则已锁墩）：队友在压的
          // 是王/2 级主（强度 ≥950）——能反压的只剩更大的王，大概率不在庄家
          // 手里；超压=再烧一张顶级主去抢一个已近乎到手的墩（攻分是团队
          // 总分，谁赢墩无所谓），留给对付庄家更有价值
          if (FEAT_R6B && teamWinning && !dealerPlayed
              && this._mateTopTrump(state, trick, ti, cfg)) score -= 12;
        }
        score += trickPts / 2 + pts; // 攻方收分意识
        // 破光期：墩内每一分都是庄家满分榜的丧钟，抢分优先于省牌
        if (sweep) score += trickPts * 2 + pts;
        if (deny) score += 10 + Math.min(sdy.need, 15);
        // 末墩储备：剩墩 ≤5 时，花无敌大主只赢回小分 → 罚，留着抠底
        // （deny/sweep 时豁免——否决成庄、破光 > 抠底期望）
        if (!deny && !sweep) score -= this._lastTrickReserve(state, playerIdx, cards_, ctx, trickPts + pts);
        // 主牌经济：赢墩要花主牌时按墩内分值「付费」——
        // 无分墩不烧主（主牌留着后手将吃大分墩），小分墩少烧（deny/sweep 豁免）
        if (!deny && !sweep) {
          if (allTrump && !lead.isTrump) {
            score -= Math.max(0, 18 - trickPts - pts);
          } else if (allTrump && lead.isTrump && !isLast && trickPts + pts < 10) {
            // 庄家清主小分墩：能输就输，留大主后手夺分
            score -= Math.max(0, 16 - trickPts - pts);
          }
        }
      } else {
        // 缺门垫主 = 纯浪费（跟主牌领出被迫出主不算）
        if (allTrump && !lead.isTrump) score -= 20;
        if (teamWinning) {
          // R12 喂分风险折减（走到本分支庄家必未出）：仅压「队友在压牌真的很
          // 弱」的极端情形（暗处比它大的 ≥4 张：如全门未出 J 在压，Q/K/A×2
          // =6 张暗牌，喂 10 ≈ 白送）；≤3 张视为正常试探全额喂。庄家已示
          // 缺门的副牌墩=将吃口，分牌折到两成（R0c 逼烧主的墩只送空牌）。
          // 调参档案：无门槛 hi*0.3 全折版单开 37.0、与超压罚合体 38.3
          //（vs HEAD 37.5）双双否；本版（≥4 起折、地板 0.1）单开 36.0 落地。
          let feedF = 1;
          if (FEAT_FEEDRISK) {
            const wp = this._currentWinnerPlay(state, trick, ti, cfg);
            if (wp) {
              const wpTrump = wp.cards.every((c) => domainOf(c, ti) === 'TRUMP');
              const hi = this._unseenHigher(
                di, wpTrump ? 'TRUMP' : lead.suit, this._maxStrength(wp.cards, ti));
              feedF = Math.max(0.1, 1 - Math.max(0, hi - 3) * 0.3);
              if (!wpTrump && ctx.sdy.voids && ctx.sdy.voids.dealer.has(lead.suit)) feedF = 0.2;
            }
          }
          score += pts * 1.5 * feedF; // 折减后的喂分试探
        } else {
          score -= pts; // 庄家在压 → 绝不送分
        }
        if (deny) score -= pts * 2; // 垫分=亲手送庄家跨合同线
        if (sweep) score -= pts * 2; // 破光期垫分=送庄家满分榜
        score += (20 - strength) / 20 * 6 + this._discardKeep(cards_, hand, ti, ctx);
      }
    }
    return score;
  }

  /**
   * 墩是否已锁进攻方（庄家无论如何夺不走）。前提：当前最大是队友。
   * 庄家已出且在压 → 必锁；庄家未出 → 仅当队友赢牌是主牌且剩余牌无
   * 更大主（主牌赢牌无从被将吃，只怕更大主）。副牌赢牌不算锁：庄家
   * 可能有未示出的缺门将吃偷墩——缺门情报只知已暴露的，安全侧不赌。
   */
  _teamLocked(state, playerIdx, ctx, trick) {
    const ti = state.trumpInfo;
    const cfg = state.config;
    const { sdy, di } = ctx;
    if (trick.plays.some((p) => p.playerIdx === sdy.dealerIdx)) return true;
    const wp = this._currentWinnerPlay(state, trick, ti, cfg);
    if (!wp) return false;
    if (!wp.cards.every((c) => domainOf(c, ti) === 'TRUMP')) return false;
    return this._unseenHigher(di, 'TRUMP', this._maxStrength(wp.cards, ti)) === 0;
  }

  /** 墩内当前在压的牌是否王/2 级顶级主（强度 ≥950：BJ/RJ/主2/副2；主花色 A 顶格 914 不算） */
  _mateTopTrump(state, trick, ti, cfg) {
    const wp = this._currentWinnerPlay(state, trick, ti, cfg);
    if (!wp) return false;
    return wp.cards.every((c) => domainOf(c, ti) === 'TRUMP')
      && this._maxStrength(wp.cards, ti) >= 950;
  }

  /**
   * 垫牌结构保护（v6.1 AI_PAIR 庄家侧 + v6.3 SWEEP 攻方主牌战已输）：
   *   - 庄家（PAIR）：拆对罚 4（清场甩牌收割靠对子结构，足以让「拆小对」
   *     劣于「垫 JQKA 大单」）+ JQKA 大单保护 1.2（控制牌）。
   *   - 攻方（SWEEP，仅 trumpWatch 触发时）：副牌「剩余牌无敌」大牌
   *     垫牌罚 8——主牌战已输后这是唯一能走墩抢分的资产（庄家领非
   *     最大牌时反压赢墩、队友喂分），庄家已示缺门的死牌除外。
   * 攻方普遍保结构已试尽删（2026-10-28 负结果存档）：普遍保对 −2pp、
   * 缺门大户养甩结构 −1.5pp、缺门空甩张数加成无效——保对的机会成本
   * 立即支付而兑现时刻近乎不存在；v6.3 的差别=只在主牌战已输（可观测
   * 局势事实）且只保可证走墩的单张大牌，非终局不启用。
   * 只动垫牌选项间的相对序，不动绝对量级（2026-10-28 教训：跨分支绝对
   * 值是「能赢就赢」强行为的隐形实现，实测勿碰）。
   */
  _discardKeep(cards_, hand, ti, ctx) {
    const isDealer = ctx && ctx.sdy.isDealer;
    // 攻方主牌战已输（trumpWatch）：垫牌别垫「剩余牌无敌」的副牌大牌
    // （庄家已示缺门=死门除外，被将吃救不回）——那是唯一还能走墩抢分
    // 的资产（seed 374 墩16 把 D/C 两门 A 当垃圾垫掉即典型失误）：庄家
    // 领非最大牌时反压赢墩、队友喂分入袋；垫掉=亲手拆自己的桥。
    const sweepKeep = FEAT_SWEEP && ctx && !isDealer && ctx.sdy.trumpWatch;
    if (!FEAT_PAIR && !sweepKeep) return 0;
    if (isDealer) {
      if (!FEAT_PAIR) return 0;
      let s = 0;
      cards_.forEach((c) => {
        const mate = hand.some((h) => h !== c && h.suit === c.suit && h.rank === c.rank);
        const bigSingle = !c.isJoker && c.rank !== ti.levelRank && !mate && rankNum(c) >= 11;
        if (mate) s -= 4;
        else if (bigSingle) s -= 1.2;
      });
      return s;
    }
    let s = 0;
    cards_.forEach((c) => {
      const dom = domainOf(c, ti);
      if (dom !== 'TRUMP'
          && !(ctx.sdy.voids && ctx.sdy.voids.dealer.has(dom))
          && this._unseenHigher(ctx.di, dom, strengthInDomain(c, ti)) === 0) {
        s -= 8;
      }
    });
    return s;
  }

  /* --------------------- R5 残局精确求解（末两墩） --------------------- */

  /**
   * 残局精确求解（剩 ≤2 墩，即手牌 ≤2 张）：枚举/采样未见牌分布 →
   * 每个候选出牌按「庄家方最大化、攻方最小化 V=庄家终局分−合同分」的
   * 完全信息 minimax（α-β 剪枝）求值到全场打空，取期望 V 最优。
   * 价值集中在末墩底分归属（末墩赢家整包收底）与合同卡点（胜负本身）。
   * 选择权只在「手牌>本墩张数」（跟牌留牌）或「领出可拆/可整」（拆单
   * vs 整对）时存在；手牌=本墩张数时合法出牌唯一，自动跳过。
   * 确定性保证：分布按牌序全枚举（超上限改固定种子采样）、候选次序稳定、
   * 节点超限整体回退贪心（不按时钟截断）→ bench 同种子可复现。
   * PIMC 通病（对手知情过强）在只剩两墩时影响有限，接受。
   * @returns {Array<object>|null} 最优出牌；null=不适用/超预算，走贪心
   */
  _solveEndgame(state, playerIdx, ctx) {
    try {
      const cfg = state.config;
      const ti = state.trumpInfo;
      const trick = state.currentTrick;
      const h = state.players[playerIdx].hand.length;
      if (h !== 2) return null; // v1 范围：手牌恰 2 张（≤2 墩）

      // 胜负已定则不求解：need≤0 庄家已成（庄分只增不减）；
      // need > 未见牌总分数 = 数学上追不上（未见分含底牌，攻方视角保守）
      const need = ctx.sdy.need;
      const mem = ctx.mem;
      const unseenPts = mem.totalPoints - mem.pointsPlayed - mem.pointsInHand;
      if (need <= 0 || need > unseenPts) return null;

      const rootCands = legalMoves(state, playerIdx);
      if (rootCands.length <= 1) return null; // 无选择权（如跟牌且手牌=本墩张数）

      const isLead = !trick || trick.plays.length === 0;
      const isDealerView = playerIdx === ctx.sdy.dealerIdx;

      // 各对手剩余手牌张数（墩内已出者少 n 张——手牌按墩同步缩减）
      const n = isLead ? null : trick.leadCombo.n;
      const groups = [];
      for (let s = 0; s < 4; s++) {
        if (s === playerIdx) continue;
        const playedIn = !isLead && trick.plays.some((p) => p.playerIdx === s);
        groups.push({ seat: s, size: h - (playedIn ? n : 0), voids: null });
      }
      const seatVoids = this._r5SeatVoids(state);
      groups.forEach((g) => { g.voids = seatVoids[g.seat]; });

      // 未见牌（我视角）：全副 − 已出 − 我手牌；庄家再剔除真底牌
      const unseen = this._r5UnseenCards(state, playerIdx);
      const needCnt = groups.reduce((s, g) => s + g.size, 0) + (isDealerView ? 0 : cfg.bottomCards);
      if (unseen.length !== needCnt) return null; // 账目不平（防御），不求解
      // （R4 先验只喂 R3：h=2 池太小实测加权反而失真 40.0→40.3，勿接到此处）

      const assignments = this._r5Assignments(unseen, groups, ti);
      if (assignments.length === 0) return null;

      const bottomPtsReal = (state.bottomCards || []).reduce((s, c) => s + pointValue(c, cfg), 0);
      const seats = groups.map((g) => g.seat);
      const rootPruned = this._r5Prune(state, playerIdx, rootCands, isLead ? null : trick, R5_K_ROOT);
      const budget = { n: 0 };
      const maximize = isDealerView;
      let best = null;
      let bestV = maximize ? -Infinity : Infinity;
      for (const cards of rootPruned) {
        const combo = parseCombo(cards, ti, cfg);
        let sum = 0;
        for (const asg of assignments) {
          const ss = this._r5SimState(state, ctx, playerIdx, seats, asg,
            isDealerView ? bottomPtsReal
              : asg.bottom.reduce((s, c) => s + pointValue(c, cfg), 0));
          this._r5Apply(ss, playerIdx, cards, combo);
          let next;
          if (ss.currentTrick) next = this._nextSeat(ss, playerIdx);
          else next = ss.tricks[ss.tricks.length - 1].winnerIdx;
          sum += this._r5Search(ss, next, budget, -Infinity, Infinity);
        }
        const ev = sum / assignments.length;
        if (maximize ? ev > bestV + 1e-9 : ev < bestV - 1e-9) {
          bestV = ev;
          best = cards;
        }
      }
      return best;
    } catch (e) {
      if (e && e.r5Abort) return null; // 节点超限 → 回退贪心
      return null; // 其余异常同样静默回退（求解器是增强件，不挡出牌）
    }
  }

  /**
   * 我视角的未见牌列表（合成 Card：id 唯一即可，引擎只用 suit/rank/isJoker）。
   * 庄家额外剔除真底牌（底牌不在任何手牌里，也永不入局）。
   */
  _r5UnseenCards(state, viewerIdx) {
    const mem = buildMemory(state, viewerIdx);
    const unseen = [];
    let uid = 0;
    const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    const push = (n, suit, rank, isJoker) => {
      for (let i = 0; i < n; i++) unseen.push({ id: `u${uid++}`, suit, rank, isJoker });
    };
    ['S', 'H', 'C', 'D'].forEach((su) => RANKS.forEach((r) => {
      push(mem.remainingOfKey(`${su}-${r}`), su, r, false);
    }));
    push(mem.remainingOfKey('JOKER-BJ'), 'JOKER', 'BJ', true);
    push(mem.remainingOfKey('JOKER-RJ'), 'JOKER', 'RJ', true);
    const dealerIdx = state.sanDaYiTeams ? state.sanDaYiTeams.dealer : state.dealerIdx;
    if (viewerIdx === dealerIdx && Array.isArray(state.bottomCards) && state.bottomCards.length) {
      const drop = new Map();
      state.bottomCards.forEach((c) => {
        const k = `${c.suit}-${c.rank}`;
        drop.set(k, (drop.get(k) || 0) + 1);
      });
      const kept = [];
      for (const c of unseen) {
        const k = `${c.suit}-${c.rank}`;
        const d = drop.get(k) || 0;
        if (d > 0) drop.set(k, d - 1);
        else kept.push(c);
      }
      return kept;
    }
    return unseen;
  }

  /** 按席位的已示缺门（缺门情报一经示出终身有效；分配假设不得违反） */
  _r5SeatVoids(state) {
    const ti = state.trumpInfo;
    const res = [new Set(), new Set(), new Set(), new Set()];
    (state.completedTricks || []).forEach((t) => {
      if (!t.leadCombo || t.leadCombo.isTrump) return;
      const dom = t.leadCombo.suit;
      t.plays.forEach((p) => {
        // 零张该门才算缺门：跟甩牌半跟（给出部分该门牌+垫牌）说明手里
        // 还有该门——按「整墩同门才算跟」会把半跟者误标缺门（2026-10-28
        // 修复，此前误判令逼烧主打空门、R3/R5 采样排除真持牌分配）。
        const hasDom = p.cards.some((c) => domainOf(c, ti) === dom);
        if (!hasDom) res[p.playerIdx].add(dom);
      });
    });
    return res;
  }

  /**
   * 未见牌 → (各席位按其剩余张数) + (攻方视角余下=假设底牌) 的分布集合。
   * 组合数 ≤ 上限全枚举（带缺门剪枝），否则固定种子采样（拒绝缺门冲突）。
   * 枚举同时受节点预算约束：缺门剪枝可让深层组几乎填不满 → 结果数长期不涨、
   * 上限永不触发，组合树裸搜（实测 R3 尺寸池 35 张时单次 222s）——超节点
   * 预算即视为溢出转采样。sampleNOverride 给定时跳过枚举直接采样（R3 大池
   * 池枚举必溢出，纯浪费）。
   */
  _r5Assignments(unseen, groups, ti, sampleNOverride, weightSpec) {
    const enumCap = R5_ENUM_CAP;
    const sampleN = sampleNOverride || R5_SAMPLE_N;
    const ok = (c, g) => !g.voids.has(domainOf(c, ti));
    const out = [];
    let overflow = false;
    // 全枚举：按组递归，组内组合选取（chosen 引用比较足够：pool 无重复对象）
    const rec = (gi, pool, acc) => {
      if (overflow) return;
      if (out.length > enumCap) { overflow = true; return; }
      if (gi === groups.length) {
        out.push({ hands: acc.slice(), bottom: pool.slice() });
        return;
      }
      const g = groups[gi];
      const comboRec = (start, chosen) => {
        if (overflow) return;
        if (chosen.length === g.size) {
          const chosenSet = new Set(chosen);
          const restPool = pool.filter((c) => !chosenSet.has(c));
          acc.push(chosen.slice());
          rec(gi + 1, restPool, acc);
          acc.pop();
          return;
        }
        for (let i = start; i < pool.length; i++) {
          if (++enumNodes > R5_ENUM_NODE_CAP) { overflow = true; return; } // 防裸搜
          if (!ok(pool[i], g)) continue;
          chosen.push(pool[i]);
          comboRec(i + 1, chosen);
          chosen.pop();
        }
      };
      comboRec(0, []);
    };
    let enumNodes = 0;
    if (!sampleNOverride) rec(0, unseen, []);
    else overflow = true; // 显式采样模式（R3 大池）：跳过枚举
    if (!overflow) return out;
    // 采样：固定种子洗牌后按序给各组取不冲突的牌，剩余即假设底牌。
    // weightSpec（R4）时超采 3× 按「庄家持主数偏离目标」重要性排序取前 N。
    out.length = 0;
    const rng = createRng(R5_RNG_SEED);
    const wantN = sampleN * (weightSpec ? 3 : 1);
    for (let t = 0; t < wantN * 4 && out.length < wantN; t++) {
      const pool = rng.shuffle(unseen);
      const taken = new Set();
      const hands = [];
      let fail = false;
      for (const g of groups) {
        const take = [];
        for (const c of pool) {
          if (take.length >= g.size) break;
          if (taken.has(c.id) || !ok(c, g)) continue;
          taken.add(c.id);
          take.push(c);
        }
        if (take.length < g.size) { fail = true; break; }
        hands.push(take);
      }
      if (fail) continue;
      out.push({ hands, bottom: pool.filter((c) => !taken.has(c.id)) });
    }
    if (weightSpec && out.length > sampleN) {
      const scored = out.map((asg, i) => {
        const dT = asg.hands[weightSpec.groupIdx]
          .filter((c) => domainOf(c, ti) === 'TRUMP').length;
        return { asg, key: -Math.abs(dT - weightSpec.target), i };
      });
      scored.sort((a, b) => b.key - a.key || a.i - b.i);
      return scored.slice(0, sampleN).map((e) => e.asg);
    }
    return out;
  }

  /** 轻量模拟态：只含引擎校验/结算所需字段，手牌=假设分布 */
  _r5SimState(state, ctx, myIdx, remainingSeats, asg, bottomPts) {
    const players = [0, 1, 2, 3].map(() => ({ hand: [] }));
    players[myIdx].hand = state.players[myIdx].hand.slice();
    asg.hands.forEach((cards, k) => { players[remainingSeats[k]].hand = cards.slice(); });
    const cur = state.currentTrick;
    return {
      config: state.config,
      trumpInfo: state.trumpInfo,
      playOrder: state.playOrder ? state.playOrder.slice()
        : (state.config.playDirection === 'clockwise' ? [0, 3, 2, 1] : [0, 1, 2, 3]),
      players,
      currentTrick: cur ? {
        leadPlayerIdx: cur.leadPlayerIdx,
        leadCombo: cur.leadCombo,
        plays: cur.plays.map((p) => ({
          playerIdx: p.playerIdx, cards: p.cards, combo: p.combo,
          isDiscard: false, isEffectiveTrump: false
        }))
      } : null,
      tricks: [],
      dealerIdx: ctx.sdy.dealerIdx,
      sanDaYiTeams: state.sanDaYiTeams || null, // rollout 贪心打分需判阵营
      bankDealerPts: ctx.sdy.dealerPts,
      bottomPts,
      contractScore: state.contractScore
    };
  }

  /** 模拟态上出一手牌（应用；返回撤销函数）。墩满即结算，轮到赢家。 */
  _r5Apply(ss, seat, cards, combo) {
    const hand = ss.players[seat].hand;
    const ids = new Set(cards.map((c) => c.id));
    const removed = [];
    for (let i = hand.length - 1; i >= 0; i--) {
      if (ids.has(hand[i].id)) removed.push(hand.splice(i, 1)[0]);
    }
    const wasLead = !ss.currentTrick;
    if (wasLead) ss.currentTrick = { leadPlayerIdx: seat, leadCombo: combo, plays: [] };
    const play = { playerIdx: seat, cards, combo, isDiscard: false, isEffectiveTrump: false };
    ss.currentTrick.plays.push(play);
    let snapshot = null;
    let done = null;
    if (ss.currentTrick.plays.length === 4) {
      snapshot = ss.currentTrick;
      const { resolveTrick } = require('../engine/trick');
      resolveTrick(ss.currentTrick, ss.trumpInfo, ss.config);
      done = { winnerIdx: snapshot.winnerIdx, points: snapshot.points };
      ss.tricks.push(done);
      ss.currentTrick = null;
    }
    return () => { // 撤销（resolveTrick 残留的 winnerIdx/points 会被下次结算覆盖）
      if (done) {
        ss.tricks.pop();
        ss.currentTrick = snapshot;
      }
      const idx = ss.currentTrick.plays.indexOf(play);
      if (idx >= 0) ss.currentTrick.plays.splice(idx, 1);
      if (wasLead && ss.currentTrick.plays.length === 0) ss.currentTrick = null;
      for (const c of removed) hand.push(c);
    };
  }

  /**
   * 完全信息 minimax（fail-soft α-β）：庄家席位最大化、攻方席位最小化
   * V=庄家终局分−合同分。终局=手牌全空：庄家得分=已入账+模拟墩分+末墩赢家收底。
   */
  _r5Search(ss, toAct, budget, alpha, beta) {
    budget.n++;
    if (budget.n > R5_NODE_CAP) throw { r5Abort: true };
    if (ss.players[toAct].hand.length === 0 && !ss.currentTrick) {
      return this._r5TerminalOf(ss);
    }
    const cands = legalMoves(ss, toAct);
    if (cands.length === 0) throw { r5Abort: true }; // 模拟异常，整体回退
    const pruned = this._r5Prune(ss, toAct, cands, ss.currentTrick, R5_K_NODE);
    const maximize = toAct === ss.dealerIdx;
    let best = maximize ? -Infinity : Infinity;
    for (const cards of pruned) {
      const combo = parseCombo(cards, ss.trumpInfo, ss.config);
      const undo = this._r5Apply(ss, toAct, cards, combo);
      let next;
      if (ss.currentTrick) next = this._nextSeat(ss, toAct);
      else next = ss.tricks[ss.tricks.length - 1].winnerIdx;
      const v = this._r5Search(ss, next, budget, alpha, beta);
      undo();
      if (maximize) {
        if (v > best) best = v;
        if (best >= beta) break; // 剪枝
        if (best > alpha) alpha = best;
      } else {
        if (v < best) best = v;
        if (best <= alpha) break; // 剪枝
        if (best < beta) beta = best;
      }
    }
    return best;
  }

  _r5TerminalOf(ss) {
    let dPts = ss.bankDealerPts;
    for (const t of ss.tricks) if (t.winnerIdx === ss.dealerIdx) dPts += t.points;
    const last = ss.tricks[ss.tricks.length - 1];
    if (last && last.winnerIdx === ss.dealerIdx) dPts += ss.bottomPts;
    return dPts - ss.contractScore;
  }

  /**
   * 候选战术剪枝：跟牌按（能否赢墩、吃分、省牌力），领出按（分、大牌、结构）
   * 排序取前 K；始终保留引擎首候选（防御性兜底）。
   */
  _r5Prune(stateOrSs, seat, cands, trick, k) {
    const cfg = stateOrSs.config;
    const ti = stateOrSs.trumpInfo;
    const keyed = cands.map((cards, i) => {
      const pts = pointsOf(cards, cfg);
      const strength = this._maxStrength(cards, ti);
      let key;
      if (trick) {
        const trickPts = trick.plays.reduce((s, p) => s + pointsOf(p.cards, cfg), 0);
        const combo = parseCombo(cards, ti, cfg);
        const canWin = this._wouldWin(stateOrSs, trick, seat, cards, combo) ? 100 : 0;
        key = canWin + pts * 2 + trickPts * 0.5 - strength / 50;
      } else {
        const combo = parseCombo(cards, ti, cfg);
        key = pts * 2 + strength / 300
          + (combo && (combo.type === 'pair') ? 4 : 0)
          + (combo && (combo.type === 'tractor' || combo.type === 'throw') ? 4 : 0)
          + (combo && combo.isTrump ? 2 : 0);
      }
      return { cards, key, i };
    });
    keyed.sort((a, b) => b.key - a.key || a.i - b.i);
    const out = keyed.slice(0, k).map((e) => e.cards);
    if (out.length === 0) out.push(cands[0]);
    return out;
  }

  /* ------------------- R3 PIMC 蒙特卡洛推演（中盘） ------------------- */

  /**
   * 中盘关键决策的 PIMC 推演：按记牌器采样三家手牌分布（同一组分布评所有
   * 根候选 = 共同随机数，差分方差远小于独立采样）→ 每候选在模拟态上用基线
   * 贪心快走打到收局 → 比期望 V=庄家终局分−合同分。
   * 范围：手牌 3~10 张的跟牌，且为关键墩——墩内分 ≥10，或墩分 ≥ need
   * （庄家赢下即达标 / 攻方夺走即否决，胜负边际价值最高的墩）。手牌=2 归 R5
   * 精确求解；>10 张 rollout 太长不推演。rollout 策略 = 无上下文贪心基线
   * （_scoreLead/_scoreFollow 基线路径：无记牌、快，且所有候选面对同一策略，
   * 策略偏差在候选间近似抵消）。
   * 确定性：固定种子采样 + 稳定次序 + 步数上限（非时钟截断），bench 可复现。
   * 只在最优候选的期望 V 比贪心选择高出/低出 R3_TAU 分时才覆盖——小样本
   * EV 有噪声，贪心本身是大量基准校准过的先验（消融开关 AI_R3_CAMP=att/dealer
   * 可只对单阵营启用）。
   * @param {Array<object>} greedyPick 贪心已选的出牌（作为对照先验）
   * @returns {Array<object>|null} 覆盖的出牌；null=不适用/超预算/证据不足，走贪心
   */
  _solvePIMC(state, playerIdx, ctx, greedyPick) {
    try {
      const cfg = state.config;
      const ti = state.trumpInfo;
      const trick = state.currentTrick;
      const h = state.players[playerIdx].hand.length;
      if (h < 3 || h > 10) return null; // R5 管 h=2；>10 rollout 超预算
      const isLeadDec = !trick || trick.plays.length === 0;
      // v2 攻方领出推演（AI_R3_LEAD）：逼烧主打哪门/何时清哪门是攻方最重
      // 的决策（v1 只覆盖跟牌）；庄家领出已有 _scoreLeadSdy+R7 增强不启用
      if (isLeadDec && !FEAT_R3_LEAD) return null;
      const n = isLeadDec ? 1 : trick.leadCombo.n;
      const need = ctx.sdy.need;
      const mem = ctx.mem;
      const unseenPts = mem.totalPoints - mem.pointsPlayed - mem.pointsInHand;
      if (need <= 0 || need > unseenPts) return null; // 胜负已定
      const trickPts = isLeadDec ? 0 : trick.plays.reduce((s, p) => s + pointsOf(p.cards, cfg), 0);
      if (!isLeadDec && trickPts < 10 && trickPts < need) return null;
      const rootCands = legalMoves(state, playerIdx);
      if (rootCands.length <= 1) return null;
      const isDealerView = playerIdx === ctx.sdy.dealerIdx;
      const pendingMate = !isLeadDec && !isDealerView && [0, 1, 2, 3].some((seat) =>
        seat !== playerIdx && seat !== ctx.sdy.dealerIdx
          && !trick.plays.some((p) => p.playerIdx === seat));
      const relayDecision = FEAT_RELAY && pendingMate;
      // 阵营消融：AI_R3_CAMP=att/dealer 只对单侧启用（缺省 both）
      const camp = envFlag('AI_R3_CAMP') || 'both';
      if (camp === 'att' && isDealerView) return null;
      if (camp === 'dealer' && !isDealerView) return null;
      if (isLeadDec && isDealerView) return null; // 领出推演：攻方试点

      // 对手分组（墩内已出者少 n 张）+ 未见牌账目校验（同 R5）
      const groups = [];
      for (let s = 0; s < 4; s++) {
        if (s === playerIdx) continue;
        const playedIn = !isLeadDec && trick.plays.some((p) => p.playerIdx === s);
        groups.push({ seat: s, size: h - (playedIn ? n : 0), voids: null });
      }
      const seatVoids = this._r5SeatVoids(state);
      groups.forEach((g) => { g.voids = seatVoids[g.seat]; });
      const unseen = this._r5UnseenCards(state, playerIdx);
      const needCnt = groups.reduce((s, g) => s + g.size, 0) + (isDealerView ? 0 : cfg.bottomCards);
      if (unseen.length !== needCnt) return null;
      const sampleN = h <= 4 ? R3_SAMPLES[4] : h <= 6 ? R3_SAMPLES[6]
        : h <= 8 ? R3_SAMPLES[8] : R3_SAMPLES[10];
      // R4 情报先验（攻方视角）：庄家自选主花色 → 采样分布按持主富集加权
      let weightSpec = null;
      if (FEAT_R4 && !isDealerView) {
        const gi = groups.findIndex((g) => g.seat === ctx.sdy.dealerIdx);
        if (gi >= 0) {
          const unseenTrumps = unseen.filter((c) => domainOf(c, ti) === 'TRUMP').length;
          const share = Math.min(R4_SHARE_CAP,
            R4_SHARE_BASE + Math.max(0, state.contractScore - 90) * R4_SHARE_SLOPE);
          weightSpec = { groupIdx: gi, target: share * unseenTrumps };
        }
      }
      const assignments = this._r5Assignments(unseen, groups, ti, sampleN, weightSpec);
      if (assignments.length === 0) return null;

      const bottomPtsReal = (state.bottomCards || []).reduce((s, c) => s + pointValue(c, cfg), 0);
      const seats = groups.map((g) => g.seat);
      const rootPruned = this._r5Prune(state, playerIdx, rootCands, isLeadDec ? null : trick, R3_K_ROOT);
      // 固定预算内替换末位：避免高分牌排序挤掉零分甩牌/小牌接力选项。
      if (!isDealerView) {
        let alternative = null;
        if (isLeadDec && FEAT_THROW_CHOICE) {
          alternative = rootCands.filter((cards) => {
            const combo = parseCombo(cards, ti, cfg);
            return combo && combo.type === 'throw' && !combo.isTrump;
          }).sort((a, b) => pointsOf(a, cfg) - pointsOf(b, cfg) || b.length - a.length)[0];
        } else if (relayDecision) {
          alternative = rootCands.slice().sort((a, b) =>
            pointsOf(a, cfg) - pointsOf(b, cfg)
              || this._maxStrength(a, ti) - this._maxStrength(b, ti))[0];
        }
        if (alternative && !rootPruned.includes(alternative)) rootPruned[rootPruned.length - 1] = alternative;
      }
      // 贪心选择必须在评估集内（对照先验；剪枝可能把它挤掉）
      const evalSet = rootPruned.some((c) => c === greedyPick)
        ? rootPruned : rootPruned.concat([greedyPick]);
      const budget = { n: 0 };
      const maximize = isDealerView;
      const evOf = (cards) => {
        const combo = parseCombo(cards, ti, cfg);
        let sum = 0;
        for (const asg of assignments) {
          const ss = this._r5SimState(state, ctx, playerIdx, seats, asg,
            isDealerView ? bottomPtsReal
              : asg.bottom.reduce((s, c) => s + pointValue(c, cfg), 0));
          this._r5Apply(ss, playerIdx, cards, combo);
          let next;
          if (ss.currentTrick) next = this._nextSeat(ss, playerIdx);
          else next = ss.tricks[ss.tricks.length - 1].winnerIdx;
          sum += this._r3Rollout(ss, next, budget);
        }
        return sum / assignments.length;
      };
      let best = null;
      let bestV = maximize ? -Infinity : Infinity;
      let greedyV = null;
      for (const cards of evalSet) {
        const ev = evOf(cards);
        if (cards === greedyPick) greedyV = ev; // 对照先验的期望（同组分布，公平比较）
        if (maximize ? ev > bestV + 1e-9 : ev < bestV - 1e-9) {
          bestV = ev;
          best = cards;
        }
      }
      if (best === greedyPick) return null; // rollout 没推翻贪心
      if (greedyV === null) greedyV = evOf(greedyPick); // 防御（理论到不了）
      if (maximize ? bestV - greedyV < R3_TAU : greedyV - bestV < R3_TAU) return null; // 优势不显著
      return best;
    } catch (e) {
      if (e && e.r3Abort) return null; // rollout 步数超限 → 回退贪心
      return null; // 求解器是增强件，其余异常同样静默回退
    }
  }

  /**
   * 单分布 rollout：从「我已出根候选」的模拟态起，全员基线贪心打到收局，
   * 返回 V=庄家终局分−合同分（复用 _r5Apply 推进、_r5TerminalOf 终局估值）。
   */
  _r3Rollout(ss, toAct, budget) {
    let guard = 0;
    while (guard++ < 200) {
      if (ss.players[toAct].hand.length === 0 && !ss.currentTrick) {
        return this._r5TerminalOf(ss); // 全场打空
      }
      const mv = this._r3RolloutMove(ss, toAct, budget);
      const combo = parseCombo(mv, ss.trumpInfo, ss.config);
      this._r5Apply(ss, toAct, mv, combo);
      toAct = ss.currentTrick ? this._nextSeat(ss, toAct) : ss.tricks[ss.tricks.length - 1].winnerIdx;
    }
    throw { r3Abort: true }; // 异常长局，防御性放弃
  }

  /** rollout 单步：基线贪心打分（无上下文，快）；候选超宽按引擎序截断保确定性
   *  （rollout 增强策略已试删 2026-10-28：全员增强高估对手 a-new +0.8pp、
   *  阵营感知增强 τ∈{5,8,10} 无差异——R3 覆盖 45 次/1600 局太稀，保真度无边际） */
  _r3RolloutMove(ss, seat, budget) {
    if (++budget.n > R3_EVENT_CAP) throw { r3Abort: true };
    const cands = legalMoves(ss, seat);
    if (cands.length === 0) throw { r3Abort: true };
    if (cands.length <= 1) return cands[0];
    const capped = cands.length > R3_ROLLOUT_K ? cands.slice(0, R3_ROLLOUT_K) : cands;
    const isLead = !ss.currentTrick || ss.currentTrick.plays.length === 0;
    let best = capped[0];
    let bestS = -Infinity;
    for (const c of capped) {
      const s = isLead ? this._scoreLead(ss, seat, c, null) : this._scoreFollow(ss, seat, c, null);
      if (s > bestS) { bestS = s; best = c; }
    }
    return best;
  }

  /* ------------------------- 辅助 ------------------------- */

  /** 所有模拟共用真实出牌方向；避免顺时针局面重复已出者、漏掉庄家。 */
  _nextSeat(state, seat) {
    const order = state.playOrder
      || (state.config.playDirection === 'clockwise' ? [0, 3, 2, 1] : [0, 1, 2, 3]);
    return order[(order.indexOf(seat) + 1) % order.length];
  }

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
    const wp = this._currentWinnerPlay(state, trick, ti, cfg);
    return wp ? this._camp(state, wp.playerIdx) : -1;
  }

  /** 墩内当前最大者的出牌记录（PlayRecord|null），resolveTrick 探针裁决 */
  _currentWinnerPlay(state, trick, ti, cfg) {
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
      return null;
    }
    return probe.plays.find((p) => p.playerIdx === probe.winnerIdx) || null;
  }
}

/** 牌面数值辅助（非规则数值，排序用） */
function rankNum(card) {
  const v = { J: 11, Q: 12, K: 13, A: 14 };
  return v[card.rank] || (card.isJoker ? 16 : parseInt(card.rank, 10));
}

module.exports = { GreedyStrategy, rankNum };
