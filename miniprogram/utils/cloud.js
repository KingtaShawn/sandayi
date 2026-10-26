/**
 * utils/cloud.js —— 小程序端云端账号与档案同步（与 h5/js/cloud.js 同协议）。
 *
 * 登录链：wx.login code → /api/auth/wx（需后台配 WX_APPID/WX_SECRET）→ 失败降级游客建档。
 * 档案同步搬 wx storage 原始字符串（与 H5 localStorage 同键同值，两端账号绑定后战绩互通）。
 * 一切网络失败静默：云端不可用 = 单机，游戏不受影响。
 *
 * 注意：CLOUD_BASE 指向 Cloudflare Pages（未备案域名）。微信开发者工具里勾选
 * "不校验合法域名"即可调试；正式发布需在小程序后台配 request 合法域名（要备案域名）。
 */

'use strict';

/** 云端 API 基址（Cloudflare Pages，与 h5/js/cloud.js 同一后端）。 */
var CLOUD_BASE = 'https://sandayi.pages.dev';

var LS_TOKEN = 'cloud:token';
var LS_USER = 'cloud:user';
var LS_LOCAL_AT = 'cloud:localAt';
/** 参与云同步的存档键（与 h5/js/cloud.js SYNC_KEYS 完全一致，值互通）。 */
var SYNC_KEYS = ['tractor:stats', 'tractor:settings', 'tractor:ruleOverrides', 'tractor:maxBids'];

var listeners = { state: [], sync: [] };
var user = null;
var token = null;
var pushTimer = null;
var pushing = false;
var pushPending = false;
var inited = false;

/* ---------- wx storage 薄封装（惰性取 global wx，Node 测试可注入） ---------- */
function W() { return typeof wx !== 'undefined' ? wx : null; }
function lsGet(k) { try { var w = W(); return w ? w.getStorageSync(k) : null; } catch (e) { return null; } }
function lsSet(k, v) { try { var w = W(); if (w) w.setStorageSync(k, v); } catch (e) { /* 满/异常静默 */ } }
function lsDel(k) { try { var w = W(); if (w) w.removeStorageSync(k); } catch (e) { /* 忽略 */ } }

function emit(evt) {
  (listeners[evt] || []).forEach(function (fn) {
    try { fn(); } catch (e) { /* UI 回调异常不进云层 */ }
  });
}

function setState(u, t) {
  user = u;
  token = t || null;
  if (u) lsSet(LS_USER, JSON.stringify(u)); else lsDel(LS_USER);
  if (t) lsSet(LS_TOKEN, t); else lsDel(LS_TOKEN);
  emit('state');
}

/* ---------- 档案打包/落地（原始字符串，零解析） ---------- */
function collectData() {
  var data = {};
  SYNC_KEYS.forEach(function (k) {
    var v = lsGet(k);
    if (v !== null && v !== undefined && v !== '') data[k] = v;
  });
  return data;
}

function applyData(data) {
  if (!data) return;
  SYNC_KEYS.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(data, k)) lsSet(k, data[k]);
  });
}

function localAt() { return Number(lsGet(LS_LOCAL_AT)) || 0; }

/** 战绩汇总（排行榜数据源：满分坐庄次数为主，局数为辅）。 */
function summarize() {
  try {
    var stats = require('../services/stats');
    var storage = require('../storage/adapter');
    var keys = require('../storage/keys');
    var records = storage.get(keys.STORAGE_KEYS.STATS) || [];
    var s = stats.summarize(records);
    return {
      rounds: s.totalRounds, wins: s.wins, losses: s.losses,
      maxBids: Number(lsGet('tractor:maxBids')) || 0
    };
  } catch (e) { return null; }
}

/* ---------- 请求（wx.request → Promise） ---------- */
function request(method, path, body, useAuth) {
  return new Promise(function (resolve, reject) {
    var w = W();
    if (!w || !w.request) { reject(new Error('no wx.request')); return; }
    var header = { 'Content-Type': 'application/json' };
    if (useAuth && token) header.Authorization = 'Bearer ' + token;
    w.request({
      url: CLOUD_BASE + '/api/' + path,
      method: method,
      header: header,
      data: body || undefined,
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else { var e = new Error('http ' + res.statusCode); e.status = res.statusCode; reject(e); }
      },
      fail: reject
    });
  });
}

/* ---------- 登录链 ---------- */
/** 微信登录：wx.login 拿 code 换 openid 建档；不可用（501/网络/未配域名）降级游客。 */
function loginWx() {
  return new Promise(function (resolve, reject) {
    var w = W();
    if (!w || !w.login) { reject(new Error('no wx.login')); return; }
    w.login({
      success: function (res) { (res && res.code) ? resolve(res.code) : reject(new Error('no code')); },
      fail: reject
    });
  }).then(function (code) {
    return request('POST', 'auth/wx', { code: code }, false);
  }).catch(function (e) {
    return request('POST', 'auth/guest', {}, false); // 降级：openid 通道没开也能玩+同步
  });
}

/* ---------- 同步核心（与 h5 版同构） ---------- */
function mergeRemote(save) {
  if (!save || !save.data) {
    if (collectData() && localAt()) schedulePush();
    return;
  }
  if (save.updatedAt > localAt()) {
    applyData(save.data);
    lsSet(LS_LOCAL_AT, String(save.updatedAt));
    emit('sync');
  } else {
    schedulePush();
  }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 2500);
}

function push() {
  if (!token) return Promise.resolve();
  if (pushing) { pushPending = true; return Promise.resolve(); }
  pushing = true;
  return request('PUT', 'sync', {
    save: { updatedAt: localAt() || Date.now(), data: collectData() },
    lb: summarize()
  }, true).then(function (r) {
    if (r && r.kept === 'server') return pull();
  }).catch(function (e) {
    if (e && e.status === 401) reLogin();
  }).then(function () {
    pushing = false;
    if (pushPending) { pushPending = false; schedulePush(); }
  });
}

function pull() {
  return request('GET', 'sync', undefined, true)
    .then(function (r) { mergeRemote(r.save); })
    .catch(function (e) { if (e && e.status === 401) reLogin(); });
}

/** 登录态失效/无：微信登录优先，降级游客；本地数据随后自动推上去。 */
function reLogin() {
  return loginWx().then(function (r) {
    setState(r.user, r.token);
    schedulePush();
  }).catch(function (e) { /* 离线：保持现状，下次再试 */ });
}

/* ---------- 对外 API（与 h5/js/cloud.js 同面） ---------- */
module.exports = {
  /** 启动（app.js onLaunch 调一次）：恢复登录态并拉取合并。onSync 在远端档案落地后回调。 */
  init: function (opts) {
    if (inited) return;
    inited = true;
    if (opts && opts.onSync) listeners.sync.push(opts.onSync);
    token = lsGet(LS_TOKEN) || null;
    try { user = JSON.parse(lsGet(LS_USER) || 'null'); } catch (e) { user = null; }
    if (token && user) {
      emit('state'); // 恢复登录态要立刻通知 UI：首次渲染先于 init 跑时，状态行还停在"未连接"
      pull();
    } else {
      setState(null, null);
      reLogin();
    }
  },

  state: function () {
    if (!user) return 'off';
    return user.isGuest ? 'guest' : 'user';
  },
  nick: function () { return user ? user.nick : ''; },
  name: function () { return (user && user.name) || ''; },
  uid: function () { return (user && user.uid) || ''; },

  /** 本地数据有变（战绩/设置/房规写入后调）：更新时间戳 + 防抖推送。 */
  notifyLocal: function () {
    lsSet(LS_LOCAL_AT, String(Date.now()));
    if (token) schedulePush();
  },

  /** 立即推送（onHide 等收尾时机）。 */
  flush: function () {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    return push();
  },

  /** 游客升级为正式账号（uid 不变，战绩不丢；可与 H5 绑同名账号互通）。 */
  bind: function (name, pass) {
    return request('POST', 'auth/bind', { username: name, password: pass }, true)
      .then(function (r) { setState(r.user, token); return r.user; });
  },

  /** 登录已有账号（换设备找回）。 */
  login: function (name, pass) {
    return request('POST', 'auth/login', { username: name, password: pass }, false)
      .then(function (r) {
        setState(r.user, r.token);
        return mergeRemote(r.save);
      });
  },

  /** 拉排行榜（满分庄家榜，公开接口）。 */
  leaderboard: function () {
    return request('GET', 'leaderboard', undefined, false).then(function (r) { return (r && r.list) || []; });
  },

  on: function (evt, fn) { if (listeners[evt]) listeners[evt].push(fn); },

  /** 测试专用：换 API 基址 / 重置模块态。 */
  _test: {
    setBase: function (b) { CLOUD_BASE = b; },
    reset: function () {
      inited = false; user = null; token = null;
      pushing = false; pushPending = false;
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    }
  }
};
