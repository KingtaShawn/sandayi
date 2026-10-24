/**
 * functions/api/_lib/runtime.js —— 运行时差异收口（KV 绑定的获取方式）。
 *
 * EdgeOne Makers：控制台绑定 KV 命名空间时填的"变量名"会成为**全局变量**直接可用
 * （官方示例 `my_kv.get(...)`），不在 context.env 里；本地 serve.js / 测试则通过
 * env.KV 注入。绑定变量名定为 KV，两种运行时走同一条路径。
 */

'use strict';

/** 取 KV 绑定；未绑定时抛错（上层转 500，README 上线清单有配置步骤）。 */
export function kvOf(env) {
  const kv = (env && (env.KV || env.kv)) ||
    (typeof globalThis.KV !== 'undefined' ? globalThis.KV : null);
  if (!kv) throw new Error('KV 存储未绑定（控制台绑定 KV 命名空间，变量名填 KV）');
  return kv;
}
