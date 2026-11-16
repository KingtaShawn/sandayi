'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../miniprogram/poker/engine');
const M=require('../miniprogram/poker/motion');
test('小程序：真人和 AI 清台后可继续，其他玩家保持筹码',()=>{
  let page;const timers=new Map();let nextTimer=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,
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
    Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,
    setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{}
  });
  page.setData=patch=>Object.assign(page.data,patch);page.onLoad();
  page.s.hand=1;page.s.dealer=0;page.s.board=[];page.s.players[0].total=100;page.s.players[1].total=100;page.s.awards=[80,120,0,0,0,0,0];page.s.winners=[0,1];
  page.geometry={table:{left:0,top:0},pot:{left:100,top:100,width:20,height:20},seats:Array.from({length:7},(_,i)=>({left:i*30,top:200,width:20,height:20}))};
  page.lastHand=1;page.totalsHand=1;page.totalsSeen=[100,100,0,0,0,0,0];page.loop();
  assert.equal(page.data.pot,200);assert.equal(page.data.players[0].chips,1920);assert.equal(page.data.players[1].chips,1880);assert.equal(page.data.payoutFlights.length,2);assert.deepEqual(Array.from(page.data.players.slice(0,2),p=>p.award),[80,120]);assert.equal(page.data.players[0].winner,true);assert.equal(page.data.players[1].winner,true);assert.equal(page.data.players[2].winner,false);assert.equal(page.data.canNext,false);
  const finish=timers.get(page.timer);assert.ok(finish);finish();assert.equal(page.data.players[0].chips,2000);assert.equal(page.data.players[1].chips,2000);assert.equal(page.data.pot,0);assert.equal(page.data.payoutFlights.length,0);assert.equal(page.data.canNext,true);page.onUnload();
});

test('小程序：提前弃牌也在每手结束后亮出底牌',()=>{
  let page;const timers=new Map();let nextTimer=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{}
  });
  page.setData=patch=>Object.assign(page.data,patch);page.onLoad();
  page.s.hand=1;page.s.dealer=0;page.s.board=[];page.s.players[1].hole=[13,14];page.s.players[1].folded=true;page.s.players[2].hole=[26,27];page.s.awards=[0,0,30,0,0,0,0];
  page.lastHand=1;page.totalsHand=1;page.totalsSeen=[0,0,0,0,0,0,0];page.render();assert.equal(page.data.players[1].cards,'');
  page.loop();assert.equal(page.data.players[1].cards,'♥2 ♥3');assert.equal(page.data.players[1].revealed,true);assert.equal(page.data.players[2].cards,'♣2 ♣3');page.onUnload();
});

test('小程序：选择半池后按预设合法金额加注',()=>{
  let page;const timers=new Map();let nextTimer=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{}
  });
  page.setData=patch=>Object.assign(page.data,patch);page.onLoad();page.s=E.create(2);E.start(page.s,()=>0.3);page.dealing=false;page.render();
  assert.equal(page.data.human,true);page.openSizing();assert.equal(page.data.sizingOpen,true);assert.equal(page.data.sizingOptions.find(o=>o.label==='½ 底池').target,45);page.selectSizing({currentTarget:{dataset:{index:0}}});assert.equal(page.data.sizingOpen,false);assert.equal(page.data.raiseTo,45);
  page.act({currentTarget:{dataset:{type:'raise'}}});assert.equal(page.s.players[0].bet,45);page.onUnload();
});

test('小程序：多人底池预设按真实金额递增，选择仍对应正确尺度',()=>{
  let page;const timers=new Map();let nextTimer=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{}});
  page.setData=patch=>Object.assign(page.data,patch);page.onLoad();E.start(page.s,()=>0.3);page.s.street=1;page.s.board=[35,36,37];page.s.current=20;page.s.players.forEach((p,i)=>{p.bet=i===1?20:0;p.total=200+p.bet;p.chips=2000-p.total});page.s.turn=0;page.s.rights=[0];page.dealing=false;page.render();
  const options=Array.from(page.data.sizingOptions);assert.deepEqual(options.map(o=>o.target),options.map(o=>o.target).slice().sort((a,b)=>a-b));assert.equal(options[0].label,'½ 底池');
  page.openSizing();const half=options.find(o=>o.label==='½ 底池');page.selectSizing({currentTarget:{dataset:{index:half.index}}});assert.equal(page.data.raiseTo,half.target);page.onUnload();
});

test('小程序：荷官发牌与筹码运动使用实测目标座位坐标',()=>{
  let page;const timers=new Map();let nextTimer=0;let lastDelay=0;
  const rect=(left,top,width,height,dataset)=>({left,top,width,height,dataset});
  const seats=Array.from({length:7},(_,i)=>rect(20+i*40,120,30,20));
  const cardGroups=Array.from({length:6},(_,k)=>[0,1].map(cardIndex=>rect(60+k*40+cardIndex*12,145,20,24,{seatIndex:k+1,cardIndex}))).flat();
  const rects=[rect(5,6,400,240),rect(100,10,40,40),rect(150,80,20,20),seats,cardGroups,[],[rect(190,190,20,30),rect(214,190,20,30)]];
  const query={in(){return this},select(){return this},selectAll(){return this},boundingClientRect(){return this},fields(options){assert.equal(options.rect,true);assert.equal(options.size,true);assert.equal(options.dataset,true);return this},exec(fn){fn(rects)}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,setTimeout:(fn,ms)=>{lastDelay=ms;timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{createSelectorQuery:()=>query}
  });
  page.setData=(patch,callback)=>{Object.assign(page.data,patch);if(callback)callback()};page.onLoad();page.onShow();page.next();
  assert.equal(page.data.motionReady,true);assert.equal(page.data.motionHand,true);
  assert.equal(lastDelay,M.dealDuration(14));assert.equal(page.data.human,false);
  assert.match(page.data.handMotion[0],/--deal-x:-80px;--deal-y:-175px/);
  assert.match(page.data.seatMotion[1][0],/--deal-x:50px;--deal-y:-127px;animation-delay:0ms/);
  assert.match(page.data.seatMotion[1][1],/--deal-x:38px;--deal-y:-127px;animation-delay:3220ms/);
  assert.equal(page.data.betFlights.length,2);
  assert.match(page.data.betFlights[0].style,/left:155px;top:84px;--dx:-85px;--dy:40px/);
  rects[5]=[rect(170,70,20,30),rect(195,70,20,30),rect(220,70,20,30)];
  page.s.board=[0,1,2];page.loop();assert.equal(page.data.motionReady,true);assert.equal(page.data.motionBoardFrom,0);
  assert.equal(lastDelay,M.dealDuration(3));assert.match(page.data.boardMotion[1],/animation-delay:460ms/);assert.match(page.data.boardMotion[2],/animation-delay:920ms/);
  assert.match(page.data.boardMotion[0],/--deal-x:-60px;--deal-y:-55px/);
  page.onUnload();
});

test('小程序：离开页面后忽略过期的坐标查询',()=>{
  let page;const callbacks=[];
  const query={in(){return this},select(){return this},selectAll(){return this},boundingClientRect(){return this},fields(){return this},exec(fn){callbacks.push(fn)}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,setTimeout:()=>1,clearTimeout:()=>{},wx:{createSelectorQuery:()=>query}
  });
  page.setData=(patch,callback)=>{Object.assign(page.data,patch);if(callback)callback()};page.onLoad();page.onShow();assert.ok(callbacks.length);page.onHide();
  const rect={left:0,top:0,width:40,height:40};callbacks.forEach(fn=>fn([rect,rect,rect,[rect],[],[],[]]));
  assert.equal(page.geometry,null);assert.notEqual(page.data.motionReady,true);page.onUnload();
});

test('小程序：无法测量坐标时牌面仍可正常显示',()=>{
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,setTimeout:()=>1,clearTimeout:()=>{},wx:{}
  });
  page.setData=(patch,callback)=>{Object.assign(page.data,patch);if(callback)callback()};page.onLoad();page.onShow();page.next();
  assert.equal(page.data.motionPending,false);assert.equal(page.data.motionReady,false);assert.equal(page.data.hole.length,2);page.onUnload();
});

test('小程序：横竖屏变化取消旧路径并显示牌面',()=>{
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{
    Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,setTimeout:()=>1,clearTimeout:()=>{},wx:{}
  });
  page.setData=(patch,callback)=>{Object.assign(page.data,patch);if(callback)callback()};page.onLoad();
  page.betFlights=[{id:1}];page.payoutFlights=[{id:2}];page.pendingDeal={hand:true};
  page.setData({motionPending:true,motionReady:true,motionHand:true,motionBoardFrom:0,betFlights:[{id:1}],payoutFlights:[{id:2}]});
  page.onResize();assert.equal(page.pendingDeal,null);assert.equal(page.betFlights.length,0);assert.equal(page.payoutFlights.length,0);assert.equal(page.data.motionPending,false);assert.equal(page.data.motionReady,false);assert.equal(page.data.motionHand,false);assert.equal(page.data.motionBoardFrom,-1);assert.equal(page.data.betFlights.length,0);assert.equal(page.data.payoutFlights.length,0);page.onUnload();
});

test('小程序：底池40时两倍底池选择加注到80',()=>{
  let page;const timers=new Map();let nextTimer=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{}});
  page.setData=patch=>Object.assign(page.data,patch);page.onLoad();page.s=E.create(2);E.start(page.s,()=>0.3);page.s.street=1;page.s.board=[35,36,37];page.s.current=0;page.s.minRaise=20;page.s.turn=0;page.s.rights=[0];page.s.players.forEach((p,i)=>{p.bet=0;p.total=[10,10,20][i];p.chips=1900});page.dealing=false;page.render();
  assert.deepEqual(Array.from(page.data.sizingOptions,o=>o.target),[20,40,80,120]);page.openSizing();page.selectSizing({currentTarget:{dataset:{index:2}}});assert.equal(page.data.raiseTo,80);page.act({currentTarget:{dataset:{type:'raise'}}});assert.equal(page.s.players[0].bet,80);page.onUnload();
});

test('小程序：摊牌显示牌型并标记恰好五张组成牌',()=>{
  let page;const timers=new Map();let nextTimer=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/poker/poker.js'),'utf8'),{Page:p=>{page=p},require:id=>id.endsWith('/motion')?M:E,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),wx:{}});
  page.setData=patch=>Object.assign(page.data,patch);page.onLoad();
  const c=(r,s=0)=>s*13+r-2;page.s.hand=1;page.s.dealer=0;page.s.board=[c(13,3),c(12,2),c(9,0),c(7,0),c(2,2)];page.s.players[0].hole=[c(14,0),c(14,1)];page.s.players[1].hole=[c(3,1),c(4,1)];page.s.players[0].total=60;page.s.players[1].total=60;page.s.awards=[120,0,0,0,0,0,0];page.s.winners=[0];
  page.lastHand=1;page.boardCount=5;page.totalsHand=1;page.totalsSeen=[60,60,0,0,0,0,0];page.loop();
  assert.equal(page.data.winningHands[0].name,'一对');assert.equal(Array.from(page.data.handHighlights).filter(Boolean).length,2);assert.equal(Array.from(page.data.boardHighlights).filter(Boolean).length,3);assert.equal(page.data.players[1].revealedCards.filter(c=>c.highlight).length,0);page.onUnload();
});
