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

const { parseCombo, domainOf, decomposeDomain, isPair } = require('./combo');
const { result } = require('./errors');

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
  // 甩牌将吃（领出为副牌甩，主牌恒大于副牌免比强度，免比大小）：领出对子须逐一
  // 被主对覆盖，单张由剩余任意主牌覆盖（主对可拆计两张）——主对毙「对+单」「多单」
  // 甩牌均有效将吃（甩→全压）。三打一无拖拉机（sanDaYiAllowTractor=false）：
  // 连对甩即多副对子，按对数计，主牌不要求连对；下方拖拉机结构对应仅为升级模式
  // （或三打一开启拖拉机）兜底，三打一默认不触发。
  const combo = parseCombo(playedCards, trumpInfo, cfg);
  if (!combo) return false;
  const fu = combo.units
    .filter((u) => u.type !== 'single')
    .sort((a, b) => b.cards.length - a.cards.length);
  for (const u of leadCombo.units) {
    if (u.type === 'tractor') {
      const i = fu.findIndex((x) => x.type === 'tractor' && x.cards.length >= u.cards.length);
      if (i < 0) return false;
      fu.splice(i, 1);
    }
  }
  const leadPairs = leadCombo.units.filter((u) => u.type === 'pair').length;
  const followPairs = fu.reduce((s, u) => s + u.cards.length / 2, 0);
  return followPairs >= leadPairs;
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
