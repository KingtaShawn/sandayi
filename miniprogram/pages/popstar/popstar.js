'use strict';
const E = require('../../popstar/engine');
const { PopstarSession } = require('../../popstar/session');
const storage = require('../../storage/adapter');
Page({
  data: { cells: [], score: 0, level: 1, remaining: 100, target: 1000, best: 0, percent: 0, busy: false, status: 'playing', bonus: 0, message: '点击相连的同色星星，收集整片星光' },
  onLoad() { this.session = new PopstarSession(storage); this.generation = 0; },
  onShow() { this.active = true; this.busy = false; this.paint(); },
  onHide() { this.stop(); }, onUnload() { this.stop(); },
  stop() { this.active = false; this.generation++; clearTimeout(this.timer); },
  paint(board, matched = [], hint = [], sources) {
    if (!this.active) return;
    const s = this.session.state;
    this.setData({
      cells: (board || s.board).map((value, i) => ({ id: i, value, empty: value === null, name: value === null ? '空格' : E.NAMES[value] + '星星', pop: matched.includes(i), hint: hint.includes(i),
        falling: sources && sources[i] !== null && sources[i] !== i,
        shift: sources && sources[i] !== null ? `--dx: ${(sources[i] % 10 - i % 10) * 66}rpx; --dy: ${(Math.floor(sources[i] / 10) - Math.floor(i / 10)) * 66}rpx;` : '' })),
      level: s.level, score: s.score, remaining: s.board.filter((v) => v !== null).length,
      target: E.target(s.level), percent: Math.min(100, Math.floor(s.score / E.target(s.level) * 100)), best: this.session.best,
      status: s.status, bonus: s.bonus, busy: this.busy
    });
  },
  onCell(e) {
    if (this.busy || this.session.state.status !== 'playing') return;
    const board = this.session.state.board.slice();
    const result = this.session.move(Number(e.currentTarget.dataset.index));
    if (!result.accepted) { this.setData({ message: '至少两颗同色星星相连才能消除' }); return; }
    this.busy = true; const run = ++this.generation;
    this.paint(board, result.matched);
    this.setData({ message: `${result.matched.length} 颗一齐消除！ +${result.gained} 分` });
    this.timer = setTimeout(() => {
      if (!this.active || run !== this.generation) return;
      this.paint(null, [], [], result.sources);
      this.timer = setTimeout(() => { if (this.active && run === this.generation) { this.busy = false; this.paint(); } }, 420);
    }, 220);
  },
  onHint() {
    if (this.busy || this.session.state.status !== 'playing') return;
    const group = E.hint(this.session.state.board); this.paint(null, [], group);
    this.setData({ message: `这片 ${group.length} 颗，可得 ${5 * group.length * group.length} 分` });
  },
  onRestart() {
    if (this.busy) return;
    wx.showModal({ title: '重玩本关？', content: '盘面重新生成，分数回到入关时，历史最高分保留。', success: (r) => { if (r.confirm && this.active) { this.session.restart(); this.paint(); } } });
  },
  onContinue() { if (!this.session.next()) this.session.restart(); this.paint(); },
  onHome() { wx.reLaunch({ url: '/pages/lobby/lobby' }); },
  onRules() { wx.showModal({ title: '消灭星星', content: '点击横竖相连的至少2颗同色星星。一次消除n颗得5×n×n分。星星下落，空列左移，不补新星星。无可消除组合时结算，剩余不足10颗奖励2000−20×剩余数量²分。达到目标进入下一关，分数累积。无时间与步数限制。', showCancel: false }); }
});
