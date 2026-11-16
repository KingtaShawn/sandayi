/** Optional real-browser geometry check: node h5/test/poker-motion-e2e.js.
 * Set PUPPETEER_EXECUTABLE_PATH if Chromium is not installed at /usr/bin/chromium.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const center=e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
async function main(){
  const server=http.createServer((request,response)=>{
    const pathname=new URL(request.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
    try{response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'text/html');response.end(fs.readFileSync(file));}
    catch{response.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=process.env.PUPPETEER_EXECUTABLE_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  let browser;
  try{
    browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox']});
    for(const [width,height] of [[844,390],[390,844]]) for(const mode of ['board','payout']){
      const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setViewport({width,height,isMobile:true,hasTouch:true});
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.addStyleTag({content:'#view-poker .dealing,#view-poker .flying-chips,#view-poker .dealer-portrait{animation-play-state:paused!important;animation-delay:0ms!important}'});
      await page.evaluate(mode=>{Poker.decide=()=>({type:mode==='board'?'call':'fold'});const old=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>old(fn,ms===2800?500:ms===1200?100:ms,...args)},mode);
      await page.click('#btn-enter-poker');await page.click('#poker-next');await sleep(80);
      const first=await page.evaluate((center,distance)=>{
        const c=eval('('+center+')'),d=eval('('+distance+')'),dealer=c(document.querySelector('.dealer-portrait'));
        const cards=[...document.querySelectorAll('.poker-card.dealing,.card-back.dealing')];
        const seats=[...document.querySelectorAll('.poker-seat')].map(c);
        const bets=[...document.querySelectorAll('.bet-flight')];
        return {cards:cards.map(e=>d(c(e),dealer)),bets:bets.map(e=>Math.min(...seats.map(s=>d(c(e),s)))),image:document.querySelector('.dealer-portrait img').naturalWidth};
      },center.toString(),distance.toString());
      assert.equal(first.cards.length,14);assert.ok(first.cards.every(x=>x<3));assert.equal(first.bets.length,2);assert.ok(first.bets.every(x=>x<3));assert.ok(first.image>0);
      await page.waitForFunction(()=>!document.querySelector('#poker-call').disabled,{timeout:8000});
      await page.evaluate(()=>document.querySelector('#poker-flights').replaceChildren());await page.click('#poker-call');
      if(mode==='board'){
        const bet=await page.evaluate((center,distance)=>{const c=eval('('+center+')'),d=eval('('+distance+')'),e=document.querySelector('.bet-flight');const start=d(c(e),c(document.querySelector('.seat-0')));const a=e.getAnimations()[0];a.currentTime=a.effect.getComputedTiming().duration*.999;return {start,end:d(c(e),c(document.querySelector('#poker-chips')))}},center.toString(),distance.toString());
        assert.ok(bet.start<3&&bet.end<3,JSON.stringify(bet));
        await page.waitForFunction(()=>document.querySelectorAll('#poker-board .dealing').length===3,{timeout:5000});
        const board=await page.evaluate((center,distance)=>{const c=eval('('+center+')'),d=eval('('+distance+')'),dealer=c(document.querySelector('.dealer-portrait'));return [...document.querySelectorAll('#poker-board .dealing')].map(e=>d(c(e),dealer))},center.toString(),distance.toString());
        assert.ok(board.every(x=>x<3),JSON.stringify(board));
      }else{
        await page.waitForFunction(()=>document.querySelector('.payout'),{timeout:8000});
        const payout=await page.evaluate((center,distance)=>{const c=eval('('+center+')'),d=eval('('+distance+')'),e=document.querySelector('.payout');const start=d(c(e),c(document.querySelector('#poker-chips')));const a=e.getAnimations()[0];a.currentTime=a.effect.getComputedTiming().duration*.999;return {start,end:d(c(e),c(document.querySelector('.poker-seat.winner')))}},center.toString(),distance.toString());
        assert.ok(payout.start<3&&payout.end<3,JSON.stringify(payout));
      }
      assert.deepEqual(errors,[]);await page.close();console.log(`✓ ${width}×${height} ${mode}: motion starts and ends at the correct elements`);
    }
    // A split pot must travel from the pot to each actual recipient, not a fixed seat.
    for(const [width,height] of [[844,390],[390,844]]) {
      const page=await browser.newPage();await page.setViewport({width,height,isMobile:true,hasTouch:true});
      await page.setRequestInterception(true);
      page.on('request',request=>{
        if(new URL(request.url()).pathname.endsWith('/js/poker-engine.js')) {
          const source=fs.readFileSync(path.join(root,'js/poker-engine.js'),'utf8');
          const fixture=`;const createPokerFixture=window.Poker.create;window.Poker.create=(...args)=>{const s=createPokerFixture(...args);s.hand=1;s.dealer=0;s.board=[];s.players[0].total=100;s.players[1].total=100;s.awards=[80,120,0,0,0,0,0];s.winners=[0,1];s.result='分池';return s;};`;
          request.respond({status:200,contentType:'text/javascript',body:source+fixture});
        } else request.continue();
      });
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.addStyleTag({content:'#view-poker .flying-chips{animation-play-state:paused!important;animation-delay:0ms!important}'});
      await page.evaluate(()=>{const old=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>old(fn,ms===2800?200:ms,...args)});
      await page.click('#btn-enter-poker');
      await page.waitForFunction(()=>document.querySelectorAll('.payout').length===2,{timeout:6000});
      const targets=await page.evaluate((center,distance)=>{const c=eval('('+center+')'),d=eval('('+distance+')');return [...document.querySelectorAll('.payout')].map((e,i)=>{const start=d(c(e),c(document.querySelector('#poker-chips')));const a=e.getAnimations()[0];a.currentTime=a.effect.getComputedTiming().duration*.999;return {start,end:d(c(e),c(document.querySelector('.seat-'+i)))}})},center.toString(),distance.toString());
      assert.ok(targets.every(x=>x.start<3&&x.end<3),JSON.stringify(targets));
      await page.close();console.log(`✓ ${width}×${height} split pot: each flight ends at its recipient`);
    }
    for(const [width,height] of [[844,390],[390,844]]) {
      const page=await browser.newPage();await page.setViewport({width,height,isMobile:true,hasTouch:true});
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.addStyleTag({content:'#view-poker .dealing,#view-poker .dealer-portrait{animation-play-state:paused!important;animation-delay:0ms!important}'});
      await page.click('#btn-enter-poker');await page.select('#poker-count','8');await page.click('#poker-reset');await page.click('#poker-next');await sleep(80);
      const cards=await page.evaluate((center,distance)=>{const c=eval('('+center+')'),d=eval('('+distance+')'),dealer=c(document.querySelector('.dealer-portrait'));return [...document.querySelectorAll('.poker-card.dealing,.card-back.dealing')].map(e=>d(c(e),dealer))},center.toString(),distance.toString());
      assert.equal(cards.length,18);assert.ok(cards.every(x=>x<3),JSON.stringify(cards));
      await page.close();console.log(`✓ ${width}×${height} nine-handed: all 18 cards originate at the dealer`);
    }
  }finally{if(browser)await browser.close();server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
