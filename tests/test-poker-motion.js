'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../miniprogram/poker/motion');
test('viewport points map to table coordinates in both orientations',()=>{
  const identity={a:1,b:0,c:0,d:1}, rotated={a:0,b:1,c:-1,d:0};
  assert.deepEqual(M.toLocal({x:170,y:90},{left:50,top:30},400,200,identity),{x:120,y:60});
  // A 400×200 local table rotated 90° has client bounds 200×400.
  assert.deepEqual(M.toLocal({x:190,y:150},{left:50,top:30},400,200,rotated),{x:120,y:60});
  assert.deepEqual(M.between({x:100,y:50},{x:260,y:140}),{x:160,y:90});
});
test('deal duration covers every card, including nine-handed play',()=>{
  assert.equal(M.DEAL_STEP,460);
  assert.ok(M.dealDuration(14) > 13 * M.DEAL_STEP + 420);
  assert.ok(M.dealDuration(18) > 17 * M.DEAL_STEP + 420);
  assert.ok(M.dealDuration(3) > 2 * M.DEAL_STEP + 420);
});
test('each street burns a card before the board, including an all-in runout',()=>{
  const flop=M.boardDealPlan(0,3);
  assert.deepEqual(flop.burns,[{index:0,delay:0}]);assert.deepEqual(flop.cards,[460,920,1380]);assert.equal(flop.steps,4);
  assert.deepEqual(M.boardDealPlan(3,4).burns,[{index:1,delay:0}]);
  assert.deepEqual(M.boardDealPlan(4,5).burns,[{index:2,delay:0}]);
  const runout=M.boardDealPlan(0,5,14);
  assert.deepEqual(runout.burns.map(b=>b.delay),[6440,8280,9200]);
  assert.deepEqual(runout.cards,[6900,7360,7820,8740,9660]);assert.equal(runout.steps,22);
});
test('dealing begins left of button, or with the button heads-up, skipping empty seats',()=>{
  const players=Array.from({length:7},()=>({hole:[1,2]}));
  assert.deepEqual(M.dealOrder(players,4),[5,6,0,1,2,3,4]);
  players[5].hole=[];players[1].hole=[];
  assert.deepEqual(M.dealOrder(players,4),[6,0,2,3,4]);
  players.forEach(p=>p.hole=[]);players[0].hole=[1,2];players[4].hole=[3,4];
  assert.deepEqual(M.dealOrder(players,4),[4,0]);
});

test('CSS rotation matrices work without a browser-specific DOMMatrix API',()=>{
  assert.deepEqual(M.matrixFromCss('none'),{a:1,b:0,c:0,d:1});
  assert.deepEqual(M.matrixFromCss('matrix(0, 1, -1, 0, 0, 0)'),{a:0,b:1,c:-1,d:0});
  assert.deepEqual(M.matrixFromCss('matrix3d(0,1,0,0,-1,0,0,0,0,0,1,0,0,0,0,1)'),{a:0,b:1,c:-1,d:0});
  assert.equal(M.matrixFromCss('rotate(90deg)'),null);
  assert.equal(M.toLocal({x:0,y:0},{left:0,top:0},10,10,{a:0,b:0,c:0,d:0}),null);
});
