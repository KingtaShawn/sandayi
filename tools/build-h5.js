/**
 * tools/build-h5.js —— 组装 H5 发布目录（h5/dist）。
 * 用法：node tools/build-h5.js（EdgeOne Pages 构建命令同此）
 * 步骤：重打 game-bundle → 只拷发布所需文件（serve.js、test/ 不进）
 *       → index.html 注入 ?v=版本号（版本 = package.json 版本 + git 短哈希），
 *         引擎/样式更新后玩家不再吃到缓存旧代码。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const H5 = path.join(ROOT, 'h5');
const DIST = path.join(H5, 'dist');

/** 版本号：package.json 版本 + git 短哈希（工作区有未提交改动追加 -dirty） */
function version() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  try {
    let v = `${pkg.version}-${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim()}`;
    try {
      execFileSync('git', ['diff', '--quiet'], { cwd: ROOT });
    } catch { v += '-dirty'; }
    return v;
  } catch { return pkg.version; } // 非 git 环境（如下载的源码包）退化为纯版本号
}

/** 递归拷贝目录 */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  // 1. 保证 bundle 与引擎同步（build-bundle.js 是副作用脚本，子进程直跑）
  execFileSync(process.execPath, [path.join(__dirname, 'build-bundle.js')], { stdio: 'inherit' });

  // 2. 全新 dist，避免删掉的文件残留
  fs.rmSync(DIST, { recursive: true, force: true });

  // 3. 只拷发布需要的
  copyDir(path.join(H5, 'css'), path.join(DIST, 'css'));
  copyDir(path.join(H5, 'js'), path.join(DIST, 'js'));
  copyDir(path.join(H5, 'icons'), path.join(DIST, 'icons'));
  fs.copyFileSync(path.join(H5, 'manifest.webmanifest'), path.join(DIST, 'manifest.webmanifest'));

  // 4. index.html 注入版本号（css/js/manifest 引用）
  const ver = version();
  let html = fs.readFileSync(path.join(H5, 'index.html'), 'utf8');
  html = html.replace(
    /((?:href|src)="(?:css\/style\.css|js\/game-bundle\.js|js\/sound\.js|js\/app\.js|manifest\.webmanifest))"/g,
    `$1?v=${ver}"`
  );
  fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf8');

  const files = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      fs.statSync(p).isDirectory() ? walk(p) : files.push(p);
    }
  })(DIST);
  console.log(`[ok] H5 发布目录 h5/dist（v${ver}，${files.length} 个文件）`);
}

main();
