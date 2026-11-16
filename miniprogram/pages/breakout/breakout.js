'use strict';
const E = require('../../breakout/engine');
const { draw } = require('../../breakout/draw');
const { BreakoutSession } = require('../../breakout/session');
const storage = require('../../storage/adapter');
Page({
  data: { score: 0, lives: 3, level: 1, best: 0, message: '', action: '发球', canvasWidth: 300, canvasHeight: 400, ready: false },
  onLoad() { this.session = new BreakoutSession(storage); this.destroyed = false; this.resize(); },
  resize() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const width = Math.max(210, Math.min(360, info.windowWidth - 32, (info.windowHeight - 245) * .75));
    this.setData({ canvasWidth: width, canvasHeight: width * 4 / 3 });
  },
  onReady() { this.setupCanvas(); },
  onResize() { this.pause(); this.resize(); this.setupCanvas(); },
  setupCanvas() {
    this.cancelFrame();
    wx.createSelectorQuery().in(this).select('#breakout-canvas').fields({ node: true, size: true, rect: true }).exec((result) => {
      if (this.destroyed || !result[0] || !result[0].node) return;
      this.canvas = result[0].node; this.rect = result[0]; this.ctx = this.canvas.getContext('2d');
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(), ratio = Math.min(info.pixelRatio || 1, 3);
      this.canvas.width = this.rect.width * ratio; this.canvas.height = this.rect.height * ratio;
      this.ctx.scale(this.canvas.width / E.WIDTH, this.canvas.height / E.HEIGHT);
      this.setData({ ready: true }); this.paint(); this.startLoop();
    });
  },
  onShow() { this.active = true; this.paint(); this.startLoop(); },
  onHide() { this.stop(); },
  onUnload() { this.destroyed = true; this.stop(); },
  cancelFrame() { if (this.canvas && this.frameId != null) this.canvas.cancelAnimationFrame(this.frameId); this.frameId = null; },
  startLoop() {
    this.cancelFrame(); this.last = 0;
    if (!this.active || !this.canvas) return;
    const frame = (now) => {
      if (!this.active) return;
      this.session.step(this.last ? (now - this.last) / 1000 : 0); this.last = now; this.paint();
      this.frameId = this.canvas.requestAnimationFrame(frame);
    };
    this.frameId = this.canvas.requestAnimationFrame(frame);
  },
  pause() { if (!this.session) return; E.pause(this.session.state); this.last = 0; this.session.save(); this.paint(); },
  stop() { this.pause(); this.active = false; this.cancelFrame(); },
  paint() {
    if (!this.session) return;
    const s = this.session.state, summary = [s.score, s.lives, s.level, s.status, s.paused, this.session.best].join(':');
    if (summary !== this.summary) {
      this.summary = summary; this.setData({ score: s.score, lives: s.lives, level: s.level, best: this.session.best, message: E.message(s), action: E.actionLabel(s) });
    }
    if (this.ctx) draw(this.ctx, s);
  },
  onTouch(e) {
    if (!this.active || !this.rect) return;
    const touch = e.touches[0]; if (!touch) return;
    const x = Number.isFinite(touch.x) ? touch.x : touch.clientX - this.rect.left;
    E.movePaddle(this.session.state, x / this.rect.width * E.WIDTH); this.paint();
  },
  onAction() { if (this.active && this.data.ready) { this.session.action(); this.last = 0; this.paint(); } },
  onRestart() {
    this.pause(); wx.showModal({ title: '重新开始？', content: '从第 1 关、3 条生命开始，历史最高分保留。', success: (r) => { if (r.confirm && this.active) { this.session.restart(); this.paint(); } } });
  },
  onHome() { wx.navigateBack(); },
  onRules() {
    this.pause(); wx.showModal({ title: '经典弹球', content: '在场地左右拖动控制挡板，点击发球开始。挡板边缘改变反弹方向；每次击中砖块得10分，带标记的砖块需要击中两次。共有6关、3条生命，清空砖块进入下一关。离开页面自动暂停，点击继续恢复；关闭页面后重新开局，最高分保存在本机。', showCancel: false });
  }
});
