'use strict';

const SIZE = 8;
const TYPES = 6;
const FRUITS = ['🍎', '🍊', '🍋', '🍇', '🫐', '🥝'];
const NAMES = ['苹果', '橙子', '柠檬', '葡萄', '蓝莓', '猕猴桃'];
const LEVELS = Array.from({ length: 12 }, (_, i) => Object.freeze({
  level: i + 1, target: 900 + i * 250, moves: 30 - Math.floor(i / 3) * 2
}));

function adjacent(a, b) {
  return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0
    && a < SIZE * SIZE && b < SIZE * SIZE
    && Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) + Math.abs(a % SIZE - b % SIZE) === 1;
}

function findMatches(board) {
  const matched = new Set();
  for (let axis = 0; axis < 2; axis++) {
    for (let line = 0; line < SIZE; line++) {
      const at = (p) => axis === 0 ? line * SIZE + p : p * SIZE + line;
      let start = 0;
      while (start < SIZE) {
        let end = start + 1;
        const fruit = board[at(start)];
        while (end < SIZE && board[at(end)] === fruit) end++;
        if (fruit !== null && fruit !== undefined && end - start >= 3) {
          for (let p = start; p < end; p++) matched.add(at(p));
        }
        start = end;
      }
    }
  }
  return Array.from(matched).sort((a, b) => a - b);
}

function swapped(board, a, b) {
  const next = board.slice();
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

function findMove(board) {
  for (let a = 0; a < board.length; a++) {
    for (const b of [a + 1, a + SIZE]) {
      if (!adjacent(a, b) || board[a] === board[b]) continue;
      const hits = findMatches(swapped(board, a, b));
      if (hits.includes(a) || hits.includes(b)) return [a, b];
    }
  }
  return null;
}

function pick(n, rng) {
  const value = rng();
  return Number.isFinite(value) ? Math.min(n - 1, Math.max(0, Math.floor(value * n))) : 0;
}

function createBoard(rng = Math.random) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const board = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const options = [];
      for (let fruit = 0; fruit < TYPES; fruit++) {
        if (i % SIZE >= 2 && board[i - 1] === fruit && board[i - 2] === fruit) continue;
        if (i >= SIZE * 2 && board[i - SIZE] === fruit && board[i - SIZE * 2] === fruit) continue;
        options.push(fruit);
      }
      board.push(options[pick(options.length, rng)]);
    }
    if (findMove(board)) return board;
  }
  // Bounded fallback also works with a constant/broken random source.
  const board = Array.from({ length: SIZE * SIZE }, (_, i) => (Math.floor(i / SIZE) * 2 + i % SIZE) % TYPES);
  board[0] = 0; board[1] = 1; board[2] = 0; board[9] = 0;
  return board;
}

function shuffleBoard(board, rng = Math.random) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const next = board.slice();
    for (let i = next.length - 1; i > 0; i--) {
      const j = pick(i + 1, rng);
      [next[i], next[j]] = [next[j], next[i]];
    }
    if (!findMatches(next).length && findMove(next)) return next;
  }
  return createBoard(rng);
}

function collapse(board, matched, rng = Math.random) {
  const next = board.slice();
  const removed = new Set(matched);
  for (let col = 0; col < SIZE; col++) {
    let write = SIZE - 1;
    for (let row = SIZE - 1; row >= 0; row--) {
      const i = row * SIZE + col;
      if (!removed.has(i)) next[write-- * SIZE + col] = board[i];
    }
    while (write >= 0) next[write-- * SIZE + col] = pick(TYPES, rng);
  }
  return next;
}

function createGame(level = 1, rng = Math.random) {
  const config = LEVELS[level - 1];
  if (!config) throw new RangeError('未知关卡');
  return { level, board: createBoard(rng), score: 0, moves: config.moves, status: 'playing' };
}

function trySwap(state, a, b, rng = Math.random) {
  if (state.status !== 'playing' || !adjacent(a, b)) return { accepted: false, state, frames: [] };
  let board = swapped(state.board, a, b);
  let matched = findMatches(board);
  if (!matched.includes(a) && !matched.includes(b)) return { accepted: false, state, frames: [] };
  let score = state.score;
  const frames = [];
  while (matched.length && frames.length < 40) {
    const combo = frames.length + 1;
    const gained = matched.length * 10 * Math.min(combo, 5);
    score += gained;
    const after = collapse(board, matched, rng);
    frames.push({ board, matched, after, gained, combo, score });
    board = after;
    matched = findMatches(board);
  }
  const reshuffled = matched.length > 0 || !findMove(board);
  if (reshuffled) board = matched.length ? createBoard(rng) : shuffleBoard(board, rng);
  const moves = state.moves - 1;
  const status = score >= LEVELS[state.level - 1].target ? 'won' : moves === 0 ? 'lost' : 'playing';
  return { accepted: true, frames, reshuffled, state: { level: state.level, board, score, moves, status } };
}

function restoreGame(value, rng = Math.random) {
  if (!value || !Number.isInteger(value.level) || !LEVELS[value.level - 1]
    || !Array.isArray(value.board) || value.board.length !== SIZE * SIZE
    || !value.board.every((v) => Number.isInteger(v) && v >= 0 && v < TYPES)
    || !Number.isSafeInteger(value.score) || value.score < 0
    || !Number.isInteger(value.moves) || value.moves < 0 || value.moves > LEVELS[value.level - 1].moves
    || findMatches(value.board).length) return null;
  const state = { level: value.level, board: value.board.slice(), score: value.score, moves: value.moves };
  state.status = state.score >= LEVELS[state.level - 1].target ? 'won' : state.moves === 0 ? 'lost' : 'playing';
  if (state.status === 'playing' && !findMove(state.board)) state.board = shuffleBoard(state.board, rng);
  return state;
}

module.exports = { SIZE, TYPES, FRUITS, NAMES, LEVELS, adjacent, findMatches, findMove, createBoard, shuffleBoard, collapse, createGame, trySwap, restoreGame };
