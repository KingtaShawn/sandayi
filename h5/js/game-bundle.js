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
 *   - 同优先级 pair_rank 可反 pair_rank？——否：同一优先级只能出现一次。
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
 * engine/combo.js —— 牌型识别（单/对/拖/甩/八张同点甩）+ 大小比较 + 拖拉机相邻判定。
 *
 * 域（domain）概念：
 *   'TRUMP' 主牌域（含王/级牌/主花色）；'S'/'H'/'C'/'D' 各副牌花色域。
 *   一次合法出牌的所有牌必须同域（甩牌亦然）。
 *
 * 拖拉机相邻：
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
 * 八张同点甩牌（R26 sanDaYiEightThrow）：双副牌同一非王牌点数恰 8 张（四门×两副），
 * 凑齐可整甩。压不过任何跟牌；唯有更大的八张同点（级牌八张最高，其余按点数）能压。
 * @param {Array<object>} cards_
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {number|null} 八甩强度（级牌=200，其余=rankValue）；非八甩返回 null
 */
function eightStrength(cards_, trumpInfo, cfg) {
  if (!cfg || cfg.gameMode !== 'san_da_yi' || cfg.sanDaYiEightThrow === false) return null;
  if (!cards_ || cards_.length !== 8) return null;
  if (cards_.some((c) => c.isJoker)) return null;
  const rank = cards_[0].rank;
  if (cards_.some((c) => c.rank !== rank)) return null;
  return rank === trumpInfo.levelRank ? 200 : rankValue(rank);
}

/**
 * 手牌中的八张同点（领出/跟牌候选枚举用）。
 * @param {Array<object>} hand
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {Array<object>|null} 该点数全部 8 张；无则 null
 */
function findEightOfKind(hand, trumpInfo, cfg) {
  const groups = new Map();
  (hand || []).forEach((c) => {
    if (c.isJoker) return;
    if (!groups.has(c.rank)) groups.set(c.rank, []);
    groups.get(c.rank).push(c);
  });
  for (const list of groups.values()) {
    if (list.length >= 8 && eightStrength(list.slice(0, 8), trumpInfo, cfg) !== null) {
      return list.slice(0, 8);
    }
  }
  return null;
}

/**
 * 将同域牌集合拆解为最大单元组合。
 * 三打一默认不合并拖拉机：连对作为多副对子逐对检查甩牌；其他模式优先合并。
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
  // 旧三打一存档未携带此配置时也按默认无拖拉机处理。
  if (cfg && cfg.gameMode === 'san_da_yi' && cfg.sanDaYiAllowTractor !== true) {
    return pairs.concat(singles).sort((a, b) => (b.size - a.size) || (b.strength - a.strength));
  }
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
  // 八张同点甩牌：必跨四门（级牌除外全主），先于同域约束识别
  const es = eightStrength(cards_, trumpInfo, config);
  if (es !== null) {
    const unit = makeUnit('eight', cards_, trumpInfo);
    unit.strength = es; // 覆盖为八甩序（级牌 200 / 其余 rankValue）
    return {
      type: 'eight', units: [unit], cards: cards_.slice(),
      n, suit: 'EIGHT', isTrump: cards_[0].rank === trumpInfo.levelRank,
      points: pointsOf(cards_, config), strength: es
    };
  }
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
  if (leadCombo.type === 'eight') {
    // 八张同点甩：只有更大的八张同点能压（主牌对子/将吃一律不行）
    return followCombo.type === 'eight' && followCombo.strength > leadCombo.strength;
  }
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
  eightStrength,
  findEightOfKind,
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
 * 参数编号 R1~R26 为内部规则编号（R26=三打一扩展）。
 */

'use strict';

/** 级牌完整序列（rankStart → rankEnd 的取值域，传统 2→A） */
const FULL_RANK_SEQUENCE = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** 分牌面值（5→5 分、10→10 分、K→10 分；总分 200 由双副牌自然得出） */
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
    throw: 8,
    eight: 8
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
  sanDaYiAllowTractor: false,        // 默认不打拖拉机：连对视为多副对子甩牌，逐对检查成立性
  sanDaYiBidStart: 90,               // 起叫分（用户规则：90 起）
  sanDaYiBidStep: 10,                // 叫分最小步长（加价可跳档，如 90→130）
  sanDaYiBidCap: 160,                // 叫分上限（报满即成交坐庄）
  sanDaYiNoBidAction: 'redeal',      // 全员不叫（重发，首报者轮到原首报者下家；force_lowest=首位强制打最低分）
  sanDaYiPeekBottomMaxBid: -1,       // 成交分 ≤ 此值时闲家可看底牌（-1=不公开；本玩法不适用看底规则）
  sanDaYiEightThrow: true,           // 八张同点甩牌：握有同一点数全部 8 张可整甩，唯有更大的八张同点能压（主牌对子也不行）

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
 * 级牌数字面量归一化：2 → '2'（rule-config 允许数字，内部统一字符串）。
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
    if (typeof cfg.sanDaYiAllowTractor !== 'boolean') {
      errors.push('R26 sanDaYiAllowTractor 必须为布尔');
    }
    if (typeof cfg.sanDaYiEightThrow !== 'boolean') {
      errors.push('R26 sanDaYiEightThrow 必须为布尔');
    }
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
 *      - 领出甩牌：有对必逐对跟（R11 延伸）——领出含 k 对、该门有 m 对须跟 min(k,m) 对，
 *        其余张自由；无对则该域任意 n 张。
 *   3. 无领出域（缺门）：任意 n 张（垫牌或将吃）；
 *      将吃争胜需结构对应（对→主对 / k对拖→主k对拖 / 甩→全压），不对应视为垫牌（合法但不争胜）。
 *
 * 返回 ValidateResult，meta: { followKind: 'full'|'partial'|'discard'|'trump', structureOk }。
 */

'use strict';

const { parseCombo, domainOf, decomposeDomain, isPair } = __require('engine/combo');
const { result } = __require('engine/errors');

/**
 * 全手（跨门）对子总数：八张同点甩牌领出时无花色门可跟，
 * 「有对必逐对跟」按全手合计折算（拖拉机按其所含对数计）。
 * @param {Array<object>} cards_
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {number}
 */
function countAllPairs(cards_, trumpInfo, cfg) {
  const byDomain = new Map();
  (cards_ || []).forEach((c) => {
    const d = domainOf(c, trumpInfo);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(c);
  });
  let pairs = 0;
  byDomain.forEach((list) => {
    decomposeDomain(list, trumpInfo, cfg).forEach((u) => {
      if (u.type !== 'single') pairs += u.cards.length / 2;
    });
  });
  return pairs;
}

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

  // 该域牌不足 n 张：全部给出即可（防御条款）
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
  // 甩牌跟牌：有对必逐对跟（R11 延伸到甩牌）——
  // 领出含 k 个对子（含拖拉机拆出的对子）、该门手上有 m 对 → 须跟出 min(k,m) 个对子，其余张自由
  if (!cfg.mustFollowPairAsPair) {
    return { ok: playedCards.length === n };
  }
  const pairsOfUnits = (units) => units.reduce(
    (cnt, u) => cnt + (u.type === 'single' ? 0 : u.cards.length / 2), 0
  );
  const leadPairs = pairsOfUnits(leadCombo.units);
  if (leadPairs === 0) {
    return { ok: playedCards.length === n };
  }
  const myPairs = pairsOfUnits(handUnits(handBefore, domain, trumpInfo, cfg));
  const required = Math.min(leadPairs, myPairs);
  if (required === 0) {
    return { ok: playedCards.length === n };
  }
  const playedPairs = pairsOfUnits(decomposeDomain(playedCards, trumpInfo, cfg));
  return playedPairs >= required
    ? { ok: true }
    : { ok: false, reason: `跟甩牌有对必逐对跟：领出含 ${leadPairs} 对，须至少跟 ${required} 个对子` };
}

/**
 * 缺门将吃结构对应判定。
 * @param {object} leadCombo
 * @param {Array<object>} playedCards 全部为主牌时
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {boolean} true = 有效将吃（争胜）
 */
function isEffectiveTrumpFollow(leadCombo, playedCards, trumpInfo, cfg) {
  const allTrump = playedCards.every((c) => domainOf(c, trumpInfo) === 'TRUMP');
  if (!allTrump) return false;
  // 八张同点甩牌：主牌将吃不争胜，唯有更大的八张同点（playContendInfo 判定）
  if (leadCombo.type === 'eight') return false;
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
  // 八张同点甩牌领出：领出者握有该点全部 8 张，别家无门可跟 →
  // 任意 8 张合法，但「有对必逐对跟」跨门延伸：领出 4 对、全手 m 对须跟 min(4,m) 对
  if (leadCombo.type === 'eight') {
    if (hand.length <= n) {
      return result(true, null, null, { followKind: 'full' }); // 剩牌整手出（防御）
    }
    if (cfg.mustFollowPairAsPair) {
      const required = Math.min(4, countAllPairs(hand, state.trumpInfo, cfg));
      const played = countAllPairs(cards_, state.trumpInfo, cfg);
      if (played < required) {
        return result(false, `跟八张甩牌有对必逐对跟：手中 ${countAllPairs(hand, state.trumpInfo, cfg)} 对，须至少跟出 ${required} 个对子`, 'E103');
      }
    }
    return result(true, null, null, { followKind: 'discard', isEffectiveTrump: false });
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
  countAllPairs,
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
 * 升级数计算（R18 standard 表，公式化）。
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
 * 级数推进（跳过序不存在，2→A 顺序；封顶 A）。
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
 *   未过A：按小光升 2 级但封顶停在 A
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
 * engine/throw.js —— 甩牌成立性校验（R14）。
 *
 * 领出甩牌成立条件：其他三家没有同门、同结构且严格更大的单元。
 * 相同大小不能压住先出的牌；对子、拖拉机中的牌也必须参与拆分比较。
 *
 * R14：
 *   reject  → 返回 E102（UI/AI 直接禁止，不出现该组合）；
 *   smallest → 只出本次甩牌中被压住的最小单元，其余牌收回。
 *   penalty_smallest → 在 smallest 基础上按原甩牌张数罚分。
 */

'use strict';

const { decomposeDomain, domainOf } = __require('engine/combo');
const { SUIT_SYMBOLS } = __require('engine/card');
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
 * 单张可被对子/拖拉机中的单牌压；对子可被拖拉机拆出的对子压。
 * 必须检查全部单元，不能因已有较小的同型单元而漏掉较大的组合。
 * @param {object} throwUnit 甩牌单元
 * @param {Array<object>} defenseUnits 防客单元集合
 * @returns {boolean} true = 防守可压（甩牌不成立）
 */
function unitCovered(throwUnit, defenseUnits) {
  return defenseUnits.some((u) => {
    if (u.strength <= throwUnit.strength) return false;
    if (throwUnit.type === 'single') return true;
    if (throwUnit.type === 'pair') return u.type === 'pair' || u.type === 'tractor';
    return u.type === 'tractor' && u.size >= throwUnit.size;
  });
}

/**
 * 甩牌成立性校验。
 * @param {object} state GameState（PLAYING、players 手牌可见性=全可见，单机 AI 与校验共用引擎真值）
 * @param {object} combo 已解析的甩牌组合（parseCombo 产物，type='throw'）
 * @param {number} leaderIdx 领出者
 * @param {object} cfg
 * @returns {{ok: boolean, reason?: string, errorCode?: string, meta?: object}}
 *   meta: { failUnit, coverBy, replacement?, penaltyPoints? }
 */
function validateThrow(state, combo, leaderIdx, cfg) {
  const domain = combo.suit; // 'TRUMP' 或花色
  const opponents = state.players.map((p, i) => ({
    idx: i,
    units: i === leaderIdx ? [] : maxUnitsOfHand(p.hand, domain, state.trumpInfo, cfg)
  })).filter((p) => p.idx !== leaderIdx);
  // 先找被压住的最小单张，再找最小对子/拖拉机，保持原单元完整。
  const unitsAsc = combo.units.slice().sort((a, b) => (a.size - b.size) || (a.strength - b.strength));
  for (const u of unitsAsc) {
    for (const opponent of opponents) {
      if (unitCovered(u, opponent.units)) {
        const oi = opponent.idx;
        const byName = `第${oi + 1}位玩家`;
        if (cfg.throwPenalty === 'smallest' || cfg.throwPenalty === 'penalty_smallest') {
          const replacement = u.cards.slice();
          const shownCards = replacement.map((c) => c.isJoker
            ? (c.rank === 'BJ' ? '大王' : '小王')
            : `${SUIT_SYMBOLS[c.suit]}${c.rank}`).join(' ');
          const isPenalty = cfg.throwPenalty === 'penalty_smallest';
          const penaltyPoints = isPenalty ? combo.n * 10 : 0;
          return result(false,
            `甩牌失败：改出 ${shownCards}，其余收回${penaltyPoints ? `，罚 ${penaltyPoints} 分` : ''}`, 'E102', {
            failUnit: u,
            coverBy: oi,
            replacement,
            // penalty_smallest：罚 10 分/张（对方阵营），由状态机出牌时记入 penaltyPoints
            penaltyPoints
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
 * 争胜资格：
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
  // 八张同点甩牌：跟牌唯有「更大的八张同点」争胜，其余（含主牌对子/将吃）一律垫牌
  if (leadCombo.type === 'eight') {
    const combo = parseCombo(play.cards, trumpInfo, cfg);
    if (combo && combo.type === 'eight' && combo.strength > leadCombo.strength) {
      return { contending: true, combo, kind: 'follow' };
    }
    return { contending: false, combo, kind: 'discard' };
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
  // 八张同点甩：比八甩序（级牌八张最高，其余按点数），严格更大才压过
  if (leadCombo.type === 'eight') {
    return chInc.combo.strength > incInc.combo.strength;
  }
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
 * 主牌大小（有主局，主花色 S、级牌 X）：
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

const { parseCombo, domainOf, decomposeDomain, isPair, pointsOf, findEightOfKind } = __require('engine/combo');
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
function validateLead(state, playerIdx, cards_, cfg) {
  const combo = parseCombo(cards_, state.trumpInfo, cfg);
  if (!combo) {
    return result(false, '出牌必须同域（一门副牌或全主牌）', 'E112');
  }
  if (combo.type === 'throw') {
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
function validatePlay(state, playerIdx, cards_) {
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
    return validateLead(state, playerIdx, cards_, cfg);
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

/** 域内强度（复用 combo.strengthInDomain 语义）：升序排序 → 小牌在前 */
function strengthSortKey(card, trumpInfo) {
  const { strengthInDomain } = __require('engine/combo');
  return strengthInDomain(card, trumpInfo);
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
  // 八张同点甩（跨门，域循环覆盖不到）：握有同一点数全部 8 张即可整甩
  const eight = findEightOfKind(hand, ti, cfg);
  if (eight) push(eight);
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

  // 八张同点甩牌领出：无门可跟，任意 8 张合法但有对必逐对跟——
  // 候选：自家更大的八甩（若握有）/ 最小对+最小单（垫）/ 对+分牌单（队友领出喂分）
  if (lead.type === 'eight') {
    if (hand.length <= n) {
      push(hand.slice());
      return out;
    }
    const mine = findEightOfKind(hand, ti, cfg);
    if (mine) push(mine); // 更大的八张同点 → 反压夺墩
    const pairs = [];
    const byKey = new Map();
    hand.forEach((c) => {
      const k = cardKey(c);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(c);
    });
    byKey.forEach((list) => {
      for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
    });
    const build = (pairPtsFirst) => {
      const chosen = [];
      const usedIds = new Set();
      const ps = pairs.slice().sort((a, b) => {
        const d = pairPtsFirst
          ? pointsOf(b, cfg) - pointsOf(a, cfg) || strengthSortKey(a[0], ti) - strengthSortKey(b[0], ti)
          : pointsOf(a, cfg) - pointsOf(b, cfg) || strengthSortKey(a[0], ti) - strengthSortKey(b[0], ti);
        return d;
      });
      for (const pr of ps) {
        if (chosen.length >= n) break;
        chosen.push(...pr);
        pr.forEach((c) => usedIds.add(c.id));
      }
      const pool = hand.slice().sort((a, b) => (pairPtsFirst
        ? pointsOf([b], cfg) - pointsOf([a], cfg) || strengthSortKey(b, ti) - strengthSortKey(a, ti)
        : pointsOf([a], cfg) - pointsOf([b], cfg) || strengthSortKey(a, ti) - strengthSortKey(b, ti)));
      for (const c of pool) {
        if (chosen.length >= n) break;
        if (!usedIds.has(c.id)) { chosen.push(c); usedIds.add(c.id); }
      }
      if (chosen.length === n) push(chosen);
    };
    build(false); // 最小垫：小对小单、尽量不带分
    build(true);  // 喂分：分对分单优先（领出者是队友时由 scorer 选用）
    return out;
  }

  if (avail.length > 0) {
    // 该门不足 n 张：全部给出 + 最小垫牌补齐（防御条款）
    if (avail.length < n) {
      const rest = hand.filter((c) => domainOf(c, ti) !== domain)
        .sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
      const k = n - avail.length;
      push(avail.concat(rest.slice(0, k))); // 最小垫牌
      // 分牌垫：队友稳赢时喂分（是否值得由 scorer 权衡）
      push(avail.concat(rest.slice().sort(
        (a, b) => pointsOf([b], cfg) - pointsOf([a], cfg) || strengthSortKey(a, ti) - strengthSortKey(b, ti)
      ).slice(0, k)));
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
        .sort((a, b) => strengthSortKey(a[0], ti) - strengthSortKey(b[0], ti));
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
    push(sorted.slice(-n).reverse()); // 最大
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
    // 分牌垫：队友稳赢时喂分（是否值得由 scorer 权衡）
    push(hand.slice().sort(
      (a, b) => pointsOf([b], cfg) - pointsOf([a], cfg) || strengthSortKey(a, ti) - strengthSortKey(b, ti)
    ).slice(0, n));
    return out;
  }
  if (lead.type === 'tractor') {
    tractorWindowsOf(trumps, ti, cfg).forEach((t) => push(t)); // 主拖将吃
    tractorWindowsOf(hand, ti, cfg).forEach((t) => push(t));
    const k = lead.units[0].cards.length / 2;
    const pairs = pairsOf(hand, ti)
      .sort((a, b) => strengthSortKey(a[0], ti) - strengthSortKey(b[0], ti));
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
    // 分牌垫：队友稳赢时喂分（是否值得由 scorer 权衡）
    push(hand.slice().sort(
      (a, b) => pointsOf([b], cfg) - pointsOf([a], cfg) || strengthSortKey(a, ti) - strengthSortKey(b, ti)
    ).slice(0, n));
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
  { seat: 'E', team: 1, isHuman: false, name: '三毛玉' },
  { seat: 'N', team: 0, isHuman: false, name: '年狗子' },
  { seat: 'W', team: 1, isHuman: false, name: '鹅燕军' }
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
  // 每次有效亮主/反主 → 最终定主者坐庄（最终定主者坐庄，含反主后 dealer 更新）
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
 *       庄家冲满分时攻方破光抢分豁免省牌罚（AI_SWEEP）；
 *     · 缺门：墩内分 ≥ threshold → 主牌将吃（结构对应优先），否则垫分/垫小。
 */

'use strict';

const { legalMoves, validatePlay } = __require('engine/validate');
const { parseCombo, domainOf, pointsOf, strengthInDomain } = __require('engine/combo');
const { pointValue, sortHand } = __require('engine/card');
const { buildMemory } = __require('ai/memory');
const { createRng } = __require('utils/random');

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
const R3_TAU = Number(envFlag('AI_R3_TAU') !== undefined ? envFlag('AI_R3_TAU') : 10); // 覆盖阈值：最优候选期望 V 须优于贪心选择这么多分（消融扫描 τ∈{0,3,5,8,10,12} 定在 10）
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
const FEAT_R7 = envFlag('AI_R7') !== '0';
/** v6 结构防守（消融开关，默认开）：PAIR=庄家拆对/大单保护，SWEEP=满分破光 */
const FEAT_PAIR = envFlag('AI_PAIR') !== '0';
const FEAT_SWEEP = envFlag('AI_SWEEP') !== '0';

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
    const { transition } = __require('core/statemachine');
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
    return { mem, di, sdy };
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
    // 满分破光（AI_SWEEP，v6）：庄家已成庄且 ≥180 分（攻方 ≤20）——
    // 每一分都关系庄家「满分坐庄」上全网榜（app.js 满分计数），攻方
    // 拿一分即破光。抢分优先于省牌：豁免主牌经济/末墩储备罚，垫分加倍罚。
    const sweep = FEAT_SWEEP && sdy.need <= 0 && sdy.dealerPts >= 180;
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
          score += pts * 1.5; // 庄家未出仍可能夺走 → 少喂试探
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
   * 垫牌结构保护（v6.1，AI_PAIR，仅庄家侧）：
   *   - 庄家：拆对罚 4（清场甩牌收割靠对子结构，足以让「拆小对」
   *     劣于「垫 JQKA 大单」）+ JQKA 大单保护 1.2（控制牌）。
   * 攻方侧已试尽删（2026-10-28 负结果存档）：普遍保对 −2pp、缺门大户
   * 养甩结构 −1.5pp——1v3 清场威胁下攻方对子结构难兑现，而保结构的
   * 机会成本（垫牌扭曲）立即支付；缺门逼烧主逐张小单已是最优形态
   * （整甩 100 局仅 5 次被选，张数加成无效果）。
   * 只动垫牌选项间的相对序，不动绝对量级（2026-10-28 教训：跨分支绝对
   * 值是「能赢就赢」强行为的隐形实现，实测勿碰）。
   */
  _discardKeep(cards_, hand, ti, ctx) {
    if (!FEAT_PAIR) return 0;
    const isDealer = ctx && ctx.sdy.isDealer;
    if (!isDealer) return 0;
    let s = 0;
    cards_.forEach((c) => {
      const mate = hand.some((h) => h !== c && h.suit === c.suit && h.rank === c.rank);
      const bigSingle = !c.isJoker && c.rank !== ti.levelRank && !mate && rankNum(c) >= 11;
      if (mate) s -= 4;
      else if (bigSingle) s -= 1.2;
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
          if (ss.currentTrick) next = (playerIdx + 1) % 4;
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
        const followed = p.cards.every((c) => domainOf(c, ti) === dom);
        if (!followed) res[p.playerIdx].add(dom);
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
      const { resolveTrick } = __require('engine/trick');
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
      if (ss.currentTrick) next = (toAct + 1) % 4;
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
      if (!trick || trick.plays.length === 0) return null; // v1 仅跟牌
      const n = trick.leadCombo.n;
      const need = ctx.sdy.need;
      const mem = ctx.mem;
      const unseenPts = mem.totalPoints - mem.pointsPlayed - mem.pointsInHand;
      if (need <= 0 || need > unseenPts) return null; // 胜负已定
      const trickPts = trick.plays.reduce((s, p) => s + pointsOf(p.cards, cfg), 0);
      if (trickPts < 10 && trickPts < need) return null; // 只推演关键墩
      const rootCands = legalMoves(state, playerIdx);
      if (rootCands.length <= 1) return null;
      const isDealerView = playerIdx === ctx.sdy.dealerIdx;
      // 阵营消融：AI_R3_CAMP=att/dealer 只对单侧启用（缺省 both）
      const camp = envFlag('AI_R3_CAMP') || 'both';
      if (camp === 'att' && isDealerView) return null;
      if (camp === 'dealer' && !isDealerView) return null;

      // 对手分组（墩内已出者少 n 张）+ 未见牌账目校验（同 R5）
      const groups = [];
      for (let s = 0; s < 4; s++) {
        if (s === playerIdx) continue;
        const playedIn = trick.plays.some((p) => p.playerIdx === s);
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
      const rootPruned = this._r5Prune(state, playerIdx, rootCands, trick, R3_K_ROOT);
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
          if (ss.currentTrick) next = (playerIdx + 1) % 4;
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
      toAct = ss.currentTrick ? (toAct + 1) % 4 : ss.tricks[ss.tricks.length - 1].winnerIdx;
    }
    throw { r3Abort: true }; // 异常长局，防御性放弃
  }

  /** rollout 单步：基线贪心打分（无上下文，快）；候选超宽按引擎序截断保确定性 */
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
    const { resolveTrick } = __require('engine/trick');
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
    const wp = this._currentWinnerPlay(state, trick, ti, cfg);
    return wp ? this._camp(state, wp.playerIdx) : -1;
  }

  /** 墩内当前最大者的出牌记录（PlayRecord|null），resolveTrick 探针裁决 */
  _currentWinnerPlay(state, trick, ti, cfg) {
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
__def("utils/cloud", function (exports, __require, module) {
/**
 * utils/cloud.js —— 小程序端云端账号与档案同步（与 h5/js/cloud.js 同协议）。
 *
 * 登录链：wx.login code → /api/auth/wx（需后台配 WX_APPID/WX_SECRET）→ 失败降级游客建档。
 * 档案同步搬 wx storage 原始字符串（与 H5 localStorage 同键同值，两端账号绑定后战绩互通）。
 * 一切网络失败静默：云端不可用 = 单机，游戏不受影响。
 *
 * 注意：CLOUD_BASE 指向 Cloudflare Pages（未备案域名）。微信开发者工具里勾选
 * "不校验合法域名"即可调试；正式发布需在小程序后台配 request 合法域名（要备案域名）。
 */

'use strict';

/** 云端 API 基址（Cloudflare Pages，与 h5/js/cloud.js 同一后端）。 */
var CLOUD_BASE = 'https://sandayi.pages.dev';

var LS_TOKEN = 'cloud:token';
var LS_USER = 'cloud:user';
var LS_LOCAL_AT = 'cloud:localAt';
/** 参与云同步的存档键（与 h5/js/cloud.js SYNC_KEYS 完全一致，值互通）。 */
var SYNC_KEYS = ['tractor:stats', 'tractor:settings', 'tractor:ruleOverrides', 'tractor:maxBids'];

var listeners = { state: [], sync: [] };
var user = null;
var token = null;
var pushTimer = null;
var pushing = false;
var pushPending = false;
var inited = false;

/* ---------- wx storage 薄封装（惰性取 global wx，Node 测试可注入） ---------- */
function W() { return typeof wx !== 'undefined' ? wx : null; }
function lsGet(k) { try { var w = W(); return w ? w.getStorageSync(k) : null; } catch (e) { return null; } }
function lsSet(k, v) { try { var w = W(); if (w) w.setStorageSync(k, v); } catch (e) { /* 满/异常静默 */ } }
function lsDel(k) { try { var w = W(); if (w) w.removeStorageSync(k); } catch (e) { /* 忽略 */ } }

function emit(evt) {
  (listeners[evt] || []).forEach(function (fn) {
    try { fn(); } catch (e) { /* UI 回调异常不进云层 */ }
  });
}

function setState(u, t) {
  user = u;
  token = t || null;
  if (u) lsSet(LS_USER, JSON.stringify(u)); else lsDel(LS_USER);
  if (t) lsSet(LS_TOKEN, t); else lsDel(LS_TOKEN);
  emit('state');
}

/* ---------- 档案打包/落地（原始字符串，零解析） ---------- */
function collectData() {
  var data = {};
  SYNC_KEYS.forEach(function (k) {
    var v = lsGet(k);
    if (v !== null && v !== undefined && v !== '') data[k] = v;
  });
  return data;
}

function applyData(data) {
  if (!data) return;
  SYNC_KEYS.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(data, k)) lsSet(k, data[k]);
  });
}

function localAt() { return Number(lsGet(LS_LOCAL_AT)) || 0; }

/** 战绩汇总（排行榜数据源：满分坐庄次数为主，局数为辅）。 */
function summarize() {
  try {
    var stats = __require('services/stats');
    var storage = __require('storage/adapter');
    var keys = __require('storage/keys');
    var records = storage.get(keys.STORAGE_KEYS.STATS) || [];
    var s = stats.summarize(records);
    return {
      rounds: s.totalRounds, wins: s.wins, losses: s.losses,
      maxBids: Number(lsGet('tractor:maxBids')) || 0
    };
  } catch (e) { return null; }
}

/* ---------- 请求（wx.request → Promise） ---------- */
function request(method, path, body, useAuth) {
  return new Promise(function (resolve, reject) {
    var w = W();
    if (!w || !w.request) { reject(new Error('no wx.request')); return; }
    var header = { 'Content-Type': 'application/json' };
    if (useAuth && token) header.Authorization = 'Bearer ' + token;
    w.request({
      url: CLOUD_BASE + '/api/' + path,
      method: method,
      header: header,
      data: body || undefined,
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else { var e = new Error('http ' + res.statusCode); e.status = res.statusCode; reject(e); }
      },
      fail: reject
    });
  });
}

/* ---------- 登录链 ---------- */
/** 微信登录：wx.login 拿 code 换 openid 建档；不可用（501/网络/未配域名）降级游客。 */
function loginWx() {
  return new Promise(function (resolve, reject) {
    var w = W();
    if (!w || !w.login) { reject(new Error('no wx.login')); return; }
    w.login({
      success: function (res) { (res && res.code) ? resolve(res.code) : reject(new Error('no code')); },
      fail: reject
    });
  }).then(function (code) {
    return request('POST', 'auth/wx', { code: code }, false);
  }).catch(function (e) {
    return request('POST', 'auth/guest', {}, false); // 降级：openid 通道没开也能玩+同步
  });
}

/* ---------- 同步核心（与 h5 版同构） ---------- */
function mergeRemote(save) {
  if (!save || !save.data) {
    if (collectData() && localAt()) schedulePush();
    return;
  }
  if (save.updatedAt > localAt()) {
    applyData(save.data);
    lsSet(LS_LOCAL_AT, String(save.updatedAt));
    emit('sync');
  } else {
    schedulePush();
  }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 2500);
}

function push() {
  if (!token) return Promise.resolve();
  if (pushing) { pushPending = true; return Promise.resolve(); }
  pushing = true;
  return request('PUT', 'sync', {
    save: { updatedAt: localAt() || Date.now(), data: collectData() },
    lb: summarize()
  }, true).then(function (r) {
    if (r && r.kept === 'server') return pull();
  }).catch(function (e) {
    if (e && e.status === 401) reLogin();
  }).then(function () {
    pushing = false;
    if (pushPending) { pushPending = false; schedulePush(); }
  });
}

function pull() {
  return request('GET', 'sync', undefined, true)
    .then(function (r) { mergeRemote(r.save); })
    .catch(function (e) { if (e && e.status === 401) reLogin(); });
}

/** 登录态失效/无：微信登录优先，降级游客；本地数据随后自动推上去。 */
function reLogin() {
  return loginWx().then(function (r) {
    setState(r.user, r.token);
    schedulePush();
  }).catch(function (e) { /* 离线：保持现状，下次再试 */ });
}

/* ---------- 对外 API（与 h5/js/cloud.js 同面） ---------- */
module.exports = {
  /** 启动（app.js onLaunch 调一次）：恢复登录态并拉取合并。onSync 在远端档案落地后回调。 */
  init: function (opts) {
    if (inited) return;
    inited = true;
    if (opts && opts.onSync) listeners.sync.push(opts.onSync);
    token = lsGet(LS_TOKEN) || null;
    try { user = JSON.parse(lsGet(LS_USER) || 'null'); } catch (e) { user = null; }
    if (token && user) {
      emit('state'); // 恢复登录态要立刻通知 UI：首次渲染先于 init 跑时，状态行还停在"未连接"
      pull();
    } else {
      setState(null, null);
      reLogin();
    }
  },

  state: function () {
    if (!user) return 'off';
    return user.isGuest ? 'guest' : 'user';
  },
  nick: function () { return user ? user.nick : ''; },
  name: function () { return (user && user.name) || ''; },
  uid: function () { return (user && user.uid) || ''; },

  /** 本地数据有变（战绩/设置/房规写入后调）：更新时间戳 + 防抖推送。 */
  notifyLocal: function () {
    lsSet(LS_LOCAL_AT, String(Date.now()));
    if (token) schedulePush();
  },

  /** 立即推送（onHide 等收尾时机）。 */
  flush: function () {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    return push();
  },

  /** 游客升级为正式账号（uid 不变，战绩不丢；可与 H5 绑同名账号互通）。 */
  bind: function (name, pass) {
    return request('POST', 'auth/bind', { username: name, password: pass }, true)
      .then(function (r) { setState(r.user, token); return r.user; });
  },

  /** 登录已有账号（换设备找回）。 */
  login: function (name, pass) {
    return request('POST', 'auth/login', { username: name, password: pass }, false)
      .then(function (r) {
        setState(r.user, r.token);
        return mergeRemote(r.save);
      });
  },

  /** 拉排行榜（满分庄家榜，公开接口）。 */
  leaderboard: function () {
    return request('GET', 'leaderboard', undefined, false).then(function (r) { return (r && r.list) || []; });
  },

  on: function (evt, fn) { if (listeners[evt]) listeners[evt].push(fn); },

  /** 测试专用：换 API 基址 / 重置模块态。 */
  _test: {
    setBase: function (b) { CLOUD_BASE = b; },
    reset: function () {
      inited = false; user = null; token = null;
      pushing = false; pushPending = false;
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    }
  }
};

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
 * rule-config.js —— 【三打一规则后台配置】
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

  // 默认不打拖拉机：连对也按多副对子甩牌；必须每个对子都不被更大的同门对子压住
  sanDaYiAllowTractor: false,

  // 起叫分（90 起）
  sanDaYiBidStart: 90,

  // 叫分最小步长（90→100→110…→160；加价可跳档，如 90→130）
  sanDaYiBidStep: 10,

  // 叫分上限（160，报满即成交坐庄）
  sanDaYiBidCap: 160,

  // 全员不叫时：redeal=重新发牌（首报者轮到原首报者下家） | force_lowest=首位强制打最低分
  sanDaYiNoBidAction: 'redeal',

  // 成交分 ≤ 此值时闲家可看底牌（-1=不公开看底）
  sanDaYiPeekBottomMaxBid: -1,

  // 八张同点甩牌：握有同一点数全部 8 张（如 8 个 6）可整甩，只有更大的八张同点能压
  sanDaYiEightThrow: true,

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

  // R14 甩牌不成立时：reject=禁止出 | smallest=只出被压住的最小单元 | penalty_smallest=再罚10分/原甩牌张
  // 失败只出本次甩牌中被压住的最小单张/对子，其余收回；不会抽取未选手牌或拆散对子。
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