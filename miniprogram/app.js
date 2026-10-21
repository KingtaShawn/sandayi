/**
 * miniprogram/app.js —— 小程序入口。
 *
 * 职责（架构 §2.2）：
 *   1. 全局 RuleConfig 加载（携带本地覆盖，config.js 唯一来源）；
 *   2. onShow 恢复对局（断线续玩 F-09：storage 中的序列化 GameState 由牌桌页接管）。
 */

'use strict';

const { createConfig, DEFAULT_CONFIG } = require('./engine/config');
const storage = require('./storage/adapter');
const { STORAGE_KEYS } = require('./storage/keys');
/** 后台规则配置文件（用户直接编辑此文件调规则；非法时自动回退默认） */
const RULE_CONFIG_FILE = require('./rule-config.js');

App({
  /**
   * 全局数据。
   */
  globalData: {
    /** 本局使用的 RuleConfig 快照（开新对局时固化进 GameState） */
    config: DEFAULT_CONFIG,
    /** 战绩统计（P1 services/stats.js 计算结果缓存） */
    stats: null
  },

  /**
   * 启动：合并本地配置覆盖（如后台下发的房规），加载战绩。
   */
  onLaunch() {
    // 规则来源优先级：rule-config.json（用户后台文档）> 本地存储覆盖（设置页）> 默认
    let overrides = {};
    try {
      overrides = storage.getJSON(STORAGE_KEYS.RULE_OVERRIDES) || {};
    } catch (e) {
      overrides = {};
    }
    overrides = Object.assign({}, RULE_CONFIG_FILE, overrides);
    // 去掉所有 _ 开头的中文说明字段（非规则参数，兼容旧 JSON 习惯）
    Object.keys(overrides).forEach((k) => {
      if (k.charAt(0) === '_') delete overrides[k];
    });
    try {
      this.globalData.config = createConfig(overrides);
    } catch (e) {
      // 配置非法时回退默认，避免卡死启动
      this.globalData.config = DEFAULT_CONFIG;
    }
    try {
      this.globalData.stats = storage.getJSON(STORAGE_KEYS.STATS) || null;
    } catch (e) {
      this.globalData.stats = null;
    }
  },

  /**
   * 前台切换：若有进行中对局存档，通知牌桌页恢复（table.onShow 读取）。
   */
  onShow() {
    // 恢复动作由 pages/table/table.js 的 onShow 执行（页面栈在则刷新，不在则由首页引导）
    try {
      const saved = storage.getJSON(STORAGE_KEYS.CURRENT_GAME);
      this.globalData.hasResumableGame = !!(saved && saved.phase);
    } catch (e) {
      this.globalData.hasResumableGame = false;
    }
  },

  /**
   * 更新全局配置（设置页调用）。
   * @param {object} overrides
   * @returns {{ok: boolean, reason?: string}}
   */
  updateConfig(overrides) {
    try {
      this.globalData.config = createConfig(overrides, this.globalData.config);
      storage.setJSON(STORAGE_KEYS.RULE_OVERRIDES, overrides || {});
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
});
