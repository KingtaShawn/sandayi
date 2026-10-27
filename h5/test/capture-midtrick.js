/**
 * 驱动到"出牌中"并截一张牌桌中央真正有出牌的图（用于复核 trick 布局）。
 */
'use strict';
const path = require('path');
// puppeteer 解析：项目 devDependencies 优先，否则退回 PUPPETEER_WS 指定的 node_modules 目录
let puppeteer = null;
try { puppeteer = require('puppeteer'); }
catch {
  if (process.env.PUPPETEER_WS) puppeteer = require(path.resolve(process.env.PUPPETEER_WS, 'puppeteer'));
}
if (!puppeteer) {
  console.error('未找到 puppeteer：项目根目录先 npm i（devDependencies 已含），或设 PUPPETEER_WS=<node_modules 目录>');
  process.exit(1);
}
const BASE = 'http://127.0.0.1:8930';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function driveToPlaying(page) {
  await page.evaluate(() => document.getElementById('btn-start').click());
  for (let i = 0; i < 400; i++) {
    await sleep(260);
    const s = await page.evaluate(() => {
      const label = (document.getElementById('hand-label').textContent || '').trim();
      return { canPlay: label.includes('轮到你出牌'), bidBar: !!document.querySelector('.bid-bar'), buryBar: !!document.querySelector('.bury-bar') };
    });
    if (s.canPlay) return true;
    await page.evaluate(() => {
      const bidBar = document.querySelector('.bid-bar');
      if (bidBar) {
        const suit = bidBar.querySelector('.bid-bar__option--suit');
        const opt = suit ? null : bidBar.querySelector('.bid-bar__option:not(.bid-bar__option--suit)');
        const pass = bidBar.querySelector('.bid-bar__pass');
        if (suit) suit.click(); else if (opt) opt.click(); else if (pass) pass.click();
      }
    });
    if (s.buryBar) {
      for (let k = 0; k < 9; k++) {
        await page.evaluate(() => { const c = Array.from(document.querySelectorAll('#hand-row .card')).find((x) => !x.classList.contains('card--selected')); if (c) c.click(); });
        await sleep(50);
      }
      await page.evaluate(() => { const c = document.querySelector('.bury-bar__confirm'); if (c && !c.classList.contains('btn--disabled')) c.click(); });
      await sleep(300);
    }
  }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'shell', // chrome-headless-shell（本机无整装 Chrome）
    args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'], timeout: 90000
  });
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [844, 390, 'phone-landscape'], [375, 812, 'mobile']]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.goto(BASE + '/?_t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);
    await driveToPlaying(page);
    // 人类跟/领：选一张手牌并出牌，再等 AI 跟完一整轮
    await page.evaluate(() => {
      const c = document.querySelector('#hand-row .card'); if (c) c.click();
      const p = document.querySelector('#action-slot .btn--primary'); if (p) p.click();
    });
    // 等一整轮（4 家）出完
    await sleep(4000);
    // 再截一张：再出一张看桌上累计
    await page.evaluate(() => {
      const c = document.querySelector('#hand-row .card'); if (c) c.click();
      const p = document.querySelector('#action-slot .btn--primary'); if (p) p.click();
    });
    await sleep(3500);
    const n = await page.evaluate(() => document.querySelectorAll('#trick-area .card').length);
    const geo = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { y: Math.round(b.y), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
      const cards = Array.from(document.querySelectorAll('#trick-area .card')).map((c) => { const b = c.getBoundingClientRect(); return { y: Math.round(b.y), bottom: Math.round(b.bottom) }; });
      return {
        trickArea: r('#trick-area'),
        tools: r('.table__tools'),
        statusBar: r('#status-bar'),
        handRow: r('#hand-row'),
        cards,
        font: getComputedStyle(document.documentElement).fontSize
      };
    });
    console.log(`${tag}: cards=${n} font=${geo.font}`);
    console.log(`  trickArea=${JSON.stringify(geo.trickArea)} tools=${JSON.stringify(geo.tools)} status=${JSON.stringify(geo.statusBar)} handRow=${JSON.stringify(geo.handRow)}`);
    console.log(`  trickCards=${JSON.stringify(geo.cards)}`);
    await page.screenshot({ path: path.join(__dirname, 'shots', `${tag}-trick.png`) });
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error('ERR:', e.message.slice(0, 300)); process.exit(1); });
