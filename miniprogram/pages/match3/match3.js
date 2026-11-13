'use strict';

const E = require('../../match3/engine');
const { Match3Session } = require('../../match3/session');
const storage = require('../../storage/adapter');

Page({
  data: { cells: [], level: 1, score: 0, moves: 30, target: 900, percent: 0, best: 0, busy: false, status: 'playing', message: '让三个相同的水果排成一行吧', lastLevel: false },
  onLoad() { this.session = new Match3Session(storage); this.selected = null; this.generation = 0; },
  onShow() { this.active = true; this.busy = false; this.selected = null; this.paint(); },
  onHide() { this.stop(); },
  onUnload() { this.stop(); },

  stop() {
    this.active = false; this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  },

  paint(values, hits = [], hint = []) {
    if (!this.active || !this.session) return;
    const state = this.session.state;
    const target = E.LEVELS[state.level - 1].target;
    this.setData({
      cells: (values || state.board).map((fruit, i) => ({ id: i, fruit, emoji: E.FRUITS[fruit], name: E.NAMES[fruit], selected: this.selected === i, pop: hits.includes(i), hint: hint.includes(i) })),
      level: state.level, score: state.score, moves: state.moves, target,
      percent: Math.min(100, Math.floor(state.score / target * 100)),
      best: this.session.best[state.level] || 0, busy: this.busy, status: state.status, lastLevel: state.level === E.LEVELS.length
    });
  },

  onCell(e) {
    if (this.busy || this.session.state.status !== 'playing') return;
    const i = Number(e.currentTarget.dataset.index);
    if (this.selected === i) this.selected = null;
    else if (this.selected !== null && E.adjacent(this.selected, i)) {
      const a = this.selected;
      this.selected = null;
      const result = this.session.move(a, i);
      if (!result.accepted) {
        this.setData({ message: '没有连成三个，不扣步数哦' });
        this.paint(); return;
      }
      this.busy = true;
      const run = ++this.generation;
      const step = (index) => {
        if (!this.active || run !== this.generation) return;
        if (index >= result.frames.length) {
          this.busy = false; this.paint();
          if (result.reshuffled) this.setData({ message: '无可用交换，已自动洗牌，不扣步数' });
          return;
        }
        const frame = result.frames[index];
        this.paint(frame.board, frame.matched);
        this.setData({ score: frame.score, percent: Math.min(100, Math.floor(frame.score / E.LEVELS[this.session.state.level - 1].target * 100)), message: `${frame.combo > 1 ? frame.combo + ' 连消！' : '消除 ' + frame.matched.length + ' 枚水果'} +${frame.gained} 分` });
        this.timer = setTimeout(() => {
          if (!this.active || run !== this.generation) return;
          this.paint(frame.after);
          this.setData({ score: frame.score });
          this.timer = setTimeout(() => step(index + 1), 220);
        }, 220);
      };
      step(0); return;
    } else this.selected = i;
    this.paint();
  },

  onHint() {
    if (this.busy || this.session.state.status !== 'playing') return;
    this.selected = null;
    this.paint(null, [], E.findMove(this.session.state.board) || []);
    this.setData({ message: '交换两枚亮起的水果，不扣步数' });
  },
  restart() { this.session.restart(); this.selected = null; this.paint(); this.setData({ message: '新的一盘，试试连锁消除吧' }); },
  onRestart() {
    if (this.busy) return;
    wx.showModal({ title: '重玩本关？', content: '本关分数和步数将重置，最佳分数与已解锁关卡保留。', confirmText: '重玩', success: (r) => { if (r.confirm && this.active) this.restart(); } });
  },
  onContinue() {
    if (this.busy) return;
    if (!this.session.next()) this.restart();
    this.paint();
    this.setData({ message: '新的一盘，试试连锁消除吧' });
  },
  onHome() { wx.reLaunch({ url: '/pages/lobby/lobby' }); },
  onRules() {
    wx.showModal({ title: '果园消消乐', content: '点击两枚相邻水果交换。横竖连成至少 3 枚消除，每枚 10 分，连锁最高 5 倍。无效交换不扣步数，连锁不额外扣步数。步数用完前达到目标即胜，无路可走自动洗牌。共 12 关，进度仅保存在本机。', showCancel: false, confirmText: '知道了' });
  }
});
