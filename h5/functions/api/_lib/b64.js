/**
 * functions/api/_lib/b64.js —— base64url 编解码（纯 JS）。
 *
 * 不用 btoa/atob：EdgeOne 边缘运行时文档只保证 TextEncoder/TextDecoder，
 * btoa 未列出；纯 JS 实现浏览器/Node/边缘三端行为一致。
 */

'use strict';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const REV = new Map();
for (let i = 0; i < ALPHABET.length; i++) REV.set(ALPHABET[i], i);

/** Uint8Array → base64url 字符串（无填充）。 */
export function b64urlEncode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 === undefined) break;
    out += ALPHABET[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 === undefined) break;
    out += ALPHABET[b2 & 63];
  }
  return out;
}

/** base64url 字符串 → Uint8Array（非法字符抛错，由调用方兜底）。 */
export function b64urlDecode(s) {
  const out = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = REV.get(s[i]);
    if (v === undefined) throw new Error('bad base64url');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
