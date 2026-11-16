'use strict';
const E=require('../miniprogram/poker/engine');
const old=require(process.argv[2]||'./baselines/poker-v1.js');
const hands=Number(process.argv[3]||200);let seed=192837;const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
let delta=0, decisions=0, raises=0;
for(let h=0;h<hands;h++){const s=E.create(8),hero=h%9;s.players.forEach(p=>p.chips=2000);E.start(s,rng);let steps=0;while(!s.done){if(++steps>300)throw Error('stuck');const who=s.turn,obs=E.observation(s,who);const m=(who===hero && process.argv[4]!=='baseline'?E:old).decide(obs,rng,24);if(who===hero){decisions++;if(m.type==='raise')raises++;}E.action(s,m.type,m.target);}delta+=s.players[hero].chips-2000;}
console.log(JSON.stringify({hands,netChips:delta,bbPer100:delta/20/hands*100,decisions,raises}));
