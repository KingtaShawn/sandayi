/**
 * functions/api/_lib/token.js —— 无状态登录态 token（HMAC-SHA256 签名）。
 *
 * 为什么不用 KV 存会话：EdgeOne KV 最终一致（约 60 秒传播），注册完立刻回读会读不到，
 * 出现"注册成功但登录失败"的诡异 bug。无状态 token 验签即可、零回读、零存储开销。
 *
 * 格式：base64url(JSON{u,exp}) + '.' + base64url(HMAC(payload, AUTH_SECRET))
 */

'use strict';

import { b64urlEncode, b64urlDecode } from './b64.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 常数时间比较（长度不同直接否，等长逐字节异或累积）。 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 取签名密钥：生产必须配 AUTH_SECRET 环境变量，本地开发给固定弱值。 */
function secretOf(env) {
  return (env && env.AUTH_SECRET) || 'dev-insecure-secret';
}

/** HMAC-SHA256(data) → base64url。 */
async function hmac(env, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secretOf(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

/**
 * 签发 token。
 * @param {object} env
 * @param {string} uid
 * @param {number} [ttlMs] 默认 90 天
 * @returns {Promise<string>}
 */
export async function signToken(env, uid, ttlMs) {
  const payload = b64urlEncode(encoder.encode(JSON.stringify({ u: uid, exp: Date.now() + (ttlMs || 90 * 24 * 3600 * 1000) })));
  return payload + '.' + await hmac(env, payload);
}

/**
 * 验证 token。
 * @returns {Promise<string|null>} 合法返回 uid，否则 null
 */
export async function verifyToken(env, token) {
  if (!token || typeof token !== 'string' || token.length > 512) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expect;
  try {
    expect = await hmac(env, payload);
  } catch (e) {
    return null;
  }
  if (!timingSafeEqual(sig, expect)) return null;
  try {
    const { u, exp } = JSON.parse(decoder.decode(b64urlDecode(payload)));
    if (!u || typeof exp !== 'number' || exp < Date.now()) return null;
    return u;
  } catch (e) {
    return null;
  }
}

/** 生成 uid（u + 时间 base36 + 8 字节随机 hex）。 */
export function newUid() {
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  let hex = '';
  for (let i = 0; i < rnd.length; i++) hex += ('0' + rnd[i].toString(16)).slice(-2);
  return 'u' + Date.now().toString(36) + hex;
}

/** 生成游客昵称后缀（4 位数字）。 */
export function randDigits4() {
  return String(1000 + crypto.getRandomValues(new Uint16Array(1))[0] % 9000);
}
