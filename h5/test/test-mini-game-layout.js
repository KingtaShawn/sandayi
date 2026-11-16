/** Real-browser regression for viewport fitting. Run npm run test:h5:layout after building. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');
const DIST = path.resolve(__dirname, '../dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const SIZES = [[320, 480], [320, 568], [360, 540], [375, 667], [390, 844], [430, 932], [568, 320], [667, 375], [844, 390], [768, 1024], [1024, 768], [1280, 720], [1920, 1080]];

test('弹球和数独：横竖屏、窗口缩放、长状态文案时棋盘及全部操作均在一屏内', { timeout: 120000 }, async () => {
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
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(base, { waitUntil: 'load' });

    async function check(game, width, height) {
      const geometry = await page.evaluate((name) => {
        const root = document.getElementById('view-' + name), board = document.getElementById(name === 'sudoku' ? 'sudoku-board' : 'breakout-canvas');
        const field = board.getBoundingClientRect();
        const controls = [...root.querySelectorAll('button, select')].filter((el) => !el.closest('.arcade-dialog'));
        const missing = controls.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width <= 0 || r.height <= 0 || r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
        }).map((el) => el.id || el.getAttribute('aria-label'));
        // A control can fit geometrically and still be clipped or covered by another element.
        const covered = controls.filter((el) => {
          if (el.disabled || el.closest('.sudoku-board')) return false;
          const r = el.getBoundingClientRect(), at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !at || !el.contains(at);
        }).map((el) => el.id || el.textContent);
        return { width: root.clientWidth, height: root.clientHeight, contentWidth: root.scrollWidth, contentHeight: root.scrollHeight,
          scroll: root.scrollTop, missing, covered, field: { width: field.width, height: field.height, top: field.top, bottom: field.bottom, left: field.left, right: field.right },
          canvasPixels: name === 'breakout' ? board.getContext('2d').getImageData(0, 0, 1, 1).data[3] : null };
      }, game);
      const label = `${game} ${width}×${height}: ${JSON.stringify(geometry)}`;
      assert.ok(geometry.contentHeight <= geometry.height + 1 && geometry.contentWidth <= geometry.width + 1, label);
      assert.equal(geometry.scroll, 0, label); assert.deepEqual(geometry.missing, [], label); assert.deepEqual(geometry.covered, [], label);
      assert.ok(geometry.field.top >= -1 && geometry.field.bottom <= height + 1 && geometry.field.left >= -1 && geometry.field.right <= width + 1, label);
      assert.ok(geometry.field.width >= (game === 'sudoku' ? 180 : 150), '场地保持可用大小：' + label);
      assert.ok(Math.abs(geometry.field.width / geometry.field.height - (game === 'sudoku' ? 1 : .75)) < .01, label);
      if (game === 'breakout') assert.ok(geometry.canvasPixels > 0, 'Canvas 已绘制');
    }

    for (const game of ['sudoku', 'breakout']) {
      await page.click('#btn-enter-' + game);
      for (const [width, height] of SIZES) {
        // Keep one live game while resizing, including portrait ↔ landscape changes.
        await page.setViewport({ width, height, isMobile: true, hasTouch: true });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await check(game, width, height);
        const status = await page.$eval('#' + game + '-status', (el) => el.textContent);
        await page.$eval('#' + game + '-status', (el) => { el.textContent = '完成！用时 123:45，使用 12 次提示。可以换一题继续挑战。'; });
        await check(game, width, height);
        await page.$eval('#' + game + '-status', (el, text) => { el.textContent = text; }, status);
      }
      await page.setViewport({ width: 320, height: 480, isMobile: true, hasTouch: true });
      if (game === 'sudoku') {
        await page.click('#sudoku-board .sudoku-cell:not(.is-given)'); await page.click('#sudoku-pencil');
        await page.click('#sudoku-digits button:last-child');
        assert.equal(await page.$eval('#sudoku-board .is-selected .sudoku-notes', (el) => el.textContent), '9');
        await page.click('#sudoku-hint'); assert.equal(await page.$eval('#sudoku-hints', (el) => el.textContent), '1');
      } else {
        await page.click('#breakout-action'); assert.equal(await page.$eval('#breakout-action', (el) => el.textContent), '暂停');
        await page.click('#breakout-action'); assert.equal(await page.$eval('#breakout-action', (el) => el.textContent), '继续游戏');
      }
      await check(game, 320, 480); await page.click('#' + game + '-home');
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
