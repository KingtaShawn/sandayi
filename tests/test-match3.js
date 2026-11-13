'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../miniprogram/match3/engine');
const { Match3Session, KEY } = require('../miniprogram/match3/session');

function rng(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function memory(value) {
  const data = new Map(value === undefined ? [] : [[KEY, value]]);
  return { data, get: (key) => data.get(key), set: (key, v) => data.set(key, JSON.parse(JSON.stringify(v))) };
}
function stable(board) {
  assert.equal(board.length, 64);
  assert.ok(board.every((fruit) => Number.isInteger(fruit) && fruit >= 0 && fruit < 6));
  assert.deepEqual(E.findMatches(board), []);
  assert.ok(E.findMove(board));
}

test('消消乐：横向长连、纵向三连、交叉去重，斜线不消除', () => {
  const board = Array(64).fill(null);
  [16, 17, 18, 19, 20, 2, 10].forEach((i) => { board[i] = 1; });
  assert.deepEqual(E.findMatches(board), [2, 10, 16, 17, 18, 19, 20]);
  const diagonal = Array(64).fill(null);
  [0, 9, 18].forEach((i) => { diagonal[i] = 2; });
  assert.deepEqual(E.findMatches(diagonal), []);
});

test('消消乐：交换仅允许相邻有效索引，不允许行尾跨行或斜向', () => {
  assert.ok(E.adjacent(0, 1)); assert.ok(E.adjacent(0, 8));
  for (const pair of [[7, 8], [0, 9], [0, 0], [-1, 0], [63, 64], [0.5, 1.5], ['0', 1]]) assert.equal(E.adjacent(...pair), false);
});

test('消消乐：1000 个种子及常量随机源均生成无消除、可交换的初盘', () => {
  for (let seed = 1; seed <= 1000; seed++) stable(E.createBoard(rng(seed)));
  for (const value of [0, 0.5, 1, NaN]) stable(E.createBoard(() => value));
});

test('消消乐：无效交换不扣步数、不改变盘面，也不消耗随机数', () => {
  const state = E.createGame(1, rng(33));
  const original = JSON.stringify(state);
  let pair;
  for (let a = 0; a < 63 && !pair; a++) {
    if (!E.adjacent(a, a + 1)) continue;
    const copy = state.board.slice(); [copy[a], copy[a + 1]] = [copy[a + 1], copy[a]];
    if (!E.findMatches(copy).length) pair = [a, a + 1];
  }
  assert.ok(pair);
  const result = E.trySwap(state, ...pair, () => { throw new Error('不应补充水果'); });
  assert.equal(result.accepted, false);
  assert.equal(JSON.stringify(state), original);
  assert.equal(result.state, state);
});

test('消消乐：重力保留同列剩余水果顺序，补齐顶部且不改输入', () => {
  const board = Array.from({ length: 64 }, (_, i) => i);
  const after = E.collapse(board, [16, 32], () => 0.5);
  assert.deepEqual(Array.from({ length: 8 }, (_, row) => after[row * 8]), [3, 3, 0, 8, 24, 40, 48, 56]);
  assert.equal(after[1], 1); assert.equal(board[16], 16);
});

test('消消乐：完整连锁只扣一步，交叉和倍率计分准确，原状态不可变', () => {
  let cascadeFound = false;
  for (let seed = 1; seed < 100; seed++) {
    const random = rng(seed);
    const state = E.createGame(1, random);
    const original = JSON.stringify(state);
    const result = E.trySwap(state, ...E.findMove(state.board), random);
    assert.ok(result.accepted);
    assert.equal(result.state.moves, 29);
    assert.equal(JSON.stringify(state), original);
    let points = 0;
    result.frames.forEach((frame, i) => {
      assert.equal(new Set(frame.matched).size, frame.matched.length);
      assert.deepEqual(frame.matched, E.findMatches(frame.board));
      points += frame.matched.length * 10 * Math.min(i + 1, 5);
      assert.equal(frame.score, points);
    });
    assert.equal(result.state.score, points);
    stable(result.state.board);
    cascadeFound ||= result.frames.length > 1;
  }
  assert.ok(cascadeFound, '覆盖实际连续消除');
});

test('消消乐：最后一步先结算再判胜负，终局不接受后续交换', () => {
  const initial = E.createGame(1, rng(20));
  initial.moves = 1; initial.score = 899;
  const won = E.trySwap(initial, ...E.findMove(initial.board), rng(99)).state;
  assert.equal(won.moves, 0); assert.equal(won.status, 'won');
  const hard = { ...initial, level: 12, score: 0 };
  const lost = E.trySwap(hard, ...E.findMove(hard.board), rng(99)).state;
  assert.equal(lost.moves, 0); assert.equal(lost.status, 'lost');
  assert.equal(E.trySwap(won, 0, 1).accepted, false);
  assert.equal(E.trySwap(lost, 0, 1).accepted, false);
});

test('消消乐：死盘洗牌恢复且常量随机源不会导致无限循环', () => {
  const dead = Array.from({ length: 64 }, (_, i) => (Math.floor(i / 8) * 2 + i % 8) % 6);
  assert.equal(E.findMove(dead), null);
  stable(E.shuffleBoard(dead, rng(92)));
  stable(E.shuffleBoard(dead, () => 0));
  const state = E.createGame(1, rng(3));
  const result = E.trySwap(state, ...E.findMove(state.board), () => 0);
  assert.ok(result.frames.length <= 40);
  stable(result.state.board);
});

test('消消乐：恢复死盘不改变分数步数，坏存档被拒绝', () => {
  const game = E.createGame(1, rng(12));
  for (const value of [null, {}, { ...game, level: 13 }, { ...game, moves: -1 }, { ...game, score: Infinity }, { ...game, board: [1, 2] }, { ...game, board: Array(64).fill(0) }, { ...game, board: Array(64).fill(8) }]) assert.equal(E.restoreGame(value), null);
  game.board = Array.from({ length: 64 }, (_, i) => (Math.floor(i / 8) * 2 + i % 8) % 6);
  const restored = E.restoreGame(game, rng(9));
  stable(restored.board); assert.equal(restored.score, 0); assert.equal(restored.moves, 30);
});

test('消消乐：每步持久化、刷新恢复、重玩保留最佳，不能未通关跳关', () => {
  const storage = memory();
  storage.data.set('tractor:stats', 'existing-card-stats');
  const session = new Match3Session(storage, rng(41));
  const result = session.move(...E.findMove(session.state.board));
  assert.ok(result.accepted);
  const restored = new Match3Session(storage, rng(42));
  assert.deepEqual(restored.state, session.state);
  assert.equal(restored.next(), false);
  const best = restored.best[1];
  restored.restart();
  assert.equal(restored.state.moves, 30); assert.equal(restored.state.score, 0); assert.equal(restored.best[1], best);
  assert.equal(storage.data.get('tractor:stats'), 'existing-card-stats');
});

test('消消乐：胜利解锁下一关，最终关无越界，坏存储不妨碍游戏', () => {
  const storage = memory();
  const session = new Match3Session(storage, rng(17));
  session.state.score = 900; session.state.status = 'won'; session.save();
  assert.equal(session.highest, 2); assert.ok(session.next()); assert.equal(session.state.level, 2);
  const restored = new Match3Session(storage, rng(18));
  assert.equal(restored.state.level, 2);
  restored.state = E.createGame(12); restored.state.status = 'won';
  assert.equal(restored.next(), false);
  for (const value of [{ version: 999 }, { version: 1, current: { nonsense: true }, best: { 1: -10, 2: '900' } }]) stable(new Match3Session(memory(value)).state.board);
  const broken = new Match3Session({ get() { throw new Error('blocked'); }, set() { throw new Error('full'); } }, rng(1));
  assert.ok(broken.move(...E.findMove(broken.state.board)).accepted);
});

test('消消乐：12 关各模拟 5 局，所有操作满足步数/分数/稳定棋盘不变量', () => {
  for (let level = 1; level <= 12; level++) {
    for (let run = 1; run <= 5; run++) {
      const random = rng(level * 1000 + run);
      let state = E.createGame(level, random);
      while (state.status === 'playing') {
        const result = E.trySwap(state, ...E.findMove(state.board), random);
        assert.ok(result.accepted);
        assert.equal(result.state.moves, state.moves - 1);
        assert.ok(result.state.score > state.score);
        state = result.state;
        stable(state.board);
      }
      assert.equal(state.status, state.score >= E.LEVELS[level - 1].target ? 'won' : 'lost');
      assert.ok(state.status === 'won' || state.moves === 0);
    }
  }
});
