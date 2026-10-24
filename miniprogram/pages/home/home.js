/**
 * pages/home/home.js —— 首页：开始对局 / 规则速查 / 设置 / 云账号 / 排行榜。
 */

'use strict';

const storage = require('../../storage/adapter');
const { STORAGE_KEYS } = require('../../storage/keys');
const { summarize } = require('../../services/stats');
const ruleConfig = require('../../rule-config');
const Cloud = require('../../utils/cloud');

Page({
  data: {
    hasHistory: false,
    isSanDaYi: ruleConfig.gameMode === 'san_da_yi',
    myLevel: '2',
    enemyLevel: '2',
    statsText: '',
    cloudText: '☁ 未连接',
    // 账号弹层
    cloudModal: false,
    cloudHint: '',
    cloudIsGuest: true,
    formName: '',
    formPass: '',
    formPass2: '',
    submitting: false,
    // 排行榜弹层
    lbModal: false,
    lbList: null,
    lbEmpty: ''
  },

  onLoad() {
    // 游客建档/升级成功时状态行即时刷新
    Cloud.on('state', () => this.updateCloudLine());
    Cloud.on('sync', () => this.onShow()); // 远端档案落地 → 刷新战绩显示
  },

  onShow() {
    const records = storage.get(STORAGE_KEYS.STATS) || [];
    const stats = summarize(records);
    // 读取上局结束时的级数进度（结算存档）
    const progress = storage.get(STORAGE_KEYS.CURRENT_GAME);
    const myLevel = progress && progress.levels ? progress.levels.team0 : '2';
    const enemyLevel = progress && progress.levels ? progress.levels.team1 : '2';
    this.setData({
      hasHistory: records.length > 0,
      isSanDaYi: ruleConfig.gameMode === 'san_da_yi',
      myLevel,
      enemyLevel,
      statsText: stats.totalRounds
        ? `战绩 ${stats.wins}胜 ${stats.losses}负 · 胜率 ${(stats.winRate * 100).toFixed(0)}%`
        : ''
    });
    this.updateCloudLine();
  },

  updateCloudLine() {
    const s = Cloud.state();
    this.setData({
      cloudText: s === 'user' ? `☁ 已同步：${Cloud.name() || Cloud.nick()}`
        : s === 'guest' ? '☁ 游客存档（换设备会丢档）' : '☁ 未连接'
    });
  },

  onStart() {
    // 新开局清除旧存档
    storage.remove(STORAGE_KEYS.CURRENT_GAME);
    wx.navigateTo({ url: '/pages/table/table?mode=new' });
  },

  onRules() {
    wx.navigateTo({ url: '/pages/rules/rules' });
  },

  /* ---------- 云账号 ---------- */
  onCloud() {
    const s = Cloud.state();
    this.setData({
      cloudModal: true,
      cloudIsGuest: s !== 'user',
      cloudHint: s === 'user' ? `已登录：${Cloud.name() || Cloud.nick()}（用户名区分大小写）`
        : s === 'guest' ? '当前是游客存档，仅保存在本机' : '云端未连接（离线可玩，联网后自动同步）',
      formName: '', formPass: '', formPass2: ''
    });
  },

  onCloudClose() { this.setData({ cloudModal: false }); },

  onNameInput(e) { this.setData({ formName: e.detail.value }); },
  onPassInput(e) { this.setData({ formPass: e.detail.value }); },
  onPass2Input(e) { this.setData({ formPass2: e.detail.value }); },

  submitCloud(mode) {
    const name = (this.data.formName || '').trim();
    const pass = this.data.formPass;
    if (!/^[a-zA-Z0-9_一-龥]{2,16}$/.test(name)) { wx.showToast({ title: '用户名需 2~16 位中文/字母/数字', icon: 'none' }); return; }
    if (!/^[\x21-\x7e]{4,32}$/.test(pass)) { wx.showToast({ title: '密码需 4~32 位字母/数字/符号', icon: 'none' }); return; }
    if (mode === 'bind' && pass !== this.data.formPass2) { wx.showToast({ title: '两次密码不一致', icon: 'none' }); return; }
    this.setData({ submitting: true });
    const p = mode === 'bind'
      ? Cloud.bind(name, pass).then(() => '已升级为正式账号，战绩保留')
      : Cloud.login(name, pass).then(() => { this.onShow(); return '已登录，档案已同步'; });
    p.then((msg) => {
      this.setData({ submitting: false, cloudModal: false });
      wx.showToast({ title: msg, icon: 'success' });
    }).catch((e) => {
      this.setData({ submitting: false });
      const st = e && e.status;
      const msg = (mode === 'bind' && st === 409) ? '这个名字已被占用，换一个吧'
        : (mode === 'bind' && st === 401) ? '登录态失效，重启小程序后重试'
        : st === 401 ? '用户名或密码错误'
        : st === 400 ? '用户名或密码格式不对'
        : '网络异常，请稍后再试';
      wx.showToast({ title: msg, icon: 'none' });
    });
  },

  onBind() { if (!this.data.submitting) this.submitCloud('bind'); },
  onLogin() { if (!this.data.submitting) this.submitCloud('login'); },

  /* ---------- 排行榜（报满坐庄榜） ---------- */
  onLeaderboard() {
    this.setData({ lbModal: true, lbList: null, lbEmpty: '加载中…' });
    Cloud.leaderboard().then((list) => {
      const me = Cloud.uid();
      this.setData({
        lbList: (list || []).map((r, i) => ({
          rank: i < 3 ? ['①', '②', '③'][i] : String(i + 1),
          nick: String(r.nick == null ? '' : r.nick),
          maxBids: Number(r.maxBids) || 0,
          isMe: !!(r.uid && r.uid === me)
        })),
        lbEmpty: (list && list.length) ? '' : '还没有人报满坐庄——去当第一个！'
      });
    }).catch(() => {
      this.setData({ lbList: null, lbEmpty: '网络异常，稍后再试' });
    });
  },

  onLbClose() { this.setData({ lbModal: false }); },

  onSettings() {
    const settings = storage.get(STORAGE_KEYS.SETTINGS) || { sound: true, animation: true };
    wx.showActionSheet({
      itemList: [settings.sound ? '关闭音效' : '开启音效', settings.animation ? '关闭动画' : '开启动画'],
      success: (res) => {
        if (res.tapIndex === 0) settings.sound = !settings.sound;
        if (res.tapIndex === 1) settings.animation = !settings.animation;
        storage.set(STORAGE_KEYS.SETTINGS, settings);
        Cloud.notifyLocal(); // 设置有变，随档案上云
        wx.showToast({ title: '已保存', icon: 'success' });
      }
    });
  }
});
