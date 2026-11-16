'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../miniprogram/sudoku/engine');
const { SudokuSession, KEY } = require('../miniprogram/sudoku/session');
const { createRng } = require('../miniprogram/utils/random');
function memory() { const map = new Map(); return { get: (k) => map.has(k) ? JSON.parse(map.get(k)) : null, set: (k, v) => map.set(k, JSON.stringify(v)) }; }

test('数独：三档随机题目均合法、唯一解且题目数字匹配答案', () => {
  const puzzles = new Set();
  for (const difficulty of Object.keys(E.DIFFICULTIES)) for (let seed = 1; seed <= 25; seed++) {
    const s = E.createGame(difficulty, createRng(seed).next);
    assert.ok(E.complete(s.solution)); assert.equal(E.countSolutions(s.givens), 1);
    assert.ok(s.givens.every((n, i) => !n || n === s.solution[i]));
    const clues = s.givens.filter(Boolean).length;
    assert.ok(clues >= E.DIFFICULTIES[difficulty].clues && clues <= E.DIFFICULTIES[difficulty].clues + 5);
    puzzles.add(s.givens.join(''));
  }
  assert.equal(puzzles.size, 75);
});
test('数独：给定数字不可更改，行列宫重复标红，填满错误答案不会获胜', () => {
  const s = E.createGame('easy', createRng(9).next), given = s.givens.findIndex(Boolean), empty = s.givens.findIndex((n) => !n);
  assert.equal(E.enter(s, given, 0), false); assert.equal(E.enter(s, -1, 1), false); assert.equal(E.enter(s, empty, 10), false);
  const peer = s.givens.findIndex((n, i) => n && E.peers(empty, i));
  assert.ok(E.enter(s, empty, s.givens[peer])); assert.ok(E.conflicts(s.board)[empty]); assert.ok(E.conflicts(s.board)[peer]);
  for (let i = 0; i < 81; i++) if (!s.board[i]) E.enter(s, i, 1);
  assert.equal(s.status, 'playing');
  for (let i = 0; i < 81; i++) if (!s.givens[i]) E.enter(s, i, s.solution[i]);
  assert.equal(s.status, 'won'); assert.equal(E.enter(s, empty, 0), false);
});
test('数独：候选笔记、自动清理、撤销、提示与独立存档恢复', () => {
  const store = memory(), session = new SudokuSession(store, createRng(14).next), s = session.state;
  const i = s.givens.findIndex((n) => !n), j = s.givens.findIndex((n, k) => !n && E.peers(i, k)), value = s.solution[i];
  assert.ok(session.move(j, value, true)); assert.equal(s.board[j], 0);
  assert.ok(s.notes[j] & (1 << (value - 1)));
  session.move(i, value); assert.equal(s.notes[j] & (1 << (value - 1)), 0);
  session.undo(); assert.equal(s.board[i], 0); assert.ok(s.notes[j] & (1 << (value - 1)));
  assert.equal(session.hint(i), i); assert.equal(s.board[i], value); assert.equal(s.hints, 1);
  session.addTime(2345); session.save();
  const restored = new SudokuSession(store); assert.deepEqual(restored.state, session.state); assert.equal(restored.history.length, 0);
  store.set('match3:progress:v1', { unchanged: true }); session.restart('hard');
  assert.deepEqual(store.get('match3:progress:v1'), { unchanged: true });
  assert.equal(store.get(KEY).current.difficulty, 'hard'); assert.equal(session.state.elapsedMs, 0);
});
test('数独：损坏、多解及篡改题目存档被拒绝，错误作答可以恢复', () => {
  const original = E.createGame('easy', createRng(5).next);
  for (const patch of [{ givens: Array(81).fill(0) }, { elapsedMs: -1 }, { notes: [] }, { solution: [] }, { difficulty: 'unknown' }]) assert.equal(E.restore({ ...original, ...patch }), null);
  const changed = structuredClone(original), given = changed.givens.findIndex(Boolean); changed.board[given] = 0; assert.equal(E.restore(changed), null);
  const wrong = structuredClone(original), i = wrong.givens.findIndex((n) => !n); wrong.board[i] = wrong.solution[i] % 9 + 1; assert.ok(E.restore(wrong));
  const store = memory(); store.set(KEY, { version: 1, current: null }); assert.equal(new SudokuSession(store).state.status, 'playing');
  assert.equal(E.timeLabel(125000), '2:05');
});
test('数独：最后一次提示获胜后停表，存储不可用时仍可玩', () => {
  const session = new SudokuSession({ get() { throw Error('disabled'); }, set() { throw Error('full'); } }, createRng(4).next);
  const s = session.state, i = s.givens.findIndex((n) => !n); s.board = s.solution.slice(); s.board[i] = 0;
  session.addTime(1200); session.hint(i); session.addTime(8000);
  assert.equal(s.status, 'won'); assert.equal(s.elapsedMs, 1200); assert.equal(session.hint(i), -1);
});
