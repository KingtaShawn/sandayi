/**
 * h5/serve.js —— H5 版本地服务器。
 * 用法：node h5/serve.js [端口]（默认 8930）
 * 手机同局域网访问：http://<本机IP>:8930
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

const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
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
});
