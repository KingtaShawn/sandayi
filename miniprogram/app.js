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
const Cloud = require('./utils/cloud');
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
    // 云端账号：微信登录（降级游客）+ 档案拉取合并，全程异步静默（见 utils/cloud.js）
    Cloud.init();
    // 隐私合规授权（微信审核硬性要求，见 initPrivacy）
    this.initPrivacy();
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
  },

  /**
   * 隐私合规授权（微信 2023 起强制要求）。
   * 云同步上线后本小程序会请求自有后端（utils/cloud.js，仅匿名 uid + 游戏档案，
   * 不收集手机号/位置等个人信息），隐私指引措辞需在公众平台同步更新。
   * 前置条件：需在公众平台「设置 → 隐私保护指引」填写本小程序的隐私说明。
   * 用户同意后由微信端记录，后续启动不再弹出。
   */
  initPrivacy() {
    if (typeof wx === 'undefined' || typeof wx.getPrivacySetting !== 'function') return;
    try {
      wx.getPrivacySetting({
        success: (res) => {
          if (res && res.needAuthorization) {
            // 触发微信官方隐私授权弹窗（含《隐私保护指引》链接）
            wx.requirePrivacyAuthorize({
              success: () => {
                // 用户已同意，微信端已记录，无需额外处理
              },
              fail: () => {
                // 用户拒绝：不阻塞游戏，下次启动再提示
              }
            });
          }
        },
        fail: () => {
          // 未配置隐私指引或接口异常时静默忽略，不影响游戏运行
        }
      });
    } catch (e) {
      // 开发者工具/未配置隐私指引可能抛错，忽略不影响本地运行
    }
  }
});
