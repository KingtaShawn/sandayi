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

const { decomposeDomain, domainOf } = require('./combo');
const { SUIT_SYMBOLS } = require('./card');
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
