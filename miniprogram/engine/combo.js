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

const { cardKey, rankValue, pointValue } = require('./card');
const { trumpStrength, trumpStep, isOffRankCard } = require('./trump');
const { RuleError } = require('./errors');

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
  const config = cfg || require('./config').DEFAULT_CONFIG;
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
