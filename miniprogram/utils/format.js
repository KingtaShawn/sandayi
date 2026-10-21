/**
 * utils/format.js —— 展示格式化（纯函数，无 wx.*）。
 *
 * 状态栏 / 结算页 / 规则速查页的文案拼装集中在此，UI 层不得散落规则数值
 * （数值一律取自 RuleConfig 快照）。
 */

'use strict';

const { SUIT_SYMBOLS } = require('../engine/card');

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
