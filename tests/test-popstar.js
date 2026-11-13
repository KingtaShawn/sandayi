'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../miniprogram/popstar/engine');
const { PopstarSession, KEY } = require('../miniprogram/popstar/session');
const M = require('../miniprogram/match3/engine');
function rng(seed) { return () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }; }
function store() { const data = new Map(); return { data, get: (key) => data.get(key), set: (key,v) => data.set(key,JSON.parse(JSON.stringify(v))) }; }
test('消消乐下落路径：幸存水果来自原格，新水果从上方进入', () => {
  const sources = M.fallSources([16,32]);
  assert.deepEqual(Array.from({length:8},(_,r)=>sources[r*8]),[-16,-8,0,8,24,40,48,56]);
  assert.equal(sources[1],1);
  const before = M.createBoard(rng(2)), after = M.collapse(before,[16,32],rng(3));
  sources.forEach((from,to)=>{if(from>=0) assert.equal(after[to],before[from]);});
});
test('消灭星星：只连横竖、不能跨行或斜连、单颗不能消', () => {
  const board = Array(100).fill(null); [9,10,20,21,32].forEach(i=>board[i]=2);
  assert.deepEqual(E.group(board,9),[9]); assert.equal(E.group(board,10).length,3);
  assert.equal(E.group(board,32).length,1); assert.deepEqual(E.group(board,-1),[]);
  assert.equal(E.remove({...E.createGame(),board},9).accepted,false);
});
test('消灭星星：消除后下落、空列左移、不补块，动画来源与颜色对应', () => {
  const board = Array(100).fill(null); board[80]=0;board[90]=0;board[81]=1;board[91]=2;board[92]=3;
  const packed = E.compact(board,[80,90]);
  assert.equal(packed.board[80],1);assert.equal(packed.board[90],2);assert.equal(packed.board[91],3);
  assert.equal(packed.board.filter(v=>v!==null).length,3);
  assert.equal(packed.sources[80],81);assert.equal(packed.sources[91],92);
  packed.sources.forEach((from,to)=>{if(from!==null)assert.equal(packed.board[to],board[from]);});
  assert.equal(board[80],0);
});
test('消灭星星：平方计分、终局奖励只发一次、最后一次消除才判胜负', () => {
  const state = E.createGame(1,0,()=>0);
  const result = E.remove(state,0);
  assert.equal(result.gained,50000);assert.equal(result.state.bonus,2000);assert.equal(result.state.score,52000);
  assert.equal(result.state.status,'won');assert.equal(E.remove(result.state,0).accepted,false);
  assert.deepEqual(E.restore(result.state),result.state);
  const board=Array(100).fill(null);board[90]=0;board[91]=0;board[92]=1;
  const ending=E.remove({...state,board,level:2},90);
  assert.equal(ending.state.score,20+1980);assert.equal(ending.state.status,'lost');
  const early={...state,score:5000};assert.equal(early.status,'playing');
});
test('消灭星星：续关带分、重玩回到入关分数、存档与其他游戏隔离', () => {
  const storage=store();storage.data.set('match3:progress:v1',{keep:true});
  const session=new PopstarSession(storage,()=>0);session.move(0);
  const restored=new PopstarSession(storage,()=>0);assert.equal(restored.state.score,52000);
  assert.equal(restored.next(),true);assert.equal(restored.state.startScore,52000);
  restored.move(0);restored.restart();assert.equal(restored.state.score,52000);assert.equal(restored.state.level,2);
  assert.deepEqual(storage.data.get('match3:progress:v1'),{keep:true});assert.ok(storage.data.has(KEY));
});
test('消灭星星：坏档拒绝、存储不可用可玩，提示选最大组', () => {
  for(const v of [null,{}, {...E.createGame(),score:-1},{...E.createGame(),board:[1]}])assert.equal(E.restore(v),null);
  const floating=E.createGame();floating.board[90]=null;assert.equal(E.restore(floating),null);
  const session=new PopstarSession({get(){throw Error();},set(){throw Error();}},()=>0);assert.ok(session.move(0).accepted);
  const board=Array(100).fill(null);board[90]=board[91]=0;board[92]=board[93]=board[94]=1;
  assert.equal(E.hint(board).length,3);
});
test('消灭星星：200 局完整模拟，数量递减、计分准确、无悬空、不重复奖励', () => {
  for(let seed=1;seed<=200;seed++) {
    let state=E.createGame(1,0,rng(seed));
    while(state.status==='playing') {
      const group=E.hint(state.board);assert.ok(group.length>=2);
      const count=state.board.filter(v=>v!==null).length;
      const result=E.remove(state,group[0]);assert.equal(result.remaining,count-group.length);
      assert.equal(result.state.score-state.score,result.gained+result.state.bonus);
      assert.deepEqual(E.compact(result.state.board,[]).board,result.state.board);
      assert.deepEqual(E.restore(result.state),result.state);state=result.state;
    }
    assert.equal(E.hint(state.board).length,0);
  }
});
