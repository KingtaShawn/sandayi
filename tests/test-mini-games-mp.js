'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function mount(name) {
  const filename = path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.js`), load = createRequire(filename);
  let page, modal, now = 1000, id = 0; const timers = new Map(), frames = new Map(), values = new Map();
  const storage = { get: (k) => values.has(k) ? JSON.parse(values.get(k)) : null, set: (k, v) => values.set(k, JSON.stringify(v)) };
  const ctx = { clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {}, scale() {} };
  const canvas = { getContext: () => ctx, requestAnimationFrame: (fn) => { frames.set(++id, fn); return id; }, cancelAnimationFrame: (key) => frames.delete(key) };
  const query = { in() { return this; }, select() { return this; }, fields() { return this; }, exec(fn) { fn([{ node: canvas, width: 300, height: 400, left: 16 }]); } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: (p) => { page = p; }, require: (p) => p.includes('storage/adapter') ? storage : load(p), Date: { now: () => now },
    setInterval: (fn) => { timers.set(++id, fn); return id; }, clearInterval: (key) => timers.delete(key),
    wx: { getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, pixelRatio: 2 }), createSelectorQuery: () => query, showModal: (options) => { modal = options; }, navigateBack() {} }
  });
  page.setData = (patch) => Object.assign(page.data, patch); page.onLoad(); page.onShow(); if (page.onReady) page.onReady();
  return { page, timers, frames, storage,
    advance(ms) { now += ms; [...timers.values()].forEach((fn) => fn()); },
    frame(ms) { now += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(now)); },
    confirm(value) { if (modal.success) modal.success({ confirm: value }); if (modal.complete) modal.complete(); },
    close() { page.onUnload(); assert.equal(timers.size, 0); assert.equal(frames.size, 0); }
  };
}
const cellEvent = (index) => ({ currentTarget: { dataset: { index } } });
test('小程序数独：操作、笔记撤销、隐藏停表与恢复，换题取消保留存档', () => {
  const p = mount('sudoku'), g = p.page;
  try {
    const s = g.session.state, i = s.givens.findIndex((n) => !n);
    g.onCell(cellEvent(i)); g.onPencil(); g.onDigit({ currentTarget: { dataset: { value: 3 } } }); assert.equal(s.notes[i], 4);
    g.onUndo(); assert.equal(s.notes[i], 0); g.onPencil(); g.enter(s.solution[i]); assert.equal(s.board[i], s.solution[i]);
    p.advance(2500); assert.equal(s.elapsedMs, 2500);
    g.onHide(); assert.equal(p.timers.size, 0); p.advance(9000); g.onShow(); p.advance(1000); assert.equal(s.elapsedMs, 2500);
    g.onPause(); p.advance(1000); assert.equal(s.elapsedMs, 3500);
    g.onDifficulty({ detail: { value: 2 } }); p.advance(5000); p.confirm(false); assert.equal(g.session.state, s); assert.equal(g.data.difficulty, 0); assert.equal(s.elapsedMs, 3500);
    g.onDifficulty({ detail: { value: 2 } }); p.confirm(true); assert.equal(g.session.state.difficulty, 'hard'); assert.equal(g.session.state.elapsedMs, 0);
    assert.equal(p.storage.get('sudoku:progress:v1').current.difficulty, 'hard');
  } finally { p.close(); }
});
test('小程序数独：完成后停表，返回后显示完整答案', () => {
  const p = mount('sudoku'), g = p.page;
  try {
    for (let i = 0; i < 81; i++) if (!g.session.state.givens[i]) { g.onCell(cellEvent(i)); g.enter(g.session.state.solution[i]); }
    assert.equal(g.data.won, true); p.advance(3000); assert.equal(g.session.state.elapsedMs, 0);
    g.onHide(); g.onShow(); assert.equal(g.data.paused, false); assert.equal(g.data.filled, 81);
  } finally { p.close(); }
});
test('小程序弹球：触屏移动、暂停恢复、返回清理帧，重开确认与最高分', () => {
  const p = mount('breakout'), g = p.page;
  try {
    assert.equal(g.data.ready, true); assert.equal(p.frames.size, 1);
    g.onTouch({ touches: [{ x: 100 }] }); assert.equal(g.session.state.paddle, 120);
    g.onAction(); p.frame(16); p.frame(16); assert.ok(g.session.state.ball.y < 432);
    g.onHide(); assert.equal(p.frames.size, 0); assert.equal(g.session.state.paused, true);
    const before = JSON.stringify(g.session.state); p.frame(5000); g.onShow(); p.frame(16); assert.equal(JSON.stringify(g.session.state), before);
    g.onAction(); p.frame(16); p.frame(16); assert.notEqual(JSON.stringify(g.session.state), before);
    g.session.state.score = 90; g.onRestart(); p.confirm(false); assert.equal(g.session.state.score, 90); assert.equal(g.session.state.paused, true);
    g.onRestart(); p.confirm(true); assert.equal(g.session.state.score, 0); assert.equal(g.session.best, 90);
    g.onResize(); assert.equal(p.frames.size, 1);
  } finally { p.close(); }
});
test('小程序：新游戏路由、JSON 和模板事件完整', () => {
  const app = require('../miniprogram/app.json');
  for (const name of ['sudoku', 'breakout']) {
    assert.ok(app.pages.includes(`pages/${name}/${name}`));
    assert.ok(require(`../miniprogram/pages/${name}/${name}.json`).usingComponents);
    const p = mount(name);
    const template = fs.readFileSync(path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.wxml`), 'utf8');
    for (const match of template.matchAll(/(?:bindtap|bindchange|catchtouchstart|catchtouchmove)="([^"]+)"/g)) assert.equal(typeof p.page[match[1]], 'function', match[1]);
    p.close();
  }
});
