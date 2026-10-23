/**
 * h5/test/e2e-grab-lift.js —— 抓底牌抬高停顿专项冒烟（puppeteer 真浏览器）。
 * 用法：先起服务 node h5/serve.js，再 node h5/test/e2e-grab-lift.js
 * 覆盖：真人叫分成交当庄 → 底牌翻面亮出（show）→ 逐张飞入（fly）→
 *       8 张新牌以 .card--lift 抬起出现（腾讯升级式）→ 4.2s 超时落回（类清零）。
 * 关键帧截图到 h5/test/shots/grab-*.png 供人工复核。
 */
'use strict';

const path = require('path');
const fs = require('fs');
let puppeteer = null;
try { puppeteer = require('puppeteer'); }
catch {
  if (process.env.PUPPETEER_WS) puppeteer = require(path.resolve(process.env.PUPPETEER_WS, 'puppeteer'));
}
if (!puppeteer) { console.error('未找到 puppeteer：项目根目录先 npm i'); process.exit(1); }

const BASE = 'http://127.0.0.1:8930';
const OUT_DIR = path.resolve(__dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}

/** 轮到真人报分时点最高分（成交即真人当庄），直到抓底动画启动 */
async function driveBidding(page) {
  for (let i = 0; i < 240; i++) {
    await sleep(200);
    const s = await page.evaluate(() => {
      const grabActive = !document.getElementById('grab-anim').hidden;
      const opts = Array.from(document.querySelectorAll('.bid-bar__option:not(.bid-bar__pass)'))
        .filter((x) => x.offsetParent !== null); // 可见的
      return {
        grabActive,
        optLabels: opts.map((x) => x.textContent.trim()),
        handLabel: (document.getElementById('hand-label').textContent || '').trim()
      };
    });
    if (s.grabActive) return 'grab';
    if (s.optLabels.length) {
      // 报分选项降序渲染：点第一个 = 当前可报最高分，压住 AI 成交当庄
      await page.evaluate(() => {
        const opts = Array.from(document.querySelectorAll('.bid-bar__option:not(.bid-bar__pass)'))
          .filter((x) => x.offsetParent !== null);
        if (opts.length) opts[0].click();
      });
      console.log(`    · 报分「${s.optLabels[0]}」`);
      await sleep(500);
    }
  }
  return 'timeout';
}

(async () => {
  console.log('== 抓底牌抬高停顿专项冒烟（puppeteer）==');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'shell' }); // chrome-headless-shell（本机无整装 Chrome）
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2 }); // 横屏手机
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });

  await sleep(600);
  await page.click('#btn-start');
  await sleep(4600);
  check('发牌完成 25 张',
    await page.$$eval('#hand-row .card', (n) => n.length) === 25,
    `got ${await page.$$eval('#hand-row .card', (n) => n.length)}`);

  const drove = await driveBidding(page);
  check('抓底动画启动（真人报分成交当庄）', drove === 'grab', `drove=${drove}`);

  // show 阶段：翻面 8 张 + 标签 + 手牌仍 25 张对照
  await sleep(500);
  check('show 翻面 8 张',
    await page.$$eval('#grab-anim .grab-anim__card--face', (n) => n.length) === 8
    && await page.$$eval('#grab-anim .grab-anim__card--face .card', (n) => n.length) === 8);
  check('标签「底牌已翻开」',
    (await page.$eval('#grab-anim-label', (n) => n.textContent.trim())).includes('底牌已翻开'));
  check('停顿期手牌 25 张',
    await page.$$eval('#hand-row .card', (n) => n.length) === 25);
  await page.screenshot({ path: path.join(OUT_DIR, 'grab-show.png') });

  // fly（8×120ms）+ 缓冲 480ms + lift 落定；在 4.2s 窗口内抓拍
  await sleep(2400);
  const midLift = await page.$$eval('#hand-row .card--lift', (n) => n.length);
  await sleep(700);
  const st = await page.evaluate(() => ({
    lift: document.querySelectorAll('#hand-row .card--lift').length,
    hand: document.querySelectorAll('#hand-row .card').length,
    animHidden: document.getElementById('grab-anim').hidden
  }));
  check('飞入完成手牌 33 张', st.hand === 33, `got ${st.hand}`);
  check('8 张新牌抬起（.card--lift）', st.lift === 8, `lift=${st.lift}（中途观测 ${midLift}）`);
  check('动画层关闭', st.animHidden);
  await page.screenshot({ path: path.join(OUT_DIR, 'grab-lift.png') });

  // 4.2s 超时落回：类清零
  await sleep(4600);
  const liftAfter = await page.$$eval('#hand-row .card--lift', (n) => n.length);
  check('超时后抬起牌落回（类清零）', liftAfter === 0, `lift=${liftAfter}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'grab-lift-down.png') });

  console.log(`\n结果：${passed} pass / ${failed} fail`);
  console.log(`截图：${OUT_DIR}/grab-{show,lift,lift-down}.png`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('冒烟异常', e); process.exit(1); });
