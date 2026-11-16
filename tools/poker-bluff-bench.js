'use strict';
// Repeatable spot check: weak made hands are a proxy, not proof of intent or skill.
const E=require(process.argv[2] || '../miniprogram/poker/engine');
const samples=Number(process.argv[3] || 1000), seed=Number(process.argv[4] || 492117)>>>0;
const generator=start=>{let x=start>>>0;return()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296)};
const deal=generator(seed), results=[];
for (const opponents of [1,3]) for (const street of [1,3]) {
  let weak=0,raises=0;
  for(let n=0;n<samples;n++){
    const deck=Array.from({length:52},(_,i)=>i);
    for(let i=deck.length-1;i>0;i--){const j=Math.floor(deal()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
    const hole=deck.slice(0,2), board=deck.slice(2,street===1?5:7);
    if(Math.floor(E.evaluate(hole.concat(board))/15**5)!==0)continue;
    const players=Array.from({length:7},(_,i)=>({chips:1500,bet:0,total:Math.floor(120/(opponents+1)),folded:i>opponents}));
    const o={hole,board,street,dealer:0,seat:1,current:0,minRaise:20,players,canRaise:true};
    const move=E.decide(o,generator(seed+n*97+opponents*100003+street*1000003),48);
    weak++;if(move.type==='raise')raises++;
  }
  results.push({opponents,street:street===1?'flop':'river',weakHands:weak,raises,raisePct:weak?+(100*raises/weak).toFixed(1):0});
}
console.log(JSON.stringify({samples,seed,results},null,2));
