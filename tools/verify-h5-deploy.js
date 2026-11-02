/** 发布后核对两个入口的版本和资源内容，并检查 Cloudflare API。 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.resolve(__dirname, '../h5/dist');
const ENTRANCES = {
  github: 'https://kingtashawn.github.io/sandayi/',
  cloudflare: 'https://sandayi.pages.dev/'
};
// 单入口发布后独立验收；不带参数时仍检查两个入口是否为同一构建。
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--site'
  && Object.prototype.hasOwnProperty.call(ENTRANCES, args[1])), '用法：node tools/verify-h5-deploy.js [--site github|cloudflare]');
const SITES = args.length ? [ENTRANCES[args[1]]] : Object.values(ENTRANCES);
const ASSETS = ['js/game-bundle.js', 'js/app.js', 'js/cloud.js', 'js/sound.js', 'css/style.css', 'manifest.webmanifest'];
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const version = html.match(/js\/game-bundle\.js\?v=([^"\s]+)/)?.[1];
assert.ok(version && !version.endsWith('-dirty'), '发布产物必须有已提交的版本号');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const expected = new Map(ASSETS.map((file) => [file, hash(fs.readFileSync(path.join(DIST, file)))]));

async function request(url, options = {}) {
  const target = new URL(url);
  target.searchParams.set('_deployCheck', Date.now());
  return fetch(target, { ...options, signal: AbortSignal.timeout(10000), cache: 'no-store' });
}

async function verify() {
  await Promise.all(SITES.map(async (base) => {
    const page = await request(base);
    assert.equal(page.status, 200, `${base} 首页状态`);
    const deployedVersion = (await page.text()).match(/js\/game-bundle\.js\?v=([^"\s]+)/)?.[1];
    assert.equal(deployedVersion, version, `${base} 版本`);
    await Promise.all(ASSETS.map(async (file) => {
      const response = await request(new URL(`${file}?v=${version}`, base));
      assert.equal(response.status, 200, `${base}${file} 状态`);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), expected.get(file), `${base}${file} 内容`);
    }));
  }));

  const leaderboard = await request('https://sandayi.pages.dev/api/leaderboard', {
    headers: { Origin: 'https://kingtashawn.github.io' }
  });
  assert.equal(leaderboard.status, 200, '排行榜 API 状态');
  assert.ok(Array.isArray((await leaderboard.json()).list), '排行榜必须返回 JSON 列表');
  const allowOrigin = leaderboard.headers.get('access-control-allow-origin');
  assert.ok(['*', 'https://kingtashawn.github.io'].includes(allowOrigin), '主入口跨域访问 API');
  const sync = await request('https://sandayi.pages.dev/api/sync');
  assert.equal(sync.status, 401, '存档 API 必须保留鉴权');
  assert.match(sync.headers.get('content-type') || '', /application\/json/, '存档接口必须由 Worker 响应');
}

(async () => {
  // 两家 CDN 的上线时间不同，短暂等待传播；持续不一致则让工作流失败。
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      await verify();
      console.log(`[ok] ${SITES.join(', ')} 均为 ${version}，6 项静态资源哈希一致，排行榜、跨域和存档鉴权正常`);
      return;
    } catch (error) {
      if (attempt === 12) throw error;
      console.log(`[retry ${attempt}/12] ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
