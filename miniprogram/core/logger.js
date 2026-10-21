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
