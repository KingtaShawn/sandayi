/**
 * storage/adapter.js —— wx 同步存储封装（项目内唯一允许 wx.setStorageSync 的模块）。
 *
 * Node 环境直跑时自动降级为内存 Map（tests 可注入），小程序环境走 wx.*。
 * 版本迁移钩子：migrate(json) 按 SCHEMA_VERSION 升级旧存档。
 */

'use strict';

const { SCHEMA_VERSION } = require('./keys');

/** Node/测试环境的内存后备存储 */
const memoryStore = new Map();

/**
 * 当前是否小程序环境（判断 wx 同步存储可用）。
 * @returns {boolean}
 */
function hasWX() {
  return typeof wx !== 'undefined' && !!wx.setStorageSync;
}

/**
 * 原始取值。
 * @param {string} key
 * @returns {any}
 */
function rawGet(key) {
  if (hasWX()) {
    try {
      const v = wx.getStorageSync(key);
      return v === '' ? null : v;
    } catch (e) {
      return null;
    }
  }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

/**
 * 原始设值。
 * @param {string} key
 * @param {any} value
 */
function rawSet(key, value) {
  if (hasWX()) {
    try {
      wx.setStorageSync(key, value);
    } catch (e) {
      // 存储满等异常静默（对局继续，仅断线续玩失效）
    }
    return;
  }
  memoryStore.set(key, value);
}

/**
 * 原始删除。
 * @param {string} key
 */
function rawRemove(key) {
  if (hasWX()) {
    try {
      wx.removeStorageSync(key);
    } catch (e) { /* 忽略 */ }
    return;
  }
  memoryStore.delete(key);
}

/**
 * JSON 读取 + 版本迁移。
 * @param {string} key
 * @returns {any|null}
 */
function getJSON(key) {
  const raw = rawGet(key);
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return raw; // 兼容直接存对象
  try {
    const json = JSON.parse(raw);
    return migrate(json);
  } catch (e) {
    return null;
  }
}

/**
 * JSON 写入（附带结构版本）。
 * @param {string} key
 * @param {any} value
 */
function setJSON(key, value) {
  const payload = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.assign({ __schemaVersion: SCHEMA_VERSION }, value)
    : value;
  rawSet(key, JSON.stringify(payload));
}

/**
 * 删除键。
 * @param {string} key
 */
function remove(key) {
  rawRemove(key);
}

/**
 * 存档版本迁移（SCHEMA_VERSION 升级时在此追加迁移步骤）。
 * @param {object} json
 * @returns {object|null} 版本过新无法降级时返回 null（由上层提示 E301）
 */
function migrate(json) {
  if (!json || typeof json !== 'object') return null;
  const v = json.__schemaVersion || 0;
  if (v > SCHEMA_VERSION) return null; // 存档来自更新版本，拒绝加载
  // v0 → v1：无结构变化（首版）
  return json;
}

module.exports = {
  get: getJSON,
  set: setJSON,
  remove,
  migrate,
  _memoryStore: memoryStore // 测试专用
};
