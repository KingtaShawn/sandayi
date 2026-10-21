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

const { cardKey, rankValue, SUITS } = require('./card');

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
