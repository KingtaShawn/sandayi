'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../miniprogram/poker/engine');
test('小程序：真人和 AI 清台后可继续，其他玩家保持筹码',()=>{
  let page;const timers=new Map();let nextTimer=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:()=>E,
    setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{}
  });
  page.setData=patch=>Object.assign(page.data,patch);page.onLoad();page.onShow();
  page.s.hand=1;page.s.dealer=0;page.s.players[0].chips=0;page.s.players[1].chips=1270;page.s.players[2].chips=0;page.s.players[3].chips=3110;
  page.render();assert.equal(page.data.canNext,true);
  assert.equal(page.data.players[0].action,'待补码');assert.equal(page.data.players[2].action,'待补码');
  page.next();assert.deepEqual(page.s.players.slice(0,4).map(p=>p.chips+p.bet),[2000,1270,2000,3110]);
  assert.ok(page.s.log.includes('你：补码 2000'));assert.ok(page.s.log.includes('儿颠颠：补码 2000'));
  page.onUnload();
});

test('小程序：分池筹码分别送至获款座位，完成后底池归零',()=>{
  let page;const timers=new Map();let nextTimer=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:()=>E,
    setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{}
  });
  page.setData=patch=>Object.assign(page.data,patch);page.onLoad();
  page.s.hand=1;page.s.dealer=0;page.s.board=[];page.s.players[0].total=100;page.s.players[1].total=100;page.s.awards=[80,120,0,0,0,0,0];
  page.lastHand=1;page.totalsHand=1;page.totalsSeen=[100,100,0,0,0,0,0];page.loop();
  assert.equal(page.data.pot,200);assert.equal(page.data.players[0].chips,1920);assert.equal(page.data.players[1].chips,1880);assert.equal(page.data.payoutFlights.length,2);assert.deepEqual(Array.from(page.data.players.slice(0,2),p=>p.award),[80,120]);assert.equal(page.data.canNext,false);
  const finish=timers.get(page.timer);assert.ok(finish);finish();assert.equal(page.data.players[0].chips,2000);assert.equal(page.data.players[1].chips,2000);assert.equal(page.data.pot,0);assert.equal(page.data.payoutFlights.length,0);assert.equal(page.data.canNext,true);page.onUnload();
});

test('小程序：提前弃牌也在每手结束后亮出底牌',()=>{
  let page;const timers=new Map();let nextTimer=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:()=>E,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{}
  });
  page.setData=patch=>Object.assign(page.data,patch);page.onLoad();
  page.s.hand=1;page.s.dealer=0;page.s.board=[];page.s.players[1].hole=[13,14];page.s.players[1].folded=true;page.s.players[2].hole=[26,27];page.s.awards=[0,0,30,0,0,0,0];
  page.lastHand=1;page.totalsHand=1;page.totalsSeen=[0,0,0,0,0,0,0];page.render();assert.equal(page.data.players[1].cards,'');
  page.loop();assert.equal(page.data.players[1].cards,'♥2 ♥3');assert.equal(page.data.players[1].revealed,true);assert.equal(page.data.players[2].cards,'♣2 ♣3');page.onUnload();
});

test('小程序：选择半池后按预设合法金额加注',()=>{
  let page;const timers=new Map();let nextTimer=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:()=>E,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{}
  });
  page.setData=patch=>Object.assign(page.data,patch);page.onLoad();page.s=E.create(2);E.start(page.s,()=>0.3);page.dealing=false;page.render();
  assert.equal(page.data.human,true);page.openSizing();assert.equal(page.data.sizingOpen,true);assert.equal(page.data.sizingOptions[1].target,45);page.selectSizing({currentTarget:{dataset:{index:1}}});assert.equal(page.data.sizingOpen,false);assert.equal(page.data.raiseTo,45);
  page.act({currentTarget:{dataset:{type:'raise'}}});assert.equal(page.s.players[0].bet,45);page.onUnload();
});
