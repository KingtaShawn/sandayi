'use strict';
// Fixed-seed seven-handed self-play; VPIP excludes forced blinds and free checks.
const E = require(process.argv[2] || '../miniprogram/poker/engine');
const hands = Number(process.argv[3] || 1000);
let seed = Number(process.argv[4] || 392117) >>> 0;
const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const s = E.create(6), stats = s.players.map(p => ({name:p.name, vpip:0, raises:0, net:0}));
for (let h=0; h<hands; h++) {
  s.players.forEach(p => {p.chips=2000});
  E.start(s,rng); const entered=new Set(), raised=new Set(); let steps=0;
  while(!s.done) {
    if(++steps>300) throw Error('牌局未能结束');
    const i=s.turn, p=s.players[i], before=s.street, cost=Math.min(p.chips,s.current-p.bet);
    const move=E.decide(E.observation(s,i),rng,12);
    if(before===0 && (move.type==='raise'||move.type==='call'&&cost>0)) entered.add(i);
    if(before===0 && move.type==='raise') raised.add(i);
    E.action(s,move.type,move.target);
  }
  s.players.forEach((p,i)=>{if(entered.has(i))stats[i].vpip++;if(raised.has(i))stats[i].raises++;stats[i].net+=p.chips-2000;});
}
console.log(JSON.stringify({hands,seed:Number(process.argv[4]||392117),sampleTrials:12,players:stats.map(p=>({name:p.name,vpipPct:+(p.vpip/hands*100).toFixed(1),raisePct:+(p.raises/hands*100).toFixed(1),bbPer100:+(p.net/20/hands*100).toFixed(1)}))},null,2));
