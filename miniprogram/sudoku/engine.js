'use strict';

const DIFFICULTIES = { easy: { name: '简单', clues: 42 }, medium: { name: '中等', clues: 34 }, hard: { name: '困难', clues: 28 } };
const box = (i) => Math.floor(i / 27) * 3 + Math.floor(i % 9 / 3);
const peers = (a, b) => a !== b && (Math.floor(a / 9) === Math.floor(b / 9) || a % 9 === b % 9 || box(a) === box(b));
const validBoard = (board) => Array.isArray(board) && board.length === 81 && board.every((n) => Number.isInteger(n) && n >= 0 && n <= 9);
function conflicts(board) {
  return board.map((n, i) => !!n && board.some((v, j) => v === n && peers(i, j)));
}
function complete(board) { return validBoard(board) && board.every(Boolean) && !conflicts(board).some(Boolean); }

// MRV search stops after two solutions: removing a clue must preserve a unique answer.
function countSolutions(input, limit = 2) {
  if (!validBoard(input) || conflicts(input).some(Boolean)) return 0;
  const board = input.slice(); let count = 0;
  function visit() {
    let chosen = -1, options;
    for (let i = 0; i < 81; i++) {
      if (board[i]) continue;
      const used = new Set();
      for (let j = 0; j < 81; j++) if (peers(i, j) && board[j]) used.add(board[j]);
      const available = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => !used.has(n));
      if (!available.length) return;
      if (!options || available.length < options.length) { chosen = i; options = available; }
      if (available.length === 1) break;
    }
    if (chosen < 0) { count++; return; }
    for (const n of options) {
      board[chosen] = n; visit(); board[chosen] = 0;
      if (count >= limit) return;
    }
  }
  visit(); return count;
}
function shuffle(values, rng) {
  const a = values.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function createGame(difficulty = 'easy', rng = Math.random) {
  if (!Object.prototype.hasOwnProperty.call(DIFFICULTIES, difficulty)) difficulty = 'easy';
  const order = () => shuffle([0, 1, 2], rng).flatMap((band) => shuffle([0, 1, 2], rng).map((row) => band * 3 + row));
  const rows = order(), cols = order(), digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
  const solution = rows.flatMap((r) => cols.map((c) => digits[(r * 3 + Math.floor(r / 3) + c) % 9]));
  const givens = solution.slice(); let clues = 81;
  for (const i of shuffle(Array.from({ length: 81 }, (_, n) => n), rng)) {
    if (clues <= DIFFICULTIES[difficulty].clues) break;
    const n = givens[i]; givens[i] = 0;
    if (countSolutions(givens) === 1) clues--; else givens[i] = n;
  }
  return { difficulty, givens, solution, board: givens.slice(), notes: Array(81).fill(0), elapsedMs: 0, hints: 0, status: 'playing' };
}
function enter(state, index, value, pencil = false) {
  if (state.status !== 'playing' || !Number.isInteger(index) || index < 0 || index >= 81 || state.givens[index] || !Number.isInteger(value) || value < 0 || value > 9) return false;
  if (pencil && value) {
    if (state.board[index]) return false;
    state.notes[index] ^= 1 << (value - 1);
  } else {
    if (state.board[index] === value && !state.notes[index]) return false;
    state.board[index] = value; state.notes[index] = 0;
    if (value) state.notes.forEach((mask, i) => { if (peers(index, i)) state.notes[i] = mask & ~(1 << (value - 1)); });
  }
  state.status = complete(state.board) ? 'won' : 'playing'; return true;
}
function hintIndex(state, selected) {
  if (state.status !== 'playing') return -1;
  if (Number.isInteger(selected) && selected >= 0 && selected < 81 && state.board[selected] !== state.solution[selected]) return selected;
  return state.board.findIndex((n, i) => n !== state.solution[i]);
}
function restore(s) {
  if (!s || !Object.prototype.hasOwnProperty.call(DIFFICULTIES, s.difficulty) || !validBoard(s.givens) || !validBoard(s.board) || !complete(s.solution)) return null;
  if (s.givens.some((n, i) => n && (n !== s.solution[i] || n !== s.board[i])) || countSolutions(s.givens) !== 1) return null;
  if (!Array.isArray(s.notes) || s.notes.length !== 81 || s.notes.some((n) => !Number.isInteger(n) || n < 0 || n > 511)) return null;
  if (!Number.isSafeInteger(s.elapsedMs) || s.elapsedMs < 0 || !Number.isSafeInteger(s.hints) || s.hints < 0) return null;
  return { difficulty: s.difficulty, givens: s.givens.slice(), solution: s.solution.slice(), board: s.board.slice(), notes: s.notes.map((n, i) => s.board[i] ? 0 : n), elapsedMs: s.elapsedMs, hints: s.hints, status: complete(s.board) ? 'won' : 'playing' };
}
function timeLabel(ms) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function cells(state, selected) {
  const errors = conflicts(state.board);
  return state.board.map((value, i) => ({
    id: i, value: value || '', given: !!state.givens[i], selected: i === selected,
    related: selected >= 0 && peers(i, selected), same: !!value && value === state.board[selected], conflict: errors[i],
    right: i % 9 === 2 || i % 9 === 5, bottom: Math.floor(i / 9) === 2 || Math.floor(i / 9) === 5,
    notes: Array.from({ length: 9 }, (_, n) => state.notes[i] & (1 << n) ? n + 1 : '')
  }));
}
module.exports = { DIFFICULTIES, peers, conflicts, complete, countSolutions, createGame, enter, hintIndex, restore, timeLabel, cells };
