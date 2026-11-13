'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../miniprogram/match3/engine');
const { Match3Session, KEY } = require('../miniprogram/match3/session');

test('小程序消消乐：点击后切走取消旧动画，回来显示已保存结果，提示不扣步数', () => {
  const data = new Map();
  const storage = { get: (key) => data.get(key), set: (key, value) => data.set(key, JSON.parse(JSON.stringify(value))) };
  let page;
  const timers = new Map();
  let sequence = 0;
  const source = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/match3/match3.js'), 'utf8');
  vm.runInNewContext(source, {
    Page: (p) => { page = p; },
    require: (id) => id.endsWith('/engine') ? E : id.endsWith('/session') ? { Match3Session } : storage,
    setTimeout: (fn) => { timers.set(++sequence, fn); return sequence; },
    clearTimeout: (id) => timers.delete(id),
    wx: {}
  });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad(); page.onShow();
  const pair = E.findMove(page.session.state.board);
  pair.forEach((i) => page.onCell({ currentTarget: { dataset: { index: i } } }));
  assert.equal(page.session.state.moves, 29);
  assert.equal(data.get(KEY).current.moves, 29);
  assert.ok(timers.size);
  const pending = Array.from(timers.values());
  page.onHide();
  assert.equal(timers.size, 0);
  const hidden = JSON.stringify(page.data);
  pending.forEach((fn) => fn());
  assert.equal(JSON.stringify(page.data), hidden, '已失效回调不能更新页面');
  page.onShow();
  assert.equal(page.data.busy, false);
  assert.equal(page.data.score, page.session.state.score);
  assert.deepEqual(Array.from(page.data.cells, (cell) => cell.fruit), page.session.state.board);
  page.onHint();
  assert.equal(page.data.cells.filter((cell) => cell.hint).length, 2);
  assert.equal(page.session.state.moves, 29);
  page.onUnload();
});

test('小程序路由：大厅为默认入口，两款游戏目标页面均已注册', () => {
  const app = require('../miniprogram/app.json');
  assert.equal(app.pages[0], 'pages/lobby/lobby');
  let page;
  const urls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/lobby/lobby.js'), 'utf8'), {
    Page: (p) => { page = p; }, wx: { navigateTo: ({ url }) => urls.push(url) }
  });
  page.onCards(); page.onMatch3(); page.onPopstar();
  assert.deepEqual(urls, ['/pages/home/home', '/pages/match3/match3', '/pages/popstar/popstar']);
  urls.forEach((url) => assert.ok(app.pages.includes(url.slice(1))));
});

test('小程序消灭星星：移除后切后台保存稳定状态，恢复不重复计分', () => {
  const Star = require('../miniprogram/popstar/engine');
  const { PopstarSession } = require('../miniprogram/popstar/session');
  const data = new Map(), timers = new Map(); let sequence = 0, page;
  const storage = { get: (k) => data.get(k), set: (k,v) => data.set(k,JSON.parse(JSON.stringify(v))) };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/popstar/popstar.js'),'utf8'), {
    Page: (p) => {page=p;}, require: (id) => id.endsWith('/engine')?Star:id.endsWith('/session')?{PopstarSession}:storage,
    setTimeout: (fn) => {timers.set(++sequence,fn);return sequence;}, clearTimeout: (id) => timers.delete(id), wx:{}
  });
  page.setData=(patch)=>Object.assign(page.data,patch);page.onLoad();page.onShow();
  const group=Star.hint(page.session.state.board);
  page.onCell({currentTarget:{dataset:{index:group[0]}}});
  const score=page.session.state.score;
  assert.equal(page.session.state.board.filter(v=>v!==null).length,100-group.length);
  const pending=Array.from(timers.values());page.onHide();pending.forEach(fn=>fn());page.onShow();
  assert.equal(page.data.busy,false);assert.equal(page.data.score,score);
  assert.equal(data.get('popstar:progress:v1').current.score,score);page.onUnload();
});
