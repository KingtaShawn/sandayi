/**
 * utils/random.js —— 随机源（mulberry32 种子随机，§8.7）。
 *
 * 所有随机（洗牌 / 翻底定主 / AI 扰动）必须走注入的 rng：
 *   测试注入固定种子可复现；线上默认 Math.random。
 */

'use strict';

/**
 * 创建可复现随机源。
 * @param {number} [seed] 种子（缺省用 Math.random 派生）
 * @returns {{seed: number, next: function(): number, int: function(number): number,
 *           range: function(number, number): number, pick: function(Array): *,
 *           shuffle: function(Array): Array}}
 */
function createRng(seed) {
  let s = (seed === undefined || seed === null)
    ? (Math.floor(Math.random() * 0xffffffff) >>> 0)
    : (seed >>> 0);
  const api = {
    seed: s,
    /** [0,1) 均匀随机 */
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** [0, n) 整数 */
    int(n) {
      return Math.floor(api.next() * n);
    },
    /** [min, max] 闭区间整数 */
    range(min, max) {
      return min + Math.floor(api.next() * (max - min + 1));
    },
    /** 数组随机取一 */
    pick(arr) {
      return arr[Math.floor(api.next() * arr.length)];
    },
    /** Fisher-Yates 洗牌（返回新数组） */
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(api.next() * (i + 1));
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      return a;
    }
  };
  return api;
}

module.exports = { createRng };
