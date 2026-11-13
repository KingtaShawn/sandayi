'use strict';
const E = require('./engine');
const KEY = 'popstar:progress:v1';
class PopstarSession {
  constructor(storage, rng = Math.random) {
    this.storage = storage; this.rng = rng;
    let saved; try { saved = storage.get(KEY); } catch (e) { /* optional persistence */ }
    saved = saved && saved.version === 1 ? saved : {};
    this.state = E.restore(saved.current) || E.createGame(1, 0, rng);
    this.best = Number.isSafeInteger(saved.best) && saved.best >= 0 ? saved.best : 0;
    this.save();
  }
  save() {
    this.best = Math.max(this.best, this.state.score);
    try { this.storage.set(KEY, { version: 1, current: this.state, best: this.best }); } catch (e) { /* keep playing */ }
  }
  move(index) { const result = E.remove(this.state, index); if (result.accepted) { this.state = result.state; this.save(); } return result; }
  restart() { this.state = E.createGame(this.state.level, this.state.startScore, this.rng); this.save(); }
  next() {
    if (this.state.status !== 'won' || this.state.level >= 1000) return false;
    this.state = E.createGame(this.state.level + 1, this.state.score, this.rng); this.save(); return true;
  }
}
module.exports = { PopstarSession, KEY };
