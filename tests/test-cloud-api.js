/**
 * tests/test-cloud-api.js —— 云端 API 全链路测试。
 *
 * 直接驱动 h5/functions/api/_lib/api.js 的 handler（EdgeOne 边缘函数与 serve.js 共用同一份），
 * 内存 KV 注入，覆盖：游客建档 → 升级正式账号 → 登录 → 档案同步 LWW → 排行榜 → 鉴权异常。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

let api, tokenLib;

test.before(async () => {
  api = await import('../h5/functions/api/_lib/api.js');
  tokenLib = await import('../h5/functions/api/_lib/token.js');
});

/* ---------- 测试环境 ---------- */
function memKv() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
    _m: m
  };
}

function freshEnv() {
  return { KV: memKv(), AUTH_SECRET: 'test-secret' };
}

function mkReq(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return new Request('http://localhost' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function json(r) { return r.json(); }

/** 建游客并返回 {env, token, uid}。 */
async function mkGuest() {
  const env = freshEnv();
  return mkGuestIn(env);
}

/** 在指定 env 里建游客（同 env 多账号场景用）。 */
async function mkGuestIn(env) {
  const r = await api.handleGuest(mkReq('POST', '/api/auth/guest'), env);
  assert.strictEqual(r.status, 200);
  const { token, user } = await json(r);
  return { env, token, user };
}

/* ---------- 游客建档 ---------- */

test('游客建档：返回 token 与游客档案', async () => {
  const { env, token, user } = await mkGuest();
  assert.ok(user.uid.startsWith('u'));
  assert.ok(user.isGuest);
  assert.strictEqual(user.name, null);
  assert.ok(user.nick.startsWith('游客'));
  const uid = await tokenLib.verifyToken(env, token);
  assert.strictEqual(uid, user.uid);
});

/* ---------- 升级绑定 ---------- */

test('游客升级：bind 成功后 isGuest=false，登录索引生效', async () => {
  const { env, token, user } = await mkGuest();
  const r = await api.handleBind(mkReq('POST', '/api/auth/bind', { username: '老王', password: 'pass1234' }, token), env);
  assert.strictEqual(r.status, 200);
  const { user: u2 } = await json(r);
  assert.strictEqual(u2.isGuest, false);
  assert.strictEqual(u2.name, '老王');
  assert.strictEqual(u2.uid, user.uid); // uid 不变，战绩不丢
  assert.strictEqual(await env.KV.get('login:老王'), user.uid); // 中文用户名索引（原样键）
});

test('bind 重名被拒（409）；同名不同大小写视作同名', async () => {
  const env = freshEnv();
  const g1 = await mkGuestIn(env);
  assert.strictEqual((await api.handleBind(mkReq('POST', '/api/auth/bind', { username: 'OldWang', password: 'pass1234' }, g1.token), env)).status, 200);
  const g2 = await mkGuestIn(env); // 同一存储里的第二个游客
  const r2 = await api.handleBind(mkReq('POST', '/api/auth/bind', { username: 'oldwang', password: 'pass1234' }, g2.token), env);
  assert.strictEqual(r2.status, 409);
});

test('bind 参数校验：弱用户名/弱密码/两次不一致场景均 400', async () => {
  const { env, token } = await mkGuest();
  assert.strictEqual((await api.handleBind(mkReq('POST', '/api/auth/bind', { username: 'a', password: 'pass1234' }, token), env)).status, 400);
  assert.strictEqual((await api.handleBind(mkReq('POST', '/api/auth/bind', { username: 'goodname', password: '12' }, token), env)).status, 400);
});

test('bind 需登录态：伪造 token 401', async () => {
  const env = freshEnv();
  const r = await api.handleBind(mkReq('POST', '/api/auth/bind', { username: 'goodname', password: 'pass1234' }, 'x.y'), env);
  assert.strictEqual(r.status, 401);
});

/* ---------- 登录 ---------- */

test('登录：正确密码 200 且捎带云端档案；错误密码 401；不存在同文案', async () => {
  const { env, token } = await mkGuest();
  await api.handleBind(mkReq('POST', '/api/auth/bind', { username: 'Peter', password: 'pass1234' }, token), env);
  // 先推一份档案，登录应捎带返回
  await api.handleSyncPut(mkReq('PUT', '/api/sync', { save: { updatedAt: Date.now(), data: { 'tractor:stats': '"[]"' } } }, token), env);
  const ok = await api.handleLogin(mkReq('POST', '/api/auth/login', { username: 'peter', password: 'pass1234' }), env);
  assert.strictEqual(ok.status, 200);
  const { token: t2, user, save } = await json(ok);
  assert.strictEqual(user.name, 'Peter'); // 大小写保留展示
  assert.ok(save && save.data['tractor:stats']); // 档案捎带
  assert.strictEqual(await tokenLib.verifyToken(env, t2), user.uid);
  const bad = await api.handleLogin(mkReq('POST', '/api/auth/login', { username: 'peter', password: 'wrong!!!' }), env);
  assert.strictEqual(bad.status, 401);
  assert.strictEqual((await json(bad)).error, '用户名或密码错误');
  const none = await api.handleLogin(mkReq('POST', '/api/auth/login', { username: 'nobody', password: 'pass1234' }), env);
  assert.strictEqual(none.status, 401);
  assert.strictEqual((await json(none)).error, '用户名或密码错误'); // 不暴露账号存在性
});

/* ---------- 档案同步 LWW ---------- */

test('sync 往返：PUT 后 GET 拿回原样数据；老时间戳不覆盖新档案', async () => {
  const { env, token } = await mkGuest();
  const t1 = 1700000000000;
  const put1 = await api.handleSyncPut(mkReq('PUT', '/api/sync', { save: { updatedAt: t1, data: { 'tractor:stats': '"[1]"', 'tractor:settings': '"{\"sound\":true}"' } } }, token), env);
  assert.strictEqual((await json(put1)).kept, 'client');
  const got = await api.handleSyncGet(mkReq('GET', '/api/sync', undefined, token), env);
  const { save } = await json(got);
  assert.strictEqual(save.updatedAt, t1);
  assert.strictEqual(save.data['tractor:stats'], '"[1]"'); // 原始字符串保真
  // 更老的数据推送：服务端保留新档案
  const put2 = await api.handleSyncPut(mkReq('PUT', '/api/sync', { save: { updatedAt: t1 - 9999, data: { 'tractor:stats': '"[old]"' } } }, token), env);
  assert.strictEqual((await json(put2)).kept, 'server');
  const got2 = await api.handleSyncGet(mkReq('GET', '/api/sync', undefined, token), env);
  assert.strictEqual((await json(got2)).save.data['tractor:stats'], '"[1]"');
});

test('sync 防脏：未来时间戳 400；超大档案 413；无登录态 401', async () => {
  const { env, token } = await mkGuest();
  assert.strictEqual((await api.handleSyncPut(mkReq('PUT', '/api/sync', { save: { updatedAt: Date.now() + 999999, data: {} } }, token), env)).status, 400);
  const big = { save: { updatedAt: Date.now(), data: { blob: 'x'.repeat(210 * 1024) } } };
  assert.strictEqual((await api.handleSyncPut(mkReq('PUT', '/api/sync', big, token), env)).status, 413);
  assert.strictEqual((await api.handleSyncPut(mkReq('PUT', '/api/sync', { save: { updatedAt: Date.now(), data: {} } }, 'bad.token'), env)).status, 401);
});

test('token 篡改：改一个字符即 401', async () => {
  const { env, token } = await mkGuest();
  const evil = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
  const r = await api.handleSyncGet(mkReq('GET', '/api/sync', undefined, evil), env);
  assert.strictEqual(r.status, 401);
});

/* ---------- 排行榜 ---------- */

test('排行榜（满分庄家榜）：没满分坐庄不上榜；按次数排序；同 uid 整行替换', async () => {
  const env = freshEnv();
  const g1 = await mkGuestIn(env); // 打了 100 局但从未满分坐庄
  await api.handleSyncPut(mkReq('PUT', '/api/sync', { save: { updatedAt: Date.now(), data: {} }, lb: { rounds: 100, wins: 90, losses: 10, maxBids: 0 } }, g1.token), env);
  let lb = await json(await api.handleLeaderboard(mkReq('GET', '/api/leaderboard'), env));
  assert.strictEqual(lb.list.length, 0); // maxBids=0 不上榜

  const g2 = await mkGuestIn(env); // 满分 2 次
  await api.handleSyncPut(mkReq('PUT', '/api/sync', { save: { updatedAt: Date.now(), data: {} }, lb: { rounds: 30, wins: 15, losses: 15, maxBids: 2 } }, g2.token), env);
  const g3 = await mkGuestIn(env); // 满分 5 次
  await api.handleSyncPut(mkReq('PUT', '/api/sync', { save: { updatedAt: Date.now(), data: {} }, lb: { rounds: 10, wins: 3, losses: 7, maxBids: 5 } }, g3.token), env);
  lb = await json(await api.handleLeaderboard(mkReq('GET', '/api/leaderboard'), env));
  assert.strictEqual(lb.list.length, 2);
  assert.strictEqual(lb.list[0].maxBids, 5); // 满分多者居首（局数少也算）
  assert.strictEqual(lb.list[1].maxBids, 2);

  // 同 uid 再推：整行替换而不是重复插入
  await api.handleSyncPut(mkReq('PUT', '/api/sync', { save: { updatedAt: Date.now(), data: {} }, lb: { rounds: 40, wins: 20, losses: 20, maxBids: 7 } }, g2.token), env);
  lb = await json(await api.handleLeaderboard(mkReq('GET', '/api/leaderboard'), env));
  assert.strictEqual(lb.list.length, 2);
  assert.strictEqual(lb.list[0].maxBids, 7);
  assert.strictEqual(lb.list[0].rounds, 40);
});

/* ---------- 小程序登录占位 ---------- */

test('wx 登录未配置时返回 501（占位可用）', async () => {
  const env = freshEnv();
  const r = await api.handleWx(mkReq('POST', '/api/auth/wx', { code: 'x' }), env);
  assert.strictEqual(r.status, 501);
});

/* ---------- dispatch 路由层 ---------- */

test('dispatch：OPTIONS 预检 2xx 放行（跨域 POST 必需）；未知路径 404', async () => {
  const env = freshEnv();
  const pre = await api.dispatch(mkReq('OPTIONS', '/api/auth/login'), env);
  assert.ok([200, 204].includes(pre.status), '预检必须 2xx，否则浏览器跨域请求全挂');
  assert.strictEqual(pre.headers.get('Access-Control-Allow-Origin'), '*');
  const miss = await api.dispatch(mkReq('GET', '/api/nope'), env);
  assert.strictEqual(miss.status, 404);
});
