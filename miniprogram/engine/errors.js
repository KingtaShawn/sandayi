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
