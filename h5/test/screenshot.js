/**
 * h5/test/screenshot.js —— 真实浏览器截图调测（puppeteer）。
 * 用法：node h5/test/screenshot.js [场景] （场景：home/bidding/playing，默认 playing）
 * 产出：h5/test/shots/*.png，自动翻页到桌面/手机两种视口。
 */
'use strict';

const path = require('path');
const fs = require('fs');
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
const OUT_DIR = path.join(__dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function driveTo(page, target) {
  // 点击开始 → 自动决策推进到目标场景
  await page.evaluate(() => document.getElementById('btn-start').click());
  for (let i = 0; i < 400; i++) {
    await sleep(300);
    const s = await page.evaluate(() => {
      const label = (document.getElementById('hand-label').textContent || '').trim();
      const result = !document.getElementById('result-modal').hidden;
      return {
        label,
        result,
        bidBar: !!document.querySelector('.bid-bar'),
        suitBar: !!document.querySelector('.bid-bar__option--suit'),
        buryBar: !!document.querySelector('.bury-bar'),
        cards: document.querySelectorAll('#hand-row .card').length
      };
    });
    if (target === 'bidding' && s.bidBar && !s.suitBar) return s;
    if (target === 'playing' && s.label.includes('轮到你出牌')) return s;
    if (target === 'scoring' && s.result) return s;
    // 自动决策
    await page.evaluate(() => {
      const bidBar = document.querySelector('.bid-bar');
      const label = (document.getElementById('hand-label').textContent || '').trim();
      if (bidBar) {
        const suit = bidBar.querySelector('.bid-bar__option--suit');
        const opt = suit ? null : bidBar.querySelector('.bid-bar__option:not(.bid-bar__option--suit)');
        const pass = bidBar.querySelector('.bid-bar__pass');
        if (suit) suit.click();
        else if (opt) opt.click();
        else if (pass) pass.click();
      } else if (document.querySelector('.bury-bar')) {
        // 由外部逐步处理
      }
    });
    const bury = await page.$('.bury-bar');
    if (bury) {
      for (let k = 0; k < 8; k++) {
        await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('#hand-row .card'));
          const t = cards.find((c) => !c.classList.contains('card--selected'));
          if (t) t.click();
        });
        await sleep(60);
      }
      await page.evaluate(() => {
        const c = document.querySelector('.bury-bar__confirm');
        if (c && !c.classList.contains('btn--disabled')) c.click();
      });
    }
  }
  return null;
}

(async () => {
  const scenario = process.argv[2] || 'playing';
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || await puppeteer.executablePath(),
    args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server', '--disable-features=msEdgeDeferStartupTasks'],
    timeout: 90000,
    protocolTimeout: 180000
  });
  try {
    // 手机横屏视口（812×375 iPhone X 横屏）
    const m = await browser.newPage();
    await m.setViewport({ width: 812, height: 375, isMobile: true, hasTouch: true });
    await m.goto(BASE + '/?_t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2500);
    await sleep(600);
    if (scenario !== 'home') {
      const st = await driveTo(m, scenario);
      console.log('[mobile] 到达场景:', JSON.stringify(st));
    }
    await m.screenshot({ path: path.join(OUT_DIR, `m-${scenario}.png`) });

    // 桌面视口（1440×900）
    const d = await browser.newPage();
    await d.setViewport({ width: 1440, height: 900 });
    await d.goto(BASE + '/?_t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2500);
    await sleep(600);
    if (scenario !== 'home') {
      const st = await driveTo(d, scenario);
      console.log('[desktop] 到达场景:', JSON.stringify(st));
    }
    await d.screenshot({ path: path.join(OUT_DIR, `d-${scenario}.png`) });

    console.log('截图完成 →', OUT_DIR);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('截图异常:', e.message); process.exit(1); });
