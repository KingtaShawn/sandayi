/** Real touch hit-testing: DOM .click() cannot detect another game covering a button. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');
const DIST = path.resolve(__dirname, '../dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

test('三打一：手机横竖屏及桌面工具栏可触达，发牌中和发牌后均可确认重发', { timeout: 120000 }, async () => {
  assert.ok(fs.existsSync(path.join(DIST, 'index.html')), '先运行 npm run build:h5');
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(DIST, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    const executablePath = process.env.CHROME_BIN || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', (r) => r.url().startsWith(base) ? r.continue() : r.abort());

    async function checkTools(label) {
      const covered = await page.evaluate(() => [...document.querySelectorAll('.table__tools button')].flatMap((button) => {
        const r = button.getBoundingClientRect();
        // Centre and inset corners must all belong to the visible button.
        return [[.5, .5], [.15, .15], [.85, .85]].flatMap(([x, y]) => {
          const hit = document.elementFromPoint(r.x + r.width * x, r.y + r.height * y);
          return button.contains(hit) ? [] : [`${button.id} 被 ${hit && (hit.id || hit.className)} 遮挡`];
        });
      }));
      assert.deepEqual(covered, [], label);
    }

    async function redeal(label) {
      await checkTools(label);
      const seed = await page.evaluate(() => window.__probe().seed);
      const point = await page.$eval('#btn-redeal', (button) => {
        const r = button.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.touchscreen.tap(point.x, point.y);
      assert.equal(await page.$eval('#btn-redeal', (b) => b.textContent), '确认重发', label);
      assert.equal(await page.evaluate(() => window.__probe().seed), seed, '首点保留当前对局');
      await checkTools(label + ' 确认态');
      await page.touchscreen.tap(point.x, point.y);
      assert.notEqual(await page.evaluate(() => window.__probe().seed), seed, label + ' 同一位置再次触摸确实重发');
      assert.equal(await page.$eval('#btn-redeal', (b) => b.textContent), '重发');
      await page.waitForFunction(() => document.getElementById('deal-anim').hidden && document.querySelectorAll('#hand-row .card').length === 25);
      await checkTools(label + ' 新局');
    }

    for (const [width, height] of [[568, 320], [667, 375], [844, 390], [320, 568], [390, 844], [1280, 720]]) {
      await page.setViewport({ width, height, isMobile: width < 1000, hasTouch: true });
      await page.goto(base, { waitUntil: 'load' });
      await page.click('#btn-enter-sandayi');
      // Capture the empty hand synchronously, before the first deal interval fires.
      const emptyHand = await page.evaluate(() => {
        document.getElementById('btn-start').click();
        return document.getElementById('hand-row').getBoundingClientRect().toJSON();
      });
      const label = `${width}×${height}`;
      assert.equal(await page.$eval('#deal-anim', (el) => el.hidden), false);
      await page.waitForSelector('#hand-row .card');
      const firstCard = await page.$eval('#hand-row', (el) => el.getBoundingClientRect().toJSON());
      assert.ok(Math.abs(emptyHand.width - firstCard.width) < 1 && Math.abs(emptyHand.height - firstCard.height) < 1, label + ' 首张牌不挤动工具栏');
      await redeal(label + ' 发牌中');
      await redeal(label + ' 发牌后');
      await page.tap('#btn-history');
      assert.equal(await page.$eval('#history-modal', (el) => el.hidden), false);
      await page.tap('#btn-history-close'); await page.tap('#btn-table-lobby');
      assert.equal(await page.$eval('#view-lobby', (el) => el.hidden), false);
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
