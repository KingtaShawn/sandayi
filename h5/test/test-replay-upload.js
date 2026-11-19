// 本地站点模拟 Cloudflare 接口，覆盖真实 IndexedDB、断网、刷新补传和分享入口。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');

test('云牌谱：同意后重发自动上传，断网刷新补传，只读链接能取回同一副牌', async () => {
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
    await page.setRequestInterception(true);
    page.on('request', req => req.url().startsWith(base + '/') ? req.continue() : req.abort());
    await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
    await page.goto(base);
    await page.waitForFunction(() => !!Cloud.uid());
    await page.click('#btn-enter-sandayi'); await page.click('#btn-replay-settings');
    assert.equal(await page.$eval('#replay-auto', el => el.checked), false);
    await page.click('#replay-auto'); await page.click('#replay-close'); await page.click('#btn-start');
    await page.waitForFunction(async () => (await RoundArchive.all()).length === 1);
    const id = await page.evaluate(async () => (await RoundArchive.all())[0].id);
    await page.click('#btn-redeal'); await page.click('#btn-redeal');
    await page.waitForFunction(() => RoundArchive.status().includes('重试'));
    assert.ok(failures > 0);
    const localIds = await page.evaluate(async () => (await RoundArchive.all()).map(r => r.id).sort());
    assert.equal(localIds.length, 2);
    assert.ok(localIds.includes(id));
    offline = false;
    await page.reload();
    await page.waitForFunction(() => RoundArchive.status().includes('已上传'));
    await page.click('#btn-enter-sandayi'); await page.click('#btn-replay-settings');
    await page.click('#replay-share'); await page.waitForSelector('#replay-link:not([hidden])');
    const link = await page.$eval('#replay-link', el => el.value);
    await page.waitForFunction(async url => (await (await fetch(url)).json()).rounds.length === 2, {}, link);
    const result = await (await fetch(link)).json();
    assert.deepEqual(result.rounds.map(r => r.id).sort(), localIds);
    assert.equal(result.rounds[0].initial.bottomCards.length, 8);
    await page.click('#replay-revoke'); await page.waitForSelector('#replay-link[hidden]');
    assert.equal((await fetch(link)).status, 403);
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(r => server.close(r));
  }
});
