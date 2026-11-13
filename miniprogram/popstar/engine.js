'use strict';
const SIZE = 10, TYPES = 5;
const NAMES = ['红色', '金色', '绿色', '蓝色', '紫色'];
const target = (level) => 1000 + (level - 1) * 2000;
function group(board, index) {
  if (!Number.isInteger(index) || index < 0 || index >= 100 || board[index] === null) return [];
  const color = board[index], seen = new Set([index]), queue = [index];
  for (let p = 0; p < queue.length; p++) {
    const i = queue[p];
    for (const j of [i - 10, i + 10, ...(i % 10 > 0 ? [i - 1] : []), ...(i % 10 < 9 ? [i + 1] : [])]) {
      if (j >= 0 && j < 100 && board[j] === color && !seen.has(j)) { seen.add(j); queue.push(j); }
    }
  }
  return queue;
}
function hint(board) {
  const visited = new Set(); let best = [];
  for (let i = 0; i < 100; i++) {
    if (board[i] === null || visited.has(i)) continue;
    const found = group(board, i); found.forEach((j) => visited.add(j));
    if (found.length >= 2 && found.length > best.length) best = found;
  }
  return best;
}
function compact(board, removed) {
  const gone = new Set(removed), next = Array(100).fill(null), sources = Array(100).fill(null);
  let writeCol = 0;
  for (let col = 0; col < 10; col++) {
    const survivors = [];
    for (let row = 9; row >= 0; row--) {
      const i = row * 10 + col;
      if (board[i] !== null && !gone.has(i)) survivors.push(i);
    }
    if (!survivors.length) continue;
    survivors.forEach((from, n) => { const to = (9 - n) * 10 + writeCol; next[to] = board[from]; sources[to] = from; });
    writeCol++;
  }
  return { board: next, sources };
}
function createGame(level = 1, score = 0, rng = Math.random) {
  const board = Array.from({ length: 100 }, () => Math.min(4, Math.max(0, Math.floor((rng() || 0) * 5))));
  if (!hint(board).length) board[1] = board[0];
  return { level, score, startScore: score, board, bonus: 0, status: 'playing' };
}
function remove(state, index) {
  const matched = group(state.board, index);
  if (state.status !== 'playing' || matched.length < 2) return { accepted: false, state };
  const packed = compact(state.board, matched);
  const gained = 5 * matched.length * matched.length;
  const remaining = packed.board.filter((v) => v !== null).length;
  const ended = !hint(packed.board).length;
  const bonus = ended ? Math.max(0, 2000 - 20 * remaining * remaining) : 0;
  const score = state.score + gained + bonus;
  return { accepted: true, matched, sources: packed.sources, gained, remaining,
    state: { ...state, board: packed.board, score, bonus, status: ended ? (score >= target(state.level) ? 'won' : 'lost') : 'playing' } };
}
function restore(value) {
  if (!value || !Number.isInteger(value.level) || value.level < 1 || value.level > 1000
    || !Number.isSafeInteger(value.score) || value.score < 0
    || !Number.isSafeInteger(value.startScore) || value.startScore < 0 || value.startScore > value.score
    || !Number.isSafeInteger(value.bonus) || value.bonus < 0 || value.bonus > 2000
    || !Array.isArray(value.board) || value.board.length !== 100
    || !value.board.every((v) => v === null || (Number.isInteger(v) && v >= 0 && v < 5))) return null;
  // Reject floating pieces/empty gaps; saves always contain a compact stable board.
  if (JSON.stringify(compact(value.board, []).board) !== JSON.stringify(value.board)) return null;
  const playing = hint(value.board).length > 0;
  if (playing && value.bonus !== 0) return null;
  return { level: value.level, score: value.score, startScore: value.startScore, bonus: value.bonus,
    board: value.board.slice(), status: playing ? 'playing' : value.score >= target(value.level) ? 'won' : 'lost' };
}
module.exports = { SIZE, TYPES, NAMES, target, group, hint, compact, createGame, remove, restore };
