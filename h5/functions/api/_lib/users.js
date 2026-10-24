/**
 * functions/api/_lib/users.js —— 用户与凭证（KV 数据模型 + PBKDF2 密码哈希）。
 *
 * KV 键设计（值全为 JSON 字符串）：
 *   u:{uid}        用户档案 {uid, nick, created, login?, wxOpenid?}
 *   login:{name}   用户名（小写规范化）→ uid 索引
 *   wx:{openid}    预留：小程序 openid → uid
 *
 * 注意：KV 最终一致，login 索引的并发重名有约 60 秒竞态窗口——休闲棋牌规模可接受，
 * 后续若需要强一致可加一个写入侧的确认读。
 */

'use strict';

const encoder = new TextEncoder();

/** PBKDF2 迭代次数（边缘函数 CPU 受限，50k 是耗时/强度的折中，改这里需同步改测试预期外的耗时）。 */
const PBKDF2_ITER = 50000;

/** 用户名规则：2~16 位，中文/字母/数字/下划线。 */
function validateName(name) {
  if (typeof name !== 'string') return '用户名格式不对';
  const n = name.trim();
  if (!/^[a-zA-Z0-9_一-龥]{2,16}$/.test(n)) return '用户名需 2~16 位中文/字母/数字/下划线';
  return null;
}

/** 密码规则：4~32 位任意可见字符（休闲游戏，不逼强密码）。 */
function validatePass(pass) {
  if (typeof pass !== 'string' || !/^[\x21-\x7e]{4,32}$/.test(pass)) return '密码需 4~32 位字母/数字/符号';
  return null;
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** PBKDF2-SHA256 哈希，返回 base64url。 */
async function pbkdf2(pass, saltBytes) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITER },
    key, 256
  );
  return b64url(new Uint8Array(bits));
}

/** 造凭证（随机盐）。 */
async function makeLogin(name, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { name: name.trim(), nameKey: name.trim().toLowerCase(), salt: b64url(salt), hash: await pbkdf2(pass, salt) };
}

/** 校验密码。 */
async function verifyPass(pass, login) {
  if (!login || !login.salt || !login.hash) return false;
  return (await pbkdf2(pass, b64urlBytes(login.salt))) === login.hash;
}

/* ---------- KV 读写（薄封装，值一律 JSON 字符串） ---------- */

async function kvOf(env) {
  const kv = (env && (env.KV || env.kv)) || null;
  if (!kv) throw new Error('KV 存储未绑定（控制台绑定 KV 命名空间到变量 KV）');
  return kv;
}

export async function getUser(env, uid) {
  const raw = await (await kvOf(env)).get('u:' + uid);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export async function putUser(env, user) {
  await (await kvOf(env)).put('u:' + user.uid, JSON.stringify(user));
}

/** 用户名 → uid（不存在返回 null）。 */
export async function getUidByName(env, name) {
  return await (await kvOf(env)).get('login:' + name.trim().toLowerCase());
}

/** 写用户名索引。 */
export async function putNameIndex(env, name, uid) {
  await (await kvOf(env)).put('login:' + name.trim().toLowerCase(), uid);
}

/** 对外暴露的用户视图（不含盐/哈希）。 */
export function publicUser(user) {
  return { uid: user.uid, nick: user.nick, name: (user.login && user.login.name) || null, isGuest: !user.login && !user.wxOpenid };
}

export default {
  validateName, validatePass, makeLogin, verifyPass,
  getUser, putUser, getUidByName, putNameIndex, publicUser
};
