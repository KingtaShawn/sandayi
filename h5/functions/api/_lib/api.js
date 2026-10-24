/**
 * functions/api/_lib/api.js —— 全部 API handler（框架无关：入参 Request + env，出参 Response）。
 *
 * EdgeOne 边缘函数入口（functions/api/**）与本地 serve.js 共用这一份逻辑，
 * 路由表见底部 ROUTES——两边各写一行转发即可，逻辑永不分叉。
 *
 * 端点一览：
 *   POST /api/auth/guest      建游客账号（无感登录）
 *   POST /api/auth/login      用户名+密码登录（捎带云端档案，省一次往返）
 *   POST /api/auth/bind       游客升级为正式账号（uid 不变，战绩不丢）
 *   POST /api/auth/wx         预留：小程序 code 换 openid 登录（需 AppSecret，未配置返回 501）
 *   GET  /api/sync            拉云端档案
 *   PUT  /api/sync            推云端档案（last-write-wins）+ 顺带合并排行榜
 *   GET  /api/leaderboard     排行榜 top100
 */

'use strict';

import { jsonResp, errResp, readJson, getBearer } from './http.js';
import { signToken, verifyToken, newUid, randDigits4 } from './token.js';
import Users from './users.js';

/** 取 KV 绑定（控制台把 KV 命名空间绑到变量 KV）。 */
function kvOf(env) {
  const kv = env && (env.KV || env.kv);
  if (!kv) throw new Error('KV 存储未绑定（控制台绑定 KV 命名空间到变量 KV）');
  return kv;
}

/** 云端档案体积上限（KV 单值限 1MB，这里给同步留个远小于它的护栏）。 */
const SAVE_MAX_BYTES = 200 * 1024;
/** 排行榜保留行数。 */
const LB_SIZE = 100;

/**
 * 排行榜合并（报满坐庄榜）：整行替换该 uid 数据后按报满次数重排。
 * 满分坐庄 = 报满成交坐庄（contractScore ≥ 上限）；计数来自客户端单机局，
 * 天然可刷，休闲榜不做反作弊。
 */
async function updateLeaderboard(kv, uid, nick, lb) {
  if (!lb || typeof lb !== 'object') return;
  const maxBids = Math.floor(Number(lb.maxBids));
  if (!Number.isFinite(maxBids) || maxBids < 1) return; // 没报满过不上榜
  const rounds = Math.max(0, Math.floor(Number(lb.rounds) || 0));
  let list;
  try { list = JSON.parse((await kv.get('lb:global')) || '[]'); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  const row = { uid, nick, maxBids, rounds, updatedAt: Date.now() };
  const i = list.findIndex((r) => r && r.uid === uid);
  if (i >= 0) list[i] = row; else list.push(row);
  list.sort((a, b) => (b.maxBids - a.maxBids) || (b.rounds - a.rounds));
  await kv.put('lb:global', JSON.stringify(list.slice(0, LB_SIZE)));
}

/* ---------- auth ---------- */

/** POST /api/auth/guest {nick?} */
export async function handleGuest(request, env) {
  const body = (request.method === 'POST') ? (await readJson(request) || {}) : {};
  const nick = (typeof body.nick === 'string' && body.nick.trim()) ? body.nick.trim().slice(0, 16) : '游客' + randDigits4();
  const user = { uid: newUid(), nick, created: Date.now(), wxOpenid: null };
  await Users.putUser(env, user);
  return jsonResp({ token: await signToken(env, user.uid), user: Users.publicUser(user) });
}

/** POST /api/auth/login {username, password} */
export async function handleLogin(request, env) {
  const body = await readJson(request);
  if (!body || Users.validateName(body.username) || Users.validatePass(body.password)) {
    return errResp(400, '用户名或密码格式不对');
  }
  const uid = await Users.getUidByName(env, body.username);
  // 用户不存在与密码错误同文案，不暴露账号是否注册过
  if (!uid) return errResp(401, '用户名或密码错误');
  const user = await Users.getUser(env, uid);
  if (!user || !user.login || !(await Users.verifyPass(body.password, user.login))) {
    return errResp(401, '用户名或密码错误');
  }
  const saveRaw = await kvOf(env).get('save:' + uid);
  let save = null;
  try { save = saveRaw ? JSON.parse(saveRaw) : null; } catch (e) { save = null; }
  return jsonResp({ token: await signToken(env, uid), user: Users.publicUser(user), save });
}

/** POST /api/auth/bind {username, password}（Bearer 游客 token） */
export async function handleBind(request, env) {
  const uid = await verifyToken(env, getBearer(request));
  if (!uid) return errResp(401, '登录态失效，请刷新页面重试');
  const user = await Users.getUser(env, uid);
  if (!user) return errResp(401, '账号不存在');
  if (user.login) return errResp(409, '已经是正式账号，直接登录即可');
  const body = await readJson(request);
  if (!body) return errResp(400, '请求格式不对');
  const e1 = Users.validateName(body.username);
  if (e1) return errResp(400, e1);
  const e2 = Users.validatePass(body.password);
  if (e2) return errResp(400, e2);
  if (await Users.getUidByName(env, body.username)) return errResp(409, '这个名字已被占用了，换一个吧');
  user.login = await Users.makeLogin(body.username, body.password);
  user.nick = user.login.name; // 正式账号昵称默认取用户名
  await Users.putUser(env, user);
  await Users.putNameIndex(env, body.username, user.uid);
  return jsonResp({ user: Users.publicUser(user) });
}

/** POST /api/auth/wx {code} —— 小程序登录预留（需在环境变量配 WX_APPID/WX_SECRET）。 */
export async function handleWx(request, env) {
  if (!env || !(env.WX_APPID && env.WX_SECRET)) {
    return errResp(501, '小程序登录未开通（需配置 WX_APPID/WX_SECRET）');
  }
  const body = await readJson(request);
  if (!body || typeof body.code !== 'string') return errResp(400, '缺少 code');
  let openid = null;
  try {
    const r = await fetch(`https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(env.WX_APPID)}&secret=${encodeURIComponent(env.WX_SECRET)}&js_code=${encodeURIComponent(body.code)}&grant_type=authorization_code`);
    const j = await r.json();
    if (!j.openid) return errResp(502, '微信登录失败(' + (j.errcode || '') + ')');
    openid = j.openid;
  } catch (e) {
    return errResp(502, '微信登录失败');
  }
  const kv = kvOf(env);
  let uid = await kv.get('wx:' + openid);
  let user = uid ? await Users.getUser(env, uid) : null;
  if (!user) {
    user = { uid: newUid(), nick: '微信玩家' + randDigits4(), created: Date.now(), wxOpenid: openid };
    await Users.putUser(env, user);
    await kv.put('wx:' + openid, user.uid);
  }
  return jsonResp({ token: await signToken(env, user.uid), user: Users.publicUser(user) });
}

/* ---------- sync / leaderboard ---------- */

/** GET /api/sync（Bearer） */
export async function handleSyncGet(request, env) {
  const uid = await verifyToken(env, getBearer(request));
  if (!uid) return errResp(401, '登录态失效');
  const raw = await kvOf(env).get('save:' + uid);
  if (!raw) return jsonResp({ save: null });
  try { return jsonResp({ save: JSON.parse(raw) }); } catch (e) { return jsonResp({ save: null }); }
}

/** PUT /api/sync {save:{updatedAt,data}, lb?}（Bearer） */
export async function handleSyncPut(request, env) {
  const uid = await verifyToken(env, getBearer(request));
  if (!uid) return errResp(401, '登录态失效');
  const body = await readJson(request);
  const save = body && body.save;
  if (!save || typeof save !== 'object' || typeof save.updatedAt !== 'number'
    || !save.data || typeof save.data !== 'object' || Array.isArray(save.data)) {
    return errResp(400, '档案格式不对');
  }
  // 时间戳防脏：不接受来自"未来"的数据（客户端时钟错乱会让 LWW 永远赢）
  if (save.updatedAt > Date.now() + 60000) return errResp(400, '时间戳异常');
  const bytes = JSON.stringify(save.data).length;
  if (bytes > SAVE_MAX_BYTES) return errResp(413, '档案太大(' + bytes + 'B)');
  const kv = kvOf(env);
  const key = 'save:' + uid;
  let prev = null;
  try { prev = JSON.parse((await kv.get(key)) || 'null'); } catch (e) { prev = null; }
  let kept = 'none';
  if (!prev || save.updatedAt >= prev.updatedAt) {
    await kv.put(key, JSON.stringify(save));
    kept = 'client';
  } else {
    kept = 'server'; // 服务端更新，客户端该来拉取
  }
  // 排行榜与档案独立合并：即使档案输了 LWW，最新战绩也进榜
  const user = await Users.getUser(env, uid);
  if (user) await updateLeaderboard(kv, uid, user.nick, body.lb);
  return jsonResp({ ok: true, kept });
}

/** GET /api/leaderboard */
export async function handleLeaderboard(request, env) {
  let list = [];
  try { list = JSON.parse((await kvOf(env).get('lb:global')) || '[]'); } catch (e) { list = []; }
  return jsonResp({ list: Array.isArray(list) ? list.slice(0, LB_SIZE) : [] });
}

/** 路由表：serve.js 与边缘函数入口共用。键为 'METHOD /path'。 */
export const ROUTES = {
  'POST /api/auth/guest': handleGuest,
  'POST /api/auth/login': handleLogin,
  'POST /api/auth/bind': handleBind,
  'POST /api/auth/wx': handleWx,
  'GET /api/sync': handleSyncGet,
  'PUT /api/sync': handleSyncPut,
  'GET /api/leaderboard': handleLeaderboard
};

/** 统一分发（serve.js 用；边缘函数入口直接引具体 handler）。 */
export async function dispatch(request, env) {
  const hit = ROUTES[request.method + ' ' + new URL(request.url).pathname];
  if (hit) return hit(request, env);
  return errResp(404, '接口不存在');
}
