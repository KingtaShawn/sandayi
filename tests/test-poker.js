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

test('raise presets apply pot odds, minimum raise and short all-in limits',()=>{
  const s=E.create(2);E.start(s,()=>0.3);
  assert.equal(E.raiseTarget(s,'quarter'),40);
  assert.equal(E.raiseTarget(s,'third'),40);
  assert.equal(E.raiseTarget(s,'half'),45);
  assert.equal(E.raiseTarget(s,'twoThirds'),53);
  assert.equal(E.raiseTarget(s,'threeQuarters'),58);
  assert.equal(E.raiseTarget(s,'pot'),70);
  assert.equal(E.raiseTarget(s,'double'),120);
  assert.equal(E.raiseTarget(s,'triple'),170);
  assert.equal(E.raiseTarget(s,'quad'),80);
  assert.throws(()=>E.raiseTarget(s,'unknown'),/未知下注选项/);
  s.players[s.turn].chips=35;
  for(const preset of ['quarter','third','half','twoThirds','threeQuarters','pot','double','triple','quad']) assert.equal(E.raiseTarget(s,preset),35);
  E.action(s,'raise',E.raiseTarget(s,'third'));
  assert.equal(s.players[0].chips,0);
});
test('pot fraction sizes are based on the pot after calling',()=>{
  const s=E.create(2);E.start(s,()=>0.3);
  E.action(s,'raise',100);
  const p=s.players[s.turn],l=E.legal(s),pot=s.players.reduce((a,q)=>a+q.total,0);
  assert.equal(E.raiseTarget(s,'half'),Math.max(l.min,s.current+Math.round((pot+l.call)/2)));
  assert.equal(p.chips+p.bet,l.max);
});

test('selected AI players use wider preflop ranges without removing stack risk limits',()=>{
  const reference=E.create(6);E.start(reference,()=>0.3);
  let extra=0, regressions=0;
  for(let a=0;a<52;a++)for(let b=a+1;b<52;b++){
    const narrow=E.observation(reference,2),wide=E.observation(reference,1);
    narrow.dealer=2;wide.dealer=1;narrow.hole=[a,b];wide.hole=[a,b];narrow.players[2].bet=0;wide.players[1].bet=0;narrow.players[2].chips=2000;wide.players[1].chips=2000;
    const n=E.decide(narrow,()=>0.5,4),w=E.decide(wide,()=>0.5,4);
    if(n.type==='fold'&&w.type!=='fold')extra++;
    if(n.type!=='fold'&&w.type==='fold')regressions++;
  }
  assert.ok(extra>40);assert.equal(regressions,0);
  const wide=E.observation(reference,1);wide.current=2000;wide.players[1].bet=0;wide.players[1].chips=2000;wide.hole=[0,14];
  assert.equal(E.decide(wide,()=>0.5,4).type,'fold');
});

test('postflop bluffing can pressure a small bet but avoids expensive or forced shoves',()=>{
  const players=Array.from({length:7},(_,i)=>({chips:1500,bet:0,total:30,folded:i>3}));
  const o={hole:[0,18],board:[33,48,11],street:1,dealer:0,seat:1,current:0,minRaise:20,players,canRaise:true};
  assert.equal(E.decide(o,()=>0,32).type,'raise');
  o.current=20;assert.equal(E.decide(o,()=>0,32).type,'raise');
  o.current=100;assert.equal(E.decide(o,()=>0,32).type,'fold');
  o.current=20;o.players[1].chips=50;assert.equal(E.decide(o,()=>0,32).type,'fold');
  o.canRaise=false;assert.notEqual(E.decide(o,()=>0,32).type,'raise');
});

test('genuine flush, open-ended and gutshot draws continue even facing an all-in',()=>{
  const players=Array.from({length:7},()=>({chips:50,bet:0,total:30,folded:false}));
  const o={street:1,dealer:0,seat:1,current:2000,minRaise:20,players,canRaise:false};
  const cases=[
    {hole:[c(2,1),c(7,1)],board:[c(14,1),c(11,1),c(13,0)]},
    {hole:[c(5,0),c(6,1)],board:[c(7,2),c(8,3),c(13,1)]},
    {hole:[c(14,0),c(5,1)],board:[c(2,2),c(3,3),c(13,1)]},
    {hole:[c(8,0),c(10,1)],board:[c(7,2),c(9,3),c(13,1),c(2,2)]},
  ];
  for(const spot of cases) {
    Object.assign(o,spot,{street:spot.board.length===3?1:2});
    assert.equal(E.decide(o,()=>0.99,32).type,'call');
  }
  // A three-card backdoor flush on the flop is not a one-card draw.
  Object.assign(o,{street:1,hole:[c(2,1),c(7,1)],board:[c(14,1),c(11,2),c(13,0)]});
  assert.equal(E.decide(o,()=>0.99,32).type,'fold');
  // Four cards in the community alone do not give a private straight draw.
  Object.assign(o,{street:2,hole:[c(2,0),c(13,1)],board:[c(5,2),c(6,3),c(7,2),c(8,3)]});
  assert.equal(E.decide(o,()=>0.99,32).type,'fold');
  // There is no future card to draw on the river.
  Object.assign(o,{street:3,hole:[c(2,1),c(7,1)],board:[c(14,1),c(11,1),c(13,0),c(4,2),c(9,3)]});
  assert.equal(E.decide(o,()=>0.99,32).type,'fold');
});

test('winners exclude an uncalled-bet refund, including multiple side pots',()=>{
  const s=E.create(3);s.players[0].chips=50;s.players[1].chips=100;
  E.start(s,()=>0.3);
  s.players[0].hole=[c(14,0),c(14,1)];s.players[1].hole=[c(13,0),c(13,1)];
  s.players[2].hole=[c(12,0),c(12,1)];s.players[3].hole=[c(11,0),c(11,1)];
  s.deck=[c(9,0),c(7,3),c(8,3),c(6,3),c(4,2),c(3,1),c(2,0),c(5,3)];
  assert.equal(s.turn,3);E.action(s,'raise',200);E.action(s,'call');E.action(s,'call');E.action(s,'fold');
  assert.deepEqual(s.board,[c(2,0),c(3,1),c(4,2),c(8,3),c(9,0)]);
  assert.equal(s.done,true);assert.deepEqual(s.awards,[170,100,0,100]);assert.deepEqual(s.winners,[0,1]);
  E.start(s,()=>0.3);assert.deepEqual(s.winners,[]);
});

test('底池 40：无人下注时四档为 20、40、80、120',()=>{
  const s=E.create(2);E.start(s,()=>0.3);s.street=1;s.current=0;s.minRaise=20;s.turn=0;s.rights=[0];
  s.players.forEach((p,i)=>{p.bet=0;p.total=[10,10,20][i];p.chips=1900;});
  assert.deepEqual(['half','pot','double','triple'].map(size=>E.raiseTarget(s,size)),[20,40,80,120]);
});
test('底池 40 含对手 20，先跟注后的底池为 60',()=>{
  const s=E.create(2);E.start(s,()=>0.3);s.street=1;s.current=20;s.minRaise=20;s.turn=0;s.rights=[0];
  s.players.forEach((p,i)=>{p.bet=i===1?20:0;p.total=[0,20,20][i];p.chips=1900;});
  assert.equal(E.legal(s).call,20);
  assert.deepEqual(['half','pot','double','triple'].map(size=>E.raiseTarget(s,size)),[50,80,140,200]);
  s.players[0].chips=100;
  assert.deepEqual(['half','pot','double','triple'].map(size=>E.raiseTarget(s,size)),[50,80,100,100]);
});

test('best five cards retain the correct rank, suits and chosen kickers',()=>{
  const cards=[c(14,0),c(14,1),c(13,3),c(12,2),c(9,0),c(7,0),c(2,2)];
  const hand=E.bestFive(cards);assert.equal(hand.name,'一对');assert.equal(hand.score,E.evaluate(cards));
  assert.deepEqual(hand.cards,[c(14,0),c(14,1),c(13,3),c(12,2),c(9,0)]);
  const royal=[c(10,0),c(11,0),c(12,0),c(13,0),c(14,0),c(2,1),c(3,2)];
  assert.equal(E.bestFive(royal).name,'皇家同花顺');assert.equal(E.bestFive(royal).score,E.evaluate(royal));
  assert.equal(E.bestFive([1,2,3,4]),null);
});
test('winning five may be entirely on the board; no invented cards after folds',()=>{
  const s=E.create(2);E.start(s,()=>0.3);s.done=true;s.winners=[0,1];
  s.board=[c(10,0),c(11,1),c(12,2),c(13,3),c(14,0)];
  s.players[0].hole=[c(2,1),c(3,1)];s.players[1].hole=[c(4,1),c(5,1)];
  const hands=E.winningHands(s);assert.equal(hands.length,2);hands.forEach(h=>{assert.equal(h.name,'顺子');assert.deepEqual(h.cards,s.board)});
  s.board=[];const early=E.winningHands(s);assert.ok(early.every(h=>h.name==='无人跟注获胜'&&h.cards.length===0));
  s.done=false;assert.deepEqual(E.winningHands(s),[]);
});
