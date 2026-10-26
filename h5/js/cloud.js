/**
 * h5/js/cloud.js —— 云端账号与档案同步（游客模式起步）。
 *
 * 设计：
 * - 无感：首次进入自动建游客账号（token 存 localStorage），全程不打断游戏；
 * - 静默：任何网络失败都不弹错、不阻塞——云端挂了=单机版，体验不降级；
 * - 保真：同步的是 localStorage 原始字符串（引擎存档的双重 stringify 原样搬运），
 *   云端永不解析内容，引擎存档结构升级不需要后端/同步层跟进；
 * - 冲突：last-write-wins，本地时间戳记在 cloud:localAt（每次本地写档更新）。
 *
 * 暴露：Cloud.init / state / nick / notifyLocal / flush / bind / login / on
 */

/* global localStorage, fetch, GameCore */
(function () {
  'use strict';

  var LS_TOKEN = 'cloud:token';
  var LS_USER = 'cloud:user';
  var LS_LOCAL_AT = 'cloud:localAt';
  /**
   * 后端地址：https://sandayi.pages.dev（Cloudflare Pages，后端已放行 CORS *）。
   * 同源访问该域名时此值也兼容；github.io 静态站跨域调用同一后端。末尾不带斜杠。
   */
  var CLOUD_BASE = 'https://sandayi.pages.dev';
  /** 参与云同步的存档键（currentGame 不同步：H5 无恢复对局流程，同步无意义）。 */
  var SYNC_KEYS = ['tractor:stats', 'tractor:settings', 'tractor:ruleOverrides', 'tractor:maxBids'];

  var listeners = { state: [], sync: [] };
  var user = null;          // {uid, nick, name, isGuest}
  var token = null;
  var pushTimer = null;
  var pushing = false;
  var pushPending = false;

  /* ---------- 存储 ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 满/隐私模式静默 */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } }

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
    SYNC_KEYS.forEach(function (k) { var v = lsGet(k); if (v !== null) data[k] = v; });
    return data;
  }

  function applyData(data) {
    if (!data) return;
    SYNC_KEYS.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(data, k)) lsSet(k, data[k]);
    });
  }

  function localAt() { return Number(lsGet(LS_LOCAL_AT)) || 0; }

  /** 战绩汇总（排行榜数据源：满分坐庄次数为主，局数为辅）；GameCore 未加载时返回 null 不上报。 */
  function summarize() {
    try {
      var C = window.GameCore;
      if (!C || !C.stats || !C.storage || !C.STORAGE_KEYS) return null;
      var records = C.storage.get(C.STORAGE_KEYS.STATS) || [];
      var s = C.stats.summarize(records);
      return {
        rounds: s.totalRounds, wins: s.wins, losses: s.losses,
        maxBids: Number(lsGet('tractor:maxBids')) || 0
      };
    } catch (e) { return null; }
  }

  /* ---------- 请求 ---------- */
  var hasFetch = (typeof fetch === 'function'); // jsdom/极老 webview 无 fetch：云端整体降级，游戏照常

  /** 最近一次后端请求的结果（弹层诊断行用：定位"登录了却未连接"这类现场问题）。 */
  var lastReq = null; // {path, ok, status, ms}；网络层异常时 status 为 0

  function api(path, opts) {
    if (!hasFetch) return Promise.reject(new Error('no fetch'));
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (opts.auth && token) headers['Authorization'] = 'Bearer ' + token;
    var t0 = Date.now();
    return fetch(CLOUD_BASE + '/api/' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      lastReq = { path: path, ok: r.ok, status: r.status, ms: Date.now() - t0 };
      if (!r.ok) {
        var err = new Error('http ' + r.status);
        err.status = r.status;
        throw err;
      }
      return r.json();
    }).catch(function (e) {
      if (!lastReq || lastReq.path !== path) lastReq = { path: path, ok: false, status: (e && e.status) || 0, ms: Date.now() - t0 };
      throw e;
    });
  }

  /* ---------- 同步核心 ---------- */
  /** 远端档案落本地或触发反向推送（谁新听谁的）。 */
  function mergeRemote(save) {
    if (!save || !save.data) {
      // 云端空档案（新账号）：本地有数据就推上去
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
    return api('sync', {
      method: 'PUT',
      auth: true,
      body: {
        save: { updatedAt: localAt() || Date.now(), data: collectData() },
        lb: summarize()
      }
    }).then(function (r) {
      if (r && r.kept === 'server') {
        // 双端同时改且服务端更新（罕见）：拉回来
        return pull();
      }
    }).catch(function (e) {
      if (e && e.status === 401) reGuest(); // token 失效：重建游客，本地数据随后自动推
      // 网络失败静默：下次 notifyLocal/flush 再试
    }).then(function () {
      pushing = false;
      if (pushPending) { pushPending = false; schedulePush(); }
    });
  }

  function pull() {
    return api('sync', { auth: true }).then(function (r) { mergeRemote(r.save); }).catch(function (e) {
      if (e && e.status === 401) reGuest();
    });
  }

  /** token 失效/无 token：建游客（本地战绩随后 push 上去，不丢）。 */
  function reGuest() {
    return api('auth/guest', { method: 'POST', body: {} }).then(function (r) {
      setState(r.user, r.token);
      schedulePush();
    }).catch(function (e) { /* 离线：保持现状，下次再试 */ });
  }

  /* ---------- 对外 API ---------- */
  window.Cloud = {
    /** 启动：恢复登录态并做一次拉取合并。opts.onSync 在远端档案落地后回调（UI 刷新）。 */
    init: function (opts) {
      if (opts && opts.onSync) listeners.sync.push(opts.onSync);
      token = lsGet(LS_TOKEN);
      try { user = JSON.parse(lsGet(LS_USER) || 'null'); } catch (e) { user = null; }
      if (token && user) {
        emit('state'); // 恢复登录态要立刻通知 UI：boot 时 renderHome 先于 init 跑过，状态行还停在"未连接"
        pull();
      } else {
        setState(null, null);
        reGuest();
      }
    },

    /** 账号状态：'off' 未连上 / 'guest' 游客 / 'user' 正式账号。 */
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
      else reGuest(); // 启动时建档失败会停在"未连接"：本地一有新数据就重试，连上即自动补推
    },

    /** 立即推送（页面隐藏等收尾时机）。 */
    flush: function () {
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      return push();
    },

    /** 游客升级为正式账号（uid 不变，战绩不丢）。 */
    bind: function (name, pass) {
      return api('auth/bind', { method: 'POST', auth: true, body: { username: name, password: pass } })
        .then(function (r) { setState(r.user, token); return r.user; });
    },

    /** 登录已有账号（换设备找回）：成功后按 LWW 合并两边档案。 */
    login: function (name, pass) {
      return api('auth/login', { method: 'POST', body: { username: name, password: pass } })
        .then(function (r) {
          setState(r.user, r.token);
          return mergeRemote(r.save);
        });
    },

    /** 拉排行榜（满分庄家榜，公开接口无需登录）。 */
    leaderboard: function () {
      return api('leaderboard').then(function (r) { return r.list || []; });
    },

    /** 现场诊断（弹层诊断行用）：入口域名、本机登录态、最近一次后端请求结果。 */
    diag: function () {
      return {
        host: (typeof location !== 'undefined' && location.host) || '?',
        saved: !!(lsGet(LS_TOKEN) && lsGet(LS_USER)),
        last: lastReq
      };
    },

    on: function (evt, fn) { if (listeners[evt]) listeners[evt].push(fn); }
  };
})();
