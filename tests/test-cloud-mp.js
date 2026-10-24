/**
 * tests/test-cloud-mp.js —— 小程序云层（utils/cloud.js）全链路测试。
 *
 * 注入假 wx（storage=Map、request=直连 _lib/api.js 真实 handler、login=固定 code），
 * 覆盖：wx 登录降级游客 → 本地档案上云 → 绑定升级 → 满分进榜 → 换设备登录拉回档案 → 离线静默。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

let api, Cloud, storage, keys, stats;

test.before(async () => {
  api = await import('../h5/functions/api/_lib/api.js');
  Cloud = require('../miniprogram/utils/cloud.js');
  storage = require('../miniprogram/storage/adapter.js');
  keys = require('../miniprogram/storage/keys.js');
  stats = require('../miniprogram/services/stats.js');
});

/** 造一个假 wx：本地 storage=独立 Map，网络=直连共享后端 env 的真实 handler。 */
function makeFakeWx(env) {
  const store = new Map();
  return {
    _store: store,
    setStorageSync: (k, v) => { store.set(k, v); },
    getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
    removeStorageSync: (k) => { store.delete(k); },
    login: (opts) => { setTimeout(() => opts.success({ code: 'test-code' }), 0); },
    request: (opts) => {
      (async () => {
        try {
          const url = new URL(opts.url);
          const body = opts.data === undefined ? undefined : JSON.stringify(opts.data);
          const req = new Request('http://localhost' + url.pathname, { method: opts.method, headers: Object.assign({}, opts.header), body });
          const r = await api.dispatch(req, env);
          const text = await r.text();
          setTimeout(() => opts.success({ statusCode: r.status, data: JSON.parse(text || 'null') }), 0);
        } catch (e) {
          setTimeout(() => opts.fail && opts.fail(e), 0);
        }
      })();
    }
  };
}

function freshBackend() {
  const kvMap = new Map();
  return {
    KV: {
      get: async (k) => (kvMap.has(k) ? kvMap.get(k) : null),
      put: async (k, v) => { kvMap.set(k, String(v)); },
      delete: async (k) => { kvMap.delete(k); }
    },
    AUTH_SECRET: 'test-secret'
  };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

test('小程序云层全链路：降级游客 → 上云 → 绑定 → 满分进榜 → 换设备登录拉回', async () => {
  const backend = freshBackend();
  const fakeWx = makeFakeWx(backend);
  global.wx = fakeWx; // cloud.js 惰性取 global wx
  Cloud._test.reset();
  Cloud._test.setBase('http://localhost');

  // 预置本地数据（老玩家装新版）：战绩 2 局 + 满分 2 次
  storage.set(keys.STORAGE_KEYS.STATS, stats.appendRecord([], { roundNo: 1, myTeamWon: true }));
  storage.set(keys.STORAGE_KEYS.STATS, stats.appendRecord(storage.get(keys.STORAGE_KEYS.STATS), { roundNo: 2, myTeamWon: false }));
  fakeWx.setStorageSync('tractor:maxBids', '2');

  Cloud.init();
  await sleep(50); // wx.login 异步 → /auth/wx 501（未配 WX_APPID）→ 降级 /auth/guest
  assert.strictEqual(Cloud.state(), 'guest', 'wx 接口未配 → 降级游客建档');
  assert.ok(Cloud.uid().startsWith('u'));
  assert.ok(String(fakeWx.getStorageSync('cloud:token')).includes('.'), 'token 已落 wx storage');

  // 本地有旧数据：flush 后应整体上云
  await Cloud.flush();
  await sleep(30);
  const save = JSON.parse(await backend.KV.get('save:' + Cloud.uid()));
  assert.ok(save.data['tractor:stats'], '战绩原始字符串已上云');
  assert.strictEqual(save.data['tractor:maxBids'], '2');

  // 满分榜：lb 汇总带 maxBids=2
  const lb = JSON.parse(await backend.KV.get('lb:global'));
  assert.strictEqual(lb[0].maxBids, 2);
  assert.strictEqual(lb[0].uid, Cloud.uid());

  // 游客升级正式账号
  const u = await Cloud.bind('小程序玩家', 'pass1234');
  assert.strictEqual(u.name, '小程序玩家');
  assert.strictEqual(Cloud.state(), 'user');

  // 排行榜拉取（公开接口）
  const list = await Cloud.leaderboard();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].uid, Cloud.uid());

  // 换设备：新 wx storage（空），同后端登录同名账号 → 服务端档案合并回本地
  const fakeWx2 = makeFakeWx(backend);
  global.wx = fakeWx2;
  Cloud._test.reset();
  Cloud._test.setBase('http://localhost');
  await Cloud.login('小程序玩家', 'pass1234');
  await sleep(30);
  assert.strictEqual(Cloud.state(), 'user');
  const localStats = storage.get(keys.STORAGE_KEYS.STATS);
  assert.ok(Array.isArray(localStats), '远端档案合并回本地 storage');
  assert.strictEqual(String(fakeWx2.getStorageSync('tractor:maxBids')), '2', '报满计数随档案找回');
});

test('离线全静默：wx.request 失败不抛错、状态保持 off', async () => {
  const fakeWx = makeFakeWx(freshBackend());
  fakeWx.request = (opts) => { setTimeout(() => opts.fail && opts.fail(new Error('offline')), 0); };
  global.wx = fakeWx;
  Cloud._test.reset();
  Cloud._test.setBase('http://localhost');
  Cloud.init();
  await Cloud.flush(); // 不应抛
  await sleep(30);
  assert.strictEqual(Cloud.state(), 'off');
});

test.after(() => { delete global.wx; });
