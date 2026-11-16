"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  E = require("../miniprogram/poker/engine");
const c = (r, s = 0) => s * 13 + r - 2;
test("wheel, royal flush, full house and kickers", () => {
  assert(
    E.evaluate([c(14), c(2), c(3), c(4), c(5)]) >
      E.evaluate([c(13), c(13, 1), c(13, 2), c(2), c(3, 1)]),
  );
  assert(
    E.evaluate([c(10), c(11), c(12), c(13), c(14)]) >
      E.evaluate([c(14), c(14, 1), c(14, 2), c(14, 3), c(13)]),
  );
  assert(
    E.evaluate([c(10), c(10, 1), c(10, 2), c(2), c(2, 1)]) >
      E.evaluate([c(14), c(11), c(8), c(6), c(2)]),
  );
});
test("random legal hands conserve chips and finish including all-ins", () => {
  let seed = 7;
  const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let n = 2; n <= 8; n++) {
    const s = E.create(n);
    for (let h = 0; h < 100; h++) {
      s.players.forEach((p) => (p.chips = 2000));
      E.start(s, rng);
      let steps = 0;
      while (!s.done) {
        assert(++steps < 300);
        const l = E.legal(s),
          v = rng();
        if (l.raise && v < 0.2) E.action(s, "raise", l.max);
        else if (l.raise && v < 0.4)
          E.action(s, "raise", Math.min(l.min, l.max));
        else E.action(s, v < 0.55 ? "fold" : "call");
        assert(s.players.every((p) => p.chips >= 0));
        assert.equal(
          s.players.reduce((v, p) => v + p.chips + (s.done ? 0 : p.total), 0),
          2000 * (n + 1),
        );
      }
      assert.equal(
        s.players.reduce((v, p) => v + p.chips, 0),
        2000 * (n + 1),
      );
    }
  }
});
test("side pots awarded only to eligible hands, unmatched chips returned", () => {
  const s = E.create(2);
  s.players.forEach((p, i) => (p.chips = [50, 100, 200][i]));
  E.start(s, () => 0.3);
  while (!s.done) {
    const l = E.legal(s);
    E.action(s, l.raise ? "raise" : "call", l.max);
  }
  assert.equal(
    s.players.reduce((a, p) => a + p.chips, 0),
    350,
  );
  assert.equal(
    s.awards.reduce((a, v) => a + v, 0),
    s.players.reduce((a, p) => a + p.total, 0),
  );
});
test("bot observations exclude opponents cards and future deck; decisions legal", () => {
  const s = E.create();
  E.start(s);
  for (let k = 0; k < 30 && !s.done; k++) {
    const o = E.observation(s, s.turn);
    assert(!("deck" in o));
    assert(o.players.every((p) => !("hole" in p)));
    const m = E.decide(o, Math.random, 8);
    E.action(s, m.type, m.target);
  }
});
test("invalid raise rejected without mutation", () => {
  const s = E.create();
  E.start(s);
  const before = JSON.stringify(s);
  assert.throws(() => E.action(s, "raise", 21));
  assert.equal(JSON.stringify(s), before);
});
test("short all-in does not reopen a previous caller raise rights", () => {
  const s = E.create(2);
  E.start(s);
  E.action(s, "call");
  s.players[1].chips = 15;
  E.action(s, "raise", 25);
  E.action(s, "call");
  assert.equal(s.turn, 0);
  assert.equal(E.legal(s).raise, false);
  assert.equal(E.legal(s).call, 5);
});
test("heads-up dealer posts small blind and acts first before flop", () => {
  const s = E.create(2);
  s.players.pop();
  E.start(s);
  assert.equal(s.turn, s.dealer);
  assert.equal(s.players[s.dealer].bet, 10);
});

 test("seven-handed table defaults to named opponents and nine-handed play remains supported",()=>{const defaults=E.create();assert.deepEqual(defaults.players.map(p=>p.name),["你","小扁豆","儿颠颠","三老蛤","滴滴佬","马老五","小腊顺"]);const s=E.create(8);assert.equal(s.players.length,9);E.start(s,()=>0.3);assert.equal(s.players.filter(p=>p.hole.length===2).length,9);assert.equal(new Set(s.players.flatMap(p=>p.hole)).size,18);});

test('positions follow the button and re-entering players retain their seats', () => {
  const s = E.create(); E.start(s, () => 0.3);
  assert.deepEqual(s.players.map(p => p.position), ['庄家','小盲','大盲','枪口','中位','劫位','关煞']);
  const foldedSeat=s.turn; E.action(s,'fold'); assert.equal(s.players[foldedSeat].position,'枪口');
  while(!s.done) E.action(s, 'fold');
  s.players[1].chips=0; s.players[4].chips=0;
  E.start(s, () => 0.3);
  assert.deepEqual(s.players.map(p => p.position), ['关煞','庄家','小盲','大盲','枪口','中位','劫位']);
});
test('heads-up dealer is also the small blind', () => {
  const s=E.create(2);s.players.pop();E.start(s,()=>0.3);
  assert.equal(s.players[s.dealer].position,'庄家/小盲');
  assert.equal(s.players.find(p=>p.position==='大盲').bet,20);
});
test('positions are unique across all supported table sizes',()=>{
  for(let n=2;n<=8;n++){const s=E.create(n);E.start(s,()=>0.3);const positions=s.players.map(p=>p.position);assert.equal(new Set(positions).size,n+1);assert.equal(positions.filter(p=>p==='小盲').length,1);assert.equal(positions.filter(p=>p==='大盲').length,1);}
});

test('seat status distinguishes in-hand, folded, all-in and elimination', () => {
  const s = E.create(3);
  assert.equal(E.seatStatus(s,0),'ready');
  s.players[1].chips = 5;
  E.start(s,()=>0.3);
  assert.equal(E.seatStatus(s,0),'in-hand');
  assert.equal(E.seatStatus(s,1),'all-in');
  const folding = s.turn; E.action(s,'fold');
  assert.equal(E.seatStatus(s,folding),'folded');
  assert.equal(E.seatStatus(s,1),'all-in');
  while(!s.done) E.action(s,'call');
  for(let i=0;i<s.players.length;i++) assert.equal(E.seatStatus(s,i),s.players[i].chips ? 'survived' : 'eliminated');
  s.players[1].chips=0; E.start(s,()=>0.3);
  assert.equal(E.seatStatus(s,1),'in-hand');
  assert.ok(s.rebuys.includes(1));
});

test('busted human and AI rebuy exactly 2000 between hands without altering other stacks', () => {
  const s=E.create(3); E.start(s,()=>0.3);
  while(!s.done) E.action(s,'fold');
  s.players[0].chips=0; s.players[2].chips=0;
  s.players[1].chips=1270; s.players[3].chips=3110;
  const oldDealer=s.dealer;
  E.start(s,()=>0.3);
  assert.deepEqual(s.rebuys,[0,2]);
  assert.deepEqual(s.players.map(p=>p.chips+p.bet),[2000,1270,2000,3110]);
  assert.equal(s.dealer,(oldDealer+1)%s.players.length);
  assert.equal(s.players.filter(p=>p.hole.length===2).length,4);
  assert.ok(s.log.some(v=>v==='你：补码 2000'));
  assert.ok(s.log.some(v=>v===s.players[2].name+'：补码 2000'));
  assert.throws(()=>E.start(s,()=>0.3),/本手尚未结束/);
  assert.deepEqual(s.players.map(p=>p.chips+p.bet),[2000,1270,2000,3110]);
});
test('all-in players are never rebought until their current hand is settled',()=>{
  const s=E.create(2);s.players[1].chips=5;E.start(s,()=>0.3);
  assert.equal(E.seatStatus(s,1),'all-in');
  assert.equal(s.players[1].chips,0);
  assert.throws(()=>E.start(s,()=>0.3),/本手尚未结束/);
  assert.equal(s.players[1].chips,0);
});
