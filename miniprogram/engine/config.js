/**
 * engine/config.js —— RuleConfig 唯一来源（架构 D8）。
 *
 * 全项目所有规则数值（80/40/×2/8/108 等）只能来自本模块：
 *   const { DEFAULT_CONFIG, createConfig, validateConfig } = require('./config');
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
  sanDaYiAllowTractor: false,        // 默认不打拖拉机：连对视为多副对子甩牌，逐对检查成立性
  sanDaYiBidStart: 90,               // 起叫分（用户规则：90 起）
  sanDaYiBidStep: 10,                // 叫分最小步长（加价可跳档，如 90→130）
  sanDaYiBidCap: 200,                // 叫分上限（=总分）
  sanDaYiNoBidAction: 'redeal',      // 全员不叫（重发，首报者轮到原首报者下家；force_lowest=首位强制打最低分）
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
    if (typeof cfg.sanDaYiAllowTractor !== 'boolean') {
      errors.push('R26 sanDaYiAllowTractor 必须为布尔');
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
