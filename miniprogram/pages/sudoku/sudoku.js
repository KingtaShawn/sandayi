'use strict';
const E = require('../../sudoku/engine');
const { SudokuSession } = require('../../sudoku/session');
const storage = require('../../storage/adapter');
const DIFFICULTIES = ['easy', 'medium', 'hard'];
Page({
  data: { cells: [], digits: [1, 2, 3, 4, 5, 6, 7, 8, 9], difficulties: ['简单', '中等', '困难'], difficulty: 0, time: '0:00', filled: 0, hints: 0, pencil: false, paused: false, won: false, canUndo: false, message: '每题只有一个解，慢慢来' },
  onLoad() {
    this.session = new SudokuSession(storage); this.selected = this.session.state.board.findIndex((n) => !n);
    if (this.selected < 0) this.selected = 0;
    this.paused = false; this.pencil = false; this.modal = false;
  },
  onShow() {
    this.active = true; this.last = Date.now(); this.paint(); this.session.save();
    clearInterval(this.timer); this.timer = setInterval(() => { this.tick(); this.setData({ time: E.timeLabel(this.session.state.elapsedMs) }); this.session.save(); }, 1000);
  },
  onHide() { this.stop(); }, onUnload() { this.stop(); },
  tick() {
    const now = Date.now();
    if (this.active && !this.paused && !this.modal && this.last) this.session.addTime(now - this.last);
    this.last = now;
  },
  stop() { this.tick(); this.active = false; this.paused = this.session.state.status === 'playing'; clearInterval(this.timer); this.session.save(); },
  paint() {
    const s = this.session.state;
    this.setData({ cells: E.cells(s, this.selected).map((c) => Object.assign(c, { label: `第${Math.floor(c.id / 9) + 1}行第${c.id % 9 + 1}列，${c.value || '空格'}${c.given ? '，题目数字' : ''}${c.conflict ? '，存在冲突' : ''}`, notes: c.notes.map((value, id) => ({ id, value })) })),
      time: E.timeLabel(s.elapsedMs), filled: s.board.filter(Boolean).length, hints: s.hints,
      difficulty: DIFFICULTIES.indexOf(s.difficulty), paused: this.paused, pencil: this.pencil,
      won: s.status === 'won', canUndo: this.session.history.length > 0
    });
    if (s.status === 'won') this.setData({ message: `完成！用时 ${E.timeLabel(s.elapsedMs)}，使用 ${s.hints} 次提示。` });
  },
  canPlay() { return this.active && !this.paused && !this.modal && this.session.state.status === 'playing'; },
  onCell(e) { if (!this.canPlay()) return; this.selected = Number(e.currentTarget.dataset.index); this.paint(); },
  onDigit(e) { this.enter(Number(e.currentTarget.dataset.value)); },
  enter(n) {
    if (!this.canPlay()) return;
    this.tick();
    if (this.session.move(this.selected, n, this.pencil)) this.setData({ message: E.conflicts(this.session.state.board).some(Boolean) ? '标红数字有重复，请检查' : '每行、每列、每个九宫格填入 1–9，不重复' });
    else if (this.session.state.givens[this.selected]) this.setData({ message: '这是题目数字，请选择一个空格' });
    this.paint();
  },
  onErase() { this.enter(0); },
  onPencil() { if (this.canPlay()) { this.pencil = !this.pencil; this.paint(); } },
  onUndo() { if (this.canPlay()) { this.tick(); if (this.session.undo()) this.setData({ message: '已撤销上一步' }); this.paint(); } },
  onHint() {
    if (!this.canPlay()) return;
    this.tick(); const i = this.session.hint(this.selected);
    if (i >= 0) { this.selected = i; this.setData({ message: '已填入一个正确数字；提示次数已记录' }); } this.paint();
  },
  onCheck() {
    if (!this.canPlay()) return;
    const s = this.session.state, wrong = s.board.filter((n, i) => n && n !== s.solution[i]).length;
    this.setData({ message: wrong ? `已填数字中有 ${wrong} 处错误，再检查一下吧` : '目前已填的数字都正确，继续加油' });
  },
  onPause() { if (!this.active || this.modal || this.session.state.status === 'won') return; this.tick(); this.paused = !this.paused; this.paint(); this.session.save(); },
  confirmNew(difficulty) {
    if (!this.active || this.modal) return;
    this.tick(); this.modal = true;
    wx.showModal({ title: '换一道新题？', content: '当前题目会被替换，新题保证只有一个解。',
      success: (r) => {
        if (r.confirm && this.active) {
          this.session.restart(difficulty); this.selected = this.session.state.board.findIndex((n) => !n); this.pencil = false; this.paused = false;
          this.setData({ message: '新题准备好了，从一个空格开始吧' });
        }
      },
      complete: () => { this.modal = false; this.last = Date.now(); if (this.active) this.paint(); }
    });
  },
  onNew() { this.confirmNew(this.session.state.difficulty); },
  onDifficulty(e) { const d = DIFFICULTIES[Number(e.detail.value)]; if (d && d !== this.session.state.difficulty) this.confirmNew(d); },
  onHome() { wx.navigateBack(); },
  onRules() {
    this.tick(); this.modal = true;
    wx.showModal({ title: '数独', content: '在空格填入1–9，每行、每列、每个3×3九宫格不能重复。深色数字是固定题目。笔记记录候选数，撤销恢复本次打开期间的操作；检查核对已填数字，提示填入一个正确数字。难度按留白数量区分，每题保证唯一解。进度自动保存在本机，暂停及离开页面不计时。', showCancel: false, complete: () => { this.modal = false; this.last = Date.now(); } });
  }
});
