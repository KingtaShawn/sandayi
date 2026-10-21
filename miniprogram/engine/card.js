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
