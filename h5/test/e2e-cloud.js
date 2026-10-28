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

    // 预置老战绩（1 局满分坐庄 + 1 局普通胜）且无计数键：启动应自动回填满分坐庄 1 次。
    // 双重 stringify 与 h5 wx shim（setStorageSync 再包一层）写出的存档形态一致
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('tractor:stats', JSON.stringify(JSON.stringify([
        { roundNo: 1, myTeamWon: true, passedA: false, attackPoints: 0, tricksCount: 20 },
        { roundNo: 2, myTeamWon: true, passedA: false, attackPoints: 65, tricksCount: 25 }
      ])));
      localStorage.removeItem('tractor:maxBids');
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

    // 老战绩回填：boot 时同步跑完，普通胜（对方 65 分）不计数，只有满分坐庄那局算
    const mb = await page.evaluate(() => localStorage.getItem('tractor:maxBids'));
    check('老战绩回填满分坐庄 1 次', mb === '1', String(mb));

    // 打开账号弹层 → 升级
    await page.click('#btn-cloud');
    await sleep(200);
    check('弹层打开', !(await page.$eval('#cloud-modal', (el) => el.hidden)));
    const bindHidden = await page.$eval('#btn-cloud-bind', (el) => el.hidden);
    const pass2Hidden = await page.$eval('#cloud-pass2', (el) => el.hidden);
    check('默认登录视图（升级按钮与确认密码都隐藏）', bindHidden && pass2Hidden);
    await page.type('#cloud-name', '华'); // 1 位用户名：必须弹层内红字提示，不能"没反应"
    await page.type('#cloud-pass', 'pass1234');
    await page.click('#btn-cloud-login');
    await sleep(150);
    const errText = await page.$eval('#cloud-err', (el) => (el.hidden ? '' : el.textContent));
    check('1位用户名点登录→弹层内红字提示', errText.includes('2~16'), errText);
    await page.click('#btn-cloud-close'); // 关掉重开：输入与红字都应清空
    await page.click('#btn-cloud');
    await sleep(100);
    check('重开弹层后红字已清', await page.$eval('#cloud-err', (el) => el.hidden));
    await page.click('#tab-cloud-bind'); // 游客升级：切到"升级"Tab 才出现确认密码与升级按钮
    await sleep(100);
    check('升级Tab亮起后显示"升级为正式账号"按钮', await page.$eval('#btn-cloud-bind', (el) => !el.hidden));
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
