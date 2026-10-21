/**
 * pages/home/home.js —— 首页：开始对局 / 规则速查 / 设置 / 继续对局。
 */

'use strict';

const storage = require('../../storage/adapter');
const { STORAGE_KEYS } = require('../../storage/keys');
const { summarize } = require('../../services/stats');

Page({
  data: {
    hasResumable: false,
    resumeRound: 0,
    hasHistory: false,
    myLevel: '2',
    enemyLevel: '2',
    statsText: ''
  },

  onShow() {
    const app = getApp();
    const saved = storage.get(STORAGE_KEYS.CURRENT_GAME);
    const hasResumable = !!(saved && saved.phase && saved.phase !== 'GAME_OVER');
    const records = storage.get(STORAGE_KEYS.STATS) || [];
    const stats = summarize(records);
    // 读取上局结束时的级数进度（结算存档）
    const progress = storage.get(STORAGE_KEYS.CURRENT_GAME);
    const myLevel = progress && progress.levels ? progress.levels.team0 : '2';
    const enemyLevel = progress && progress.levels ? progress.levels.team1 : '2';
    this.setData({
      hasResumable,
      resumeRound: saved ? saved.roundNo || 1 : 1,
      hasHistory: records.length > 0,
      myLevel,
      enemyLevel,
      statsText: stats.totalRounds
        ? `战绩 ${stats.wins}胜 ${stats.losses}负 · 胜率 ${(stats.winRate * 100).toFixed(0)}%`
        : ''
    });
    void app;
  },

  onStart() {
    // 新开局清除旧存档
    storage.remove(STORAGE_KEYS.CURRENT_GAME);
    wx.navigateTo({ url: '/pages/table/table?mode=new' });
  },

  onResume() {
    wx.navigateTo({ url: '/pages/table/table?mode=resume' });
  },

  onRules() {
    wx.navigateTo({ url: '/pages/rules/rules' });
  },

  onSettings() {
    const settings = storage.get(STORAGE_KEYS.SETTINGS) || { sound: true, animation: true };
    const that = this;
    wx.showActionSheet({
      itemList: [settings.sound ? '关闭音效' : '开启音效', settings.animation ? '关闭动画' : '开启动画'],
      success(res) {
        if (res.tapIndex === 0) settings.sound = !settings.sound;
        if (res.tapIndex === 1) settings.animation = !settings.animation;
        storage.set(STORAGE_KEYS.SETTINGS, settings);
        wx.showToast({ title: '已保存', icon: 'success' });
        void that;
      }
    });
  }
});
