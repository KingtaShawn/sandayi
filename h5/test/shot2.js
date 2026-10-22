/**
 * h5/test/shot2.js —— 连接已运行的 Edge 调试端口（9222）截图。
 * 前置：PowerShell 跑 start-edge.ps1 启动 headless Edge。
 * 用法：node h5/test/shot2.js <场景：home|bidding|playing|scoring> [输出名]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const WS = path.join('C:', 'Users', 'baicells', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules');
const puppeteer = require(path.join(WS, 'puppeteer'));

const BASE = 'http://127.0.0.1:8930';
const OUT_DIR = path.join(__dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function driveTo(page, target) {
  await page.evaluate(() => document.getElementById('btn-start').click());
  for (let i = 0; i < 400; i++) {
    await sleep(280);
    const s = await page.evaluate(() => {
      const label = (document.getElementById('hand-label').textContent || '').trim();
      return {
        label,
        result: !document.getElementById('result-modal').hidden,
        bidBar: !!document.querySelector('.bid-bar'),
        suitBar: !!document.querySelector('.bid-bar__option--suit'),
        buryBar: !!document.querySelector('.bury-bar'),
        canPlay: label.includes('轮到你出牌')
      };
    });
    if (target === 'bidding' && s.bidBar && !s.suitBar) return s;
    if (target === 'playing' && s.canPlay) return s;
    if (target === 'scoring' && s.result) return s;
    await page.evaluate(() => {
      const bidBar = document.querySelector('.bid-bar');
      if (bidBar) {
        const suit = bidBar.querySelector('.bid-bar__option--suit');
        const opt = suit ? null : bidBar.querySelector('.bid-bar__option:not(.bid-bar__option--suit)');
        const pass = bidBar.querySelector('.bid-bar__pass');
        if (suit) suit.click();
        else if (opt) opt.click();
        else if (pass) pass.click();
      }
    });
    const hasBury = await page.evaluate(() => !!document.querySelector('.bury-bar'));
    if (hasBury) {
      for (let k = 0; k < 9; k++) {
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
      await sleep(300);
    }
    if (target === 'playing' && s.canPlay) {
      // 选中部分牌让画面更真实
      await page.evaluate(() => document.getElementById('btn-hint').click());
      await sleep(200);
    }
  }
  return null;
}

(async () => {
  const scenario = process.argv[2] || 'playing';
  const name = process.argv[3] || scenario;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  try {
    // 手机视口
    const m = await browser.newPage();
    await m.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await m.goto(BASE + '/?_t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1800);
    if (scenario !== 'home') {
      const st = await driveTo(m, scenario);
      console.log('[mobile]', JSON.stringify(st));
    }
    await sleep(500);
    await m.screenshot({ path: path.join(OUT_DIR, `m-${name}.png`) });
    await m.close();
    // 桌面视口
    const d = await browser.newPage();
    await d.setViewport({ width: 1440, height: 900 });
    await d.goto(BASE + '/?_t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1800);
    if (scenario !== 'home') {
      const st = await driveTo(d, scenario);
      console.log('[desktop]', JSON.stringify(st));
    }
    await sleep(500);
    await d.screenshot({ path: path.join(OUT_DIR, `d-${name}.png`) });
    await d.close();
    console.log('DONE →', OUT_DIR);
  } finally {
    browser.disconnect();
  }
})().catch((e) => { console.error('ERR:', e.message.slice(0, 300)); process.exit(1); });
