/**
 * h5/serve.js —— H5 版本地服务器（静态文件 + /api 云端接口）。
 * 用法：node h5/serve.js [端口]（默认 8930）
 * 手机同局域网访问：http://<本机IP>:8930
 *
 * /api/* 与 EdgeOne 边缘函数共用 h5/functions/api/_lib/api.js 同一份 handler，
 * 本地联调与生产行为一致。KV 用内存 Map + 落盘 h5/.dev-kv.json（重启不丢测试账号）。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8930;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg'
};

/* ---------- 开发 KV（接口同 EdgeOne KV：get/put/delete 全 async 字符串值） ---------- */
const DEV_KV_FILE = path.join(ROOT, '.dev-kv.json');
const devKv = (() => {
  let m = new Map();
  try { m = new Map(Object.entries(JSON.parse(fs.readFileSync(DEV_KV_FILE, 'utf8')))); } catch (e) { /* 首次启动无文件 */ }
  let timer = null;
  const flush = () => { try { fs.writeFileSync(DEV_KV_FILE, JSON.stringify(Object.fromEntries(m))); } catch (e) { /* 忽略 */ } };
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, String(v)); if (timer) clearTimeout(timer); timer = setTimeout(flush, 300); },
    async delete(k) { m.delete(k); if (timer) clearTimeout(timer); timer = setTimeout(flush, 300); }
  };
})();

const ENV = { KV: devKv, AUTH_SECRET: process.env.AUTH_SECRET || 'dev-insecure-secret' };

/* ---------- /api 路由（handler 与 EdgeOne 边缘函数共用） ---------- */
const apiPromise = import('./functions/api/_lib/api.js');

/** Node req → Web Request（body 原样搬运）。 */
async function toWebRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return new Request('http://localhost' + req.url, {
    method: req.method,
    headers: Object.assign({}, req.headers),
    body: (req.method === 'GET' || req.method === 'HEAD' || !chunks.length) ? undefined : Buffer.concat(chunks)
  });
}

async function handleApi(req, res) {
  const { dispatch, corsPreflight } = await apiPromise;
  try {
    if (req.method === 'OPTIONS') { const r = corsPreflight(); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(); return; }
    const request = await toWebRequest(req);
    const r = await dispatch(request, ENV);
    const headers = Object.fromEntries(r.headers);
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, headers);
    res.end(buf);
  } catch (e) {
    console.error('[api]', e);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '服务器内部错误' }));
  }
}

/* ---------- 静态文件 ---------- */
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.startsWith('/api/')) return void handleApi(req, res);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  // 防目录穿越
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, data) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    // 一律 no-store：开发服务器无 ETag/版本号可协商，浏览器启发式缓存会把旧 index.html
    // （连同它引用的旧 ?v= 资源）一直留在手机/微信 webview 里，改完代码刷新不生效
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`三打一 H5 版已启动：`);
  console.log(`  本机访问   http://127.0.0.1:${PORT}`);
  console.log(`  手机访问   http://<本机局域网IP>:${PORT}（需同一 WiFi）`);
  console.log(`  云端接口   /api/*（KV 落盘 .dev-kv.json，与线上同一套 handler）`);
});
