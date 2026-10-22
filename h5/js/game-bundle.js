/* 自动生成：node tools/build-bundle.js —— 请勿手改；引擎更新后重跑 */
(function () {
'use strict';
var __defs = {};
var __cache = {};
function __req(from, id) {
  var key = id.charAt(0) === "." ? __resolve(from, id) : id;
  if (__cache[key]) return __cache[key].exports;
  var def = __defs[key];
  if (!def) throw new Error('module not found: ' + key + ' (from ' + from + ')');
  var mod = { exports: {} };
  __cache[key] = mod;
  def(mod.exports, function (i) { return __req(key, i); }, mod);
  return mod.exports;
}
function __resolve(from, id) {
  var base = id.charAt(0) === "." ? id : "./" + id;
  return base.replace(/^\.\//, "").replace(/^\.\//, "");
}
function __def(id, factory) { __defs[id] = factory; }
__def("engine/bid", function (exports, __require, module) {
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

const { cardKey } = __require('engine/card');
const { result } = __require('engine/errors');

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
 * 叫分可选项（用户规则：90 起，每档 +10，到 200 封顶）。
 * 每人只叫一次，放弃者出局；下一位叫分必须比当前最高高一档。
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
  if (cur === 0) {
    // 无人叫分：全部档位可选（90..200）
    for (let v = start; v <= cap; v += step) opts.push(v);
    return opts;
  }
  // 有人叫分：只能叫比当前最高高一档（+10）
  const next = cur + step;
  if (next <= cap) opts.push(next);
  return opts;
}

/**
 * 报分校验（可反复加价）。
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
  // 已 pass 者失去本局叫分资格（QQ 规则：放弃后不可再叫；被强制打最低除外）
  if ((state.passedBidders || []).includes(playerIdx)) {
    return result(false, '已放弃叫分，本局不可再报', 'E114');
  }
  const opts = scoreBidOptions(state, playerIdx, cfg);
  if (!opts.includes(score)) {
    return result(false, `叫分不合法（当前可选：${opts.length ? opts.join('/') : '无（已封顶）'}）`, 'E113');
  }
  return result(true, null, null, { type: 'score_bid', score });
}

});
__def("engine/card", function (exports, __require, module) {
/**
 * engine/card.js —— 牌的表示与基础运算。
 *
 * Card: { id, suit, rank, isJoker }
 *   id  全局唯一：`${deckIndex}${suit}${rank}`，如 '0H10'、'1BJ'
 *   suit 'S'|'H'|'C'|'D'|'JOKER'（王为 JOKER）
 *   rank '2'..'10','J','Q','K','A'，王专用 'BJ'(大王)/'RJ'(小王)
 *
 * 排序键设计（架构 §8.4）：
 *   主牌域  999 大王 / 998 小王 / 997 主花色级牌 / 996 副级牌（先出为大由比较器处理）
 *          / 900+牌面值 主花色其余牌
 *   副牌域  100×花色序 + 牌面值（S=1,H=2,C=3,D=4；级牌不在副牌域）
 */

'use strict';

/** 花色编码（§8.1） */
const SUITS = ['S', 'H', 'C', 'D'];
/** 花色展示符号 */
const SUIT_SYMBOLS = { S: '♠', H: '♥', C: '♣', D: '♦', JOKER: '🃏' };
/** 花色排序序（副牌分组展示用） */
const SUIT_ORDER = { S: 1, H: 2, C: 3, D: 4 };

/** 牌面大小值：2..10 数字面，J=11 Q=12 K=13 A=14，小王 15 大王 16 */
const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14, RJ: 15, BJ: 16
};

/**
 * 创建一张牌。
 * @param {number} deckIndex 副序（0 起）
 * @param {string} suit
 * @param {string} rank
 * @returns {{id: string, suit: string, rank: string, isJoker: boolean}}
 */
function createCard(deckIndex, suit, rank) {
  return {
    id: `${deckIndex}${suit}${rank}`,
    suit,
    rank,
    isJoker: suit === 'JOKER'
  };
}

/**
 * 牌的领域键（同名同花色视为相同牌，对子判定依据）。
 * @param {{suit: string, rank: string}} card
 * @returns {string} 如 'H-10'、'JOKER-BJ'
 */
function cardKey(card) {
  return `${card.suit}-${card.rank}`;
}

/**
 * 牌面大小值。
 * @param {string} rank
 * @returns {number}
 */
function rankValue(rank) {
  return RANK_VALUES[rank] || 0;
}

/**
 * 分牌分值（5/10/K，数值来自 RuleConfig.pointValues）。
 * @param {{rank: string}} card
 * @param {object} cfg
 * @returns {number}
 */
function pointValue(card, cfg) {
  const map = (cfg && cfg.pointValues) || {};
  return map[card.rank] || 0;
}

/**
 * 是否王。
 * @param {{isJoker: boolean}} card
 * @returns {boolean}
 */
function isJokerCard(card) {
  return !!card.isJoker;
}

/**
 * 是否主牌（需已定主）。trumpInfo.trumpIds 存的是 cardKey 集合（架构字段名沿用）。
 * @param {{suit: string, rank: string}} card
 * @param {{trumpIds: Set<string>}} trumpInfo
 * @returns {boolean}
 */
function isTrump(card, trumpInfo) {
  if (!trumpInfo) return false;
  if (card.isJoker) return true;
  return trumpInfo.trumpIds.has(cardKey(card));
}

/**
 * 全局排序键（升序排列时主牌自然靠右：副牌 < 900 ≤ 主牌）。
 * @param {{suit: string, rank: string, isJoker: boolean}} card
 * @param {object|null} trumpInfo 未定主时按自然序（花色+牌面）
 * @returns {number}
 */
function sortKey(card, trumpInfo) {
  if (card.isJoker) {
    return card.rank === 'BJ' ? 999 : 998;
  }
  if (trumpInfo) {
    const key = cardKey(card);
    if (trumpInfo.trumpIds.has(key)) {
      if (trumpInfo.isNoTrump) return 996; // 无主局：所有级牌同级（先出为大）
      if (card.suit === trumpInfo.trumpSuit && card.rank === trumpInfo.levelRank) return 997; // 主花色级牌
      if (card.rank === trumpInfo.levelRank) return 996; // 副级牌
      return 900 + rankValue(card.rank); // 主花色其余 A~3（级牌已排除）
    }
    return SUIT_ORDER[card.suit] * 100 + rankValue(card.rank);
  }
  return SUIT_ORDER[card.suit] * 100 + rankValue(card.rank);
}

/**
 * 手牌排序（升序：副牌按花色分组在左，主牌域在右）。
 * @param {Array} hand
 * @param {object|null} trumpInfo
 * @returns {Array} 新数组（不改原数组）
 */
function sortHand(hand, trumpInfo) {
  return hand.slice().sort((a, b) => {
    const ka = sortKey(a, trumpInfo);
    const kb = sortKey(b, trumpInfo);
    if (ka !== kb) return ka - kb;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * 两张牌是否同名同花色（等价牌）。
 * @param {{suit:string, rank:string}} a
 * @param {{suit:string, rank:string}} b
 * @returns {boolean}
 */
function sameCard(a, b) {
  return a.suit === b.suit && a.rank === b.rank;
}

/**
 * 按 id 查找手牌中的牌（输入可能来自 UI 的选中副本）。
 * @param {Array} hand
 * @param {{id:string}} card
 * @returns {object|null}
 */
function findInHand(hand, card) {
  return hand.find((c) => c.id === card.id) || null;
}

module.exports = {
  SUITS,
  SUIT_SYMBOLS,
  SUIT_ORDER,
  createCard,
  cardKey,
  rankValue,
  pointValue,
  isJokerCard,
  isTrump,
  sortKey,
  sortHand,
  sameCard,
  findInHand
};

});
__def("engine/combo", function (exports, __require, module) {
/**
 * engine/combo.js —— 牌型识别（单/对/拖/甩）+ 大小比较 + 拖拉机相邻判定。
 *
 * 域（domain）概念：
 *   'TRUMP' 主牌域（含王/级牌/主花色）；'S'/'H'/'C'/'D' 各副牌花色域。
 *   一次合法出牌的所有牌必须同域（甩牌亦然，PRD §5.7）。
 *
 * 拖拉机相邻（PRD §5.7）：
 *   副牌域：牌面值相邻（级牌被抽走后，如打5时 44 与 66 不相邻）；
 *   主牌域：逻辑 step 相邻（对王+对主X / 对主X+对同花色副X / 对副X+对主A / …）；
 *   R22=false（默认）：不同花色副级牌对互不相邻（同级 tie，非相邻）；
 *   R22=true：视为相邻可成拖。
 */

'use strict';

const { cardKey, rankValue, pointValue } = __require('engine/card');
const { trumpStrength, trumpStep, isOffRankCard } = __require('engine/trump');
const { RuleError } = __require('engine/errors');

/**
 * 牌所属域。
 * @param {{suit:string,isJoker:boolean}} card
 * @param {object} trumpInfo
 * @returns {'TRUMP'|string}
 */
function domainOf(card, trumpInfo) {
  if (card.isJoker) return 'TRUMP';
  if (trumpInfo && trumpInfo.trumpIds.has(cardKey(card))) return 'TRUMP';
  return card.suit;
}

/**
 * 域内强度值（同域才可比较；副牌域 = 牌面值，主牌域 = trumpStrength）。
 */
function strengthInDomain(card, trumpInfo) {
  if (domainOf(card, trumpInfo) === 'TRUMP') return trumpStrength(card, trumpInfo);
  return rankValue(card.rank);
}

/**
 * 构造牌型单元。
 * @param {'single'|'pair'|'tractor'} type
 * @param {Array<object>} cards
 * @param {object} trumpInfo
 * @returns {{type:string, cards:Array, size:number, isTrumpUnit:boolean, head:object, strength:number}}
 */
function makeUnit(type, cards_, trumpInfo) {
  const head = cards_.reduce((m, c) => (strengthInDomain(c, trumpInfo) > strengthInDomain(m, trumpInfo) ? c : m), cards_[0]);
  return {
    type,
    cards: cards_.slice(),
    size: cards_.length,
    isTrumpUnit: domainOf(cards_[0], trumpInfo) === 'TRUMP',
    head,
    strength: strengthInDomain(head, trumpInfo)
  };
}

/**
 * 两对是否相邻（拖拉机判定核心）。
 * @param {{cards:Array}} pairA
 * @param {{cards:Array}} pairB
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {boolean}
 */
function pairAdjacent(pairA, pairB, trumpInfo, cfg) {
  const a = pairA.cards[0];
  const b = pairB.cards[0];
  const domA = domainOf(a, trumpInfo);
  const domB = domainOf(b, trumpInfo);
  if (domA !== domB) return false;
  if (domA === 'TRUMP') {
    const sa = trumpStep(a, trumpInfo);
    const sb = trumpStep(b, trumpInfo);
    if (sa === sb) {
      // 同为副级牌 tie 域：默认不相邻（R22）；开启 R22 则不同花色副级牌对相邻
      if (!cfg.offSuitRankPairAsTractor) return false;
      return a.suit !== b.suit;
    }
    return Math.abs(sa - sb) === 1;
  }
  // 副牌域：牌面相邻（级牌已抽走，天然跳过）
  return Math.abs(rankValue(a.rank) - rankValue(b.rank)) === 1;
}

/** 是否合法对子（同名同花色两张；注意不同花色副级牌不是对子——域键不同） */
function isPair(cards_, trumpInfo) {
  if (cards_.length !== 2) return false;
  return cardKey(cards_[0]) === cardKey(cards_[1]);
}

/**
 * 将同域牌集合拆解为最大单元组合（拖拉机优先合并）。
 * @param {Array<object>} cards 同域牌
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {Array<object>} ComboUnit[] 降序
 */
function decomposeDomain(cards_, trumpInfo, cfg) {
  // 按域键分组计数（deckCount=2 时每键至多 2 张；3 副时 3 张拆为对+单）
  const groups = new Map();
  cards_.forEach((c) => {
    const k = cardKey(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  });
  const pairs = [];
  const singles = [];
  groups.forEach((list) => {
    while (list.length >= 2) {
      pairs.push(makeUnit('pair', [list.shift(), list.shift()], trumpInfo));
    }
    while (list.length > 0) {
      singles.push(makeUnit('single', [list.shift()], trumpInfo));
    }
  });
  // 对子按域内强度降序，贪心合并最长相邻链 → 拖拉机
  pairs.sort((x, y) => y.strength - x.strength);
  const used = new Array(pairs.length).fill(false);
  const units = [];
  for (let i = 0; i < pairs.length; i++) {
    if (used[i]) continue;
    // 向下延伸相邻对链
    const chain = [pairs[i]];
    used[i] = true;
    for (let j = i + 1; j < pairs.length; j++) {
      if (used[j]) continue;
      if (pairAdjacent(chain[chain.length - 1], pairs[j], trumpInfo, cfg)) {
        chain.push(pairs[j]);
        used[j] = true;
      }
    }
    if (chain.length >= 2) {
      const tCards = chain.reduce((acc, u) => acc.concat(u.cards), []);
      units.push(makeUnit('tractor', tCards, trumpInfo));
    } else {
      units.push(chain[0]);
    }
  }
  singles.forEach((s) => units.push(s));
  // 降序：张数多优先，其次强度
  units.sort((a, b) => (b.size - a.size) || (b.strength - a.strength));
  return units;
}

/**
 * 解析一次出牌的牌型。
 * @param {Array<object>} cards
 * @param {object} trumpInfo
 * @param {object} [cfg] 缺省用 DEFAULT_CONFIG（R22）
 * @returns {{type:'single'|'pair'|'tractor'|'throw', units:Array, cards:Array,
 *           n:number, suit:string, isTrump:boolean, points:number}|null}
 *   跨域混合返回 null（E112）
 */
function parseCombo(cards_, trumpInfo, cfg) {
  const config = cfg || __require('engine/config').DEFAULT_CONFIG;
  if (!cards_ || cards_.length === 0) return null;
  const n = cards_.length;
  const domains = new Set(cards_.map((c) => domainOf(c, trumpInfo)));
  if (domains.size > 1) return null; // 跨域（主+副混合 / 两门副牌）非法
  const domain = [...domains][0];
  const isTrump = domain === 'TRUMP';

  if (n === 1) {
    return {
      type: 'single', units: [makeUnit('single', cards_, trumpInfo)], cards: cards_.slice(),
      n, suit: isTrump ? 'TRUMP' : domain, isTrump, points: pointsOf(cards_, config)
    };
  }
  if (n === 2 && isPair(cards_, trumpInfo)) {
    return {
      type: 'pair', units: [makeUnit('pair', cards_, trumpInfo)], cards: cards_.slice(),
      n, suit: isTrump ? 'TRUMP' : domain, isTrump, points: pointsOf(cards_, config)
    };
  }
  // 多张：同域拆解
  const units = decomposeDomain(cards_, trumpInfo, config);
  if (units.length === 1 && units[0].type === 'tractor') {
    return {
      type: 'tractor', units, cards: cards_.slice(),
      n, suit: isTrump ? 'TRUMP' : domain, isTrump, points: pointsOf(cards_, config)
    };
  }
  // 其他多单元组合 → 甩牌（两对不相连 / 对+单 / 多单等同域组合）
  return {
    type: 'throw', units, cards: cards_.slice(),
    n, suit: isTrump ? 'TRUMP' : domain, isTrump, points: pointsOf(cards_, config)
  };
}

/** 牌组分值合计 */
function pointsOf(cards_, cfg) {
  return cards_.reduce((s, c) => s + pointValue(c, cfg), 0);
}

/**
 * 单元比较（同域同型）：a > b 返回正数。
 * 不同型不同张：张数大者胜（甩牌逐单元比较的确定性约定）。
 * @param {object} a ComboUnit
 * @param {object} b ComboUnit
 * @returns {number}
 */
function compareUnit(a, b) {
  if (a.size !== b.size) return a.size - b.size;
  return a.strength - b.strength;
}

/**
 * 组合比较（同域同 n，用于墩内争胜）：
 *   单元按（张数降序，强度降序）对齐后逐对比较，首个分差决定；
 *   全部相等 → 0（tie，由调用方按 R13 先出为大 / 花色序裁决）。
 * @param {object} a Combo
 * @param {object} b Combo
 * @returns {number}
 */
function compareCombo(a, b) {
  const ua = a.units.slice().sort((x, y) => (y.size - x.size) || (y.strength - x.strength));
  const ub = b.units.slice().sort((x, y) => (y.size - x.size) || (y.strength - x.strength));
  const len = Math.min(ua.length, ub.length);
  for (let i = 0; i < len; i++) {
    const d = compareUnit(ua[i], ub[i]);
    if (d !== 0) return d;
  }
  return ua.length - ub.length;
}

/**
 * 跟牌组合能否压过领出组合（同域、同 n）。
 * - 单张：比单张
 * - 对子：须含更大的对单元
 * - 拖拉机（k 对）：须含 k 对拖且拖头更大
 * - 甩牌：每个领出单元须被跟牌对应单元压过（逐单元，张数对齐比较）
 * @param {object} leadCombo 领出组合
 * @param {object} followCombo 跟牌组合（已确认同域同 n）
 * @returns {boolean}
 */
function canBeat(leadCombo, followCombo) {
  if (leadCombo.type === 'single') {
    const u = followCombo.units.find((x) => x.type === 'single');
    return !!u && u.strength > leadCombo.units[0].strength;
  }
  if (leadCombo.type === 'pair') {
    const u = followCombo.units.find((x) => x.type === 'pair');
    return !!u && u.strength > leadCombo.units[0].strength;
  }
  if (leadCombo.type === 'tractor') {
    const k = leadCombo.units[0].cards.length / 2; // 对数
    const t = followCombo.units.find((x) => x.type === 'tractor' && x.cards.length === k * 2);
    return !!t && t.strength > leadCombo.units[0].strength;
  }
  // 甩牌：逐单元压过（领出单元降序 vs 跟牌单元降序，张数对齐）
  const lu = leadCombo.units.slice().sort((x, y) => (y.size - x.size) || (y.strength - x.strength));
  const fu = followCombo.units.slice().sort((x, y) => (y.size - x.size) || (y.strength - x.strength));
  if (fu.length < lu.length) return false;
  for (let i = 0; i < lu.length; i++) {
    if (compareUnit(fu[i], lu[i]) <= 0) return false;
  }
  return true;
}

module.exports = {
  domainOf,
  strengthInDomain,
  makeUnit,
  pairAdjacent,
  isPair,
  decomposeDomain,
  parseCombo,
  compareUnit,
  compareCombo,
  canBeat,
  pointsOf
};

});
__def("engine/config", function (exports, __require, module) {
/**
 * engine/config.js —— RuleConfig 唯一来源（架构 D8）。
 *
 * 全项目所有规则数值（80/40/×2/8/108 等）只能来自本模块：
 *   const { DEFAULT_CONFIG, createConfig, validateConfig } = __require('engine/config');
 * 任何模块禁止字面量硬编码规则数值（UI 展示文案亦由本配置渲染）。
 *
 * 参数编号 R1~R24 与 PRD §7 参数总表一一对应。
 */

'use strict';

/** 级牌完整序列（rankStart → rankEnd 的取值域，传统 2→A） */
const FULL_RANK_SEQUENCE = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** 分牌面值（PRD §5.1：5→5 分、10→10 分、K→10 分；总分 200 由双副牌自然得出） */
const DEFAULT_POINT_VALUES = { '5': 5, '10': 10, 'K': 10 };

/**
 * 默认规则配置（传统拖拉机规则）。
 * @type {Record<string, string|number|boolean|number[]|Object>}
 */
const DEFAULT_CONFIG = {
  // —— 玩法模式 ——
  gameMode: 'shengji',               // R25 玩法模式（shengji=升级2v2 | san_da_yi=三打一）

  // —— 牌与发牌 ——
  deckCount: 2,                      // R1 牌副数（2 副 = 108 张含大小王）
  bottomCards: 8,                    // R2 底牌张数
  pointValues: { ...DEFAULT_POINT_VALUES }, // 分牌面值（扩展可调点，属 R1 配套）

  // —— 级数 ——
  rankStart: '2',                    // R3 起始级牌（兼容传数字 2，createConfig 归一化）
  rankEnd: 'A',                      // R4 终局级牌

  // —— 计分与升级 ——
  pointsToTake: 80,                  // R5 上台分
  pointsPerLevel: 40,                // R6 每级分数
  cleanSweepBonusLevels: 1,          // R7 大光（0 分）额外升级数
  levelUpTable: 'standard',          // R18 升级幅度表（standard / custom）
  passACondition: 'small_light',     // R15 过A条件（small_light | win | big_light）
  roundGoal: 'first_pass_A',         // R24 整轮目标（first_pass_A | loop）

  // —— 主牌 ——
  allowNoTrump: true,                // R8 是否允许无主局（对王反主）
  offSuitRankTieFirstWin: true,      // R13 副级牌先出为大

  // —— 抠底 ——
  bottomMultiplier: 2,               // R9 抠底分数倍数（统一倍数）
  bottomMultiplierByType: false,     // R10 是否按牌型加倍
  bottomMultiplierTable: {           // R10 开启时的牌型倍数表（单2/对4/拖8，甩牌取最大单元）
    single: 2,
    pair: 4,
    tractor: 8,
    throw: 8
  },

  // —— 跟牌 ——
  mustFollowPairAsPair: true,        // R11 有对必跟对（不可拆）
  mustFollowTractorAsTractor: true,  // R12 有拖必跟拖

  // —— 甩牌 ——
  throwPenalty: 'reject',            // R14 甩牌不成立罚则（reject | smallest | penalty_smallest=罚10分/张+强制出小）

  // —— 流程 ——
  dealerPassRule: 'winner_stays',    // R16 庄家传递（winner_stays | rotate | bidder_always）
  bidDeadLine: 'before_bottom_flip', // R17 亮主截止（before_bottom_flip | after_deal）
  playDirection: 'counterclockwise', // R19 出牌方向（counterclockwise | clockwise）
  noBidFallback: 'flip_bottom',      // R20 无人亮主处理（flip_bottom | redeal）

  // —— 反主 ——
  allowSingleJokerOverride: false,   // R21 单王反无主

  // —— 牌型 ——
  offSuitRankPairAsTractor: false,   // R22 不同花色副级牌对是否构成拖拉机

  // —— 三打一（R26，gameMode='san_da_yi' 时生效） ——
  sanDaYiBidStart: 90,               // 起叫分（用户规则：90 起）
  sanDaYiBidStep: 10,                // 叫分档位（90→100→110…→200，每档 +10）
  sanDaYiBidCap: 200,                // 叫分上限（=总分）
  sanDaYiNoBidAction: 'force_lowest',// 全员不叫（首位强制打最低分；redeal=重发）
  sanDaYiPeekBottomMaxBid: -1,       // 成交分 ≤ 此值时闲家可看底牌（-1=不公开；本玩法不适用看底规则）

  // —— 体验 ——
  aiPaceSeconds: [0.8, 1.5]          // R23 AI 出牌节奏区间（秒）
};

/** 各参数可选范围（供 validateConfig 与规则速查页渲染） */
const PARAM_RANGES = {
  gameMode: ['shengji', 'san_da_yi'],
  deckCount: [1, 2, 3],
  throwPenalty: ['reject', 'smallest', 'penalty_smallest'],
  passACondition: ['small_light', 'win', 'big_light'],
  dealerPassRule: ['winner_stays', 'rotate', 'bidder_always'],
  bidDeadLine: ['before_bottom_flip', 'after_deal'],
  playDirection: ['counterclockwise', 'clockwise'],
  noBidFallback: ['flip_bottom', 'redeal'],
  levelUpTable: ['standard', 'custom'],
  roundGoal: ['first_pass_A', 'loop'],
  sanDaYiNoBidAction: ['redeal', 'force_lowest']
};

/**
 * 深冻结对象（配置只读，防止运行期被篡改）。
 * @param {*} obj
 * @returns {*} 冻结后的同一引用
 */
function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.keys(obj).forEach((k) => deepFreeze(obj[k]));
    Object.freeze(obj);
  }
  return obj;
}

/**
 * 级牌数字面量归一化：2 → '2'（PRD jsonc 示例允许数字，内部统一字符串）。
 * @param {string|number} rank
 * @returns {string}
 */
function normalizeRank(rank) {
  return typeof rank === 'number' ? String(rank) : rank;
}

/**
 * 取当前规则下的级牌序列（rankStart → rankEnd）。
 * @param {object} cfg
 * @returns {string[]}
 */
function rankSequence(cfg) {
  const start = normalizeRank(cfg.rankStart);
  const end = normalizeRank(cfg.rankEnd);
  const i0 = FULL_RANK_SEQUENCE.indexOf(start);
  const i1 = FULL_RANK_SEQUENCE.indexOf(end);
  if (i0 < 0 || i1 < 0 || i1 < i0) {
    return FULL_RANK_SEQUENCE.slice();
  }
  return FULL_RANK_SEQUENCE.slice(i0, i1 + 1);
}

/**
 * 校验配置合法性与兼容性。
 * @param {object} cfg
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
function validateConfig(cfg) {
  const errors = [];
  const warnings = [];
  if (!cfg || typeof cfg !== 'object') {
    return { ok: false, errors: ['config 必须是对象'], warnings };
  }
  // R1 / R2：牌数与整除约束
  if (![1, 2, 3].includes(cfg.deckCount)) errors.push('R1 deckCount 只能取 1/2/3');
  if (!Number.isInteger(cfg.bottomCards) || cfg.bottomCards < 0 || cfg.bottomCards > 12) {
    errors.push('R2 bottomCards 取值 4~12（允许 0 用于调试）');
  }
  const totalCards = 54 * cfg.deckCount;
  if ((totalCards - cfg.bottomCards) % 4 !== 0) {
    errors.push(`R2 底牌张数不满足发牌整除：(${totalCards}-${cfg.bottomCards}) % 4 !== 0`);
  }
  // R3 / R4：级牌序列
  const seq = rankSequence(cfg);
  if (seq.length < 2) errors.push('R3/R4 级牌序列至少 2 级');
  // R5 / R6：计分
  if (!Number.isFinite(cfg.pointsToTake) || cfg.pointsToTake <= 0) errors.push('R5 pointsToTake 必须为正数');
  if (!Number.isFinite(cfg.pointsPerLevel) || cfg.pointsPerLevel <= 0) errors.push('R6 pointsPerLevel 必须为正数');
  if (cfg.pointsToTake % cfg.pointsPerLevel !== 0) {
    warnings.push('R5 上台分不能被 R6 每级分数整除，升级表档位将不均匀（允许但不建议）');
  }
  const maxPoints = totalCards / 54 * 100; // 每副牌 100 分
  if (cfg.pointsToTake >= maxPoints) warnings.push('R5 上台分 ≥ 总分，攻方永远无法上台');
  // R7
  if (!Number.isInteger(cfg.cleanSweepBonusLevels) || cfg.cleanSweepBonusLevels < 0) {
    errors.push('R7 cleanSweepBonusLevels 必须为非负整数');
  }
  // R9 / R10
  if (![1, 2, 4, 8].includes(cfg.bottomMultiplier)) errors.push('R9 bottomMultiplier 只能取 ×1/×2/×4/×8');
  if (typeof cfg.bottomMultiplierByType !== 'boolean') errors.push('R10 bottomMultiplierByType 必须为布尔');
  // 枚举参数
  Object.keys(PARAM_RANGES).forEach((key) => {
    if (!PARAM_RANGES[key].includes(cfg[key])) {
      errors.push(`${key} 只能取 ${PARAM_RANGES[key].join(' / ')}`);
    }
  });
  // R23
  if (!Array.isArray(cfg.aiPaceSeconds) || cfg.aiPaceSeconds.length !== 2
      || cfg.aiPaceSeconds[0] < 0.3 || cfg.aiPaceSeconds[1] > 3
      || cfg.aiPaceSeconds[0] > cfg.aiPaceSeconds[1]) {
    errors.push('R23 aiPaceSeconds 必须为 [min,max] 且在 0.3~3 内');
  }
  // R26 三打一
  if (cfg.gameMode === 'san_da_yi') {
    const start = cfg.sanDaYiBidStart;
    const step = cfg.sanDaYiBidStep;
    if (!Number.isFinite(start) || start <= 0) errors.push('R26 sanDaYiBidStart 必须为正数');
    if (!Number.isFinite(step) || step <= 0) errors.push('R26 sanDaYiBidStep 必须为正数');
    if (!Number.isFinite(cfg.sanDaYiBidCap) || cfg.sanDaYiBidCap < start) {
      errors.push('R26 sanDaYiBidCap 必须 ≥ sanDaYiBidStart');
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * 合并用户覆盖并生成冻结配置实例。
 * @param {object} [overrides]
 * @param {object} [base] 基配置（默认 DEFAULT_CONFIG）
 * @returns {object} 深冻结后的配置
 * @throws {Error} 配置非法时抛出（含全部错误明细）
 */
function createConfig(overrides, base) {
  const merged = Object.assign({}, base || DEFAULT_CONFIG, overrides || {});
  // 归一化与子表合并
  merged.rankStart = normalizeRank(merged.rankStart);
  merged.rankEnd = normalizeRank(merged.rankEnd);
  merged.pointValues = Object.assign({}, DEFAULT_CONFIG.pointValues, merged.pointValues || {});
  merged.bottomMultiplierTable = Object.assign(
    {}, DEFAULT_CONFIG.bottomMultiplierTable, merged.bottomMultiplierTable || {}
  );
  merged.aiPaceSeconds = (merged.aiPaceSeconds || DEFAULT_CONFIG.aiPaceSeconds).slice();
  const { ok, errors } = validateConfig(merged);
  if (!ok) {
    throw new Error(`RuleConfig 校验失败：${errors.join('；')}`);
  }
  return deepFreeze(merged);
}

module.exports = {
  FULL_RANK_SEQUENCE,
  DEFAULT_CONFIG: deepFreeze(Object.assign({}, DEFAULT_CONFIG)),
  PARAM_RANGES,
  createConfig,
  validateConfig,
  rankSequence,
  deepFreeze
};

});
__def("engine/deck", function (exports, __require, module) {
/**
 * engine/deck.js —— 牌堆构建 / 洗牌 / 发牌切分（纯函数）。
 */

'use strict';

const { createCard, SUITS } = __require('engine/card');
const { rankSequence } = __require('engine/config');

/**
 * 按 RuleConfig 构建整副牌（deckCount 副 × 54 张，含大小王）。
 * @param {object} cfg
 * @returns {Array<object>} Card[]
 */
function buildDeck(cfg) {
  const deck = [];
  const ranks = rankSequence(cfg).length === 13
    ? rankSequence(cfg)
    : ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  for (let d = 0; d < cfg.deckCount; d++) {
    SUITS.forEach((suit) => {
      ranks.forEach((rank) => {
        deck.push(createCard(d, suit, rank));
      });
    });
    deck.push(createCard(d, 'JOKER', 'RJ')); // 小王
    deck.push(createCard(d, 'JOKER', 'BJ')); // 大王
  }
  return deck;
}

/**
 * Fisher-Yates 洗牌（返回新数组，不修改入参；随机性全部走注入 rng，§8.7）。
 * @param {Array} cards
 * @param {{next: function(): number}} rng
 * @returns {Array}
 */
function shuffle(cards, rng) {
  const arr = cards.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/**
 * 发牌切分：每人 (总数-底牌)/4 张，余下为底牌（R2）。
 * @param {Array} deck 已洗牌堆
 * @param {object} cfg
 * @returns {{hands: Array<Array<object>>, bottom: Array<object>, perPlayer: number}}
 * @throws {Error} 牌数与配置不符
 */
function dealInitial(deck, cfg) {
  const total = 54 * cfg.deckCount;
  if (deck.length !== total) {
    throw new Error(`发牌失败：牌堆 ${deck.length} 张 ≠ 配置 ${total} 张`);
  }
  const perPlayer = (total - cfg.bottomCards) / 4;
  if (!Number.isInteger(perPlayer) || perPlayer <= 0) {
    throw new Error('发牌失败：底牌张数配置不能整除');
  }
  const hands = [[], [], [], []];
  let i = 0;
  for (let round = 0; round < perPlayer; round++) {
    for (let p = 0; p < 4; p++) {
      hands[p].push(deck[i++]);
    }
  }
  const bottom = deck.slice(i);
  return { hands, bottom, perPlayer };
}

module.exports = { buildDeck, shuffle, dealInitial };

});
__def("engine/errors", function (exports, __require, module) {
/**
 * engine/errors.js —— 统一错误码 + RuleError。
 *
 * 错误码分段（架构 §8.6）：
 *   E1xx 规则引擎（出牌/亮主/甩牌/跟牌校验）
 *   E2xx 状态机（非法 action / phase 不允许 / 状态损坏）
 *   E3xx 持久化（版本不兼容 / 数据损坏）
 */

'use strict';

/** 错误码常量 */
const ERROR_CODES = {
  // —— E1xx 规则引擎 ——
  E101: '非法出牌',
  E102: '甩牌不成立',
  E103: '跟牌结构不符',
  E104: '非轮到该玩家',
  E105: '所出牌不在手牌中',
  E106: '出牌张数不符',
  E107: '埋底张数错误',
  E108: '非庄家不能埋底',
  E109: '亮主牌型不合法',
  E110: '反主优先级不足',
  E111: '亮主窗口已关闭',
  E112: '牌型无法识别（跨花色等）',
  E113: '配置非法',
  // —— E2xx 状态机 ——
  E201: '非法 action',
  E202: '当前阶段不允许该操作',
  E203: '状态损坏',
  // —— E3xx 持久化 ——
  E301: '存档版本不兼容',
  E302: '存档数据损坏'
};

/**
 * 规则/流程错误。所有 ValidateResult 的 reason 使用 message（用户可读，供 F-08 提示）。
 */
class RuleError extends Error {
  /**
   * @param {string} code ERROR_CODES 键（如 'E101'）
   * @param {string} [detail] 补充说明
   */
  constructor(code, detail) {
    const base = ERROR_CODES[code] || '未知错误';
    super(detail ? `${base}：${detail}` : base);
    this.name = 'RuleError';
    this.code = code;
    this.errorCode = code;
  }
}

/**
 * 构造校验结果。
 * @param {boolean} ok
 * @param {string} [reason]
 * @param {string} [errorCode]
 * @param {object} [meta] 附加信息（如甩牌罚则替换牌）
 * @returns {{ok: boolean, reason?: string, errorCode?: string, meta?: object}}
 */
function result(ok, reason, errorCode, meta) {
  const r = { ok };
  if (reason) r.reason = reason;
  if (errorCode) r.errorCode = errorCode;
  if (meta) r.meta = meta;
  return r;
}

module.exports = { ERROR_CODES, RuleError, result };

});
__def("engine/follow", function (exports, __require, module) {
/**
 * engine/follow.js —— 跟牌校验（R11/R12 严格结构 + 缺门将吃结构对应）。
 *
 * 跟牌者视角（领出组合 leadCombo、跟牌 cards）：
 *   1. 计算跟牌域分布：领出域牌数 / 主牌数 / 其他副牌数；
 *   2. 有领出域（够 n 张或不足全出）：
 *      - 领出单张：任意 1 张该域牌；
 *      - 领出对子（R11）：有该域对必跟对；无对出 2 单（不足全出）；
 *      - 领出 k 对拖（R12）：优先同域 k 对拖 → 同域对子补（不足单补）→ 全单；
 *      - 领出甩牌：结构自由（出该域任意 n 张），合法性=域与张数即可。
 *   3. 无领出域（缺门）：任意 n 张（垫牌或将吃）；
 *      将吃争胜需结构对应（对→主对 / k对拖→主k对拖 / 甩→全压），不对应视为垫牌（合法但不争胜）。
 *
 * 返回 ValidateResult，meta: { followKind: 'full'|'partial'|'discard'|'trump', structureOk }。
 */

'use strict';

const { parseCombo, domainOf, decomposeDomain, isPair } = __require('engine/combo');
const { result } = __require('engine/errors');

/**
 * 手牌中某域的牌。
 * @param {Array<object>} hand
 * @param {string} domain
 * @param {object} trumpInfo
 */
function domainCards(hand, domain, trumpInfo) {
  return hand.filter((c) => domainOf(c, trumpInfo) === domain);
}

/**
 * 手牌中某域的最大单元拆解。
 */
function handUnits(hand, domain, trumpInfo, cfg) {
  const dc = domainCards(hand, domain, trumpInfo);
  return dc.length ? decomposeDomain(dc, trumpInfo, cfg) : [];
}

/**
 * 跟牌结构校验核心（是否"尽力结构跟牌"：有对必跟对/有拖必跟拖）。
 * @param {object} leadCombo
 * @param {Array<object>} playedCards 跟牌者实际打出的该域牌
 * @param {Array<object>} handBefore 跟牌者打牌前手牌
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {{ok: boolean, reason?: string}}
 */
function checkFollowStructure(leadCombo, playedCards, handBefore, trumpInfo, cfg) {
  const domain = leadCombo.suit;
  const n = leadCombo.n;
  const available = domainCards(handBefore, domain, trumpInfo);

  // 该域牌不足 n 张：全部给出即可（PRD §5.9 防御条款）
  if (available.length <= n) {
    return { ok: playedCards.length === available.length };
  }
  // 该域牌充足但打出的不全在该域 → 非法（有该门必须跟该门）
  if (playedCards.length > 0 && playedCards.some((c) => domainOf(c, trumpInfo) !== domain)) {
    return { ok: false, reason: `有${domain === 'TRUMP' ? '主牌' : '该花色'}必须跟该门` };
  }

  if (leadCombo.type === 'single') {
    return { ok: playedCards.length === n };
  }
  if (leadCombo.type === 'pair') {
    if (!cfg.mustFollowPairAsPair) {
      return { ok: playedCards.length === n };
    }
    const hasPair = handUnits(handBefore, domain, trumpInfo, cfg).some((u) => u.type === 'pair' || u.type === 'tractor');
    if (!hasPair) return { ok: playedCards.length === n };
    const playedPair = isPair(playedCards, trumpInfo);
    return playedPair
      ? { ok: true }
      : { ok: false, reason: '有对必跟对（R11），不可拆对垫单' };
  }
  if (leadCombo.type === 'tractor') {
    const k = leadCombo.units[0].cards.length / 2;
    if (!cfg.mustFollowTractorAsTractor) {
      return { ok: playedCards.length === n };
    }
    const myUnits = handUnits(handBefore, domain, trumpInfo, cfg);
    const myTractor = myUnits.find((u) => u.type === 'tractor' && u.cards.length >= k * 2);
    if (!myTractor) return { ok: playedCards.length === n };
    // 打出的牌须含 k 对拖拉机
    const playedCombo = parseCombo(playedCards, trumpInfo, cfg);
    const playedTractor = playedCombo && playedCombo.units.find(
      (u) => u.type === 'tractor' && u.cards.length === k * 2
    );
    return playedTractor
      ? { ok: true }
      : { ok: false, reason: `有拖必跟拖（R12）：领出 ${k} 对拖拉机时须跟出同长拖拉机（允许拆更长）` };
  }
  // 甩牌跟牌：结构自由
  return { ok: playedCards.length === n };
}

/**
 * 缺门将吃结构对应判定（PRD §5.9.3）。
 * @param {object} leadCombo
 * @param {Array<object>} playedCards 全部为主牌时
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {boolean} true = 有效将吃（争胜）
 */
function isEffectiveTrumpFollow(leadCombo, playedCards, trumpInfo, cfg) {
  const allTrump = playedCards.every((c) => domainOf(c, trumpInfo) === 'TRUMP');
  if (!allTrump) return false;
  if (leadCombo.type === 'single') return playedCards.length === 1;
  if (leadCombo.type === 'pair') {
    return isPair(playedCards, trumpInfo);
  }
  if (leadCombo.type === 'tractor') {
    const k = leadCombo.units[0].cards.length / 2;
    const combo = parseCombo(playedCards, trumpInfo, cfg);
    const t = combo && combo.units.find((u) => u.type === 'tractor' && u.cards.length === k * 2);
    return !!t;
  }
  // 甩牌将吃：每个领出单元被主牌同结构压过
  const combo = parseCombo(playedCards, trumpInfo, cfg);
  if (!combo) return false;
  const lu = leadCombo.units.slice().sort((a, b) => (b.size - a.size) || (b.strength - a.strength));
  const fu = combo.units.slice().sort((a, b) => (b.size - a.size) || (b.strength - a.strength));
  if (fu.length < lu.length) return false;
  for (let i = 0; i < lu.length; i++) {
    if (fu[i].size !== lu[i].size || fu[i].strength <= lu[i].strength) return false;
  }
  return true;
}

/**
 * 跟牌总校验。
 * @param {object} state GameState
 * @param {number} playerIdx
 * @param {Array<object>} cards
 * @param {object} cfg
 * @returns {object} ValidateResult + meta
 */
function validateFollow(state, playerIdx, cards_, cfg) {
  const trick = state.currentTrick;
  const leadCombo = trick.leadCombo;
  const n = leadCombo.n;
  const hand = state.players[playerIdx].hand;
  if (cards_.length !== n) {
    return result(false, `跟牌张数须为 ${n} 张`, 'E106');
  }
  const domain = leadCombo.suit;
  const available = domainCards(hand, domain, state.trumpInfo);
  const playedInDomain = cards_.filter((c) => domainOf(c, state.trumpInfo) === domain);

  if (available.length > 0) {
    // 有该门：必须跟该门
    if (playedInDomain.length < Math.min(n, available.length)) {
      return result(false, `有${domain === 'TRUMP' ? '主牌' : '该花色牌'}，必须优先跟出（可出 ${Math.min(n, available.length)} 张）`, 'E103');
    }
    const struct = checkFollowStructure(leadCombo, playedInDomain, hand, state.trumpInfo, cfg);
    if (!struct.ok) {
      return result(false, struct.reason || '跟牌结构不符', 'E103', { followKind: 'full' });
    }
    return result(true, null, null, { followKind: available.length >= n ? 'full' : 'partial' });
  }

  // 缺门：任意 n 张合法；主牌将吃判定结构对应（不对应=垫牌，合法）
  const effective = isEffectiveTrumpFollow(leadCombo, cards_, state.trumpInfo, cfg);
  return result(true, null, null, {
    followKind: cards_.every((c) => domainOf(c, state.trumpInfo) === 'TRUMP') ? (effective ? 'trump' : 'discard') : 'discard',
    isEffectiveTrump: effective
  });
}

module.exports = {
  domainCards,
  handUnits,
  checkFollowStructure,
  isEffectiveTrumpFollow,
  validateFollow
};

});
__def("engine/settle", function (exports, __require, module) {
/**
 * engine/settle.js —— 一局结算：攻方分汇总 / 抠底加倍(R9/R10) / 升级表(R18) / 过A(R15) / 庄传递(R16) / 终局(R24)。
 */

'use strict';

const { pointValue, rankValue } = __require('engine/card');
const { rankSequence } = __require('engine/config');
const { lastTrickShape } = __require('engine/trick');

/**
 * 底牌分合计。
 * @param {Array<object>} bottomCards
 * @param {object} cfg
 * @returns {number}
 */
function bottomPoints(bottomCards, cfg) {
  return (bottomCards || []).reduce((s, c) => s + pointValue(c, cfg), 0);
}

/**
 * 抠底倍数（R9 统一 / R10 牌型）。
 * @param {object} lastTrick
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {number}
 */
function bottomMultiplier(lastTrick, trumpInfo, cfg) {
  if (!cfg.bottomMultiplierByType) {
    return cfg.bottomMultiplier; // R9
  }
  const shape = lastTrickShape(lastTrick, trumpInfo, cfg); // R10
  const table = cfg.bottomMultiplierTable;
  return table[shape] || cfg.bottomMultiplier;
}

/**
 * 升级数计算（R18 standard 表，公式化，PRD §5.12）。
 * @param {number} s 攻方得分
 * @param {object} cfg
 * @returns {{winnerTeam: 'defense'|'attack', levels: number}}
 *   winnerTeam 以阵营角色表达（defense=庄家方胜, attack=攻方胜）
 */
function computeLevelGain(s, cfg) {
  const P = cfg.pointsPerLevel;
  const T = cfg.pointsToTake;
  if (s >= T) {
    // 攻方上台：1 + floor((S-T)/P)，200 分封顶按公式自然得 4
    return { winnerTeam: 'attack', levels: 1 + Math.floor((s - T) / P) };
  }
  if (s === 0) {
    return { winnerTeam: 'defense', levels: 2 + cfg.cleanSweepBonusLevels };
  }
  if (s < P) {
    return { winnerTeam: 'defense', levels: 2 }; // 小光 1~P-1 → 2 级
  }
  return { winnerTeam: 'defense', levels: 2 - Math.floor(s / P) }; // 40-79 → 1
}

/**
 * 级数推进（跳过序不存在，2→A 顺序；封顶 A，PRD §5.12/§5.14）。
 * @param {string} rank 当前级
 * @param {number} levels 升级数
 * @param {object} cfg
 * @returns {string} 新级
 */
function advanceRank(rank, levels, cfg) {
  const seq = rankSequence(cfg);
  let i = seq.indexOf(rank);
  if (i < 0) i = 0;
  i = Math.min(i + levels, seq.length - 1);
  return seq[i];
}

/**
 * 过 A 判定（R15）。
 * @param {object} params {winnerTeamIsDealer, attackPoints, dealerRank, cfg}
 * @returns {{passedA: boolean, levelsGained: number}}
 *   未过A：按小光升 2 级但封顶停在 A（PRD §5.14）
 */
function checkPassA(params) {
  const { winnerIsDealer, attackPoints, dealerRank, cfg } = params;
  const P = cfg.pointsPerLevel;
  if (dealerRank !== cfg.rankEnd) {
    return { passedA: false, levelsGained: null };
  }
  // 庄家方正在打 A
  if (!winnerIsDealer) {
    // 攻方上台 → 庄家方（打A者）下台，过A失败
    return { passedA: false, levelsGained: null };
  }
  const cond = cfg.passACondition;
  let passOk = false;
  if (cond === 'small_light') passOk = attackPoints < P;
  else if (cond === 'big_light') passOk = attackPoints === 0;
  else if (cond === 'win') passOk = true;
  if (passOk) return { passedA: true, levelsGained: null };
  // 未过A：庄家方按小光升 2 级但封顶 A（继续打A）
  return { passedA: false, levelsGained: 2, cappedAtA: true };
}

/**
 * 下局庄家（R16）。
 * @param {object} params {dealerTeam, attackTeam, dealerIdx, bidWinnerIdx, winnerTeam, players, dealerPassRule, lastDealerIdx}
 * @returns {number} nextDealerIdx
 */
function nextDealer(params) {
  const {
    dealerTeam, winnerTeam, dealerIdx, bidWinnerIdx, players,
    dealerPassRule, lastDealerIdx
  } = params;
  const attackWon = winnerTeam !== dealerTeam;
  if (dealerPassRule === 'bidder_always') {
    return bidWinnerIdx !== null && bidWinnerIdx !== undefined ? bidWinnerIdx : dealerIdx;
  }
  if (!attackWon) {
    if (dealerPassRule === 'rotate') {
      // 庄家方队友坐庄
      return (dealerIdx + 2) % 4;
    }
    return dealerIdx; // winner_stays
  }
  // 攻方上台：攻方成员当庄
  if (dealerPassRule === 'rotate') {
    return (dealerIdx + 2) % 4; // 对面（攻方成员，因 2v2 对面为队友关系相反）
  }
  // winner_stays：定主者当庄；翻底定主（无人亮主）→ 上局庄家的下家
  if (bidWinnerIdx !== null && bidWinnerIdx !== undefined) {
    return bidWinnerIdx;
  }
  const base = lastDealerIdx === undefined ? dealerIdx : lastDealerIdx;
  return nextSeatOfOpponentTeam(base, players);
}

/**
 * 上局庄家的下家中属于攻方的成员（对面即上局庄家的对家=上局庄家方；下家属攻方）。
 * 座位顺序 0S→1E→2N→3W 逆时针；下家 = (idx+1)%4。
 */
function nextSeatOfOpponentTeam(baseIdx, players) {
  return (baseIdx + 1) % 4;
}

/**
 * 三打一结算（R26）。
 * 庄家最终得分 = 庄家赢墩分 + （庄家赢末墩时）底牌分×1；
 * 庄家得分 ≥ 合同分（contractScore）→ 庄家胜；否则三家胜。
 * 甩牌失败罚分（每张 10 分给对方阵营）由状态机在出牌时记入 penaltyPoints。
 * @param {object} state
 * @returns {object} SettleResult（三打一形态）
 */
function settleRoundSanDaYi(state) {
  const cfg = state.config;
  const teams = state.sanDaYiTeams;
  const dealerIdx = teams ? teams.dealer : state.dealerIdx;
  const attackerSet = new Set(teams ? teams.attackers : [0, 1, 2, 3].filter((i) => i !== dealerIdx));

  // 场上分
  let dealerPointsOnTable = 0;
  let attackerPointsOnTable = 0;
  state.completedTricks.forEach((t) => {
    if (attackerSet.has(t.winnerIdx)) attackerPointsOnTable += t.points;
    else dealerPointsOnTable += t.points;
  });

  // 甩牌罚分（罚给对方阵营）
  const pen = state.penaltyPoints || { dealer: 0, attackers: 0 };
  dealerPointsOnTable += 0; // 罚分从对方扣还是加给己方？——采用"加给对方"模型：
  attackerPointsOnTable += pen.attackers; // 攻方被罚 → 分加给庄家；庄家被罚 → 分加给攻方
  dealerPointsOnTable += pen.dealer;

  // 底牌：末墩赢家收底 ×1（不翻倍）
  const lastTrick = state.completedTricks[state.completedTricks.length - 1];
  const bp = bottomPoints(state.bottomCards, cfg);
  const dealerTookBottom = !attackerSet.has(lastTrick.winnerIdx);
  const bottomGained = dealerTookBottom ? bp : 0;
  const attackerBottomGained = dealerTookBottom ? 0 : bp;

  const dealerPoints = dealerPointsOnTable + bottomGained;
  const attackerPoints = attackerPointsOnTable + attackerBottomGained;
  const contract = state.contractScore;
  const dealerWon = dealerPoints >= contract;

  // 下局首报者：上局赢家先报（庄家赢→庄家；三家赢→庄家下家）
  const nextFirstBidder = dealerWon ? dealerIdx : (dealerIdx + 1) % 4;
  // 下局庄家占位（三打一庄家由报分产生，doDeal 用 sanDaYiFirstBidder 定首报）
  const nextDealerIdx = nextFirstBidder;

  return {
    mode: 'san_da_yi',
    dealerIdx,
    contractScore: contract,
    dealerPoints,
    attackerPoints,
    bottomPoints: bp,
    bottomMultiplierUsed: 1,
    bottomGained,
    penaltyPoints: pen,
    winnerTeam: dealerWon ? 'dealer' : 'attackers',
    levelsGained: 0,
    passedA: false,
    nextDealerIdx,
    nextFirstBidder,
    nextLevels: { team0: state.levels.team0, team1: state.levels.team1 },
    gameOver: false, // 三打一无过A概念，连续对局；胜负统计记入战绩
    attackPoints: attackerPoints // 兼容字段（历史/统计展示攻方分）
  };
}

/**
 * 一局结算总入口。
 * @param {object} state GameState（completedTricks 已全部完成、bottomCards、attackTeam、players…）
 * @returns {object} SettleResult
 */
function settleRound(state) {
  if (state.config.gameMode === 'san_da_yi') {
    return settleRoundSanDaYi(state);
  }
  const cfg = state.config;
  const attackTeam = state.attackTeam;
  const dealerTeam = state.players[state.dealerIdx].team;
  const defenseTeam = dealerTeam;

  // 场上分（按赢墩阵营累计；scores 由状态机维护，这里重算校验用 completedTricks）
  const attackPointsOnTable = state.completedTricks
    .filter((t) => state.players[t.winnerIdx].team === attackTeam)
    .reduce((s, t) => s + t.points, 0);

  // 抠底：最后一墩赢家
  const lastTrick = state.completedTricks[state.completedTricks.length - 1];
  const lastWinnerTeam = state.players[lastTrick.winnerIdx].team;
  const bp = bottomPoints(state.bottomCards, cfg);
  let mult = 1;
  let bottomGained = 0;
  if (lastWinnerTeam === attackTeam && bp > 0) {
    mult = bottomMultiplier(lastTrick, state.trumpInfo, cfg);
    bottomGained = bp * mult;
  }
  const attackPoints = attackPointsOnTable + bottomGained;

  // 升级数与胜方
  const gain = computeLevelGain(attackPoints, cfg);
  const winnerTeam = gain.winnerTeam === 'attack' ? attackTeam : defenseTeam;
  let levelsGained = gain.levels;

  // 过 A（R15）：庄家方打 A
  const dealerRank = state.levels[`team${dealerTeam}`];
  let passedA = false;
  if (dealerRank === cfg.rankEnd) {
    const pa = checkPassA({
      winnerIsDealer: winnerTeam === dealerTeam,
      attackPoints,
      dealerRank,
      cfg
    });
    passedA = pa.passedA;
    if (pa.cappedAtA) levelsGained = pa.levelsGained; // 停在 A 按小光 2 级（封顶 A）
    if (passedA) levelsGained = gain.levels;
  }

  // 攻方上台且攻方打A获胜（攻方当庄打A过A情形也需处理）
  const attackRank = state.levels[`team${attackTeam}`];
  if (!passedA && attackRank === cfg.rankEnd && winnerTeam === attackTeam) {
    // 攻方打 A 上台：本局以庄家队级数（dealer 的对家同队）为准——
    // 注意：本局级牌 = 庄家队级数；攻方过A判定发生在其当庄的下一局，这里不动。
  }

  // 级数推进（胜方升级；未过A封顶 A 由 advanceRank 天然保证）
  const nextLevels = { team0: state.levels.team0, team1: state.levels.team1 };
  if (levelsGained > 0) {
    const key = `team${winnerTeam}`;
    nextLevels[key] = advanceRank(nextLevels[key], levelsGained, cfg);
  }

  // 下局庄家（R16）
  const nextDealerIdx = nextDealer({
    dealerTeam,
    winnerTeam,
    dealerIdx: state.dealerIdx,
    bidWinnerIdx: state.bidWinnerIdx,
    players: state.players,
    dealerPassRule: cfg.dealerPassRule,
    lastDealerIdx: state.lastDealerIdx === undefined ? state.dealerIdx : state.lastDealerIdx
  });

  // 终局（R24）：过A 且 roundGoal=first_pass_A
  const gameOver = passedA && cfg.roundGoal === 'first_pass_A';

  return {
    attackPoints,
    attackPointsOnTable,
    bottomPoints: bp,
    bottomMultiplierUsed: mult,
    bottomGained,
    winnerTeam,
    levelsGained,
    passedA,
    nextDealerIdx,
    nextLevels,
    gameOver
  };
}

module.exports = {
  bottomPoints,
  bottomMultiplier,
  computeLevelGain,
  advanceRank,
  checkPassA,
  nextDealer,
  settleRound,
  settleRoundSanDaYi
};

});
__def("engine/throw", function (exports, __require, module) {
/**
 * engine/throw.js —— 甩牌成立性校验（PRD §5.8 / R14）。
 *
 * 领出甩牌成立条件：所甩每个单元都比其他三家手中该门牌的最大单元大。
 * 判定采用"逐单元最大单元拆解比较"：
 *   对其余三家，将该门牌按 decomposeDomain 拆成最大单元组合，
 *   若任何一家的任一同型单元 ≥ 甩牌对应单元（按张数配对，同张数单元中最大者比较），
 *   则甩牌不成立。
 *
 * R14：
 *   reject  → 返回 E102（UI/AI 直接禁止，不出现该组合）；
 *   smallest → 返回罚则替换牌（该门最小等量牌，meta.replacement）。
 */

'use strict';

const { decomposeDomain, domainOf, pointsOf } = __require('engine/combo');
const { cardKey, sortHand, sortKey } = __require('engine/card');
const { result } = __require('engine/errors');

/**
 * 计算一家手牌中该门的最大单元集合。
 * @param {Array<object>} hand
 * @param {string} domain 'TRUMP' 或花色
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {Array<object>} ComboUnit[]
 */
function maxUnitsOfHand(hand, domain, trumpInfo, cfg) {
  const domainCards = hand.filter((c) => domainOf(c, trumpInfo) === domain);
  if (domainCards.length === 0) return [];
  return decomposeDomain(domainCards, trumpInfo, cfg);
}

/**
 * 单元组比较：跟牌方最大单元是否能压过甩牌单元。
 * 同张数单元取跟牌方最大者比大小；跟牌方无同张数单元 → 视同张数的更小单元？
 * 约定（保守，符合线下习惯）：对子单元要求对方无更大对子（两张同名单张在 deckCount=2 下即对子，decompose 已合并）。
 * @param {object} throwUnit 甩牌单元
 * @param {Array<object>} defenseUnits 防客单元集合
 * @returns {boolean} true = 防守可压（甩牌不成立）
 */
function unitCovered(throwUnit, defenseUnits) {
  const sameSize = defenseUnits.filter((u) => u.size === throwUnit.size);
  if (sameSize.length > 0) {
    const biggest = sameSize.reduce((m, u) => (u.strength > m.strength ? u : m));
    return biggest.strength >= throwUnit.strength;
  }
  // 防守无同张数单元：若防守有更大张数单元（如拖 vs 对），拖含的对子可能拆压——
  // 保守认定：更大单元必然包含 ≥ 对子强度的牌，能压对子/单张单元。
  const bigger = defenseUnits.filter((u) => u.size > throwUnit.size);
  if (bigger.length > 0 && throwUnit.size >= 1) {
    // 拖拉机拆解含相邻对，其中最大对 ≥ 其头对；对甩出的对子单元，取拖头对比较
    if (throwUnit.type === 'pair') {
      const headPairStrength = bigger.reduce((m, u) => Math.max(m, u.strength), -1);
      return headPairStrength >= throwUnit.strength;
    }
    if (throwUnit.type === 'single') {
      // 任何防守单元的头牌 ≥ 甩单张 → 可压
      const maxHead = defenseUnits.reduce((m, u) => Math.max(m, u.strength), -1);
      return maxHead >= throwUnit.strength;
    }
  }
  return false;
}

/**
 * 甩牌成立性校验。
 * @param {object} state GameState（PLAYING、players 手牌可见性=全可见，单机 AI 与校验共用引擎真值）
 * @param {object} combo 已解析的甩牌组合（parseCombo 产物，type='throw'）
 * @param {number} leaderIdx 领出者
 * @param {object} cfg
 * @returns {{ok: boolean, reason?: string, errorCode?: string, meta?: object}}
 *   meta: { failUnit, coverBy, replacement?(R14=smallest 时该门最小等量牌) }
 */
function validateThrow(state, combo, leaderIdx, cfg) {
  const domain = combo.suit; // 'TRUMP' 或花色
  const opponents = state.players
    .map((p, i) => i)
    .filter((i) => i !== leaderIdx);
  const unitsDesc = combo.units.slice().sort((a, b) => (b.size - a.size) || (b.strength - a.strength));
  for (const u of unitsDesc) {
    for (const oi of opponents) {
      const defense = maxUnitsOfHand(state.players[oi].hand, domain, state.trumpInfo, cfg);
      if (unitCovered(u, defense)) {
        const byName = `第${oi + 1}位玩家`;
        if (cfg.throwPenalty === 'smallest' || cfg.throwPenalty === 'penalty_smallest') {
          const hand = state.players[leaderIdx].hand;
          const domainCards = sortHand(
            hand.filter((c) => domainOf(c, state.trumpInfo) === domain),
            state.trumpInfo
          );
          if (domainCards.length < combo.n) {
            return result(false, '甩牌不成立且该门牌不足以罚出等量牌', 'E102');
          }
          const replacement = domainCards.slice(0, combo.n);
          const isPenalty = cfg.throwPenalty === 'penalty_smallest';
          return result(false, isPenalty
            ? `甩牌不成立（${byName}可压）：罚 ${combo.n * 10} 分给对方，并改为出该门最小 ${combo.n} 张`
            : `甩牌不成立（${byName}可压），改为出该门最小 ${combo.n} 张`, 'E102', {
            failUnit: u,
            coverBy: oi,
            replacement,
            // penalty_smallest：罚 10 分/张（对方阵营），由状态机出牌时记入 penaltyPoints
            penaltyPoints: isPenalty ? combo.n * 10 : 0
          });
        }
        return result(false, `甩牌不成立（${byName}有更大的牌可压）`, 'E102', { failUnit: u, coverBy: oi });
      }
    }
  }
  return result(true);
}

module.exports = { validateThrow, maxUnitsOfHand, unitCovered };

});
__def("engine/trick", function (exports, __require, module) {
/**
 * engine/trick.js —— 墩结算：争胜资格 / 逐家比较 / 赢墩 / 分牌收集。
 *
 * 争胜资格（PRD §5.10）：
 *   1. 有效将吃的主牌 > 一切副牌；主牌之间按主牌序比；
 *   2. 同为领出花色：按领出结构比较（拖头/对/甩逐单元）；
 *   3. 后压过者胜（逐家滚动比较，最终最大者赢墩）；
 *   4. 垫牌（缺门非主 / 主牌结构不对应 / 非领出花色）永远不争胜。
 */

'use strict';

const { parseCombo, canBeat, pointsOf, domainOf } = __require('engine/combo');
const { pointValue } = __require('engine/card');
const { isEffectiveTrumpFollow } = __require('engine/follow');

/**
 * 计算一次跟牌的争胜资格与比较组合。
 * @param {object} play PlayRecord（playerIdx/cards/combo/isDiscard/isEffectiveTrump）
 * @param {object} leadCombo
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {{contending: boolean, combo: object|null, kind: 'lead'|'trump'|'follow'|'discard'}}
 */
function playContendInfo(play, leadCombo, trumpInfo, cfg) {
  if (play.playerIdx === leadCombo.leadPlayerIdx) {
    return { contending: true, combo: play.combo, kind: 'lead' };
  }
  const combo = parseCombo(play.cards, trumpInfo, cfg);
  if (!combo) return { contending: false, combo: null, kind: 'discard' };
  // 全主牌且领出非主 → 有效将吃判定重算（不信任序列化标志）
  const allTrump = play.cards.every((c) => domainOf(c, trumpInfo) === 'TRUMP');
  if (allTrump && !leadCombo.isTrump) {
    if (isEffectiveTrumpFollow(leadCombo, play.cards, trumpInfo, cfg)) {
      return { contending: true, combo, kind: 'trump' };
    }
    return { contending: false, combo: null, kind: 'discard' };
  }
  // 同为领出域副牌 → 正常争胜比较
  if (combo.suit === leadCombo.suit && !leadCombo.isTrump) {
    return { contending: true, combo, kind: 'follow' };
  }
  // 领出是主牌域：跟牌全主才争胜
  if (leadCombo.isTrump && allTrump) {
    return { contending: true, combo, kind: 'follow' };
  }
  return { contending: false, combo: null, kind: 'discard' };
}

/**
 * 判定 challenger 是否压过 incumbent。
 * @param {object} chInc playContendInfo(挑战者)
 * @param {object} incInc playContendInfo(当前最大者)
 * @param {object} leadCombo
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {boolean}
 */
function beats(chInc, incInc, leadCombo, trumpInfo, cfg) {
  // 副牌 vs 主牌（将吃）：主赢
  if (chInc.kind === 'trump' && incInc.kind !== 'trump') return true;
  if (chInc.kind !== 'trump' && incInc.kind === 'trump') return false;
  // 同类：组合比较（canBeat 语义=结构压过；tie 时返回 false → 先出为大）
  if (leadCombo.type === 'single' || leadCombo.type === 'pair' || leadCombo.type === 'tractor') {
    return canBeat(incInc.combo, chInc.combo);
  }
  // 甩牌：逐单元压过
  return canBeat(incInc.combo, chInc.combo);
}

/**
 * 墩结算。
 * @param {object} trick TrickData（plays 已含 4 家）
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {{winnerIdx: number, points: number, detail: Array}}
 */
function resolveTrick(trick, trumpInfo, cfg) {
  const leadCombo = trick.leadCombo;
  const infos = trick.plays.map((p) => playContendInfo(p, leadCombo, trumpInfo, cfg));
  let bestIdx = 0;
  for (let i = 1; i < trick.plays.length; i++) {
    const ch = infos[i];
    if (!ch.contending) continue;
    const inc = infos[bestIdx];
    if (beats(ch, inc, leadCombo, trumpInfo, cfg)) bestIdx = i;
  }
  const points = trick.plays.reduce(
    (s, p) => s + p.cards.reduce((x, c) => x + pointValue(c, cfg), 0), 0
  );
  trick.winnerIdx = trick.plays[bestIdx].playerIdx;
  trick.points = points;
  return {
    winnerIdx: trick.winnerIdx,
    points,
    detail: infos.map((info, i) => ({
      playerIdx: trick.plays[i].playerIdx,
      kind: info.kind,
      contending: info.contending
    }))
  };
}

/**
 * 最后一墩牌型（R10 按牌型加倍抠底用）。
 * @param {object} lastTrick
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {string} single|pair|tractor|throw（取赢家牌型；甩牌取最大单元）
 */
function lastTrickShape(lastTrick, trumpInfo, cfg) {
  const leadCombo = lastTrick.leadCombo;
  if (leadCombo.type !== 'throw') return leadCombo.type;
  // 甩牌取最大单元牌型
  const biggest = leadCombo.units.reduce((m, u) => (u.size > m.size ? u : m), leadCombo.units[0]);
  return biggest.type;
}

module.exports = { resolveTrick, playContendInfo, beats, lastTrickShape };

});
__def("engine/trump", function (exports, __require, module) {
/**
 * engine/trump.js —— 主牌域构建（有主 / 无主局）。
 *
 * TrumpInfo 是 (trumpSuit, levelRank, cfg) 的纯函数：序列化时只需存三元组，
 * 反序列化时重建（core/state.js 依赖此特性）。
 *
 * 主牌大小（PRD §5.3，有主局，主花色 S、级牌 X）：
 *   大王 > 小王 > S-X > 副X（三门同级，先出为大 R13）> S-A > S-K > … > S-3
 * 无主局（R8）：仅 大王 > 小王 > 8 张级牌（四门同级，先出为大）。
 *
 * 主牌逻辑序（供拖拉机相邻判定，step 越小越大）：
 *   有主：BJ=0, RJ=1, 主X=2, 副X=3(tie), 主A=4, 主K=5, …
 *   无主：BJ=0, RJ=1, 级X=2(tie)
 */

'use strict';

const { cardKey, rankValue, SUITS } = __require('engine/card');

/** 主牌强度值（越大越强；副级牌 970 三门同级 → R13 先出为大） */
const TRUMP_STRENGTH = {
  BJ: 1000,
  RJ: 990,
  TRUMP_SUIT_RANK: 980,
  OFF_SUIT_RANK: 970
};

/**
 * 构建主牌域信息。
 * @param {string|null} trumpSuit 主花色；null = 无主局
 * @param {string} levelRank 本局级牌（打几）
 * @param {object} cfg RuleConfig
 * @returns {{levelRank: string, trumpSuit: string|null, isNoTrump: boolean,
 *           trumpIds: Set<string>, order: Array<object>, offRankStep: number}}
 */
function buildTrumpInfo(trumpSuit, levelRank, cfg) {
  const isNoTrump = trumpSuit === null || trumpSuit === undefined;
  if (!isNoTrump && !SUITS.includes(trumpSuit)) {
    throw new Error(`非法主花色：${trumpSuit}`);
  }
  const level = typeof levelRank === 'number' ? String(levelRank) : levelRank;

  /** @type {Set<string>} 主牌 cardKey 集合（大小王 + 全部级牌 + 主花色整门） */
  const trumpIds = new Set();
  /** @type {Array<{step:number,key:string,suit:string,rank:string,tie:boolean}>} 降序逻辑序 */
  const order = [];

  // 大小王
  trumpIds.add('JOKER-BJ');
  trumpIds.add('JOKER-RJ');
  order.push({ step: 0, key: 'JOKER-BJ', suit: 'JOKER', rank: 'BJ', tie: false });
  order.push({ step: 1, key: 'JOKER-RJ', suit: 'JOKER', rank: 'RJ', tie: false });

  let offRankStep;
  if (isNoTrump) {
    // 无主局：4 门级牌同级（8 张），step=2
    offRankStep = 2;
    SUITS.forEach((s) => trumpIds.add(`${s}-${level}`));
    order.push({ step: 2, key: `OFF-${level}`, suit: 'OFF', rank: level, tie: true });
  } else {
    // 有主局：主花色级牌 > 副级牌（3 门同级 tie）
    trumpIds.add(`${trumpSuit}-${level}`);
    order.push({ step: 2, key: `${trumpSuit}-${level}`, suit: trumpSuit, rank: level, tie: false });
    offRankStep = 3;
    SUITS.filter((s) => s !== trumpSuit).forEach((s) => trumpIds.add(`${s}-${level}`));
    order.push({ step: 3, key: `OFF-${level}`, suit: 'OFF', rank: level, tie: true });
    // 主花色 A~3（跳过级牌）
    for (let v = 14; v >= 2; v--) {
      const r = Object.keys({ 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, J: 1, Q: 1, K: 1, A: 1 })
        .find((k) => rankValue(k) === v);
      if (r === level) continue;
      trumpIds.add(`${trumpSuit}-${r}`);
      order.push({ step: 4 + (14 - v), key: `${trumpSuit}-${r}`, suit: trumpSuit, rank: r, tie: false });
    }
  }

  return {
    levelRank: level,
    trumpSuit: isNoTrump ? null : trumpSuit,
    isNoTrump,
    trumpIds,
    order,
    offRankStep
  };
}

/**
 * 主牌强度值（非主牌返回 -1）。
 * @param {{suit:string,rank:string,isJoker:boolean}} card
 * @param {object} trumpInfo
 * @returns {number}
 */
function trumpStrength(card, trumpInfo) {
  if (!trumpInfo) return -1;
  if (card.isJoker) {
    return card.rank === 'BJ' ? TRUMP_STRENGTH.BJ : TRUMP_STRENGTH.RJ;
  }
  if (!trumpInfo.trumpIds.has(cardKey(card))) return -1;
  if (trumpInfo.isNoTrump) return TRUMP_STRENGTH.OFF_SUIT_RANK;
  if (card.suit === trumpInfo.trumpSuit) {
    if (card.rank === trumpInfo.levelRank) return TRUMP_STRENGTH.TRUMP_SUIT_RANK;
    return 900 + rankValue(card.rank);
  }
  return TRUMP_STRENGTH.OFF_SUIT_RANK; // 副级牌
}

/**
 * 主牌域逻辑 step（越小越大；非主牌返回 -1）。
 * 副级牌多门共享同一 step（tie），相邻判定见 combo.pairAdjacent。
 * @param {{suit:string,rank:string,isJoker:boolean}} card
 * @param {object} trumpInfo
 * @returns {number}
 */
function trumpStep(card, trumpInfo) {
  if (!trumpInfo) return -1;
  if (card.isJoker) return card.rank === 'BJ' ? 0 : 1;
  if (card.isJoker) return -1;
  if (!trumpInfo.trumpIds.has(cardKey(card))) return -1;
  if (!trumpInfo.isNoTrump && card.suit === trumpInfo.trumpSuit) {
    if (card.rank === trumpInfo.levelRank) return 2;
    return 4 + (14 - rankValue(card.rank));
  }
  return trumpInfo.offRankStep; // 副级牌（有主 3 / 无主 2）
}

/**
 * 是否副级牌（tie 域，多门同级）。
 * @param {{suit:string,rank:string,isJoker:boolean}} card
 * @param {object} trumpInfo
 * @returns {boolean}
 */
function isOffRankCard(card, trumpInfo) {
  return trumpStep(card, trumpInfo) === trumpInfo.offRankStep && !card.isJoker;
}

module.exports = { buildTrumpInfo, trumpStrength, trumpStep, isOffRankCard, TRUMP_STRENGTH };

});
__def("engine/validate", function (exports, __require, module) {
/**
 * engine/validate.js —— 出牌校验总入口 + 合法出牌集合枚举。
 *
 * validatePlay：AI 与真人共用的唯一合法性真值（AI 铁律二次校验点）。
 * legalMoves：当前玩家全部（代表性）合法出牌组合；每个候选均经 validatePlay
 *             过滤后返回，保证集合内 100% 合法（reject 模式下甩牌不合法组合不出现）。
 */

'use strict';

const { parseCombo, domainOf, decomposeDomain, isPair, pointsOf } = __require('engine/combo');
const { cardKey } = __require('engine/card');
const { validateThrow } = __require('engine/throw');
const { validateFollow } = __require('engine/follow');
const { result } = __require('engine/errors');

/**
 * 牌是否全在手。
 */
function allInHand(hand, cards_) {
  const ids = new Set(hand.map((c) => c.id));
  return cards_.every((c) => ids.has(c.id));
}

/**
 * 领出校验（含甩牌成立性）。
 * @param {object} state
 * @param {number} playerIdx
 * @param {Array<object>} cards
 * @param {object} cfg
 */
function validateLead(state, playerIdx, cards_, cfg, opts) {
  const combo = parseCombo(cards_, state.trumpInfo, cfg);
  if (!combo) {
    return result(false, '出牌必须同域（一门副牌或全主牌）', 'E112');
  }
  // skipThrowValidation：R14 罚则路径——罚出的该门最小牌不再做成立性二次校验
  //（最小牌几乎必然可被压，二次校验会死锁罚则；同域/张数等基础校验仍全量执行）
  if (combo.type === 'throw' && !(opts && opts.skipThrowValidation)) {
    const t = validateThrow(state, combo, playerIdx, cfg);
    if (!t.ok) return t;
  }
  return result(true, null, null, { combo });
}

/**
 * 出牌校验总入口。
 * @param {object} state GameState
 * @param {number} playerIdx
 * @param {Array<object>} cards
 * @returns {{ok: boolean, reason?: string, errorCode?: string, meta?: object}}
 */
function validatePlay(state, playerIdx, cards_, opts) {
  const cfg = state.config;
  if (!cards_ || cards_.length === 0) {
    return result(false, '请选择要出的牌', 'E101');
  }
  const hand = state.players[playerIdx].hand;
  if (!allInHand(hand, cards_)) {
    return result(false, '所出牌不在手牌中', 'E105');
  }
  const isLead = !state.currentTrick || state.currentTrick.plays.length === 0;
  if (isLead) {
    return validateLead(state, playerIdx, cards_, cfg, opts);
  }
  const lead = state.currentTrick.leadCombo;
  if (cards_.length !== lead.n) {
    return result(false, `本墩须出 ${lead.n} 张牌`, 'E106');
  }
  return validateFollow(state, playerIdx, cards_, cfg);
}

/**
 * 埋底校验。
 * @param {object} state
 * @param {number} playerIdx
 * @param {Array<object>} cards
 */
function validateBury(state, playerIdx, cards_) {
  const cfg = state.config;
  if (state.phase !== 'BURYING') {
    return result(false, '当前不在埋底阶段', 'E202');
  }
  if (playerIdx !== state.dealerIdx) {
    return result(false, '只有庄家可以埋底', 'E108');
  }
  if (!cards_ || cards_.length !== cfg.bottomCards) {
    return result(false, `埋底张数须为 ${cfg.bottomCards} 张`, 'E107');
  }
  if (!allInHand(state.players[playerIdx].hand, cards_)) {
    return result(false, '埋底牌不在手牌中', 'E105');
  }
  return result(true);
}

/* ===================== 合法集合枚举（AI / 提示 F-10 共用） ===================== */

/** 组合去重键：排序后的 cardKey 序列 */
function playKey(cards_) {
  return cards_.map((c) => cardKey(c)).sort().join('|');
}

/**
 * 手牌按域分组。
 */
function groupByDomain(hand, trumpInfo) {
  const groups = new Map();
  hand.forEach((c) => {
    const d = domainOf(c, trumpInfo);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(c);
  });
  return groups;
}

/**
 * 域内全部对（cardKey → 两张牌）。
 */
function pairsOf(domainCards_, trumpInfo) {
  const byKey = new Map();
  domainCards_.forEach((c) => {
    const k = cardKey(c);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  });
  const pairs = [];
  byKey.forEach((list) => {
    for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  });
  return pairs;
}

/**
 * 域内全部相邻对链（窗口长度 ≥2 的所有连续拖拉机）。
 * @returns {Array<Array<object>>} 每项为 2k 张牌的拖拉机
 */
function tractorWindowsOf(domainCards_, trumpInfo, cfg) {
  const { pairAdjacent } = __require('engine/combo');
  const units = pairsOf(domainCards_, trumpInfo)
    .map((p) => ({ cards: p, head: p[0] }))
    .sort((a, b) => strengthSortKey(a.head, trumpInfo) - strengthSortKey(b.head, trumpInfo));
  const windows = [];
  let chain = [];
  const flush = () => {
    for (let len = 2; len <= chain.length; len++) {
      for (let s = 0; s + len <= chain.length; s++) {
        windows.push(chain.slice(s, s + len).reduce((acc, u) => acc.concat(u.cards), []));
      }
    }
    chain = [];
  };
  units.forEach((u, i) => {
    if (i === 0 || pairAdjacent({ cards: units[i - 1].cards }, { cards: u.cards }, trumpInfo, cfg)) {
      chain.push(u);
    } else {
      flush();
      chain = [u];
    }
  });
  flush();
  return windows;
}

/** 域内强度（复用 combo.strengthInDomain 语义） */
function strengthSortKey(card, trumpInfo) {
  const { strengthInDomain } = __require('engine/combo');
  return -strengthInDomain(card, trumpInfo); // 升序排序 → 强度降序
}

/**
 * 领出候选枚举。
 */
function leadCandidates(state, playerIdx) {
  const cfg = state.config;
  const hand = state.players[playerIdx].hand;
  const ti = state.trumpInfo;
  const groups = groupByDomain(hand, ti);
  const out = [];
  const push = (cards_) => out.push(cards_);

  groups.forEach((domainCards_, domain) => {
    // 单张（同名去重，取一张代表）
    const seenKey = new Set();
    domainCards_.forEach((c) => {
      const k = cardKey(c);
      if (!seenKey.has(k)) {
        seenKey.add(k);
        push([c]);
      }
    });
    // 对子
    pairsOf(domainCards_, ti).forEach((p) => push(p));
    // 拖拉机（全部连续窗口）
    tractorWindowsOf(domainCards_, ti, cfg).forEach((t) => push(t));
    // 甩牌候选（有分/有结构的常见组合）：整域最大单元组合、对+单、最大两单
    const units = decomposeDomain(domainCards_, ti, cfg);
    if (units.length >= 2) {
      push(units.reduce((acc, u) => acc.concat(u.cards), [])); // 全单元甩
      const pairU = units.find((u) => u.type === 'pair');
      const singleU = units.filter((u) => u.type === 'single');
      if (pairU && singleU.length) push(pairU.cards.concat(singleU[0].cards)); // 对+最大单
      if (singleU.length >= 2) push(singleU[0].cards.concat(singleU[1].cards)); // 双单甩
    }
  });
  return out;
}

/**
 * 跟牌候选枚举。
 */
function followCandidates(state, playerIdx) {
  const cfg = state.config;
  const hand = state.players[playerIdx].hand;
  const ti = state.trumpInfo;
  const lead = state.currentTrick.leadCombo;
  const n = lead.n;
  const domain = lead.suit;
  const avail = hand.filter((c) => domainOf(c, ti) === domain);
  const out = [];
  const push = (cards_) => {
    if (cards_.length === n) out.push(cards_);
  };

  if (avail.length > 0) {
    // 该门不足 n 张：全部给出 + 最小垫牌补齐（PRD §5.9 防御条款）
    if (avail.length < n) {
      const rest = hand.filter((c) => domainOf(c, ti) !== domain)
        .sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
      const fill = rest.slice(0, n - avail.length);
      push(avail.concat(fill));
      return out;
    }
    if (n === 1) {
      const seen = new Set();
      avail.forEach((c) => {
        const k = cardKey(c);
        if (!seen.has(k)) { seen.add(k); push([c]); }
      });
      return out;
    }
    if (lead.type === 'pair') {
      const pairs = pairsOf(avail, ti);
      pairs.forEach((p) => push(p));
      // 无对（或 R11 关）时的单+单组合（限量：最小单与其他单组合）
      const singles = avail.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
      if (pairs.length === 0 || !cfg.mustFollowPairAsPair) {
        for (let i = 0; i < singles.length && i < 6; i++) {
          for (let j = i + 1; j < singles.length && j < 8; j++) {
            push([singles[i], singles[j]]);
          }
        }
      }
      return out;
    }
    if (lead.type === 'tractor') {
      const k = lead.units[0].cards.length / 2;
      // 全部 k 对连续窗口拖拉机
      tractorWindowsOf(avail, ti, cfg).forEach((t) => push(t));
      // 对子 + 最小单补齐（j 对 + 2(k-j) 单）
      const pairs = pairsOf(avail, ti)
        .sort((a, b) => strengthSortKey(b[0], ti) - strengthSortKey(a[0], ti));
      const singles = avail.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
      const usedKeys = new Set();
      for (let j = k; j >= 0; j--) {
        const chosen = [];
        usedKeys.clear();
        for (let x = 0; x < j && x < pairs.length; x++) {
          chosen.push(...pairs[x]);
          pairs[x].forEach((c) => usedKeys.add(cardKey(c)));
        }
        const fill = [];
        for (const s of singles) {
          if (fill.length >= (n - chosen.length)) break;
          const cnt = chosen.filter((c) => c.id === s.id).length;
          const sameKeyUsed = chosen.filter((c) => cardKey(c) === cardKey(s)).length;
          const availCnt = avail.filter((c) => cardKey(c) === cardKey(s)).length;
          if (sameKeyUsed < availCnt && cnt === 0) fill.push(s);
        }
        if (chosen.length + fill.length === n) push(chosen.concat(fill));
      }
      return out;
    }
    // 甩牌领出：结构自由 → 最小 n 张、保对去单组合、最大 n 张
    const sorted = avail.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
    push(sorted.slice(0, n)); // 最小垫
    push(sorted.slice(0, n).reverse()); // 最大
    const units = decomposeDomain(avail, ti, cfg);
    const keep = [];
    const singlesLeft = [];
    units.forEach((u) => {
      if (u.type === 'single') singlesLeft.push(...u.cards);
    });
    let take = 0;
    for (const u of units) {
      if (u.type === 'single') continue;
      if (take + u.size > n) continue;
      take += u.size;
      keep.push(...u.cards);
    }
    for (const s of singlesLeft) {
      if (take >= n) break;
      take++;
      keep.push(s);
    }
    if (keep.length === n) push(keep);
    return out;
  }

  // 缺门：任意 n 张合法。代表集：主牌结构对应（将吃）、最小垫、分牌垫
  const trumps = hand.filter((c) => domainOf(c, ti) === 'TRUMP');
  if (n === 1) {
    const seen = new Set();
    hand.forEach((c) => {
      const k = cardKey(c);
      if (!seen.has(k)) { seen.add(k); push([c]); }
    });
    return out;
  }
  if (lead.type === 'pair') {
    pairsOf(trumps, ti).forEach((p) => push(p)); // 主对将吃
    pairsOf(hand, ti).forEach((p) => push(p)); // 副对垫
    const singles = hand.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
    for (let i = 0; i < singles.length && i < 6; i++) {
      for (let j = i + 1; j < singles.length && j < 8; j++) push([singles[i], singles[j]]);
    }
    return out;
  }
  if (lead.type === 'tractor') {
    tractorWindowsOf(trumps, ti, cfg).forEach((t) => push(t)); // 主拖将吃
    tractorWindowsOf(hand, ti, cfg).forEach((t) => push(t));
    const k = lead.units[0].cards.length / 2;
    const pairs = pairsOf(hand, ti);
    const singles = hand.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
    const chosen = [];
    for (let x = 0; x < k && x < pairs.length; x++) chosen.push(...pairs[x]);
    const usedIds = new Set(chosen.map((c) => c.id));
    for (const s of singles) {
      if (chosen.length >= n) break;
      if (!usedIds.has(s.id)) { chosen.push(s); usedIds.add(s.id); }
    }
    if (chosen.length === n) push(chosen);
    push(singles.slice(0, n));
    return out;
  }
  // 甩牌缺门：主牌全压组合 / 最小垫
  const tSorted = trumps.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
  const tUnits = decomposeDomain(trumps, ti, cfg);
  const trumpKeep = [];
  let tk = 0;
  for (const u of tUnits) {
    if (u.type === 'single') continue;
    if (tk + u.size > n) continue;
    tk += u.size;
    trumpKeep.push(...u.cards);
  }
  for (const s of tSorted) {
    if (tk >= n) break;
    if (!trumpKeep.find((c) => c.id === s.id)) { tk++; trumpKeep.push(s); }
  }
  if (trumpKeep.length === n) push(trumpKeep);
  const all = hand.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
  push(all.slice(0, n));
  const pointFirst = hand.slice().sort((a, b) => pointsOf([b], cfg) - pointsOf([a], cfg));
  const pf = [];
  const pfIds = new Set();
  for (const c of pointFirst) {
    if (pf.length >= n) break;
    if (pointsOf([c], cfg) > 0 && !pfIds.has(c.id)) { pf.push(c); pfIds.add(c.id); }
  }
  for (const c of all) {
    if (pf.length >= n) break;
    if (!pfIds.has(c.id)) { pf.push(c); pfIds.add(c.id); }
  }
  if (pf.length === n) push(pf);
  return out;
}

/**
 * 枚举当前玩家全部合法出牌（去重后逐个经 validatePlay 过滤）。
 * @param {object} state
 * @param {number} playerIdx
 * @returns {Array<Array<object>>} 合法 Card[][]
 */
function legalMoves(state, playerIdx) {
  const isLead = !state.currentTrick || state.currentTrick.plays.length === 0;
  const raw = isLead ? leadCandidates(state, playerIdx) : followCandidates(state, playerIdx);
  const seen = new Set();
  const out = [];
  raw.forEach((cards_) => {
    const key = playKey(cards_);
    if (seen.has(key)) return;
    seen.add(key);
    const v = validatePlay(state, playerIdx, cards_);
    if (v.ok) out.push(cards_);
  });
  return out;
}

module.exports = {
  validatePlay,
  validateLead,
  validateBury,
  legalMoves,
  _internals: { leadCandidates, followCandidates, pairsOf, tractorWindowsOf, groupByDomain, playKey }
};

});
__def("core/actions", function (exports, __require, module) {
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

});
__def("core/dealer-ai-loop", function (exports, __require, module) {
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

const { transition, enterBurying } = __require('core/statemachine');
const { Logger } = __require('core/logger');
const { createRng } = __require('utils/random');
const { RuleError } = __require('engine/errors');

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
  const { scoreBidOptions } = __require('engine/bid');
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
  const { classifyBidCards, bidPriority } = __require('engine/bid');
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
        const { scoreBidOptions } = __require('engine/bid');
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

});
__def("core/logger", function (exports, __require, module) {
/**
 * core/logger.js —— 事件日志（复盘 F-18 与调试用，纯逻辑）。
 */

'use strict';

/**
 * 环形日志（容量限制防内存膨胀）。
 */
class Logger {
  /**
   * @param {number} [capacity=2000]
   */
  constructor(capacity) {
    this.capacity = capacity || 2000;
    /** @type {Array<object>} */
    this.entries = [];
  }

  /**
   * 追加日志。
   * @param {string} type 事件类型（action type / 'SYS'）
   * @param {object} data 摘要数据（小对象）
   */
  log(type, data) {
    this.entries.push({ ts: Date.now(), type, data: data || {} });
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  /**
   * 查询。
   * @param {object} [filter] {type?, playerIdx?}
   * @returns {Array<object>}
   */
  query(filter) {
    const f = filter || {};
    return this.entries.filter((e) => {
      if (f.type && e.type !== f.type) return false;
      if (f.playerIdx !== undefined && e.data.playerIdx !== f.playerIdx) return false;
      return true;
    });
  }

  /**
   * 导出（序列化）。
   * @returns {Array<object>}
   */
  export() {
    return this.entries.slice();
  }

  /**
   * 清空。
   */
  clear() {
    this.entries = [];
  }
}

module.exports = { Logger };

});
__def("core/state", function (exports, __require, module) {
/**
 * core/state.js —— GameState 创建 / clone / 序列化与反序列化（断线续玩 F-09）。
 *
 * GameState 全量可序列化：JSON.stringify 后可完整恢复。
 * 序列化特殊处理（§8.8）：
 *   - trumpInfo：trumpIds(Set) → 数组；order 含 Card 引用 → 存三元组重建；
 *   - logger 不入 state（服务层独立）。
 */

'use strict';

const { DEFAULT_CONFIG, createConfig } = __require('engine/config');
const { buildDeck, shuffle, dealInitial } = __require('engine/deck');
const { buildTrumpInfo } = __require('engine/trump');
const { createRng } = __require('utils/random');
const { RuleError } = __require('engine/errors');

/** 当前结构版本 */
const SCHEMA_VERSION = 1;

/** 默认玩家表（§8.2：0=S 南真人，1=E 东，2=N 北，3=W 西）
 *  team 仅升级模式（2v2）有意义；三打一阵营由 sanDaYiTeams 动态决定（庄 vs 三家） */
const DEFAULT_PLAYERS = [
  { seat: 'S', team: 0, isHuman: true, name: '你' },
  { seat: 'E', team: 1, isHuman: false, name: '东家AI' },
  { seat: 'N', team: 0, isHuman: false, name: '北家AI' },
  { seat: 'W', team: 1, isHuman: false, name: '西家AI' }
];

/**
 * 创建初始状态。
 * @param {object} [config] RuleConfig（缺省 DEFAULT_CONFIG）
 * @param {Array<object>} [players] 4 人（缺省默认表）
 * @param {object} [rng] 随机源（缺省自建）
 * @param {object} [opts] {seed, dealerIdx, levels}
 * @returns {object} GameState
 */
function createInitialState(config, players, rng, opts) {
  const cfg = config || DEFAULT_CONFIG;
  const o = opts || {};
  const rand = rng || createRng(o.seed);
  const state = {
    schemaVersion: SCHEMA_VERSION,
    config: cfg,
    roundNo: 1,
    phase: 'INIT_DEAL',
    players: (players || DEFAULT_PLAYERS).map((p) => ({
      seat: p.seat,
      team: p.team,
      isHuman: p.isHuman,
      name: p.name,
      hand: []
    })),
    turnIdx: o.dealerIdx !== undefined ? o.dealerIdx : 0,
    playOrder: cfg.playDirection === 'clockwise' ? [0, 3, 2, 1] : [0, 1, 2, 3],
    deck: [],
    bottomCards: [],
    bottomRevealed: false,
    bids: [],
    trumpInfo: null,
    dealerIdx: o.dealerIdx !== undefined ? o.dealerIdx : 0,
    bidWinnerIdx: null,
    passedBidders: [],
    bottomMerged: false,
    buryDone: false,
    currentTrick: null,
    completedTricks: [],
    scores: { team0: 0, team1: 0 },
    levels: o.levels || { team0: cfg.rankStart, team1: cfg.rankStart },
    attackTeam: 1,
    lastSettle: null,
    lastDealerIdx: o.dealerIdx !== undefined ? o.dealerIdx : 0,
    seed: rand.seed,
    gameOver: false,
    roundHistory: []
  };
  return state;
}

/**
 * 洗牌并把整副牌放入 deck（发牌动作由 statemachine DEAL 执行）。
 * @param {object} state
 * @param {object} [rng]
 */
function prepareDeck(state, rng) {
  const rand = rng || createRng();
  const base = buildDeck(state.config);
  state.deck = shuffle(base, rand);
  state.seed = rand.seed;
}

/**
 * 执行发牌切分（DEAL action 内部使用）。
 * @param {object} state
 */
function dealHands(state) {
  const { hands, bottom } = dealInitial(state.deck, state.config);
  state.players.forEach((p, i) => {
    p.hand = hands[i];
  });
  state.bottomCards = bottom;
  state.deck = [];
}

/**
 * 浅 clone state（结构共享：reducer 返回新引用，深层字段按需替换）。
 * @param {object} state
 * @returns {object}
 */
function cloneState(state) {
  return Object.assign({}, state, {
    players: state.players.map((p) => Object.assign({}, p, { hand: p.hand.slice() })),
    playOrder: state.playOrder.slice(),
    deck: state.deck.slice(),
    bottomCards: state.bottomCards.slice(),
    bids: state.bids.map((b) => Object.assign({}, b, { cards: b.cards.slice() })),
    passedBidders: (state.passedBidders || []).slice(),
    completedTricks: state.completedTricks.map((t) => cloneTrick(t)),
    currentTrick: state.currentTrick ? cloneTrick(state.currentTrick) : null,
    scores: Object.assign({}, state.scores),
    levels: Object.assign({}, state.levels),
    lastSettle: state.lastSettle ? Object.assign({}, state.lastSettle) : null,
    roundHistory: state.roundHistory.slice(),
    config: state.config
  });
}

/** clone 一墩 */
function cloneTrick(trick) {
  return Object.assign({}, trick, {
    plays: trick.plays.map((p) => Object.assign({}, p, {
      cards: p.cards.slice(),
      combo: p.combo ? Object.assign({}, p.combo) : null
    })),
    leadCombo: Object.assign({}, trick.leadCombo)
  });
}

/**
 * 序列化（JSON 安全）。
 * @param {object} state
 * @returns {object} 可 JSON.stringify 的普通对象
 */
function serializeState(state) {
  const plain = cloneState(state);
  // trumpInfo：Set → 数组；order 重建材料 = (levelRank, trumpSuit, isNoTrump)
  plain.trumpInfo = state.trumpInfo ? {
    levelRank: state.trumpInfo.levelRank,
    trumpSuit: state.trumpInfo.trumpSuit,
    isNoTrump: state.trumpInfo.isNoTrump
  } : null;
  return plain;
}

/**
 * 反序列化（版本兼容检查 E301）。
 * @param {object|string} json
 * @returns {object} GameState（trumpInfo.trumpIds/order 重建）
 * @throws {RuleError} E301 版本过新 / E302 数据损坏
 */
function deserializeState(json) {
  let obj = json;
  if (typeof json === 'string') {
    try {
      obj = JSON.parse(json);
    } catch (e) {
      throw new RuleError('E302', '存档 JSON 解析失败');
    }
  }
  if (!obj || typeof obj !== 'object' || !obj.phase) {
    throw new RuleError('E302', '存档缺少 phase 字段');
  }
  if (obj.schemaVersion > SCHEMA_VERSION) {
    throw new RuleError('E301', `存档版本 ${obj.schemaVersion} 高于当前 ${SCHEMA_VERSION}`);
  }
  const state = Object.assign({}, obj);
  // 重建 trumpInfo
  if (state.trumpInfo && state.trumpInfo.levelRank) {
    const ti = state.trumpInfo;
    state.trumpInfo = buildTrumpInfo(ti.trumpSuit, ti.levelRank, state.config || DEFAULT_CONFIG);
  } else {
    state.trumpInfo = null;
  }
  return state;
}

/**
 * 校验 state 完整可恢复（QA 工具）。
 * @param {object} state
 * @returns {boolean}
 */
function roundTripOk(state) {
  const restored = deserializeState(serializeState(state));
  return restored.phase === state.phase
    && restored.players.length === state.players.length
    && restored.players.every((p, i) => p.hand.length === state.players[i].hand.length)
    && (!state.trumpInfo || (
      restored.trumpInfo.levelRank === state.trumpInfo.levelRank
      && restored.trumpInfo.trumpSuit === state.trumpInfo.trumpSuit
      && restored.trumpInfo.isNoTrump === state.trumpInfo.isNoTrump
    ));
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_PLAYERS,
  createInitialState,
  prepareDeck,
  dealHands,
  cloneState,
  serializeState,
  deserializeState,
  roundTripOk
};

});
__def("core/statemachine", function (exports, __require, module) {
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

const { canBid, classifyBidCards, bidPriority, currentPriority, bidWindowOpen, canScoreBid } = __require('engine/bid');
const { validatePlay, validateBury } = __require('engine/validate');
const { parseCombo } = __require('engine/combo');
const { resolveTrick } = __require('engine/trick');
const { settleRound } = __require('engine/settle');
const { buildTrumpInfo } = __require('engine/trump');
const { RuleError } = __require('engine/errors');
const { prepareDeck, dealHands, cloneState } = __require('core/state');
const { createRng } = __require('utils/random');

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
  // QQ 规则：每人只叫一次，叫过即用掉机会；放弃者出局。
  // 剩余有资格者 = 未 pass 且未叫过 且 不是自己
  const eligible = [0, 1, 2, 3].filter((i) =>
    i !== idx && !(s.passedBidders || []).includes(i)
    && !(s.bids || []).some((b) => b.type === 'score_bid' && b.playerIdx === i));
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

/** 三打一：pass（放弃叫分，本局出局）——QQ：全放弃则首位强制打最低分（或 redeal） */
function doPassScoreBid(s, idx) {
  if (!s.passedBidders.includes(idx)) {
    s.passedBidders.push(idx);
  }
  const hasBid = (s.bids || []).some((b) => b.type === 'score_bid');
  if (!hasBid && s.passedBidders.length >= 4) {
    // 全员放弃：force_lowest（QQ 默认）= 首位叫分者强制打最低分；redeal = 重发
    if (s.config.sanDaYiNoBidAction === 'redeal') {
      s.phase = 'INIT_DEAL';
      s.turnIdx = s.sanDaYiFirstBidder !== undefined ? s.sanDaYiFirstBidder : 0;
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
    // 成交判定：除最高报价者外，其余人全部出局（pass 或已叫过且被超过）
    const highest = s.scoreBidHighest;
    const bidded = (s.bids || []).filter((b) => b.type === 'score_bid').map((b) => b.playerIdx);
    const allOut = [0, 1, 2, 3].every((i) =>
      i === highest.playerIdx || s.passedBidders.includes(i) || bidded.includes(i));
    if (allOut) {
      return enterSanDaYiPlay(s);
    }
    // 轮到下一位有资格者（未 pass 且未叫过）
    let next = nextSeat(s, idx);
    let guard = 0;
    while (guard++ < 4 && (s.passedBidders.includes(next)
      || (s.bids || []).some((b) => b.type === 'score_bid' && b.playerIdx === next))) {
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

/**
 * 甩牌罚则预检（R14 非 reject 模式）：领出甩牌不成立时返回替换牌与罚分。
 * @returns {{replace: boolean, replacement?: Array, penaltyPoints: number}}
 */
function preCheckThrowPenalty(s, idx, cards_) {
  const isLead = !s.currentTrick || s.currentTrick.plays.length === 0;
  if (!isLead) return { replace: false, penaltyPoints: 0 };
  const combo = parseCombo(cards_, s.trumpInfo, s.config);
  if (!combo || combo.type !== 'throw') return { replace: false, penaltyPoints: 0 };
  const { validateThrow } = __require('engine/throw');
  const t = validateThrow(s, combo, idx, s.config);
  if (t.ok) return { replace: false, penaltyPoints: 0 };
  if (t.meta && t.meta.replacement) {
    return { replace: true, replacement: t.meta.replacement, penaltyPoints: t.meta.penaltyPoints || 0 };
  }
  // 无替换（该门牌不足）→ 原样抛错
  return { replace: false, penaltyPoints: 0 };
}

/** 三打一罚分记账：出牌者被罚 → 分加给对方阵营 */
function addPenaltyPoints(s, payerIdx, points) {
  if (!s.penaltyPoints) s.penaltyPoints = { dealer: 0, attackers: 0 };
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
  // R14=smallest/penalty_smallest：甩牌不成立 → 引擎强制替换为该门最小等量牌（+罚分记账）
  if (cfg.throwPenalty !== 'reject') {
    const pre = preCheckThrowPenalty(s, idx, cards_);
    if (pre.replace) {
      if (pre.penaltyPoints > 0) {
        addPenaltyPoints(s, idx, pre.penaltyPoints);
      }
      cards_ = pre.replacement;
    }
  }
  // 罚则替换牌不做甩牌成立性二次校验（最小牌必然可被压，二次校验会死锁罚则）
  const v = validatePlay(s, idx, cards_, { skipThrowValidation: true });
  if (!v.ok) {
    throw new RuleError(v.errorCode || 'E101', v.reason);
  }
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
    const isTrumpPlay = cards_.every((c) => __require('engine/combo').domainOf(c, s.trumpInfo) === 'TRUMP');
    const { isEffectiveTrumpFollow } = __require('engine/follow');
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

});
__def("ai/memory", function (exports, __require, module) {
/**
 * ai/memory.js —— 记牌器：已出牌 / 剩余牌 / 分牌统计跟踪（P1 困难难度用，结构先行）。
 *
 * 事件订阅 logger 或直接从 GameState 派生（纯函数）：
 *   - 已出牌（completedTricks + currentTrick）
 *   - 各域剩余张数（108 - 已出 - 自己手牌）
 *   - 分牌已出统计
 */

'use strict';

const { pointValue } = __require('engine/card');
const { domainOf } = __require('engine/combo');

/**
 * 从状态构建记牌视图。
 * @param {object} state GameState
 * @param {number} viewerIdx 观察者（AI）视角
 * @returns {object} memory view
 */
function buildMemory(state, viewerIdx) {
  const cfg = state.config;
  const played = [];
  state.completedTricks.forEach((t) => {
    t.plays.forEach((p) => played.push(...p.cards));
  });
  if (state.currentTrick) {
    state.currentTrick.plays.forEach((p) => played.push(...p.cards));
  }
  const myHand = state.players[viewerIdx].hand;

  // 剩余牌 = 全副牌 - 已出 - 我的手牌（对其他三家可见性=概率分布）
  const total = 54 * cfg.deckCount;
  const playedKeys = new Map();
  played.forEach((c) => {
    const k = `${c.suit}-${c.rank}`;
    playedKeys.set(k, (playedKeys.get(k) || 0) + 1);
  });
  const myKeys = new Map();
  myHand.forEach((c) => {
    const k = `${c.suit}-${c.rank}`;
    myKeys.set(k, (myKeys.get(k) || 0) + 1);
  });

  // 分牌统计
  const pointsPlayed = played.reduce((s, c) => s + pointValue(c, cfg), 0);
  const pointsInHand = myHand.reduce((s, c) => s + pointValue(c, cfg), 0);

  // 按域统计已出
  const playedByDomain = { TRUMP: 0, S: 0, H: 0, C: 0, D: 0 };
  played.forEach((c) => {
    if (state.trumpInfo) playedByDomain[domainOf(c, state.trumpInfo)]++;
  });

  return {
    playedCount: played.length,
    played,
    pointsPlayed,
    pointsInHand,
    totalPoints: total / 54 * 100, // 每副 100 分
    playedByDomain,
    remainingCount: total - played.length - myHand.length,
    isKeyPlayed: (key) => (playedKeys.get(key) || 0) >= cfg.deckCount,
    remainingOfKey: (key) => Math.max(0, cfg.deckCount - (playedKeys.get(key) || 0) - (myKeys.get(key) || 0))
  };
}

module.exports = { buildMemory };

});
__def("ai/strategy-greedy", function (exports, __require, module) {
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

const { legalMoves, validatePlay } = __require('engine/validate');
const { parseCombo, domainOf, pointsOf } = __require('engine/combo');
const { pointValue, sortHand } = __require('engine/card');
const { buildMemory } = __require('ai/memory');

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
    const { resolveTrick } = __require('engine/trick');
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
    const { strengthInDomain } = __require('engine/combo');
    return Math.max(...cards_.map((c) => strengthInDomain(c, ti)));
  }

  _isBiggestSingle(cards_, domainCards_, ti) {
    const { strengthInDomain } = __require('engine/combo');
    const s = strengthInDomain(cards_[0], ti);
    return domainCards_.every((c) => strengthInDomain(c, ti) <= s);
  }

  _isBiggestPair(cards_, domainCards_, ti) {
    const { strengthInDomain } = __require('engine/combo');
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
    const { resolveTrick } = __require('engine/trick');
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

});
__def("ai/strategy", function (exports, __require, module) {
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

const { GreedyStrategy } = __require('ai/strategy-greedy');

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

});
__def("services/game-service", function (exports, __require, module) {
/**
 * services/game-service.js —— 对局门面：组装状态机 + AI + 日志（纯逻辑，禁 wx.*）。
 */

'use strict';

const { createInitialState, serializeState, deserializeState, cloneState } = __require('core/state');
const { transition } = __require('core/statemachine');
const { stepAI, aiBidOptions } = __require('core/dealer-ai-loop');
const { Logger } = __require('core/logger');
const { createAI } = __require('ai/strategy');
const { validatePlay, validateBury } = __require('engine/validate');
const { canBid } = __require('engine/bid');
const { RuleError } = __require('engine/errors');
const { createRng } = __require('utils/random');
const { DEFAULT_CONFIG } = __require('engine/config');

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
    // 引擎 doPlay 将强制替换为该门最小等量牌（+罚分记账），符合线下"甩错自然罚分"规则；
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
            return { ok: true, replaced: true, playedCards: last.cards };
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

});
__def("services/hint", function (exports, __require, module) {
/**
 * services/hint.js —— 出牌提示生成（F-10，P1）：合法集合中选较优组合。
 *
 * 复用 AI 的贪心打分（同一 legalMoves 真值源），取 Top1 作为提示。
 */

'use strict';

const { legalMoves } = __require('engine/validate');
const { createAI } = __require('ai/strategy');

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

});
__def("services/stats", function (exports, __require, module) {
/**
 * services/stats.js —— 战绩统计（F-14，P1）：局数/胜率/最快过A 的纯计算。
 */

'use strict';

/**
 * 汇总战绩。
 * @param {Array<object>} records [{roundNo, myTeamWon, passedA, attackPoints, tricksCount, durationMs}]
 * @returns {object} 统计视图
 */
function summarize(records) {
  const list = Array.isArray(records) ? records : [];
  const total = list.length;
  const wins = list.filter((r) => r.myTeamWon).length;
  const passARecords = list.filter((r) => r.passedA);
  const fastestPassA = passARecords.length
    ? Math.min(...passARecords.map((r) => r.roundNo || 0))
    : null;
  const totalTricks = list.reduce((s, r) => s + (r.tricksCount || 0), 0);
  return {
    totalRounds: total,
    wins,
    losses: total - wins,
    winRate: total ? +(wins / total).toFixed(3) : 0,
    passACount: passARecords.length,
    fastestPassA,
    avgTricks: total ? +(totalTricks / total).toFixed(1) : 0
  };
}

/**
 * 追加一局记录（增量）。
 * @param {Array<object>} records
 * @param {object} record
 * @param {number} [cap=200] 上限
 * @returns {Array<object>}
 */
function appendRecord(records, record, cap) {
  const list = (records || []).slice();
  list.push(record);
  const limit = cap || 200;
  if (list.length > limit) list.splice(0, list.length - limit);
  return list;
}

module.exports = { summarize, appendRecord };

});
__def("utils/format", function (exports, __require, module) {
/**
 * utils/format.js —— 展示格式化（纯函数，无 wx.*）。
 *
 * 状态栏 / 结算页 / 规则速查页的文案拼装集中在此，UI 层不得散落规则数值
 * （数值一律取自 RuleConfig 快照）。
 */

'use strict';

const { SUIT_SYMBOLS } = __require('engine/card');

/** 方位中文名（players 下标 0..3 = S,E,N,W）；三打一模式北家是对手非队友 */
const SEAT_NAMES = ['南(你)', '东', '北(队友)', '西'];
const SEAT_NAMES_SDY = ['南(你)', '东', '北', '西'];

/**
 * 方位名。
 * @param {number|string} seatOrIdx
 * @param {string} [gameMode] 'shengji'（默认）| 'san_da_yi'
 * @returns {string}
 */
function seatName(seatOrIdx, gameMode) {
  const names = gameMode === 'san_da_yi' ? SEAT_NAMES_SDY : SEAT_NAMES;
  if (typeof seatOrIdx === 'number') return names[seatOrIdx] || String(seatOrIdx);
  const idx = { S: 0, E: 1, N: 2, W: 3 }[seatOrIdx];
  return idx !== undefined ? names[idx] : String(seatOrIdx);
}

/**
 * 花色符号。
 * @param {string} suit
 * @returns {string}
 */
function suitSymbol(suit) {
  return SUIT_SYMBOLS[suit] || '?';
}

/**
 * 主牌标签：如 '♥(打5)' / '无主(打A)'。
 * @param {object} trumpInfo
 * @returns {string}
 */
function trumpLabel(trumpInfo) {
  if (!trumpInfo) return '定主中…';
  const lv = `打${trumpInfo.levelRank}`;
  if (trumpInfo.isNoTrump) return `无主(${lv})`;
  return `${SUIT_SYMBOLS[trumpInfo.trumpSuit]}(${lv})`;
}

/**
 * 阵营名。
 * @param {number} team 0=我方 1=敌方
 * @returns {string}
 */
function teamName(team) {
  return team === 0 ? '我方' : '敌方';
}

/**
 * 牌型名。
 * @param {string} type single|pair|tractor|throw
 * @returns {string}
 */
function comboTypeName(type) {
  return { single: '单张', pair: '对子', tractor: '拖拉机', throw: '甩牌' }[type] || type;
}

/**
 * 亮主类型名。
 * @param {string} type single_rank|pair_rank|joker_pair|single_joker
 * @returns {string}
 */
function bidTypeName(type) {
  return {
    single_rank: '亮级牌',
    pair_rank: '对级牌反主',
    joker_pair: '对王反主(无主)',
    single_joker: '单王反主(无主)'
  }[type] || type;
}

/**
 * 结算横幅文案。
 * @param {object} settle SettleResult
 * @param {number} dealerTeam 庄家方阵营
 * @param {object} cfg
 * @returns {string} 如「我方守住！升 2 级」/「敌方上台！升 1 级」
 */
function settleBanner(settle, dealerTeam, cfg) {
  if (!settle) return '';
  // 三打一：庄家 vs 合同分
  if (cfg.gameMode === 'san_da_yi' || settle.mode === 'san_da_yi') {
    const dealerWon = settle.winnerTeam === 'dealer';
    const head = dealerWon ? '庄家达成！' : '三家防守成功！';
    const score = `庄家 ${settle.dealerPoints} / 合同 ${settle.contractScore} 分`;
    const pen = settle.penaltyPoints && (settle.penaltyPoints.dealer || settle.penaltyPoints.attackers)
      ? ` · 罚分 庄${settle.penaltyPoints.dealer}/攻${settle.penaltyPoints.attackers}` : '';
    return `${head} · ${score}${pen}`;
  }
  const winner = settle.winnerTeam;
  const isDefenseWin = winner === dealerTeam;
  const head = isDefenseWin ? `${teamName(dealerTeam)}守住！` : `${teamName(winner)}上台！`;
  const levels = settle.passedA ? '过A！' : `升 ${settle.levelsGained} 级`;
  const score = `攻方得分 ${settle.attackPoints}/${cfg.pointsToTake}`;
  return `${head}${levels} · ${score}`;
}

/**
 * 升级幅度表文案（规则速查页用，由配置动态渲染，验收标准 2）。
 * @param {object} cfg
 * @returns {Array<{range: string, result: string, levels: string}>}
 */
function levelUpTableText(cfg) {
  const P = cfg.pointsPerLevel;
  const T = cfg.pointsToTake;
  const rows = [
    { range: '0 分（大光）', result: '庄家方升', levels: `${2 + cfg.cleanSweepBonusLevels} 级` },
    { range: `1 ~ ${P - 1} 分（小光）`, result: '庄家方升', levels: '2 级' },
    { range: `${P} ~ ${T - 1} 分`, result: '庄家方升', levels: '1 级' }
  ];
  for (let s = T, n = 1; s < T + 5 * P; s += P, n++) {
    rows.push({ range: `${s} ~ ${s + P - 1} 分`, result: '攻方上台，升', levels: `${n} 级` });
  }
  return rows;
}

/**
 * 过 A 条件文案。
 * @param {object} cfg
 * @returns {string}
 */
function passAText(cfg) {
  return {
    small_light: `当庄打A时需让对方得分 < ${cfg.pointsPerLevel} 分（小光）方可过A`,
    win: '当庄打A时赢局即可过A',
    big_light: '当庄打A时需让对方 0 分（大光）方可过A'
  }[cfg.passACondition] || cfg.passACondition;
}

module.exports = {
  SEAT_NAMES,
  seatName,
  suitSymbol,
  trumpLabel,
  teamName,
  comboTypeName,
  bidTypeName,
  settleBanner,
  levelUpTableText,
  passAText
};

});
__def("utils/random", function (exports, __require, module) {
/**
 * utils/random.js —— 随机源（mulberry32 种子随机，§8.7）。
 *
 * 所有随机（洗牌 / 翻底定主 / AI 扰动）必须走注入的 rng：
 *   测试注入固定种子可复现；线上默认 Math.random。
 */

'use strict';

/**
 * 创建可复现随机源。
 * @param {number} [seed] 种子（缺省用 Math.random 派生）
 * @returns {{seed: number, next: function(): number, int: function(number): number,
 *           range: function(number, number): number, pick: function(Array): *,
 *           shuffle: function(Array): Array}}
 */
function createRng(seed) {
  let s = (seed === undefined || seed === null)
    ? (Math.floor(Math.random() * 0xffffffff) >>> 0)
    : (seed >>> 0);
  const api = {
    seed: s,
    /** [0,1) 均匀随机 */
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** [0, n) 整数 */
    int(n) {
      return Math.floor(api.next() * n);
    },
    /** [min, max] 闭区间整数 */
    range(min, max) {
      return min + Math.floor(api.next() * (max - min + 1));
    },
    /** 数组随机取一 */
    pick(arr) {
      return arr[Math.floor(api.next() * arr.length)];
    },
    /** Fisher-Yates 洗牌（返回新数组） */
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(api.next() * (i + 1));
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      return a;
    }
  };
  return api;
}

module.exports = { createRng };

});
__def("storage/adapter", function (exports, __require, module) {
/**
 * storage/adapter.js —— wx 同步存储封装（项目内唯一允许 wx.setStorageSync 的模块）。
 *
 * Node 环境直跑时自动降级为内存 Map（tests 可注入），小程序环境走 wx.*。
 * 版本迁移钩子：migrate(json) 按 SCHEMA_VERSION 升级旧存档。
 */

'use strict';

const { SCHEMA_VERSION } = __require('storage/keys');

/** Node/测试环境的内存后备存储 */
const memoryStore = new Map();

/**
 * 当前是否小程序环境（判断 wx 同步存储可用）。
 * @returns {boolean}
 */
function hasWX() {
  return typeof wx !== 'undefined' && !!wx.setStorageSync;
}

/**
 * 原始取值。
 * @param {string} key
 * @returns {any}
 */
function rawGet(key) {
  if (hasWX()) {
    try {
      const v = wx.getStorageSync(key);
      return v === '' ? null : v;
    } catch (e) {
      return null;
    }
  }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

/**
 * 原始设值。
 * @param {string} key
 * @param {any} value
 */
function rawSet(key, value) {
  if (hasWX()) {
    try {
      wx.setStorageSync(key, value);
    } catch (e) {
      // 存储满等异常静默（对局继续，仅断线续玩失效）
    }
    return;
  }
  memoryStore.set(key, value);
}

/**
 * 原始删除。
 * @param {string} key
 */
function rawRemove(key) {
  if (hasWX()) {
    try {
      wx.removeStorageSync(key);
    } catch (e) { /* 忽略 */ }
    return;
  }
  memoryStore.delete(key);
}

/**
 * JSON 读取 + 版本迁移。
 * @param {string} key
 * @returns {any|null}
 */
function getJSON(key) {
  const raw = rawGet(key);
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return raw; // 兼容直接存对象
  try {
    const json = JSON.parse(raw);
    return migrate(json);
  } catch (e) {
    return null;
  }
}

/**
 * JSON 写入（附带结构版本）。
 * @param {string} key
 * @param {any} value
 */
function setJSON(key, value) {
  const payload = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.assign({ __schemaVersion: SCHEMA_VERSION }, value)
    : value;
  rawSet(key, JSON.stringify(payload));
}

/**
 * 删除键。
 * @param {string} key
 */
function remove(key) {
  rawRemove(key);
}

/**
 * 存档版本迁移（SCHEMA_VERSION 升级时在此追加迁移步骤）。
 * @param {object} json
 * @returns {object|null} 版本过新无法降级时返回 null（由上层提示 E301）
 */
function migrate(json) {
  if (!json || typeof json !== 'object') return null;
  const v = json.__schemaVersion || 0;
  if (v > SCHEMA_VERSION) return null; // 存档来自更新版本，拒绝加载
  // v0 → v1：无结构变化（首版）
  return json;
}

module.exports = {
  get: getJSON,
  set: setJSON,
  remove,
  migrate,
  _memoryStore: memoryStore // 测试专用
};

});
__def("storage/keys", function (exports, __require, module) {
/**
 * storage/keys.js —— 存储键常量 + 序列化版本号（断线续玩恢复兼容，§8.8）。
 */

'use strict';

/** 当前 GameState 序列化结构版本（字段结构变化时 +1 并在 adapter 写迁移） */
const SCHEMA_VERSION = 1;

/** 存储键 */
const STORAGE_KEYS = {
  /** 进行中对局（GameState 序列化 JSON） */
  CURRENT_GAME: 'tractor:currentGame',
  /** 本地规则覆盖（房规） */
  RULE_OVERRIDES: 'tractor:ruleOverrides',
  /** 战绩统计 */
  STATS: 'tractor:stats',
  /** 设置（音效/动画/出牌方式） */
  SETTINGS: 'tractor:settings'
};

module.exports = { SCHEMA_VERSION, STORAGE_KEYS };

});
__def("rule-config", function (exports, __require, module) {
/**
 * rule-config.js —— 【拖拉机规则后台配置】
 *
 * 使用方法：改完保存 → 开发者工具点「编译」→ 开新一局生效。
 * 改错的值会自动回退默认，不会崩。
 * 每个参数上方的中文注释就是说明，直接改注释不影响程序。
 */

module.exports = {

  /* ══════════ 玩法模式 ══════════ */

  // shengji=升级（2v2，打2到A） | san_da_yi=三打一（1v3，报分定庄，恒打2，主牌=王+2）
  gameMode: 'san_da_yi',

  /* ══════════ 三打一参数（gameMode='san_da_yi' 时生效） ══════════ */

  // 起叫分（90 起）
  sanDaYiBidStart: 90,

  // 叫分档位步长（90→100→110…→200，每档 +10；有人叫后只能加一档）
  sanDaYiBidStep: 10,

  // 叫分上限（=总分 200，报满即成交坐庄）
  sanDaYiBidCap: 200,

  // 全员不叫时：force_lowest=首位强制打最低分 | redeal=重新发牌
  sanDaYiNoBidAction: 'force_lowest',

  // 成交分 ≤ 此值时闲家可看底牌（-1=不公开看底）
  sanDaYiPeekBottomMaxBid: -1,

  /* ══════════ 牌与发牌 ══════════ */

  // R1 牌副数（1/2/3）：2=双副牌108张（传统80分玩法）
  deckCount: 2,

  // R2 底牌张数（4~12）：埋底阶段庄家扣下的牌数，传统为 8
  bottomCards: 8,

  // 分牌面值：哪个点数算几分（可自定义，如把 J 也算 10 分就加 J: 10）
  pointValues: { '5': 5, '10': 10, 'K': 10 },

  /* ══════════ 级数（升级模式） ══════════ */

  // R3 起始级牌：两队最初打几（2~A 任选）
  rankStart: '2',

  // R4 终局级牌：打到这张牌且满足过A条件就获胜（默认 A）
  rankEnd: 'A',

  /* ══════════ 计分与升级（升级模式） ══════════ */

  // R5 上台分：攻方拿到这个分数就上台（默认 80）
  pointsToTake: 80,

  // R6 每级分数：上台后每多拿这么多分多升 1 级（默认 40）
  pointsPerLevel: 40,

  // R7 大光奖励：守方 0 分时额外升几级（默认 1）
  cleanSweepBonusLevels: 1,

  // R18 升级幅度表：standard=标准公式（0分升3/小光升2/40-79升1/80起每40分+1级）
  levelUpTable: 'standard',

  // R15 过A条件：small_light=小光(对方<40分)才过A | win=赢局即过 | big_light=大光(对方0分)才过
  passACondition: 'small_light',

  // R24 整轮目标：first_pass_A=先过A者胜 | loop=打过A后循环继续
  roundGoal: 'first_pass_A',

  /* ══════════ 主牌 ══════════ */

  // R8 是否允许无主局：true=对王可反成无主（主牌只剩王和级牌共12张）
  allowNoTrump: true,

  // R13 副级牌同为大时：true=先出为大（传统）| false=按花色固定序
  offSuitRankTieFirstWin: true,

  /* ══════════ 抠底 ══════════ */

  // R9 抠底倍数（×1/×2/×4/×8）：最后一墩赢家收底牌分×此倍数。注意：R10 开启后本项失效
  bottomMultiplier: 2,

  // R10 抠底按牌型加倍：false=统一用上面的倍数 | true=单张×2、对子×4、拖拉机×8（用下面明细）
  bottomMultiplierByType: false,

  // R10 明细：抠底所用最后牌型对应的倍数（甩牌取其中最大单元）
  bottomMultiplierTable: { single: 2, pair: 4, tractor: 8, throw: 8 },

  /* ══════════ 跟牌 ══════════ */

  // R11 有对必跟对：true=手上有领出花色的对子时必须跟对子（严格）| false=可拆对垫牌
  mustFollowPairAsPair: true,

  // R12 有拖必跟拖：true=手上有拖拉机时必须跟拖拉机 | false=可拆
  mustFollowTractorAsTractor: true,

  /* ══════════ 甩牌 ══════════ */

  // R14 甩牌不成立时：reject=禁止出 | smallest=强制换成最小牌 | penalty_smallest=罚10分/张给对方+强制出最小
  // 2026-10-22 用户确认：甩牌不成立不弹禁止提示，按线下规则自然罚分（10分/张+强制出该门最小）；
  // 混花色（跨域）不属于甩牌范畴，仍走 E112「出牌必须同域」直接禁止
  throwPenalty: 'penalty_smallest',

  /* ══════════ 流程 ══════════ */

  // R16 下局谁坐庄（升级模式）：winner_stays=胜方定主者坐庄 | rotate=轮流 | bidder_always=本局定主者优先
  dealerPassRule: 'winner_stays',

  // R17 亮主截止：before_bottom_flip=埋底前都可亮反 | after_deal=发牌结束即截止
  bidDeadLine: 'before_bottom_flip',

  // R19 出牌方向：counterclockwise=逆时针（传统）| clockwise=顺时针
  playDirection: 'counterclockwise',

  // R20 无人亮主时（升级模式）：flip_bottom=翻底牌定主 | redeal=重新发牌
  noBidFallback: 'flip_bottom',

  /* ══════════ 反主 ══════════ */

  // R21 单王反无主：true=亮一张王即可反成无主（激进地方玩法）
  allowSingleJokerOverride: false,

  /* ══════════ 牌型 ══════════ */

  // R22 不同花色的两张副级牌对是否构成拖拉机：true=算（地方玩法）| false=不算（严格）
  offSuitRankPairAsTractor: false,

  /* ══════════ 体验 ══════════ */

  // R23 AI 出牌节奏（秒）：[最短, 最长] 区间随机。想更快改 [0.4, 0.8]
  aiPaceSeconds: [0.8, 1.5]
};

});

var out = {
  GameService: __req('root', 'services/game-service').GameService,
  createConfig: __req('root', 'engine/config').createConfig,
  DEFAULT_CONFIG: __req('root', 'engine/config').DEFAULT_CONFIG,
  validateConfig: __req('root', 'engine/config').validateConfig,
  getHint: __req('root', 'services/hint').getHint,
  fmt: __req('root', 'utils/format'),
  storage: __req('root', 'storage/adapter'),
  STORAGE_KEYS: __req('root', 'storage/keys').STORAGE_KEYS,
  stats: __req('root', 'services/stats'),
  createRng: __req('root', 'utils/random').createRng,
  ruleConfig: __req('root', 'rule-config'),
  scoreBidOptions: __req('root', 'engine/bid').scoreBidOptions
};
if (typeof window !== 'undefined') window.GameCore = out;
if (typeof module !== 'undefined' && module.exports) module.exports = out;
})();