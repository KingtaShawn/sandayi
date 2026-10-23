/**
 * tools/build-bundle.js —— 把小程序逻辑层（engine/core/ai/services/utils/storage + rule-config）
 * 按 CommonJS 依赖打包成浏览器可用的单文件 bundle（h5/js/game-bundle.js）。
 *
 * 用法：node tools/build-bundle.js
 * 原理：每个模块包一层注册器 __def(id, factory)，require 按 id 解析；
 *       引擎源文件零改动（依赖铁律的兑现：无 wx.* 依赖，才能整体平移）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'miniprogram');
const OUT = path.resolve(__dirname, '..', 'h5', 'js', 'game-bundle.js');
/** 参与打包的目录（= 依赖铁律保护的纯逻辑层） */
const DIRS = ['engine', 'core', 'ai', 'services', 'utils', 'storage'];
/** 根级单文件模块 */
const ROOT_FILES = ['rule-config'];

/** 收集模块：id 形如 'engine/card'、'rule-config' */
function collect() {
  const mods = new Map(); // id -> code
  for (const d of DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js') && !f.startsWith('.')) mods.set(`${d}/${f.slice(0, -3)}`, fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  for (const f of ROOT_FILES) {
    const p = path.join(ROOT, f + '.js');
    if (fs.existsSync(p)) mods.set(f, fs.readFileSync(p, 'utf8'));
  }
  return mods;
}

/** 解析 require 调用中的相对路径 → 注册表 id */
function resolveId(from, req) {
  if (!req.startsWith('.')) return req; // 非相对（本项目内不存在，原样返回）
  const base = path.posix.join(path.posix.dirname(from), req);
  const clean = path.posix.normalize(base).replace(/^\.\//, '');
  return clean;
}

/** 扫描代码里的 require('...') 字面量，返回依赖 id 列表 */
function scanDeps(id, code) {
  const deps = [];
  const re = /require\((['"])([^'"]+)\1\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    deps.push(resolveId(id, m[2]));
  }
  return deps;
}

function main() {
  const mods = collect();
  const lines = [];
  lines.push('/* 自动生成：node tools/build-bundle.js —— 请勿手改；引擎更新后重跑 */');
  lines.push('(function () {');
  lines.push("'use strict';");
  lines.push('var __defs = {};');
  lines.push('var __cache = {};');
  // require 解析器：支持相对/注册表 id；未注册 id 抛错（快速暴露遗漏）
  // 工厂签名 (exports, __require, module)：模块可用 module.exports = {...} 重赋值导出（本项目通用风格）
  lines.push('function __req(from, id) {');
  lines.push('  var key = id.charAt(0) === "." ? __resolve(from, id) : id;');
  lines.push('  if (__cache[key]) return __cache[key].exports;');
  lines.push('  var def = __defs[key];');
  lines.push("  if (!def) throw new Error('module not found: ' + key + ' (from ' + from + ')');");
  lines.push('  var mod = { exports: {} };');
  lines.push('  __cache[key] = mod;');
  lines.push('  def(mod.exports, function (i) { return __req(key, i); }, mod);');
  lines.push('  return mod.exports;');
  lines.push('}');
  lines.push('function __resolve(from, id) {');
  lines.push('  var base = id.charAt(0) === "." ? id : "./" + id;');
  // 简化：打包时已把依赖改写为注册 id，这里仅兜底
  lines.push('  return base.replace(/^\\.\\//, "").replace(/^\\.\\//, "");');
  lines.push('}');
  lines.push('function __def(id, factory) { __defs[id] = factory; }');

  for (const [id, code] of mods) {
    const deps = scanDeps(id, code);
    // 依赖声明（便于排查 + 兜底校验）
    const missing = deps.filter((d) => !mods.has(d));
    if (missing.length) {
      console.warn(`[warn] ${id} 依赖未打包（可能惰性 require）：${missing.join(', ')}`);
    }
    lines.push(`__def(${JSON.stringify(id)}, function (exports, __require, module) {`);
    // 依赖改写：require('../engine/card') → __require('engine/card')（字符串替换，保序）
    const rewritten = code.replace(/require\((['"])([^'"]+)\1\)/g, (s, q, req) => {
      const rid = resolveId(id, req);
      return mods.has(rid) ? `__require(${q}${rid}${q})` : s;
    });
    lines.push(rewritten);
    lines.push('});');
  }

  // 导出窗口全局 GameCore：{ GameService, createConfig, DEFAULT_CONFIG, getHint, fmt, storage, STORAGE_KEYS, stats, createRng, ruleConfig, scoreBidOptions }
  lines.push(`
var out = {
  GameService: __req('root', 'services/game-service').GameService,
  createConfig: __req('root', 'engine/config').createConfig,
  DEFAULT_CONFIG: __req('root', 'engine/config').DEFAULT_CONFIG,
  validateConfig: __req('root', 'engine/config').validateConfig,
  getHint: __req('root', 'services/hint').getHint,
  fmt: __req('root', 'utils/format'),
  storage: __req('root', 'storage/adapter'),
  STORAGE_KEYS: __req('root', 'storage/keys').STORAGE_KEYS,
  stats: __req('root', 'services/stats'),
  createRng: __req('root', 'utils/random').createRng,
  ruleConfig: __req('root', 'rule-config'),
  scoreBidOptions: __req('root', 'engine/bid').scoreBidOptions
};
if (typeof window !== 'undefined') window.GameCore = out;
if (typeof module !== 'undefined' && module.exports) module.exports = out;
})();`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`[ok] 打包 ${mods.size} 个模块 → ${path.relative(process.cwd(), OUT)}`);
}

main();
