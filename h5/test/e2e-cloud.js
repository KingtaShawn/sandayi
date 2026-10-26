/**
 * h5/test/e2e-cloud.js —— 云账号功能冒烟（chrome-headless-shell）。
 * 用法：先 node h5/serve.js 8930，另开终端 node h5/test/e2e-cloud.js
 * 覆盖：页面正常启动 → 游客无感建档 → 升级正式账号 → 状态行/弹层联动 → 游戏可开局。
 */

'use strict';

const puppeteer = require('puppeteer');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8930'; // E2E_BASE 指向替换服务器（如 HEAD 版 bundle 验证）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'shell' }); // chrome-headless-shell（本机无整装 Chrome）
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1600 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // cloud.js 的 CLOUD_BASE 指向线上后端；e2e 必须打本地 serve.js —— 拦截跨域 /api 请求改写回来
    await page.setRequestInterception(true);
    const remoteApi = /^https?:\/\/(?!127\.0\.0\.1|localhost)[^/]+(\/api\/.*)$/;
    page.on('request', (req) => {
      const m = remoteApi.exec(req.url());
      if (m) return req.continue({ url: BASE + m[1] });
      req.continue();
    });

    await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
    await sleep(1200); // 游客建档是异步的，等云层落定

    check('页面无脚本错误', errors.length === 0, errors.join(' | '));
    check('无错误红条', !(await page.$('#err-bar')));

    // 游客无感建档
    const state0 = await page.$eval('#cloud-state', (el) => el.textContent);
    check('游客自动建档（状态行=游客存档）', state0.includes('游客'), state0);
    const token = await page.evaluate(() => localStorage.getItem('cloud:token'));
    check('token 已落 localStorage', !!token && token.includes('.'));

    // 打开账号弹层 → 升级
    await page.click('#btn-cloud');
    await sleep(200);
    check('弹层打开', !(await page.$eval('#cloud-modal', (el) => el.hidden)));
    const hasBind = await page.$eval('#btn-cloud-bind', (el) => !el.hidden);
    check('游客态显示"升级为正式账号"按钮', hasBind);
    await page.type('#cloud-name', '冒烟' + Date.now().toString(36).slice(-4));
    await page.type('#cloud-pass', 'pass1234');
    await page.type('#cloud-pass2', 'pass1234');
    await page.click('#btn-cloud-bind');
    await sleep(800);
    check('升级后弹层自动关闭', await page.$eval('#cloud-modal', (el) => el.hidden));
    const state1 = await page.$eval('#cloud-state', (el) => el.textContent);
    check('状态行变为已同步', state1.includes('已同步'), state1);

    // 重载后登录态恢复：状态行必须仍是已同步（回归：init 恢复分支曾不通知 UI，首页一直"未连接"）
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    const stateR = await page.$eval('#cloud-state', (el) => el.textContent);
    check('重载后登录态保持（状态行仍已同步）', stateR.includes('已同步'), stateR);
    const tokenR = await page.evaluate(() => localStorage.getItem('cloud:token'));
    check('重载后 token 仍在', !!tokenR && tokenR.includes('.'));

    // 云端档案应已就位（.dev-kv.json）
    const pushed = await page.evaluate(async () => {
      const t = localStorage.getItem('cloud:token');
      const r = await fetch('/api/sync', { headers: { Authorization: 'Bearer ' + t } });
      const j = await r.json();
      return !!(j.save && j.save.data);
    });
    check('云端档案可拉取', pushed);

    // 排行榜（满分庄家榜）：弹层可开、空榜文案正确
    await page.click('#btn-leaderboard');
    await sleep(300);
    check('排行榜弹层打开', !(await page.$eval('#lb-modal', (el) => el.hidden)));
    const lbEmpty = await page.$eval('#lb-list', (el) => el.textContent);
    check('空榜显示引导文案', lbEmpty.includes('满分'), lbEmpty);
    await page.click('#btn-lb-close');

    // 升级后游戏照常可开局（云层不破坏主流程）
    await page.click('#btn-start');
    await sleep(500);
    check('开始对局正常', !(await page.$eval('#view-table', (el) => el.hidden)));
    check('全程无脚本错误', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
  console.log(`== 云账号冒烟：${passed} 过 ${failed} 挂 ==`);
  process.exit(failed ? 1 : 0);
})();
