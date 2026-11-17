/** Real animation timelines, screen-space landing points, and hand-node continuity. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');
const DIST = path.resolve(__dirname, '../dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

test('三打一：飞牌连续完成、四家落点随横竖屏适配、拿底不重播、手牌可正常埋底', { timeout: 120000 }, async () => {
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

    async function start(width, height, captureService = false) {
      await page.setViewport({ width, height, isMobile: width < 1000, hasTouch: true });
      await page.goto(base, { waitUntil: 'load' });
      if (captureService) await page.evaluate(() => {
        // Legal engine actions set up each dealer; AI is idle while geometry is inspected.
        const startGame = GameCore.GameService.prototype.startGame;
        GameCore.GameService.prototype.startGame = function () { window.testService = this; return startGame.call(this); };
        GameCore.GameService.prototype.tick = () => ({ acted: false });
      });
      await page.click('#btn-enter-sandayi');
      await page.evaluate(() => {
        window.flightCounts = { start: 0, end: 0 };
        ['start', 'end'].forEach((kind) => document.addEventListener('animation' + kind, (e) => {
          if (e.target.matches('#deal-anim-fly .deal-anim__fly')) window.flightCounts[kind]++;
        }));
      });
      await page.click('#btn-start');
    }

    async function checkLanding(selector) {
      const result = await page.$$eval(selector, (flights) => flights.map((flight) => {
        const seat = Number(flight.dataset.seat);
        const target = document.querySelector(['#hand-row', '#seat-1', '#seat-2', '#seat-3'][seat]);
        const animation = flight.getAnimations()[0], time = animation.currentTime;
        animation.pause(); animation.currentTime = animation.effect.getTiming().duration;
        const r = flight.getBoundingClientRect(), t = target.getBoundingClientRect();
        const distance = Math.hypot(r.x + r.width / 2 - t.x - t.width / 2, r.y + r.height / 2 - t.y - t.height / 2);
        const angle = getComputedStyle(flight).getPropertyValue('--flight-angle');
        animation.currentTime = time; animation.play();
        return { seat, distance, angle };
      }));
      assert.ok(result.length > 0);
      for (const r of result) {
        assert.ok(r.distance < 2, '飞牌中心落到真实座位：' + JSON.stringify(r));
        assert.equal(r.angle, ['0deg', '-90deg', '180deg', '90deg'][r.seat]);
      }
    }

    async function chooseDealer(dealer) {
      await page.evaluate((seat) => {
        const service = window.testService;
        for (let i = 0; i < 8 && service.getState().phase === 'BIDDING'; i++) {
          const s = service.getState();
          service.dispatch(s.turnIdx === seat
            ? { type: 'SCORE_BID', playerIdx: seat, score: s.config.sanDaYiBidCap }
            : { type: 'PASS_BID', playerIdx: s.turnIdx });
        }
        window.dispatchEvent(new Event('resize'));
      }, dealer);
      await page.waitForFunction(() => !document.getElementById('grab-anim').hidden);
    }

    for (const [width, height] of [[568, 320], [844, 390], [320, 568], [390, 844], [1280, 720], [1920, 1080]]) {
      await start(width, height);
      await page.waitForSelector('#deal-anim-fly [data-seat="3"]');
      assert.equal(await page.$$eval('#deal-anim-fly .deal-anim__fly', (nodes) => new Set(nodes.map((n) => n.dataset.seat)).size), 4);
      await checkLanding('#deal-anim-fly .deal-anim__fly');
      // A live viewport rotation must update routes without rebuilding flights.
      if (width === 844) {
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
        await checkLanding('#deal-anim-fly .deal-anim__fly');
      }
      await page.tap('#btn-table-lobby');
      assert.equal(await page.$$eval('.deal-anim__fly', (nodes) => nodes.length), 0, '离开时清空飞牌');
    }

    await start(844, 390, true);
    await page.waitForSelector('#hand-row .card');
    const continuity = await page.evaluate(async () => {
      const hand = document.querySelector('#hand-row .card');
      const flight = document.querySelector('#deal-anim-fly').lastElementChild;
      const animation = flight.getAnimations()[0], before = animation.currentTime;
      await new Promise((resolve) => setTimeout(resolve, 160));
      return { sameHand: hand.isConnected, sameFlight: flight.isConnected,
        sameAnimation: flight.getAnimations()[0] === animation, advanced: animation.currentTime > before + 100 };
    });
    assert.deepEqual(continuity, { sameHand: true, sameFlight: true, sameAnimation: true, advanced: true });
    await page.waitForFunction(() => document.getElementById('deal-anim').hidden);
    assert.deepEqual(await page.evaluate(() => flightCounts), { start: 100, end: 100 }, '100 张飞牌各自从起点连续完成一次');
    assert.equal(await page.$$eval('#hand-row .card', (cards) => cards.length), 25);

    // Human dealer: preserve all eight bottom nodes through flights, then exercise the reused hand.
    await chooseDealer(0);
    assert.equal(await page.$$eval('.grab-anim__card--face', (cards) => cards.length), 8);
    await page.evaluate(() => { window.bottomNodes = [...document.querySelectorAll('#grab-anim-cards > div')]; });
    await page.waitForSelector('#grab-anim-fly .deal-anim__fly');
    await checkLanding('#grab-anim-fly .deal-anim__fly');
    assert.equal(await page.evaluate(() => bottomNodes.every((n, i) => document.getElementById('grab-anim-cards').children[i] === n)), true);
    await page.waitForFunction(() => document.getElementById('grab-anim').hidden);
    assert.equal(await page.$$eval('#hand-row .card', (cards) => cards.length), 33);
    await page.click('.bid-bar__option--suit');
    await page.evaluate(() => [...document.querySelectorAll('#hand-row .card')].slice(0, 8).forEach((card) => card.click()));
    assert.equal(await page.$$eval('#hand-row .card--selected', (cards) => cards.length), 8);
    await page.click('.bury-bar__confirm');
    assert.equal(await page.evaluate(() => __probe().phase), 'PLAYING');
    assert.equal(await page.$$eval('#hand-row .card', (cards) => cards.length), 25);
    assert.equal(await page.$$eval('#hand-row .card--selected', (cards) => cards.length), 0);

    // Portrait AI dealer: bottom cards stay private, and redealing cancels the old flight chain.
    await start(390, 844, true);
    await page.waitForFunction(() => document.getElementById('deal-anim').hidden);
    await chooseDealer(1);
    assert.equal(await page.$$eval('.grab-anim__card--face', (cards) => cards.length), 0);
    await page.waitForSelector('#grab-anim-fly .deal-anim__fly');
    await checkLanding('#grab-anim-fly .deal-anim__fly');
    const seed = await page.evaluate(() => __probe().seed);
    await page.tap('#btn-redeal'); await page.tap('#btn-redeal');
    assert.notEqual(await page.evaluate(() => __probe().seed), seed);
    await page.waitForFunction(() => document.getElementById('deal-anim').hidden);
    assert.equal(await page.$$eval('#grab-anim-fly > *', (cards) => cards.length), 0);
    assert.equal(await page.$$eval('#hand-row .card', (cards) => cards.length), 25);

    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await start(844, 390, true);
    await page.waitForSelector('#deal-anim-fly .deal-anim__fly');
    assert.equal(await page.$eval('#deal-anim-fly .deal-anim__fly', (el) => getComputedStyle(el).visibility), 'hidden');
    await page.waitForFunction(() => document.getElementById('deal-anim').hidden);
    assert.equal(await page.$$eval('#hand-row .card', (cards) => cards.length), 25, '减少动态效果仍正常完成发牌');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
