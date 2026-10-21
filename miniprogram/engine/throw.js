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

const { decomposeDomain, domainOf, pointsOf } = require('./combo');
const { cardKey, sortHand, sortKey } = require('./card');
const { result } = require('./errors');

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
