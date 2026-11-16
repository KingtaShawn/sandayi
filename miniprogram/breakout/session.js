'use strict';
const E = require('./engine');
const KEY = 'breakout:best:v1';
class BreakoutSession {
  constructor(storage) {
    this.storage = storage; this.state = E.createGame();
    let saved; try { saved = storage.get(KEY); } catch (e) { /* optional storage */ }
    this.best = saved && Number.isSafeInteger(saved.best) && saved.best >= 0 ? saved.best : 0;
  }
  save() {
    if (this.state.score <= this.best) return;
    this.best = this.state.score;
    try { this.storage.set(KEY, { version: 1, best: this.best }); } catch (e) { /* keep playing */ }
  }
  step(seconds) { E.step(this.state, seconds); this.save(); }
  action() {
    const s = this.state;
    if (s.status === 'ready') E.launch(s);
    else if (s.status === 'won') { if (!E.next(s)) this.restart(); }
    else if (s.status === 'lost') this.restart();
    else if (s.paused) E.resume(s); else E.pause(s);
  }
  restart() { this.save(); this.state = E.createGame(); }
}
module.exports = { BreakoutSession, KEY };
