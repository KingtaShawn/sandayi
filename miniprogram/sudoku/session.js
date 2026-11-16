'use strict';
const E = require('./engine');
const KEY = 'sudoku:progress:v1';
class SudokuSession {
  constructor(storage, rng = Math.random) {
    this.storage = storage; this.rng = rng; this.history = [];
    let saved; try { saved = storage.get(KEY); } catch (e) { /* persistence is optional */ }
    this.state = (saved && saved.version === 1 && E.restore(saved.current)) || E.createGame('easy', rng);
  }
  save() { try { this.storage.set(KEY, { version: 1, current: this.state }); } catch (e) { /* keep playing */ } }
  move(index, value, pencil = false) {
    const before = { board: this.state.board.slice(), notes: this.state.notes.slice() };
    if (!E.enter(this.state, index, value, pencil)) return false;
    this.history.push(before); if (this.history.length > 100) this.history.shift();
    this.save(); return true;
  }
  undo() {
    if (!this.history.length || this.state.status !== 'playing') return false;
    const last = this.history.pop(); this.state.board = last.board; this.state.notes = last.notes;
    this.save(); return true;
  }
  hint(selected) {
    const index = E.hintIndex(this.state, selected);
    if (index < 0) return -1;
    this.state.hints++; this.move(index, this.state.solution[index]); return index;
  }
  addTime(ms) { if (this.state.status === 'playing' && Number.isFinite(ms) && ms > 0) this.state.elapsedMs += Math.round(ms); }
  restart(difficulty = this.state.difficulty) { this.state = E.createGame(difficulty, this.rng); this.history = []; this.save(); }
}
module.exports = { SudokuSession, KEY };
