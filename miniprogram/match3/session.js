'use strict';

const Engine = require('./engine');
const KEY = 'match3:progress:v1';

class Match3Session {
  constructor(storage, rng = Math.random) {
    this.storage = storage;
    this.rng = rng;
    let saved;
    try { saved = storage.get(KEY); } catch (e) { /* Offline storage is optional. */ }
    saved = saved && saved.version === 1 ? saved : {};
    this.best = {};
    for (const config of Engine.LEVELS) {
      const score = saved.best && saved.best[config.level];
      if (Number.isSafeInteger(score) && score >= 0) this.best[config.level] = score;
    }
    this.highest = 1;
    while (this.highest < Engine.LEVELS.length && this.best[this.highest] >= Engine.LEVELS[this.highest - 1].target) this.highest++;
    const restored = Engine.restoreGame(saved.current, rng);
    this.state = restored && restored.level <= this.highest ? restored : Engine.createGame(this.highest, rng);
    this.save();
  }

  save() {
    this.best[this.state.level] = Math.max(this.best[this.state.level] || 0, this.state.score);
    if (this.state.status === 'won') this.highest = Math.max(this.highest, Math.min(Engine.LEVELS.length, this.state.level + 1));
    try { this.storage.set(KEY, { version: 1, current: this.state, best: this.best }); } catch (e) { /* Keep playing if quota is exhausted. */ }
  }

  move(a, b) {
    const result = Engine.trySwap(this.state, a, b, this.rng);
    if (result.accepted) { this.state = result.state; this.save(); }
    return result;
  }

  restart() { this.state = Engine.createGame(this.state.level, this.rng); this.save(); }

  next() {
    if (this.state.status !== 'won' || this.state.level >= Engine.LEVELS.length) return false;
    this.state = Engine.createGame(this.state.level + 1, this.rng);
    this.save();
    return true;
  }
}

module.exports = { Match3Session, KEY };
