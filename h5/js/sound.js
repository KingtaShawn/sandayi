/**
 * h5/js/sound.js —— Web Audio 音效模块（零素材，全部程序合成）。
 *
 * 出牌/选牌/发牌/拿底/叫分/收墩/结算等动作音效不用任何音频文件：
 * 带通白噪声 = 拍牌/洗牌，振荡器音阶 = 叫分/得分/胜负提示。
 * 浏览器自动播放策略：首次用户手势解锁 AudioContext（app.js 挂 unlock）；
 * 静音状态存 localStorage（键同 STORAGE_KEYS.SETTINGS，settings.sound）。
 */
'use strict';

(function () {
  if (window.SoundFx) return; // 防重复加载

  const SETTINGS_KEY = 'tractor:settings'; // 与小程序 STORAGE_KEYS.SETTINGS 同键，设置互通

  let ctx = null;      // AudioContext（懒创建，老浏览器缺 API 时整体静默）
  let master = null;   // 总增益
  let unlocked = false;
  let enabled = true;
  let noiseBuf = null; // 白噪声缓冲（0.5s 预生成复用）
  let mediaEl = null;  // 静音 <audio>（iOS 静音拨片/微信 webview 的会话解锁）
  const lastPlayAt = Object.create(null); // 同名音效上次播放时刻（节流用）

  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (typeof s.sound === 'boolean') enabled = s.sound;
  } catch (e) { /* 坏档忽略 */ }

  function save() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      s.sound = enabled;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) { /* 存满/隐私模式静默 */ }
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1; // 手机外放要足量，桌面也不炸（各音效自带包络峰值）
    master.connect(ctx.destination);
    return ctx;
  }

  /** 极短静音 WAV data URI（8kHz·50ms·8bit）——媒体元素解锁用 */
  function silentWavUri() {
    const sr = 8000, n = 400;
    const b = new ArrayBuffer(44 + n);
    const u = new Uint8Array(b);
    const dv = new DataView(b);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) u[o + i] = s.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    w(36, 'data'); dv.setUint32(40, n, true);
    for (let i = 0; i < n; i++) u[44 + i] = 128; // 8bit PCM 静音 = 128
    let bin = '';
    for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }

  /**
   * 媒体会话解锁：iOS 的 Ring/Silent 拨片会静音 Web Audio，微信 webview 同理；
   * 手势内播放一个循环静音 <audio> 把会话切到「媒体播放」路由后不再受影响。
   */
  function unlockMedia() {
    if (mediaEl) return;
    try {
      mediaEl = new Audio(silentWavUri());
      mediaEl.playsInline = true;
      mediaEl.loop = true;
      mediaEl.volume = 0;
      const p = mediaEl.play();
      if (p && p.catch) p.catch(() => { /* 播不了就撤，不影响 Web Audio 主线 */ });
    } catch (e) { mediaEl = null; }
  }

  /** 白噪声源（预生成一份缓冲，每次新建 source 复用） */
  function noiseSrc() {
    if (!noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    return s;
  }

  /** 噪声脉冲：带通滤波的短促「啪/嗒」——拍牌、洗牌、收墩的基元 */
  function burst(t0, dur, freq, q, peak) {
    const f = freq * (0.92 + Math.random() * 0.16); // 微随机走音，避免机械感
    const src = noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** 单音：振荡器 + 指数包络（叫分/得分/胜负提示的基元），slideTo 可做滑音 */
  function tone(t0, dur, freq, type, peak, slideTo) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /* ========== 音效定义（t = 起始时刻，n = 张数） ========== */
  const FX = {
    /** 出牌：牌拍桌面——高频脆响 + 低频厚度，多张逐张错开像一把牌甩下 */
    play(t, n) {
      const count = Math.min(n || 1, 4);
      for (let i = 0; i < count; i++) {
        const t0 = t + i * 0.045;
        burst(t0, 0.09, 2600 + i * 250, 1.4, 0.5);
        tone(t0, 0.06, 150, 'sine', 0.26);
      }
    },
    /** 选牌：轻点一声 */
    select(t) { burst(t, 0.045, 4200, 2.2, 0.3); },
    /** 发牌逐张：更轻更短的「嗒」 */
    deal(t) { burst(t, 0.035, 3300, 2.5, 0.16); },
    /** 洗牌：两声擦牌 */
    shuffle(t) {
      burst(t, 0.14, 1200, 0.8, 0.18);
      burst(t + 0.1, 0.16, 900, 0.8, 0.2);
    },
    /** 拿底牌：噪声带上扫的呼啸 */
    grab(t) {
      const src = noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(500, t);
      bp.frequency.exponentialRampToValueAtTime(2400, t + 0.28);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      src.connect(bp).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.36);
    },
    /** 叫分：上行双音 */
    bid(t) { tone(t, 0.1, 660, 'triangle', 0.3); tone(t + 0.09, 0.14, 880, 'triangle', 0.3); },
    /** 不叫：低回单音 */
    pass(t) { tone(t, 0.16, 330, 'triangle', 0.26, 290); },
    /** 选主：三连上行 */
    trump(t) {
      tone(t, 0.09, 587, 'triangle', 0.28);
      tone(t + 0.08, 0.09, 740, 'triangle', 0.28);
      tone(t + 0.16, 0.16, 988, 'triangle', 0.3);
    },
    /** 收墩：牌堆拢起一滑 */
    collect(t) { burst(t, 0.13, 1600, 0.9, 0.22); },
    /** 得分：清亮双叮 */
    score(t) { tone(t, 0.12, 1047, 'sine', 0.3); tone(t + 0.1, 0.2, 1568, 'sine', 0.32); },
    /** 胜利：上行小号角（三角波主体 + 低八度衬底） */
    win(t) {
      [523, 659, 784, 1047].forEach((f, i) => {
        const dur = i === 3 ? 0.42 : 0.14;
        tone(t + i * 0.12, dur, f, 'triangle', 0.3);
        tone(t + i * 0.12, dur, f / 2, 'sine', 0.14);
      });
    },
    /** 失败：下行叹气 */
    lose(t) {
      [392, 330, 262].forEach((f, i) => tone(t + i * 0.16, 0.22, f, 'triangle', 0.24));
    },
    /** 非法操作：低频双振 */
    error(t) {
      tone(t, 0.07, 130, 'square', 0.16);
      tone(t + 0.1, 0.07, 130, 'square', 0.16);
    }
  };

  /** 高频音效的最小同名间隔（ms），防连点爆音；其余默认 45ms */
  const THROTTLE_MS = { deal: 70, select: 55 };

  window.SoundFx = {
    isEnabled: () => enabled,
    /** 音频通道状态（开关按钮回调做「被系统拦下」提示用） */
    state() {
      if (!ctx) return 'idle';
      return ctx.state; // running / suspended / closed / interrupted(iOS)
    },
    /** 开关（开时顺手解锁并播确认音；点击本身即用户手势） */
    toggle() {
      enabled = !enabled;
      save();
      if (enabled) {
        this.unlock();
        this.play('select');
      }
      return enabled;
    },
    /**
     * 手势解锁（iOS/Chrome 自动播放策略）。可重入：低电量模式/微信 webview
     * 里 resume 可能被拒，之前一次性标记会永远哑掉——running 前每次手势都重试。
     */
    unlock() {
      if (!ensureCtx()) return;
      if (ctx.state !== 'running') ctx.resume().catch(() => { /* 下次手势再试 */ });
      unlockMedia();
      unlocked = true;
    },
    /** 播放音效：play('play', { count: 3 }) —— count 供出牌多张错峰 */
    play(name, opts) {
      if (!enabled || !unlocked) return;
      if (!ensureCtx()) return;
      const fn = FX[name];
      if (!fn) return;
      const now = Date.now();
      const gap = THROTTLE_MS[name] || 45;
      if (lastPlayAt[name] && now - lastPlayAt[name] < gap) return;
      lastPlayAt[name] = now;
      try {
        if (ctx.state === 'suspended') ctx.resume().catch(() => { /* 忽略 */ });
        fn(ctx.currentTime + 0.01, (opts && opts.count) || 1);
      } catch (e) { /* 音频失败不影响游戏 */ }
    }
  };
})();
