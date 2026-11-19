// 本地站点模拟 Cloudflare 接口，覆盖真实 IndexedDB、断网、刷新补传和分享入口。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');

// 在浏览器内观察待传记录，避免读取测试本身创建数据库。
async function replayStores() {
  if (!(await indexedDB.databases()).some(db => db.name === 'sandayi-replays')) return {};
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sandayi-replays');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction([...db.objectStoreNames]);
      const rows = {};
      for (const name of db.objectStoreNames) {
        const keys = tx.objectStore(name).getAllKeys();
        keys.onsuccess = () => { rows[name] = keys.result.map(key => Array.isArray(key) ? key[1] : key).sort(); };
      }
      tx.oncomplete = () => { db.close(); resolve(rows); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

async function seedOldQueue(round) {
  const owner = Cloud.uid();
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('sandayi-replays', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      const archive = db.createObjectStore('rounds', { keyPath: 'id' });
      for (const id of ['old-private', 'old-closed-page']) archive.put({ ...round, id });
      const stages = db.createObjectStore('unfinished', { keyPath: ['owner', 'id'] });
      stages.createIndex('owner', 'owner');
      stages.put({ owner, id: 'old-closed-page', page: 'previous-page' });
      const pending = db.createObjectStore('pending', { keyPath: ['owner', 'id'] });
      pending.createIndex('owner', 'owner');
      pending.put({ owner, id: 'old-pending', round: { ...round, id: 'old-pending' } });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  localStorage.setItem('sandayi:upload-replays:' + owner, 'on');
}

test('云牌谱：断网补传、确认后清理、旧版升级和公开查询', async () => {
  const { dispatch } = await import('../functions/api/_lib/api.js');
  const data = new Map();
  const env = { AUTH_SECRET: 'local-test', KV: {
    get: async k => data.get(k) || null, put: async (k, v) => data.set(k, v), delete: async k => data.delete(k),
    list: async ({ prefix }) => ({ keys: [...data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true })
  } };
  let base, offline = true, failures = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    if (url.pathname.startsWith('/api/')) {
      if (offline && req.method === 'PUT' && url.pathname === '/api/replays') {
        failures++; res.writeHead(503); res.end(); return;
      }
      const parts = []; for await (const part of req) parts.push(part);
      const response = await dispatch(new Request(url, { method: req.method, headers: req.headers,
        body: parts.length ? Buffer.concat(parts) : undefined }), env);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    const file = path.join(__dirname, '../dist', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream');
    if (url.pathname === '/js/cloud.js') res.end(fs.readFileSync(file, 'utf8').replaceAll('https://sandayi.pages.dev', base));
    else fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.exposeFunction('readReplayStores', () => page.evaluate(replayStores));
    await page.setRequestInterception(true);
    page.on('request', req => req.url().startsWith(base + '/') ? req.continue() : req.abort());
    await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
    await page.goto(base);
    await page.waitForFunction(() => !!Cloud.uid());
    await page.evaluate(async () => {
      await RoundArchive.save({ id: 'disabled-deal', phase: 'BIDDING' });
      await RoundArchive.finish({ id: 'disabled-deal' });
    });
    assert.deepEqual(await page.evaluate(replayStores), {});
    assert.equal(await page.$('#btn-export-replays, #replay-share'), null);
    await page.click('#btn-enter-sandayi'); await page.click('#btn-replay-settings');
    assert.equal(await page.$eval('#replay-auto', el => el.checked), false);
    await page.click('#replay-auto'); await page.click('#replay-close'); await page.click('#btn-start');
    await page.waitForFunction(async () => (await window.readReplayStores()).unfinished?.length === 1);
    const [id] = (await page.evaluate(replayStores)).unfinished;
    await page.click('#btn-redeal'); await page.click('#btn-redeal');
    await page.waitForFunction(() => RoundArchive.status().includes('重试'));
    assert.ok(failures > 0);
    await page.waitForFunction(async () => (await window.readReplayStores()).unfinished?.length === 1);
    const queue = await page.evaluate(replayStores);
    assert.deepEqual(queue.pending, [id]);
    assert.equal(queue.rounds, undefined);
    const localIds = [...queue.pending, ...queue.unfinished].sort();
    offline = false;
    await page.reload();
    await page.waitForFunction(() => RoundArchive.status().includes('已上传'));
    await page.click('#btn-enter-sandayi'); await page.click('#btn-replay-settings');
    assert.equal(await page.$eval('#replay-revoke', el => el.hidden), true);
    // 模拟旧版签发过的链接，新界面只在此时显示撤销入口。
    const link = await page.evaluate(async () => (await Cloud.replayRequest(Cloud.uid(), 'POST')).url);
    await page.click('#replay-close'); await page.click('#btn-replay-settings');
    await page.waitForSelector('#replay-revoke', { visible: true });
    await page.waitForFunction(async url => (await (await fetch(url)).json()).rounds.length === 2, {}, link);
    const result = await (await fetch(link)).json();
    assert.deepEqual(result.rounds.map(r => r.id).sort(), localIds);
    assert.equal(result.rounds[0].initial.bottomCards.length, 8);
    await page.waitForFunction(async () => !(await window.readReplayStores()).pending.length);
    assert.deepEqual(await page.evaluate(replayStores), { pending: [], unfinished: [] });
    await page.click('#replay-revoke'); await page.waitForSelector('#replay-revoke[hidden]');
    assert.equal((await fetch(link)).status, 403);
    // 旧牌谱已经上传。绑定账号名后由本人公开，匿名访问者即可按名读取。
    await page.evaluate(() => Cloud.bind('华哥', 'test-local-password'));
    const publicUrl = base + '/api/replays?name=' + encodeURIComponent('华哥');
    assert.equal((await fetch(publicUrl)).status, 404);
    await page.waitForSelector('#replay-public:enabled');
    await page.click('#replay-public');
    await page.waitForFunction(() => { const b = document.querySelector('#replay-public'); return b.checked && !b.disabled; });
    assert.deepEqual((await (await fetch(publicUrl)).json()).rounds.map(r => r.id).sort(), localIds);
    const guestPage = await browser.createBrowserContext();
    try {
      const visitor = await guestPage.newPage();
      await visitor.setRequestInterception(true);
      visitor.on('request', r => r.url().startsWith(base + '/') && !r.url().includes('/api/auth/') ? r.continue() : r.abort());
      await visitor.goto(base); await visitor.click('#btn-enter-sandayi'); await visitor.click('#btn-replay-settings');
      await visitor.click('#public-browse'); await visitor.type('#public-name', '华哥'); await visitor.click('#public-search button');
      await visitor.waitForFunction(() => document.querySelectorAll('#public-rounds details').length === 2);
    } finally { await guestPage.close(); }
    await page.click('#replay-public');
    await page.waitForFunction(() => { const b = document.querySelector('#replay-public'); return !b.checked && !b.disabled; });
    assert.equal((await fetch(publicUrl)).status, 404);
    const upgrade = await browser.createBrowserContext();
    try {
      const oldPage = await upgrade.newPage();
      await oldPage.setRequestInterception(true);
      oldPage.on('request', r => r.url().startsWith(base + '/') ? r.continue() : r.abort());
      await oldPage.goto(base); await oldPage.waitForFunction(() => !!Cloud.uid());
      await oldPage.evaluate(seedOldQueue, result.rounds[0]);
      await oldPage.reload(); await oldPage.waitForFunction(() => !!Cloud.uid());
      const oldLink = await oldPage.evaluate(async () => (await Cloud.replayRequest(Cloud.uid(), 'POST')).url);
      await oldPage.waitForFunction(async url => (await (await fetch(url)).json()).rounds.length === 2, {}, oldLink);
      const migrated = await (await fetch(oldLink)).json();
      assert.deepEqual(migrated.rounds.map(r => r.id).sort(), ['old-closed-page', 'old-pending']);
      assert.deepEqual((await oldPage.evaluate(replayStores)).rounds, ['old-closed-page', 'old-private']);
    } finally { await upgrade.close(); }
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(r => server.close(r));
  }
});
