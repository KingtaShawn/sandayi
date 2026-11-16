/** DOM integration only: no browser/layout emulation or production network calls. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const E = require('../../miniprogram/match3/engine');
const { KEY } = require('../../miniprogram/match3/session');
const H5 = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('H5 发布产物：所有本地 CSS/JS/manifest 引用存在且使用同一版本', () => {
  const html = fs.readFileSync(path.join(H5, 'dist/index.html'), 'utf8');
  const refs = Array.from(html.matchAll(/(?:src|href)="((?:css|js)\/[^"?]+|manifest\.webmanifest)\?v=([^"]+)"/g));
  assert.equal(refs.length, 15);
  assert.equal(new Set(refs.map((ref) => ref[2])).size, 1);
  refs.forEach((ref) => assert.ok(fs.existsSync(path.join(H5, 'dist', ref[1])), ref[1]));
  assert.match(html, /id="btn-enter-match3"/);
  assert.match(html, /id="btn-enter-breakout"/);
  assert.match(html, /id="btn-enter-sudoku"/);
});

function boot(saved, { normalMotion = false, starSaved, pokerSetup, sudokuSaved } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(fs.readFileSync(path.join(H5, 'index.html'), 'utf8'), {
    url: 'https://local.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console
  });
  const w = dom.window;
  w.addEventListener('error', (event) => errors.push(event.error));
  let seed = 13;
  w.Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  w.matchMedia = () => ({ matches: !normalMotion });
  w.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {}, scale() {} });
  w.SoundFx = { play() {}, unlock() {}, state: () => 'idle', isEnabled: () => false, toggle: () => false, isMusicOn: () => false, toggleMusic: () => false, setActive(value) { this.active = value; } };
  // Fast card-game timers still execute their real callbacks; match animation ordering is preserved.
  const timeout = w.setTimeout.bind(w), interval = w.setInterval.bind(w);
  w.setTimeout = (fn, ms, ...args) => timeout(fn, ms >= 500 ? 10 : ms, ...args);
  w.setInterval = (fn, ms, ...args) => interval(fn, Math.min(ms, 2), ...args);
  if (starSaved) w.localStorage.setItem('popstar:progress:v1', starSaved);
  if (saved) w.localStorage.setItem(KEY, saved);
  if (sudokuSaved) w.localStorage.setItem('sudoku:progress:v1', sudokuSaved);
  for (const script of ['game-bundle.js', 'arcade-motion.js', 'popstar.js', 'match3.js', 'poker-engine.js', 'poker.js', 'mini-games.js', 'app.js']) {
    w.eval(fs.readFileSync(path.join(H5, 'js', script), 'utf8'));
    if (script === 'poker-engine.js' && pokerSetup) {
      const create = w.Poker.create;
      w.Poker.create = (...args) => { const state = create(...args); pokerSetup(state); return state; };
    }
  }
  const $ = (id) => w.document.getElementById(id);
  const click = (id) => $(id).click();
  const state = () => JSON.parse(JSON.stringify(w.GameCore.storage.get(KEY).current));
  const cell = (i) => $('match-board').children[i];
  async function settled() {
    for (let i = 0; i < 250; i++) {
      if ($('match-board').getAttribute('aria-busy') !== 'true') return;
      await sleep(5);
    }
    throw new Error('动画没有结束');
  }
  function close() { dom.window.close(); assert.deepEqual(errors, [], '没有未捕获的页面错误'); }
  return { w, $, click, state, cell, settled, close };
}

test('H5：默认双入口，三打一规则/返回/对局暂停恢复，音乐不进入果园', async () => {
  const p = boot();
  try {
    assert.equal(p.$('view-lobby').hidden, false);
    assert.equal(p.$('view-home').hidden, true);
    p.click('btn-enter-sandayi'); p.click('btn-rules');
    assert.match(p.$('rules-body').textContent, /三打一规则速查/);
    p.click('btn-rules-back'); p.click('btn-start');
    assert.equal(p.$('view-table').hidden, false);
    p.click('btn-table-lobby');
    const paused = JSON.stringify(p.w.__probe());
    p.click('btn-enter-match3');
    await sleep(80);
    assert.equal(JSON.stringify(p.w.__probe()), paused, 'AI 未在另一个游戏里继续出牌');
    assert.equal(p.w.SoundFx.active, false);
    p.click('btn-match-home'); p.click('btn-enter-sandayi');
    assert.equal(p.$('btn-start').textContent, '继续对局');
    const seed = p.w.__probe().seed;
    p.click('btn-start');
    assert.equal(p.w.__probe().seed, seed);
    assert.equal(p.$('view-table').hidden, false);
    assert.equal(p.w.document.documentElement.classList.contains('arcade-mode'), false);
  } finally { p.close(); }
});

test('H5：点击消除、无效交换、提示、重玩取消/确认及刷新恢复', async () => {
  const p = boot();
  let saved;
  try {
    p.click('btn-enter-match3');
    assert.equal(p.$('match-board').children.length, 64);
    const initial = p.state();
    let invalid;
    for (let a = 0; a < 63; a++) {
      if (E.adjacent(a, a + 1) && !E.trySwap(initial, a, a + 1).accepted) { invalid = [a, a + 1]; break; }
    }
    invalid.forEach((i) => p.cell(i).click());
    await p.settled();
    assert.deepEqual(p.state(), initial);
    p.click('btn-match-hint');
    assert.equal(p.w.document.querySelectorAll('.fruit--hint').length, 2);
    E.findMove(initial.board).forEach((i) => p.cell(i).click());
    await p.settled();
    assert.equal(p.state().moves, initial.moves - 1);
    assert.ok(p.state().score > 0);
    assert.equal(Number(p.$('match-score').textContent), p.state().score);
    saved = p.w.localStorage.getItem(KEY);
    p.click('btn-match-restart'); p.click('match-dialog-secondary');
    assert.equal(p.state().moves, 29);
    p.click('btn-match-restart'); p.click('match-dialog-primary');
    assert.equal(p.state().moves, 30); assert.equal(p.state().score, 0);
  } finally { p.close(); }
  const restored = boot(saved);
  try {
    restored.click('btn-enter-match3');
    assert.equal(restored.state().moves, 29);
    assert.ok(restored.state().score > 0);
    assert.equal(Number(restored.$('match-score').textContent), restored.state().score);
  } finally { restored.close(); }
});

test('H5：指针轻点与滑动每次仅交换一次，动画中离开保存结果且旧动画不污染新页面', async () => {
  const p = boot(undefined, { normalMotion: true });
  try {
    p.click('btn-enter-match3');
    const board = p.$('match-board');
    board.setPointerCapture = () => {}; board.hasPointerCapture = () => true; board.releasePointerCapture = () => {};
    const pair = E.findMove(p.state().board);
    function pointer(type, i, x, y) {
      const event = new p.w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      p.cell(i).dispatchEvent(event);
    }
    // Touch tap has a following synthetic click: selection must not toggle back off.
    pointer('pointerdown', pair[0], 0, 0); pointer('pointerup', pair[0], 0, 0); p.cell(pair[0]).click();
    assert.equal(p.cell(pair[0]).getAttribute('aria-pressed'), 'true');
    pointer('pointerdown', pair[0], 0, 0);
    pointer('pointerup', pair[0], pair[1] === pair[0] + 1 ? 35 : 0, pair[1] === pair[0] + 8 ? 35 : 0);
    p.cell(pair[0]).click();
    assert.equal(p.state().moves, 29);
    const committed = p.state();
    p.click('btn-match-home');
    await sleep(200);
    p.click('btn-enter-match3');
    assert.deepEqual(p.state(), committed);
    assert.equal(p.$('match-board').getAttribute('aria-busy'), 'false');
    assert.equal(p.$('match-dialog').hidden, true);
    assert.deepEqual(Array.from(board.children, (cell) => Number(cell.dataset.fruit)), committed.board);
  } finally { p.close(); }
});

test('H5：完整一关只经用户点击操作到结算，终局可重玩或下一关', async () => {
  const p = boot();
  try {
    p.click('btn-enter-match3');
    for (let step = 0; step < 30 && p.state().status === 'playing'; step++) {
      E.findMove(p.state().board).forEach((i) => p.cell(i).click());
      await p.settled();
    }
    const finished = p.state();
    assert.notEqual(finished.status, 'playing');
    assert.equal(p.$('match-dialog').hidden, false);
    p.click('match-dialog-primary');
    assert.equal(p.state().status, 'playing');
    assert.equal(p.state().score, 0);
    assert.equal(p.state().level, finished.status === 'won' ? 2 : 1);
    assert.equal(p.$('match-dialog').hidden, true);
  } finally { p.close(); }
});

test('H5：恢复失败和最终关胜利均有完整出口，弹窗键盘焦点可用', () => {
  for (const won of [false, true]) {
    const current = E.createGame(won ? 12 : 1, () => .4);
    current.moves = 0; current.score = won ? E.LEVELS[11].target : 0;
    const best = won ? Object.fromEntries(E.LEVELS.map((c) => [c.level, c.target])) : {};
    const saved = JSON.stringify(JSON.stringify({ version: 1, current, best }));
    const p = boot(saved);
    try {
      p.click('btn-enter-match3');
      assert.equal(p.$('match-dialog').hidden, false);
      assert.equal(p.$('match-dialog-primary').textContent, '再玩本关');
      assert.equal(p.w.document.activeElement.id, 'match-dialog-primary');
      p.$('match-dialog-primary').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      assert.equal(p.w.document.activeElement.id, 'match-dialog-secondary');
      p.click('match-dialog-secondary');
      assert.equal(p.$('view-lobby').hidden, false);
    } finally { p.close(); }
  }
});

test('动画：交换保留终点直到渲染新盘面，落距与来源相符，取消后不残留', async () => {
  const p = boot();
  try {
    p.w.matchMedia = () => ({ matches: false });
    const cells = Array.from(p.$('match-board').children), calls = [];
    cells.forEach((cell, i) => {
      cell.getBoundingClientRect = () => ({ left: i % 8 * 42, top: Math.floor(i / 8) * 42, width: 38, height: 38 });
      cell.animate = (frames, options) => {
        const a = { finished: Promise.resolve(), cancel() { this.cancelled = true; } };
        calls.push({ i, frames, options, a }); return a;
      };
    });
    const motion = p.w.createArcadeMotion(p.$('match-board'), cells, 8);
    motion.swap(0,1); await Promise.resolve(); await Promise.resolve();
    assert.equal(calls[0].frames[1].transform,'translate(42px,0px)');
    assert.equal(calls[1].frames[1].transform,'translate(-42px,0px)');
    motion.clearMoves(); assert.ok(calls.every(c=>c.a.cancelled),'已完成的 forwards 动画也必须取消');
    calls.length=0; motion.fall(E.fallSources([16,32]));
    assert.equal(calls.find(c=>c.i===16).frames[0].transform,'translate(0px,-84px)');
    assert.equal(calls.find(c=>c.i===0).frames[0].opacity,0);
    assert.equal(calls.some(c=>c.i===1),false,'未移动的格子不播放下落');
    motion.cancel();assert.ok(calls.every(c=>c.a.cancelled));
  } finally { p.close(); }
});

test('H5 消灭星星：四个入口、提示、完整盘面终局、下一关/重玩、存档隔离', async () => {
  const Star = require('../../miniprogram/popstar/engine');
  const p=boot(); let saved;
  const current=()=>JSON.parse(JSON.stringify(p.w.GameCore.storage.get('popstar:progress:v1').current));
  async function settleStar() {
    for(let i=0;i<300&&p.$('star-board').getAttribute('aria-busy')==='true';i++)await sleep(5);
    assert.equal(p.$('star-board').getAttribute('aria-busy'),'false');
  }
  try {
    assert.equal(p.w.document.querySelectorAll('.game-entry').length,6);
    const fruitSaved=p.w.localStorage.getItem(KEY);
    p.click('btn-enter-popstar');assert.equal(p.$('view-popstar').hidden,false);
    assert.equal(p.$('star-board').children.length,100);
    p.click('btn-star-hint');assert.ok(p.w.document.querySelectorAll('#star-board .fruit--hint').length>=2);
    for(let step=0;step<50&&current().status==='playing';step++) {
      p.$('star-board').children[Star.hint(current().board)[0]].click(); await settleStar();
    }
    assert.notEqual(current().status,'playing');assert.equal(p.$('star-dialog').hidden,false);
    saved=p.w.localStorage.getItem('popstar:progress:v1');
    assert.equal(p.w.localStorage.getItem(KEY),fruitSaved);
    const finished=current();p.click('star-dialog-primary');
    assert.equal(current().status,'playing');
    assert.equal(current().score,finished.status==='won'?finished.score:0);
    p.click('btn-star-home');p.click('btn-enter-match3');assert.equal(p.$('view-match3').hidden,false);
  } finally { p.close(); }
  const q=boot(undefined,{starSaved:saved});
  try { q.click('btn-enter-popstar'); assert.equal(q.$('star-dialog').hidden,false); q.click('star-dialog-secondary');assert.equal(q.$('view-lobby').hidden,false); } finally { q.close(); }
});

test('H5 消灭星星：动画中退出保留稳定结果，旧动画不能改写恢复页面', async () => {
  const Star=require('../../miniprogram/popstar/engine'); const p=boot(undefined,{normalMotion:true});
  try {
    p.click('btn-enter-popstar');
    const read=()=>JSON.parse(JSON.stringify(p.w.GameCore.storage.get('popstar:progress:v1').current));
    p.$('star-board').children[Star.hint(read().board)[0]].click();
    const saved=read();p.click('btn-star-home');await sleep(240);p.click('btn-enter-popstar');
    assert.deepEqual(read(),saved);assert.equal(p.$('star-board').getAttribute('aria-busy'),'false');
    assert.deepEqual(Array.from(p.$('star-board').querySelectorAll('[data-index]'),c=>c.dataset.fruit==='null'?null:Number(c.dataset.fruit)),saved.board);
    assert.equal(p.w.document.querySelectorAll('#star-board .arcade-spark').length,0);
  } finally {p.close();}
});

test('H5 德州入口、合法行动、暂停恢复与人数重置',async()=>{const p=boot();try{p.click('btn-enter-poker');assert.equal(p.$('view-poker').hidden,false);p.click('poker-next');assert.equal(p.$('poker-seats').children.length,7);assert.deepEqual(Array.from(p.w.document.querySelectorAll('.seat-info strong'),e=>e.textContent),['你','小扁豆','儿颠颠','三老蛤','滴滴佬','马老五','小腊顺']);assert.deepEqual(Array.from(p.w.document.querySelectorAll('.seat-position'),e=>e.textContent),['庄家','小盲','大盲','枪口','中位','劫位','关煞']);assert.equal(p.w.document.querySelectorAll('.poker-seat.in-hand').length,7);assert.ok(Array.from(p.w.document.querySelectorAll('.poker-seat.in-hand small')).every(e=>e.textContent.startsWith('在局')));assert.equal(p.$('poker-status').textContent,'荷官正在发牌…');assert.equal(p.$('poker-log').children.length,0);assert.equal(p.$('poker-hand').children.length,2);p.click('poker-home');const log=p.$('poker-log').textContent;await sleep(550);assert.equal(p.$('poker-log').textContent,log);p.click('btn-enter-poker');for(let i=0;i<100&&p.$('poker-call').disabled;i++)await sleep(100);assert.equal(p.$('poker-call').disabled,false);p.click('poker-call');assert.equal(p.$('poker-error').textContent,'');p.w.confirm=()=>true;p.$('poker-count').value='2';p.click('poker-reset');assert.equal(p.$('poker-seats').children.length,3);assert.equal(p.$('poker-next').disabled,false);}finally{p.close();}});

test('H5 荷官发手牌，回到牌桌不会重复发牌',()=>{const p=boot();try{p.click('btn-enter-poker');assert.ok(p.$('poker-dealer'));p.click('poker-next');assert.equal(p.$('poker-hand').querySelectorAll('.dealing').length,2);p.click('poker-home');p.click('btn-enter-poker');assert.equal(p.$('poker-hand').querySelectorAll('.dealing').length,0);assert.equal(p.$('poker-status').textContent,'荷官正在发牌…');assert.equal(p.$('poker-call').disabled,true);}finally{p.close();}});

test('H5 玩家手牌位于牌桌内，操作区包含完整操作',()=>{const p=boot();try{p.click('btn-enter-poker');assert.ok(p.$('poker-hand').closest('.poker-table'));assert.deepEqual(Array.from(p.w.document.querySelectorAll('.poker-actions button'),e=>e.id),['poker-fold','poker-call','poker-amount','poker-raise','poker-allin','poker-next','poker-reset']);}finally{p.close();}});

 test('H5 真人和 AI 清台后可继续，其他玩家筹码保留',async()=>{const p=boot(null,{pokerSetup:s=>{s.hand=1;s.dealer=0;s.players[0].chips=0;s.players[1].chips=1270;s.players[2].chips=0;s.players[3].chips=3110;}});try{p.click('btn-enter-poker');await sleep(30);assert.equal(p.$('poker-next').disabled,false);assert.equal(p.w.document.querySelectorAll('.poker-seat.eliminated').length,2);p.click('poker-next');const seats=Array.from(p.w.document.querySelectorAll('.poker-seat'));const total=i=>{const seat=seats[i],stack=Number(seat.querySelector('.seat-info > span').textContent.replace(/\D/g,'')),bet=seat.querySelector('.seat-bet');return stack+(bet?Number(bet.textContent.replace(/\D/g,'')):0);};assert.deepEqual([0,1,2,3].map(total),[2000,1270,2000,3110]);assert.match(p.$('poker-log').textContent,/你：补码 2000/);assert.match(p.$('poker-log').textContent,/儿颠颠：补码 2000/);}finally{p.close();}});

test('H5 分池时按实际分配展示每位获款者，收池完成后底池清零',async()=>{
  const p=boot(null,{pokerSetup:s=>{s.hand=1;s.dealer=0;s.players[0].total=100;s.players[1].total=100;s.awards=[80,120,0,0,0,0,0];s.winners=[0,1];s.board=[];s.result='你 收获 80 · 小扁豆 收获 120';}});
  try{p.click('btn-enter-poker');assert.ok(p.$('poker-chips').children.length>0);assert.equal(p.$('poker-next').disabled,true);assert.deepEqual(Array.from(p.w.document.querySelectorAll('.seat-info > span')).slice(0,2).map(e=>e.textContent),['◈ 1920','◈ 1880']);await sleep(80);assert.deepEqual(Array.from(p.w.document.querySelectorAll('.seat-info > span')).slice(0,2).map(e=>e.textContent),['◈ 2000','◈ 2000']);assert.deepEqual(Array.from(p.w.document.querySelectorAll('.seat-award'),e=>e.textContent),['+80','+120']);assert.equal(p.w.document.querySelectorAll('.poker-seat.winner').length,2);assert.match(p.$('poker-pot').textContent,/底池已分配/);assert.equal(p.$('poker-chips').children.length,0);assert.equal(p.$('poker-next').disabled,false);}finally{p.close();}
});

test('H5 每手结束后所有参与者亮牌，含已弃牌且无公共牌的情况',async()=>{
  const p=boot(null,{pokerSetup:s=>{s.hand=1;s.dealer=0;s.board=[];s.players[0].hole=[0,1];s.players[1].hole=[13,14];s.players[1].folded=true;s.players[2].hole=[26,27];s.players[2].folded=false;s.players[0].total=10;s.players[2].total=20;s.awards=[0,0,30,0,0,0,0];s.result='儿颠颠 收获 30';}});
  try{p.click('btn-enter-poker');assert.equal(p.w.document.querySelector('.seat-1 .seat-cards'),null);assert.equal(p.w.document.querySelector('.seat-2 .seat-cards .card-back')!==null,true);await sleep(80);assert.equal(p.w.document.querySelector('.seat-1 .seat-cards').textContent,'♥2♥3');assert.equal(p.w.document.querySelector('.seat-2 .seat-cards').textContent,'♣2♣3');assert.equal(p.$('poker-board').children.length,0);}finally{p.close();}
});
test('H5 加注选择为牌桌内的固定尺度',()=>{const p=boot();try{p.click('btn-enter-poker');const trigger=p.$('poker-amount');assert.equal(trigger.tagName,'BUTTON');assert.equal(p.$('poker-sizing-panel').hidden,true);assert.deepEqual(Array.from(p.w.document.querySelectorAll('.poker-size-options button'),o=>o.dataset.preset),['half','pot','double','triple']);}finally{p.close();}});

test('H5 半池预设显示并提交实际加注总额',async()=>{const p=boot();try{p.click('btn-enter-poker');p.click('poker-next');for(let i=0;i<100&&p.$('poker-raise').disabled;i++)await sleep(50);assert.equal(p.$('poker-raise').disabled,false);p.click('poker-amount');assert.equal(p.$('poker-sizing-panel').hidden,false);assert.equal(p.$('poker-amount').getAttribute('aria-expanded'),'true');p.click('poker-size-half');assert.equal(p.$('poker-sizing-panel').hidden,true);assert.equal(p.$('poker-amount').getAttribute('aria-expanded'),'false');assert.match(p.$('poker-amount').textContent,/½ 底池/);const text=p.$('poker-raise').textContent;assert.match(text,/^加注至 \d+$/);p.click('poker-raise');assert.ok(p.$('poker-log').textContent.includes('你：'+text));}finally{p.close();}});

 test('H5 横屏尺度面板支持键盘关闭与焦点返回',async()=>{const p=boot();try{p.click('btn-enter-poker');p.click('poker-next');for(let i=0;i<100&&p.$('poker-amount').disabled;i++)await sleep(50);assert.equal(p.$('poker-amount').disabled,false);p.click('poker-amount');assert.equal(p.w.document.activeElement.id,'poker-size-half');p.w.document.dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(p.$('poker-sizing-panel').hidden,true);assert.equal(p.w.document.activeElement.id,'poker-amount');p.click('poker-amount');p.click('poker-home');assert.equal(p.$('view-poker').hidden,true);p.click('btn-enter-poker');assert.equal(p.$('poker-sizing-panel').hidden,true);}finally{p.close();}});

test('H5 预设在多人底池中按实际加注总额递增排列',async()=>{
  const p=boot(null,{pokerSetup:s=>{s.hand=1;s.done=false;s.dealer=0;s.turn=0;s.street=1;s.board=[35,36,37];s.current=20;s.minRaise=20;s.pending=[0,1,2,3,4,5,6];s.rights=s.pending.slice();s.players.forEach((q,i)=>Object.assign(q,{hole:[i*2,i*2+1],bet:i===1?20:0,total:200+(i===1?20:0),chips:1800-(i===1?20:0),folded:false,action:''}));}});
  try{p.click('btn-enter-poker');await sleep(30);p.click('poker-amount');const opts=Array.from(p.w.document.querySelectorAll('.poker-size-options button'));const targets=opts.map(e=>Number(e.querySelector('small').textContent.replace(/\D/g,'')));assert.equal(opts.length,4);assert.deepEqual(targets,[...targets].sort((a,b)=>a-b));assert.equal(opts[0].dataset.preset,'double');assert.equal(opts[1].dataset.preset,'triple');}finally{p.close();}
});

test('H5 多位底池赢家高亮，只有退还筹码者不显示为赢家',async()=>{
  const p=boot(null,{pokerSetup:s=>{s.hand=1;s.dealer=0;s.players[0].total=100;s.players[1].total=100;s.players[2].total=10;s.awards=[80,120,10,0,0,0,0];s.winners=[0,1];s.board=[];s.result='你 收获 80 · 小扁豆 收获 120 · 儿颠颠 收获 10';}});
  try{p.click('btn-enter-poker');await sleep(80);assert.equal(p.w.document.querySelectorAll('.poker-seat.winner').length,2);assert.ok(p.w.document.querySelector('.seat-0.winner'));assert.ok(p.w.document.querySelector('.seat-1.winner'));assert.equal(p.w.document.querySelector('.seat-2.winner'),null);assert.equal(p.w.document.querySelector('.seat-0 small').textContent,'胜出');}finally{p.close();}
});

test('H5 数独：笔记、撤销、冲突检查、提示、暂停与刷新续玩', () => {
  const p = boot(); let saved;
  const state = () => JSON.parse(JSON.stringify(p.w.GameCore.storage.get('sudoku:progress:v1').current));
  try {
    p.click('btn-enter-sudoku');
    assert.equal(p.$('view-sudoku').hidden, false); assert.equal(p.$('sudoku-board').children.length, 81);
    const s = state(), i = s.givens.findIndex((n) => !n), cell = p.$('sudoku-board').children[i];
    cell.click(); p.click('sudoku-pencil'); p.$('sudoku-digits').children[2].click();
    assert.equal(state().notes[i], 4); assert.equal(state().board[i], 0);
    p.click('sudoku-undo'); assert.equal(state().notes[i], 0); p.click('sudoku-pencil');
    const peer = s.givens.findIndex((n, j) => n && p.w.GameCore.Sudoku.peers(i, j));
    cell.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: String(s.givens[peer]), bubbles: true }));
    assert.equal(cell.getAttribute('aria-invalid'), 'true'); p.click('sudoku-check'); assert.match(p.$('sudoku-status').textContent, /错误/);
    p.click('sudoku-hint'); assert.equal(state().board[i], s.solution[i]); assert.equal(state().hints, 1);
    p.click('sudoku-pause'); assert.equal(p.$('sudoku-cover').hidden, false); assert.ok(p.$('sudoku-hint').disabled);
    p.click('sudoku-pause'); assert.equal(p.$('sudoku-cover').hidden, true);
    saved = p.w.localStorage.getItem('sudoku:progress:v1');
    p.click('sudoku-home'); assert.equal(p.$('view-lobby').hidden, false);
    p.click('btn-enter-sudoku'); assert.equal(p.$('sudoku-cover').hidden, false); p.click('sudoku-pause'); assert.equal(state().board[i], s.solution[i]);
  } finally { p.close(); }
  const restored = boot(undefined, { sudokuSaved: saved });
  try { restored.click('btn-enter-sudoku'); assert.equal(restored.w.GameCore.storage.get('sudoku:progress:v1').current.hints, 1); assert.equal(restored.$('sudoku-hints').textContent, '1'); } finally { restored.close(); }
});

test('H5 数独：换难度取消/确认、键盘焦点与完整解题后返回', () => {
  const p = boot();
  try {
    p.click('btn-enter-sudoku');
    const s = () => p.w.GameCore.storage.get('sudoku:progress:v1').current;
    const initial = JSON.stringify(s());
    p.$('sudoku-difficulty').value = 'hard'; p.$('sudoku-difficulty').dispatchEvent(new p.w.Event('change'));
    const root = p.$('view-sudoku'), cancel = root.querySelector('[data-cancel]'), confirm = root.querySelector('[data-confirm]');
    assert.equal(p.w.document.activeElement, confirm);
    confirm.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); assert.equal(p.w.document.activeElement, cancel);
    cancel.click(); assert.equal(JSON.stringify(s()), initial); assert.equal(p.$('sudoku-difficulty').value, 'easy');
    p.$('sudoku-difficulty').value = 'medium'; p.$('sudoku-difficulty').dispatchEvent(new p.w.Event('change')); confirm.click(); assert.equal(s().difficulty, 'medium');
    const current = s();
    for (let i = 0; i < 81; i++) if (!current.givens[i]) { p.$('sudoku-board').children[i].click(); p.$('sudoku-digits').children[current.solution[i] - 1].click(); }
    assert.equal(s().status, 'won'); assert.match(p.$('sudoku-status').textContent, /完成/); assert.equal(p.$('sudoku-pause').disabled, true);
    p.click('sudoku-home'); p.click('btn-enter-sudoku'); assert.equal(p.$('sudoku-cover').hidden, true); assert.equal(p.$('sudoku-filled').textContent, '81 / 81');
  } finally { p.close(); }
});

test('H5 数独：离开和弹窗不计时，后台自动暂停', () => {
  const p = boot();
  try {
    let now = 1000; p.w.Date.now = () => now; let timer;
    p.w.setInterval = (fn) => { timer = fn; return 10001; }; p.w.clearInterval = () => { timer = null; };
    p.click('btn-enter-sudoku'); now += 3000; timer(); assert.equal(p.$('sudoku-time').textContent, '0:03');
    p.click('sudoku-rules'); now += 5000; timer(); p.$('view-sudoku').querySelector('[data-confirm]').click(); now += 1000; timer(); assert.equal(p.$('sudoku-time').textContent, '0:04');
    p.w.dispatchEvent(new p.w.Event('blur')); now += 5000; timer(); assert.equal(p.$('sudoku-time').textContent, '0:04'); assert.equal(p.$('sudoku-cover').hidden, false);
    p.click('sudoku-home'); assert.equal(timer, null);
  } finally { p.close(); }
});

test('H5 弹球：移动发球、切换暂停恢复、清关、失败与重开保留最高分', () => {
  const p = boot();
  try {
    const Session = p.w.GameCore.BreakoutSession; let session;
    p.w.GameCore.BreakoutSession = function (storage) { session = new Session(storage); return session; };
    const frames = new Map(); let id = 0, now = 100;
    p.w.requestAnimationFrame = (fn) => { frames.set(++id, fn); return id; }; p.w.cancelAnimationFrame = (key) => frames.delete(key);
    const frame = () => { now += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(now)); };
    p.click('btn-enter-breakout'); assert.equal(frames.size, 1); p.click('breakout-action'); frame(); frame(); assert.ok(session.state.ball.y < 432);
    p.$('breakout-canvas').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); frame(); assert.ok(session.state.paddle < 180);
    p.click('breakout-home'); assert.equal(frames.size, 0); assert.equal(session.state.paused, true);
    const before = JSON.stringify(session.state); p.click('btn-enter-sudoku'); frame(); assert.equal(JSON.stringify(session.state), before);
    p.click('sudoku-home'); p.click('btn-enter-breakout'); assert.equal(p.$('breakout-action').textContent, '继续游戏'); frame(); assert.equal(JSON.stringify(session.state), before);
    p.click('breakout-action'); frame(); frame(); assert.equal(session.state.paused, false);
    session.state.bricks = [{ x: 100, y: 80, w: 38, h: 18, hp: 1, color: 0 }]; session.state.ball = { x: 119, y: 110, vx: 0, vy: -450 }; frame(); frame();
    assert.equal(p.$('breakout-action').textContent, '下一关'); assert.equal(p.$('breakout-score').textContent, '10');
    p.click('breakout-action'); assert.equal(session.state.level, 2); assert.equal(p.$('breakout-action').textContent, '发球');
    p.click('breakout-action'); session.state.lives = 1; session.state.ball.y = 500; session.state.ball.vy = 300; frame(); frame(); assert.equal(p.$('breakout-action').textContent, '再来一局');
    p.click('breakout-action'); assert.equal(session.state.lives, 3); assert.equal(session.state.score, 0); assert.equal(session.best, 10);
    p.click('breakout-action'); p.click('breakout-restart'); p.$('view-breakout').querySelector('[data-cancel]').click(); assert.equal(session.state.paused, true);
    p.click('breakout-restart'); p.$('view-breakout').querySelector('[data-confirm]').click(); assert.equal(session.state.status, 'ready');
    p.click('breakout-home'); assert.equal(frames.size, 0);
  } finally { p.close(); }
});
