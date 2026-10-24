/**
 * functions/api/_lib/http.js —— HTTP 小工具（EdgeOne 边缘函数 / Node serve.js 双端通用）。
 *
 * 统一 JSON 响应 + CORS。游戏与 API 同源部署，CORS 头是为小程序/联调留的兼容面。
 */

'use strict';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

/** JSON 成功响应。 */
export function jsonResp(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS_HEADERS)
  });
}

/** JSON 错误响应。 */
export function errResp(status, msg) {
  return jsonResp({ error: msg }, status);
}

/** OPTIONS 预检直接放行。 */
export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * 安全读 JSON body：非法/非对象一律返回 null（脏请求不进 handler 主体）。
 * @param {Request} request
 * @returns {Promise<object|null>}
 */
export async function readJson(request) {
  try {
    const v = await request.json();
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
  } catch (e) {
    return null;
  }
}

/** 从 Authorization: Bearer xxx 取 token。 */
export function getBearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
