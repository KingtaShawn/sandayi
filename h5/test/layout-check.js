/**
 * h5/test/layout-check.js —— 布局几何校验（puppeteer 测量，无需人眼）。
 * 校验：视口适配/卡牌尺寸/手牌位置/座位方位/操作条位置，手机+桌面两视口。
 */
'use strict';

const path = require('path');
const WS = path.join('C:', 'Users', 'baicells', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules');
const puppeteer = require(path.join(WS, 'puppeteer'));

const BASE = 'http://127.0.0.1:8930';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} —— ${detail}`); }
}

async function driveToPlaying(page) {
  await page.evaluate(() => document.getElementById('btn-start').click());
  for (let i = 0; i < 400; i++) {
    await sleep(280);
    const s = await page.evaluate(() => {
      const label = (document.getElementById('hand-label').textContent || '').trim();
      return {
        canPlay: label.includes('轮到你出牌'),
        bidBar: !!document.querySelector('.bid-bar'),
        suitBar: !!document.querySelector('.bid-bar__option--suit'),
        buryBar: !!document.querySelector('.bury-bar')
      };
    });
    if (s.canPlay) return true;
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
    if (s.buryBar) {
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
  }
  return false;
}

async function verifyViewport(browser, w, h, tag, expectCenter) {
  console.log(`\n== ${tag} 视口 ${w}x${h} ==`);
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.goto(BASE + '/?_t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);
  const ok = await driveToPlaying(page);
  check('到达出牌阶段', ok);
  if (!ok) { await page.close(); return; }

  // 等 AI 出几张牌让中央区有内容
  await sleep(2500);

  const geo = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const cards = Array.from(document.querySelectorAll('#hand-row .card')).map((c) => {
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      app: rect('#app'),
      handRow: rect('#hand-row'),
      handFirst: cards[0] || null,
      handLast: cards[cards.length - 1] || null,
      cardCount: cards.length,
      cardWSame: cards.length ? cards.every((c) => c.w === cards[0].w) : false,
      north: rect('#seat-2'),
      west: rect('#seat-3'),
      east: rect('#seat-1'),
      center: rect('.table__center'),
      statusBar: rect('#status-bar'),
      tools: rect('.table__tools'),
      actionSlot: rect('.table__action-slot'),
      playBtn: rect('#action-slot .btn--primary'),
      trick: rect('#trick-area'),
      htmlFont: getComputedStyle(document.documentElement).fontSize
    };
  });

  // ===== 断言 =====
  // 1. rem 基准：375 宽 → 3.75px；桌面 → 7.5px
  const expectFont = w >= 750 ? '7.5px' : (w / 100).toFixed(2).replace(/0$/, '') + 'px';
  check(`rem 基准（${geo.htmlFont}，期望 ${expectFont}）`, Math.abs(parseFloat(geo.htmlFont) - w / 100) < 0.31 || (w >= 750 && geo.htmlFont === '7.5px'), JSON.stringify(geo.htmlFont));

  // 2. 卡牌尺寸：25 张>24 触发 dense（8.53rem 小牌），≤24 张 11.73rem——与小程序 hand-area 逻辑一致
  const denseMode = geo.cardCount > 24;
  const expectCardW = Math.round((denseMode ? 8.53 : 11.73) * parseFloat(geo.htmlFont));
  if (geo.handFirst) {
    check(`卡牌宽 ${geo.handFirst.w}px（${denseMode ? 'dense' : 'normal'} 期望≈${expectCardW}px）`, Math.abs(geo.handFirst.w - expectCardW) <= 12, JSON.stringify(geo.handFirst));
    check(`手牌 ${geo.cardCount} 张尺寸一致`, geo.cardCount === 25 && geo.cardWSame, `count=${geo.cardCount} sameW=${geo.cardWSame}`);
  } else { check('手牌存在', false, '无手牌'); }

  // 3. 手牌区在屏幕下部（y > 视口高 55%）
  if (geo.handRow) check('手牌区位于屏幕下部', geo.handRow.y > geo.vh * 0.55, `y=${geo.handRow.y} vh=${geo.vh}`);

  // 4. 手牌不超出视口右缘
  if (geo.handLast) check('手牌未溢出屏幕', geo.handLast.x + geo.handLast.w <= geo.vw + 2, `last=${JSON.stringify(geo.handLast)} vw=${geo.vw}`);

  // 5. 座位方位：北在顶部、西在左侧、东在右侧
  if (geo.north && geo.west && geo.east) {
    check('北家在顶部', geo.north.y < geo.center.y, `N.y=${geo.north.y} C.y=${geo.center.y}`);
    check('西家在左侧', geo.west.x < geo.center.x, `W.x=${geo.west.x} C.x=${geo.center.x}`);
    check('东家在右侧', geo.east.x > geo.center.x + geo.center.w * 0.6, `E.x=${geo.east.x}`);
  }

  // 6. 状态栏在中央区上部
  if (geo.statusBar && geo.center) check('状态栏位于中央上部', geo.statusBar.y < geo.center.y + geo.center.h / 2, `SB.y=${geo.statusBar.y}`);

  // 7. 操作条在手牌下方且在视口内
  if (geo.actionSlot && geo.handRow) {
    check('操作条在手牌下方', geo.actionSlot.y >= geo.handRow.y, `A.y=${geo.actionSlot.y} H.y=${geo.handRow.y}`);
    check('操作条含出牌按钮', !!geo.playBtn);
    if (geo.playBtn) check('出牌按钮在视口内', geo.playBtn.y + geo.playBtn.h <= geo.vh + 2, JSON.stringify(geo.playBtn));
  }

  // 8. 桌面：容器居中限宽
  if (expectCenter && geo.app) {
    check('桌面容器限宽 750', geo.app.w <= 752, `app.w=${geo.app.w}`);
    const sideMargin = geo.app.x;
    check('桌面容器水平居中', Math.abs(sideMargin - (geo.vw - geo.app.x - geo.app.w)) <= 4, `x=${geo.app.x} vw=${geo.vw} w=${geo.app.w}`);
  }

  await page.screenshot({ path: path.join(__dirname, 'shots', `${tag}-playing.png`) });
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
    args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'],
    timeout: 90000
  });
  try {
    await verifyViewport(browser, 375, 812, 'mobile', false);
    await verifyViewport(browser, 414, 896, 'mobileL', false);
    await verifyViewport(browser, 1440, 900, 'desktop', true);
  } finally {
    await browser.close();
  }
  console.log(`\n布局校验: ${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR:', e.message.slice(0, 300)); process.exit(1); });
