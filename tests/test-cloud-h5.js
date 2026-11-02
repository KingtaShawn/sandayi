'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tick = () => new Promise(setImmediate);
const response = (body) => ({ ok: true, status: 200, json: async () => body });

async function client(onFetch, count = 6) {
  const store = new Map([
    ['cloud:token', 'local-test-token'], ['cloud:user', JSON.stringify({ uid: 'test-user', nick: 'test', isGuest: false })],
    ['cloud:localAt', '1000'], ['tractor:maxBids', String(count)]
  ]);
  const timers = new Map();
  let timerId = 0;
  const window = { GameCore: { STORAGE_KEYS: { STATS: 'tractor:stats' }, storage: { get: () => [] },
    stats: { summarize: () => ({ totalRounds: 200, wins: 100, losses: 100 }) } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../h5/js/cloud.js'), 'utf8'), {
    window, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, opts) => {
      if (url.endsWith('/sync') && opts.method === 'GET') return response({ save: { updatedAt: 1000, data: {} } });
      return onFetch(url, opts);
    }
  });
  window.Cloud.init();
  await tick();
  return { cloud: window.Cloud, store };
}

test('H5打开排行榜必须等正在上传的成绩完成，且刷新期间的新成绩也必须上传', async () => {
  const pending = [], seen = [];
  const { cloud, store } = await client(async (url, opts) => {
    seen.push({ url, count: opts.body && JSON.parse(opts.body).lb.maxBids });
    if (opts.method === 'PUT') return new Promise(resolve => pending.push(resolve));
    return response({ list: [{ maxBids: 7 }] });
  });
  const first = cloud.flush();
  await tick();
  store.set('tractor:maxBids', '7');
  const board = cloud.leaderboard();
  await tick();
  assert.equal(seen.some(r => r.url.endsWith('/leaderboard')), false, '不能在6次仍上传时先显示旧榜');
  pending.shift()(response({ kept: 'client', maxBids: 6 }));
  await tick();
  assert.equal(seen[1].count, 7, '应立即补传第7次，而不是再等2.5秒');
  assert.equal(seen.some(r => r.url.endsWith('/leaderboard')), false);
  pending.shift()(response({ kept: 'client', maxBids: 7 }));
  await first;
  assert.equal((await board)[0].maxBids, 7);
});

test('H5保留服务端确认的累计次数，下一次满分从正确基数继续累加', async () => {
  const { cloud, store } = await client(async () => response({ kept: 'client', maxBids: 8 }));
  await cloud.flush();
  assert.equal(store.get('tractor:maxBids'), '8');
});

test('排行榜GET不复用浏览器HTTP缓存', async () => {
  let boardOptions;
  const { cloud } = await client(async (url, opts) => {
    if (url.endsWith('/leaderboard')) { boardOptions = opts; return response({ list: [] }); }
    return response({ kept: 'client', maxBids: 6 });
  });
  await cloud.leaderboard();
  assert.equal(boardOptions.cache, 'no-store');
});

test('KV读取暂时仍是6次时，展示服务器已确认写入的7次', async () => {
  const row = { uid: 'test-user', nick: 'test', maxBids: 7, rounds: 200 };
  const { cloud } = await client(async (url, opts) => opts.method === 'PUT'
    ? response({ kept: 'client', maxBids: 7, leaderboardRow: row })
    : response({ list: [{ ...row, maxBids: 6 }] }), 7);
  assert.equal((await cloud.leaderboard())[0].maxBids, 7);
});

test('同步未成功时不把本地次数当成已经上榜，继续展示服务器返回的次数', async () => {
  const { cloud } = await client(async (url, opts) => {
    if (opts.method === 'PUT') throw new Error('offline');
    return response({ list: [{ uid: 'test-user', maxBids: 6 }] });
  }, 7);
  assert.equal((await cloud.leaderboard())[0].maxBids, 6);
});

test('只等待同一份上传的排行榜刷新不额外重复写入KV', async () => {
  let release, puts = 0;
  const { cloud } = await client(async (url, opts) => {
    if (opts.method === 'PUT') { puts++; return new Promise(resolve => { release = resolve; }); }
    return response({ list: [] });
  });
  const upload = cloud.flush();
  const board = cloud.leaderboard();
  await tick();
  release(response({ kept: 'client', maxBids: 6 }));
  await upload; await board;
  assert.equal(puts, 1);
});
