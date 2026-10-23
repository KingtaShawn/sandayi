/**
 * h5/test/layout-check.js —— 布局几何校验（puppeteer 测量，无需人眼）。
 * 校验：横屏视口适配/卡牌尺寸/手牌位置/座位方位/操作条悬浮位/无纵向溢出，手机横屏+桌面两视口。
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

// 横屏设计基准：版心 160rem × 90rem（16:9），更宽窗口横向拉伸
const DESIGN_W = 160, DESIGN_H = 90;

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

async function verifyViewport(browser, w, h, tag) {
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
      docH: document.documentElement.scrollHeight,
      htmlFont: getComputedStyle(document.documentElement).fontSize
    };
  });

  // ===== 断言 =====
  // 1. rem 基准：横屏 160×90 设计，取宽高中紧者
  const expectFont = Math.min(w / DESIGN_W, h / DESIGN_H);
  check(`rem 基准（${geo.htmlFont}，期望≈${expectFont.toFixed(2)}px）`,
    Math.abs(parseFloat(geo.htmlFont) - expectFont) < 0.31, JSON.stringify(geo.htmlFont));

  // 2. 卡牌尺寸：横屏手牌区宽，25 张仍用常规牌（11.73rem，>30 张才 dense）
  const expectCardW = Math.round(11.73 * parseFloat(geo.htmlFont));
  if (geo.handFirst) {
    check(`卡牌宽 ${geo.handFirst.w}px（期望≈${expectCardW}px）`, Math.abs(geo.handFirst.w - expectCardW) <= 12, JSON.stringify(geo.handFirst));
    check(`手牌 ${geo.cardCount} 张尺寸一致`, geo.cardCount === 25 && geo.cardWSame, `count=${geo.cardCount} sameW=${geo.cardWSame}`);
  } else { check('手牌存在', false, '无手牌'); }

  // 3. 手牌区在屏幕下部
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

  // 7. 出牌按钮悬浮于出牌区内且在视口内
  if (geo.actionSlot) {
    check('操作条含出牌按钮', !!geo.playBtn);
    if (geo.playBtn) {
      check('出牌按钮在视口内', geo.playBtn.y + geo.playBtn.h <= geo.vh + 2 && geo.playBtn.y >= geo.center.y, JSON.stringify(geo.playBtn));
      check('操作条悬浮于出牌区（不占手牌下方空间）', geo.actionSlot.y + geo.actionSlot.h <= geo.handRow.y + 4, `A.bottom=${geo.actionSlot.y + geo.actionSlot.h} H.y=${geo.handRow.y}`);
    }
  }

  // 8. 版心满宽（160rem 起，超宽屏 240rem 封顶）；无纵向溢出
  if (geo.app) {
    const expectAppW = Math.round(Math.min(w, 240 * parseFloat(geo.htmlFont)));
    check(`版心满宽 ${geo.app.w}px（期望≈${expectAppW}px）`, Math.abs(geo.app.w - expectAppW) <= 3, JSON.stringify(geo.app));
  }
  check('无纵向溢出（整页不滚动）', geo.docH <= geo.vh + 2, `docH=${geo.docH} vh=${geo.vh}`);

  await page.screenshot({ path: path.join(__dirname, 'shots', `${tag}-playing.png`) });
  await page.close();
}

// 竖屏自动转横屏：触屏竖屏下 #app 整层旋转 90°、rem 基准宽高互换、真实鼠标点按能开局；桌面竖窗不旋转
async function verifyPortraitRotation(browser) {
  console.log('\n== 竖屏自动旋转 触屏 375x812 ==');
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  await page.goto(BASE + '/?_t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1800);

  const geo = await page.evaluate(() => {
    const app = document.getElementById('app');
    const cs = getComputedStyle(app);
    const m = (cs.transform.match(/matrix\(([^)]+)\)/) || [])[1];
    const r = app.getBoundingClientRect();
    return {
      matrix: m, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      vw: innerWidth, vh: innerHeight,
      docH: document.documentElement.scrollHeight,
      htmlFont: getComputedStyle(document.documentElement).fontSize
    };
  });
  const vals = geo.matrix ? geo.matrix.split(',').map(Number) : [];
  const rot = vals.length === 6 && Math.abs(Math.abs(vals[1]) - 1) < 0.01;
  check('整层旋转 90°（矩阵含 sinθ=±1）', rot, geo.matrix || '无 transform');
  check('旋转后铺满竖屏（视觉包围盒=视口）', geo.w === geo.vw && geo.h === geo.vh && geo.x === 0 && geo.y === 0,
    JSON.stringify({ w: geo.w, h: geo.h, vw: geo.vw, vh: geo.vh, x: geo.x, y: geo.y }));
  const expectFont = Math.min(geo.vh / DESIGN_W, geo.vw / DESIGN_H);
  check(`rem 基准宽高互换（${geo.htmlFont}，期望≈${expectFont.toFixed(2)}px）`,
    Math.abs(parseFloat(geo.htmlFont) - expectFont) < 0.31, geo.htmlFont);
  check('无纵向溢出（整页不滚动）', geo.docH <= geo.vh + 2, `docH=${geo.docH} vh=${geo.vh}`);

  // 真实坐标点按（验证变换下命中换算）：点首页「开始对局」→ 发牌完成手牌 25 张
  const btn = await page.$('#btn-start');
  const box = await btn.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(3500);
  const st = await page.evaluate(() => ({
    tableShown: !document.getElementById('view-table').hidden,
    cards: document.querySelectorAll('#hand-row .card').length,
    tipGone: !document.getElementById('rotate-tip')
  }));
  check('竖屏点按开局成功（命中经矩阵换算）', st.tableShown && st.cards === 25, JSON.stringify(st));
  check('旋转提示层已移除', st.tipGone);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'portrait-rotated.png') });
  await page.close();

  // 桌面竖窗：不旋转，常规缩放布局
  const d = await browser.newPage();
  await d.setViewport({ width: 900, height: 1440 });
  await d.goto(BASE + '/?_t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  const dGeo = await d.evaluate(() => getComputedStyle(document.getElementById('app')).transform);
  check('桌面竖窗不旋转', dGeo === 'none', dGeo);
  await d.close();
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || await puppeteer.executablePath(),
    args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'],
    timeout: 90000
  });
  try {
    await verifyViewport(browser, 812, 375, 'mobile');   // iPhone X 横屏
    await verifyViewport(browser, 896, 414, 'mobileL');   // iPhone XR 横屏（20:9 一代）
    await verifyViewport(browser, 1180, 820, 'ipad');     // iPad Air 横屏（≈4:3 侧区更高）
    await verifyViewport(browser, 1440, 900, 'desktop');
    await verifyPortraitRotation(browser);                // 竖屏手机整层自动转横
  } finally {
    await browser.close();
  }
  console.log(`\n布局校验: ${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR:', e.message.slice(0, 300)); process.exit(1); });
