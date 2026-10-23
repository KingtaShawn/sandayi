/**
 * h5/js/app.js —— 三打一 H5 版主程序。
 *
 * 忠实移植 miniprogram/pages/table/table.js 的全部逻辑（渲染/AI 驱动/双动画/智能选牌/结算），
 * setData → 直接 DOM 更新；wx.* → DOM 等价实现（toast/localStorage/震动）。
 * 引擎经 game-bundle.js（tools/build-bundle.js 生成）零改动复用。
 */
'use strict';

(function () {
  // ===== 加载自检与错误显示（真机无控制台，页面顶部红条直显错误） =====
  function showErrBar(msg) {
    let bar = document.getElementById('err-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'err-bar';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#d0342c;color:#fff;font-size:12px;padding:8px 12px;word-break:break-all;';
      (document.body || document.documentElement).appendChild(bar);
    }
    bar.textContent = '⚠ ' + msg;
  }
  window.addEventListener('error', (e) => {
    showErrBar((e.message || '脚本错误') + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : ''));
  });
  if (!window.GameCore) {
    showErrBar('游戏引擎(game-bundle.js)未加载成功——请刷新重试；若反复出现请检查网络');
    return;
  }

  const C = window.GameCore;
  const { GameService, createConfig, DEFAULT_CONFIG, getHint, fmt, storage, STORAGE_KEYS, stats, createRng, ruleConfig, scoreBidOptions } = C;

  /* ========== wx 等价物 ========== */
  // storage/adapter 检测 wx.setStorageSync —— 注入 localStorage 版 wx 垫片后存档直接持久化
  window.wx = {
    setStorageSync: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 满/隐私模式静默 */ } },
    getStorageSync: (k) => {
      try {
        const raw = localStorage.getItem(k);
        return raw === null ? '' : JSON.parse(raw);
      } catch (e) { return ''; }
    },
    removeStorageSync: (k) => { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } },
    vibrateShort: () => { if (navigator.vibrate) navigator.vibrate(15); }
  };

  /* ========== 小工具 ========== */
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const d = document.createElement(tag || 'div');
    if (cls) d.className = cls;
    if (html !== undefined) d.innerHTML = html;
    return d;
  };
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    t.classList.remove('toast--hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.add('toast--hidden'); setTimeout(() => { t.hidden = true; }, 300); }, 1800);
  }
  const SYMBOLS = { S: '♠', H: '♥', C: '♣', D: '♦' };
  const SEAT_LABELS = ['南', '东', '北', '西'];

  /* ========== 视图切换 ========== */
  function showView(name) {
    ['home', 'rules', 'table'].forEach((v) => { $('view-' + v).hidden = (v !== name); });
  }

  /* ========== 卡牌 DOM ========== */
  /**
   * 单张卡牌元素（移植 card 组件 refresh 逻辑）。
   * @param {object} card {id, suit, rank, isJoker, isTrump, pointValue}
   */
  function cardEl(card, opts) {
    const o = opts || {};
    const d = el('div', 'card');
    const isJoker = !!card.isJoker;
    const isBig = card.rank === 'BJ';
    const red = isJoker ? isBig : (card.suit === 'H' || card.suit === 'D');
    let cls = 'card ' + (red ? 'card--red' : 'card--black');
    if (isJoker) cls += ' card--joker' + (isBig ? ' card--joker-big' : '');
    if (card.isTrump) cls += ' card--trump';
    if (o.selected) cls += ' card--selected';
    if (o.dense) cls += ' card--dense';
    if (o.playIn) cls += ' anim-play-in';
    if (o.shaking) cls += ' anim-shake';
    d.className = cls;
    if (o.styleText) d.setAttribute('style', o.styleText);
    if (o.playInDelay) d.style.animationDelay = o.playInDelay + 'ms';
    const displayRank = isJoker ? (isBig ? '★' : '☆') : card.rank;
    const suitSymbol = isJoker ? '王' : (SYMBOLS[card.suit] || '');
    d.appendChild(el('div', 'card__corner',
      `<div class="card__rank${isJoker ? ' card__rank--star' : ''}">${displayRank}</div><div class="card__suit">${suitSymbol}</div>`));
    return d;
  }

  /* ========== 座位信息 DOM ========== */
  function seatEl(p, i, st, animState) {
    const isSDY = st.config.gameMode === 'san_da_yi';
    const vertical = (i === 1 || i === 3);
    const isTurn = st.turnIdx === i && st.phase !== 'SCORING' && st.phase !== 'GAME_OVER';
    let handCount;
    if (animState.dealing && animState.dealCounts) handCount = animState.dealCounts[i] || 0;
    else if (animState.grabbing && i === st.dealerIdx) handCount = Math.min(p.hand.length, p.hand.length - (st.config.bottomCards || 8) + (animState.grabFlyCount || 0));
    else handCount = p.hand.length;
    const camp = isSDY
      ? (st.sanDaYiTeams && st.sanDaYiTeams.dealer === i ? '' : '对手')
      : (i === 2 ? '队友' : (i === 0 ? '' : '对手'));
    let cls = 'seat-info' + (vertical ? ' seat-info--vertical' : '') + (isTurn ? ' seat-info--turn' : '');
    const d = el('div', cls);
    const badge = (st.dealerIdx === i) ? '<div class="seat-info__dealer-badge">庄</div>' : '';
    // 三打一报分阶段：本座位最新报分/不叫 挂在座位旁（去中心化，不占中央）
    let bidChip = '';
    if (isSDY && st.phase === 'BIDDING') {
      const mine = (st.bids || []).filter((b) => b.type === 'score_bid' && b.playerIdx === i);
      if (mine.length) bidChip = `<div class="seat-info__bid-bubble">叫 ${mine[mine.length - 1].score}</div>`;
      else if ((st.passedBidders || []).includes(i)) bidChip = '<div class="seat-info__bid-bubble seat-info__bid-bubble--pass">不叫</div>';
    }
    d.innerHTML = `
      <div class="seat-info__avatar"><span class="seat-info__avatar-text">${SEAT_LABELS[i]}</span>${badge}</div>
      <div class="seat-info__meta">
        <span class="seat-info__name">${p.name}</span>
        ${vertical ? '' : `<span class="seat-info__cards">剩 ${handCount} 张</span>`}
      </div>
      ${isTurn ? '<div class="seat-info__thinking"><span class="seat-info__dot"></span><span class="seat-info__dot seat-info__dot--2"></span><span class="seat-info__dot seat-info__dot--3"></span></div>' : ''}
      ${camp ? `<span class="seat-info__camp${camp === '对手' ? ' seat-info__camp--foe' : ''}">${camp}</span>` : ''}
      ${bidChip}
    `;
    return d;
  }

  /* ========== 游戏主控（移植 table.js Page 逻辑） ========== */
  const G = {
    service: null,
    selectedIds: [],
    lastPickId: null, // smartToggle 本次选入时点的那张（再点它=撤销整组）
    lastAdded: null, // smartToggle 本次选入的组
    prevHandIds: null,
    handVisibleCount: 999,
    dealAnim: { active: false, counts: [0, 0, 0, 0], flyCards: [] },
    grabBottom: { active: false, stage: 'show', dealerIdx: 0, cards: [], flyCount: 0, flyCards: [] },
    _dealAnimating: false,
    _grabAnimating: false,
    _grabObservedMerged: undefined,
    _dealTimer: null,
    _dealWatchdog: null,
    _grabTimer: null,
    _aiTimer: null,
    _watchdog: null,
    lastFloatKey: '',
    lastTapCardId: '',
    lastTapAt: 0,
    lastHandKey: ''
  };
  const DOUBLE_TAP_MS = 320;

  /** 合并规则配置（rule-config 文件覆盖 → 存档覆盖 → 默认） */
  function buildConfig() {
    let overrides = {};
    try { overrides = storage.getJSON(STORAGE_KEYS.RULE_OVERRIDES) || {}; } catch (e) { overrides = {}; }
    overrides = Object.assign({}, ruleConfig, overrides);
    Object.keys(overrides).forEach((k) => { if (k.charAt(0) === '_') delete overrides[k]; });
    try { return createConfig(overrides); } catch (e) { return DEFAULT_CONFIG; }
  }

  function startGame() {
    G.service = new GameService({ config: buildConfig(), rng: createRng() });
    G.selectedIds = [];
    G.lastAdded = null;
    G.prevHandIds = null;
    G._grabObservedMerged = undefined;
    G.lastFloatKey = '';
    G.lastHandKey = '';
    G.service.startGame();
    showView('table');
    render();
    driveAI();
  }

  /* ---------- 渲染 ---------- */
  function decorateCard(st, c) {
    const ti = st.trumpInfo;
    let isTrump = false;
    if (ti) {
      try {
        isTrump = c.isJoker || (ti.trumpIds && ti.trumpIds.has ? ti.trumpIds.has(`${c.suit}-${c.rank}`) : false);
      } catch (e) { isTrump = false; }
      if (ti.isNoTrump && !c.isJoker && c.rank === ti.levelRank) isTrump = true;
    } else if (st.config && st.config.gameMode === 'san_da_yi') {
      isTrump = c.isJoker || c.rank === '2'; // 选主前：王与 2 本就是常主，先归主牌区
    }
    return Object.assign({}, c, {
      isTrump,
      pointValue: (st.config.pointValues && st.config.pointValues[c.rank]) || 0
    });
  }

  function buildHandView(st) {
    return st.players[0].hand.map((c) => decorateCard(st, c));
  }

  function renderHand(st, newIds) {
    const row = $('hand-row');
    const all = buildHandView(st);
    const visible = all.slice(0, Math.max(0, G.handVisibleCount));
    const n = visible.length;
    const dense = n > 24;
    const usable = 93.33; // rem（700rpx，满宽=100rem）
    const cardW = dense ? 8.53 : 11.73;
    let margin = n > 1 ? Math.floor(((usable - cardW) / (n - 1)) * 100) / 100 - cardW : 0;
    if (margin > -0.8) margin = -0.8;
    if (margin < -8.8) margin = -8.8;
    // 排序：副牌左（花色/牌面升序），主牌右——主牌区再分「王+级牌（常主）」与主花色
    // 两段：2 不散落各花色（三打一级牌恒为 2），主级牌排同级牌最前
    const suitOrder = { S: 1, H: 2, C: 3, D: 4 };
    const rankVal = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14, RJ: 15, BJ: 16 };
    const ti0 = st.trumpInfo;
    const levelRank = ti0 ? ti0.levelRank : (st.config.gameMode === 'san_da_yi' ? '2' : '');
    const trumpSuit = ti0 ? ti0.trumpSuit : '';
    const sorted = visible.slice().sort((a, b) => {
      const ta = a.isTrump ? 1 : 0, tb = b.isTrump ? 1 : 0;
      if (ta !== tb) return ta - tb;
      const ga = (a.isJoker || a.rank === levelRank) ? 0 : 1;
      const gb = (b.isJoker || b.rank === levelRank) ? 0 : 1;
      if (ga !== gb) return ga - gb;
      if (a.rank === levelRank && b.rank === levelRank) {
        const pa = a.suit === trumpSuit ? 0 : 1, pb = b.suit === trumpSuit ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      const sa = a.isJoker ? 0 : (suitOrder[a.suit] || 9), sb = b.isJoker ? 0 : (suitOrder[b.suit] || 9);
      if (sa !== sb) return sa - sb;
      return (rankVal[a.rank] || 0) - (rankVal[b.rank] || 0);
    });
    const isDealing = all.length > n;
    const newIdSet = new Set(newIds || []);
    // keyed diff：仅当手牌集合变化才重建（防动画重放）；selected 变化走轻量 class 切换
    const handKey = sorted.map((c) => c.id).join(',') + '|' + n + '|' + (dense ? 1 : 0);
    if (handKey !== G.lastHandKey) {
      G.lastHandKey = handKey;
      row.innerHTML = '';
      let firstTrumpSeen = false;
      sorted.forEach((c, i) => {
        const isTrumpHead = c.isTrump && !firstTrumpSeen;
        if (isTrumpHead) firstTrumpSeen = true;
        if (isTrumpHead && i > 0) row.appendChild(el('div', 'hand-area__divider'));
        const styleText = i === 0 ? '' : `margin-left:${isTrumpHead ? Math.max(margin, -5.33) : margin}rem`;
        const playIn = isDealing || newIdSet.has(c.id);
        const d = cardEl(c, {
          selected: G.selectedIds.includes(c.id),
          dense, playIn,
          playInDelay: isDealing ? (i % 5) * 30 : 0,
          styleText
        });
        d.dataset.cardId = c.id;
        d.addEventListener('click', () => onCardTap(c));
        // 桌面端右键选牌/出牌（e.button===2 过滤，避免吃掉手机长按的系统菜单）
        d.addEventListener('contextmenu', (e) => onCardContext(e, c));
        row.appendChild(d);
      });
    } else {
      // 集合未变：只同步 selected 态
      const children = row.children;
      for (let i = 0; i < children.length; i++) {
        const d = children[i];
        if (!d.dataset.cardId) continue;
        const on = G.selectedIds.includes(d.dataset.cardId);
        d.classList.toggle('card--selected', on);
      }
    }
    return sorted.map((c) => c.id);
  }

  function renderTrick(st) {
    const area = $('trick-area');
    let trick = st.currentTrick;
    let dim = false;
    if (st.phase === 'PLAYING' && !st.currentTrick && st.completedTricks.length) {
      trick = st.completedTricks[st.completedTricks.length - 1];
      dim = true;
    }
    area.className = 'trick-area' + (dim ? ' trick-area--dim' : '');
    area.innerHTML = '';
    if (!trick || !trick.plays) return;
    const bySeat = { 0: [], 1: [], 2: [], 3: [] };
    trick.plays.forEach((p) => { bySeat[p.playerIdx] = bySeat[p.playerIdx].concat(p.cards.map((c) => decorateCard(st, c))); });
    const seatRow = (cards) => {
      const s = el('div', 'trick-area__seat');
      cards.forEach((c, i) => {
        // 出牌区用小一号牌面（.trick-area .card 专属规格），不与手牌等大抢视觉
        s.appendChild(cardEl(c, { playIn: !dim, styleText: `margin-left:${i === 0 ? 0 : -3.47}rem` }));
      });
      return s;
    };
    area.appendChild(seatRow(bySeat[2])); // 北
    const mid = el('div', 'trick-area__middle');
    mid.appendChild(seatRow(bySeat[3])); // 西
    const holder = el('div', 'trick-area__bottom-holder');
    area.appendChild(mid).appendChild(holder);
    mid.insertBefore(seatRow(bySeat[1]), holder.nextSibling || null); // 东
    area.appendChild(seatRow(bySeat[0])); // 南
  }

  function renderAnim(st) {
    // 发牌动画层
    const da = $('deal-anim');
    da.hidden = !G.dealAnim.active;
    if (G.dealAnim.active) {
      const wrap = $('deal-anim-fly');
      wrap.innerHTML = '';
      G.dealAnim.flyCards.forEach((f) => {
        const d = el('div', 'deal-anim__fly deal-anim__fly--s' + f.seat);
        d.style.animationDelay = f.delayMs + 'ms';
        wrap.appendChild(d);
      });
    }
    // 抓底牌动画层
    const ga = $('grab-anim');
    ga.hidden = !G.grabBottom.active;
    if (G.grabBottom.active) {
      const cardsWrap = $('grab-anim-cards');
      cardsWrap.innerHTML = '';
      G.grabBottom.cards.forEach((c, i) => {
        const d = el('div', 'grab-anim__card' + (i < G.grabBottom.flyCount ? ' grab-anim__card--gone' : ''));
        d.style.animationDelay = c.delay + 'ms';
        cardsWrap.appendChild(d);
      });
      const flyWrap = $('grab-anim-fly');
      flyWrap.innerHTML = '';
      G.grabBottom.flyCards.forEach((f) => {
        flyWrap.appendChild(el('div', 'deal-anim__fly deal-anim__fly--s' + f.seat));
      });
    }
  }

  function renderActionBar(st, view) {
    const slot = $('action-slot');
    slot.innerHTML = '';
    // 报分/选主条（选主阶段：bidMode='trump' 由 render 尾部填充，此处需同时覆盖 BIDDING 与 CHOOSE_TRUMP）
    if (!G.dealAnim.active && !G.grabBottom.active && (view.isHumanTurnBid || view.isHumanChooseTrump)) {
      const bar = el('div', 'bid-bar');
      bar.appendChild(el('div', 'bid-bar__tip', view.bidTipText));
      if (view.bidMode === 'score') {
        const opts = el('div', 'bid-bar__options');
        view.scoreOptions.forEach((s) => {
          const b = el('div', 'bid-bar__option', `<span class="bid-bar__option-label">${s}分</span>`);
          b.addEventListener('click', () => onScoreBid(s));
          opts.appendChild(b);
        });
        bar.appendChild(opts);
        const pass = el('div', 'bid-bar__pass', view.passLabel);
        pass.addEventListener('click', onPassBid);
        bar.appendChild(pass);
      } else if (view.bidMode === 'trump') {
        const opts = el('div', 'bid-bar__options');
        view.suitOptions.forEach((s) => {
          const b = el('div', `bid-bar__option bid-bar__option--suit${s.red ? ' bid-bar__option--red' : ''}`,
            `<span class="bid-bar__suit-symbol">${s.symbol}</span><span class="bid-bar__option-sub">${s.count} 张</span>`);
          b.addEventListener('click', () => onChooseTrump(s.suit));
          opts.appendChild(b);
        });
        bar.appendChild(opts);
      }
      slot.appendChild(bar);
    }
    // 埋底条
    if (!G.dealAnim.active && !G.grabBottom.active && view.isHumanDealer && st.phase === 'BURYING') {
      const bar = el('div', 'bury-bar');
      bar.innerHTML = `<div class="bury-bar__tip">选择 ${view.needBuryCount} 张埋底（已选 ${G.selectedIds.length}/${view.needBuryCount}）</div>`;
      const btn = el('button', 'bury-bar__confirm' + (G.selectedIds.length === view.needBuryCount ? '' : ' btn--disabled'), '确认埋底');
      btn.addEventListener('click', onBuryConfirm);
      bar.appendChild(btn);
      slot.appendChild(bar);
    }
    // 出牌按钮
    if (st.phase === 'PLAYING' && st.turnIdx === 0) {
      const canPlay = G.selectedIds.length > 0 && G.selectedIds.length === view.needPlayCount;
      const play = el('button', 'btn btn--primary' + (canPlay ? ' anim-pulse' : ' btn--disabled'), '出牌');
      play.addEventListener('click', onPlay);
      slot.appendChild(play);
      const clear = el('button', 'btn btn--ghost', '重选');
      clear.addEventListener('click', onClearSelect);
      slot.appendChild(clear);
    }
  }

  function renderResult(st, view) {
    const modal = $('result-modal');
    if (!(st.phase === 'SCORING' || st.phase === 'GAME_OVER') || !view.settle) {
      modal.hidden = true;
      return;
    }
    modal.hidden = false;
    const banner = $('result-banner');
    banner.textContent = view.settleBanner;
    banner.className = 'result-modal__banner' + (view.settleIsWin ? ' result-modal__banner--win' : '');
    const scores = $('result-scores');
    scores.innerHTML = '';
    const addItem = (label, value, gold) => {
      scores.appendChild(el('div', 'result-modal__score-item',
        `<span class="result-modal__score-label">${label}</span><span class="result-modal__score-value${gold ? ' result-modal__score-value--gold' : ''}">${value}</span>`));
    };
    addItem('庄家得分', view.settle.dealerPoints);
    if (view.settle.attackerPoints !== undefined) addItem('闲家得分', view.settle.attackerPoints);
    addItem('合同分', view.settle.contractScore, true);
    if (view.settle.bottomGained > 0) addItem('收底 +' + view.settle.bottomGained, '×1', true);
    if (view.settle.penaltyTotal > 0) addItem('罚分', view.settle.penaltyTotal);
    // 底牌翻开
    const bottomWrap = $('result-bottom');
    const bc = st.bottomCards || [];
    if (bc.length) {
      bottomWrap.hidden = false;
      const wrap = $('result-bottom-cards');
      wrap.innerHTML = '';
      bc.forEach((c, i) => wrap.appendChild(cardEl(decorateCard(st, c), { styleText: `margin-left:${i === 0 ? 0 : -6.13}rem` })));
    } else {
      bottomWrap.hidden = true;
    }
    $('btn-result-next').hidden = (st.phase === 'GAME_OVER');
  }

  function render() {
    const st = G.service.getState();
    if (!st) return;
    const isSDY = st.config.gameMode === 'san_da_yi';
    const dealerTeam = isSDY && st.sanDaYiTeams ? 0 : st.players[st.dealerIdx].team;
    const isHumanDealer = (st.phase === 'BURYING' || st.phase === 'CHOOSE_TRUMP') && st.players[st.dealerIdx].isHuman;
    const isHumanTurnBid = st.phase === 'BIDDING' && (isSDY ? st.turnIdx === 0 : humanBidPending(st));
    const isHumanChooseTrump = st.phase === 'CHOOSE_TRUMP' && st.players[st.dealerIdx].isHuman;
    const needPlayCount = (st.currentTrick && st.currentTrick.leadCombo) ? st.currentTrick.leadCombo.n : G.selectedIds.length;

    const grabStarted = detectGrabBottom(st);
    const newIds = detectNewCards(st, grabStarted);

    const view = {
      isHumanTurnBid, isHumanDealer, isHumanChooseTrump, needPlayCount,
      needBuryCount: st.config.bottomCards
    };

    // 状态栏
    const sb = $('status-bar');
    const myScore = isSDY && st.sanDaYiTeams
      ? (st.sanDaYiTeams.dealer === 0 ? sumDealerPoints(st) : sumAttackerPoints(st))
      : st.scores.team0;
    const enemyScore = isSDY && st.sanDaYiTeams
      ? (st.sanDaYiTeams.dealer === 0 ? sumAttackerPoints(st) : sumDealerPoints(st))
      : st.scores.team1;
    const myLabel = isSDY && st.sanDaYiTeams ? (st.sanDaYiTeams.dealer === 0 ? '庄家' : '三家') : '我方';
    const enLabel = isSDY && st.sanDaYiTeams ? (st.sanDaYiTeams.dealer === 0 ? '三家' : '庄家') : '敌方';
    const trickInfo = st.completedTricks.length ? `已 ${st.completedTricks.length} 墩` : '';
    sb.innerHTML = `
      <div class="status-bar__item"><span class="status-bar__label">${isSDY ? '模式' : '主牌'}</span><span class="status-bar__value status-bar__value--gold">${isSDY ? '三打一' : fmt.trumpLabel(st.trumpInfo)}</span></div>
      <div class="status-bar__score status-bar__score--mine"><span class="status-bar__score-label">${myLabel}</span><span class="status-bar__score-value">${myScore}</span></div>
      <div class="status-bar__divider"></div>
      <div class="status-bar__score status-bar__score--enemy"><span class="status-bar__score-label">${enLabel}</span><span class="status-bar__score-value">${enemyScore}</span></div>
      <div class="status-bar__item"><span class="status-bar__label">${isSDY ? (st.contractScore ? '合同' : '报分中') : '第' + st.roundNo + '局'}</span><span class="status-bar__value ${isSDY && st.contractScore ? 'status-bar__value--gold' : 'status-bar__value--dim'}">${isSDY && st.contractScore ? st.contractScore + '分' : trickInfo}</span></div>
    `;

    // 主牌胶囊
    const chip = $('trump-chip');
    chip.textContent = isSDY
      ? (st.trumpInfo ? `三打一 · 主${SYMBOLS[st.trumpInfo.trumpSuit] || ''}` : '三打一 · 报分中')
      : (st.trumpInfo ? `打 ${st.trumpInfo.levelRank}` : '');

    // 手牌提示
    const hl = $('hand-label');
    const myBid = (st.bids || []).filter((b) => b.type === 'score_bid' && b.playerIdx === 0).pop();
    hl.textContent = (G._grabAnimating && G.grabBottom.active)
      ? (st.players[st.dealerIdx].isHuman ? '底牌飞入你的手牌…' : `${st.players[st.dealerIdx].name}拿底牌中…`)
      : (st.phase === 'PLAYING'
        ? (st.turnIdx === 0 ? '轮到你出牌（点牌成组选入，再点同一张收回；双击直接出，右键已选牌出）' : '等待其他玩家…')
        : (st.phase === 'BIDDING'
          ? (isSDY
            ? (st.turnIdx === 0 && !(st.passedBidders || []).includes(0)
              ? '轮到你叫分'
              : (myBid ? `你叫 ${myBid.score} 分，等待其他玩家…`
                : ((st.passedBidders || []).includes(0) ? '已不叫，等待其他玩家…' : '等待其他玩家叫分…')))
            : '亮主阶段')
          : (st.phase === 'CHOOSE_TRUMP' ? (st.players[st.dealerIdx].isHuman ? '轮到你选主牌花色' : '庄家选主中…') : (st.phase === 'BURYING' ? '埋底阶段' : ''))));

    // 座位
    const animState = {
      dealing: G._dealAnimating,
      dealCounts: G.dealAnim.counts,
      grabbing: G._grabAnimating && G.grabBottom.active,
      grabFlyCount: G.grabBottom.flyCount
    };
    [2, 3, 1].forEach((i) => {
      const holder = $('seat-' + i);
      holder.innerHTML = '';
      holder.appendChild(seatEl(st.players[i], i, st, animState));
    });

    // 手牌/出牌区/动画层
    renderHand(st, newIds);
    renderTrick(st);
    renderAnim(st);

    // 操作条（含报分选项计算）
    if (isHumanTurnBid && isSDY && !(st.passedBidders || []).includes(0)) {
      view.bidMode = 'score';
      view.scoreOptions = scoreBidOptions(st, 0, st.config);
      const highest = st.scoreBidHighest;
      view.bidTipText = highest
        ? `当前最高 ${highest.score} 分（${['南', '东', '北', '西'][highest.playerIdx]}）——加价（可跳档）或放弃`
        : '三打一叫分：从 90 分起，步长 10，可跳档';
      view.passLabel = highest ? '不叫（放弃）' : '不叫';
    } else if (isHumanTurnBid && isSDY) {
      const highest = st.scoreBidHighest;
      view.bidTipText = highest ? `等待他人……当前最高 ${highest.score} 分` : '等待他人叫分……';
    }
    if (isHumanChooseTrump) {
      const hand = st.players[0].hand;
      view.bidMode = 'trump';
      // 各门张数不含 2（2 与王同为常主，不计入门长——比哪门长要看纯门牌）
      view.suitOptions = ['S', 'H', 'C', 'D'].map((su) => ({
        suit: su, symbol: SYMBOLS[su], red: su === 'H' || su === 'D',
        count: hand.filter((c) => c.suit === su && c.rank !== '2').length
      }));
      const alwaysTrumps = hand.filter((c) => c.isJoker || c.rank === '2').length;
      view.bidTipText = `你是庄家（合同 ${st.contractScore} 分）——选花色做主牌；王与 2 共 ${alwaysTrumps} 张常主`;
    }
    renderActionBar(st, view);

    // 结算
    const settleView = {};
    if (st.lastSettle && (st.phase === 'SCORING' || st.phase === 'GAME_OVER')) {
      const sl = st.lastSettle;
      settleView.settle = {
        dealerPoints: sl.dealerPoints,
        attackerPoints: sl.attackerPoints,
        contractScore: sl.contractScore,
        penaltyTotal: sl.penaltyPoints ? (sl.penaltyPoints.dealer + sl.penaltyPoints.attackers) : 0,
        bottomGained: sl.bottomGained
      };
      settleView.settleBanner = fmt.settleBanner(sl, dealerTeam, st.config);
      settleView.settleIsWin = isSDY
        ? (sl.winnerTeam === 'dealer' ? sl.dealerIdx === 0 : sl.dealerIdx !== 0)
        : sl.winnerTeam === 0;
    }
    renderResult(st, settleView);

    persist();
    scheduleWatchdog();
    maybeFloatPoints(st);
  }

  /* ---------- 手牌新增检测 + 双动画（移植 table.js） ---------- */
  function detectNewCards(st, grabStarted) {
    const ids = st.players[0].hand.map((c) => c.id);
    const hadPrev = !!G.prevHandIds;
    const prevCount = hadPrev ? G.prevHandIds.length : 0;
    if (prevCount === 0 && ids.length >= 20) startDealAnimation();
    const added = hadPrev ? ids.filter((id) => !G.prevHandIds.includes(id)) : [];
    G.prevHandIds = ids;
    if (grabStarted) return [];
    return added;
  }

  function detectGrabBottom(st) {
    if (!st || st.config.gameMode !== 'san_da_yi') return false;
    const merged = !!st.bottomMerged;
    if (G._grabObservedMerged === undefined) { G._grabObservedMerged = merged; return false; }
    const rising = merged && !G._grabObservedMerged;
    G._grabObservedMerged = merged;
    if (!rising) return false;
    startGrabBottomAnimation(st.dealerIdx);
    return true;
  }

  function startDealAnimation() {
    if (G._dealAnimating) return;
    if (G._dealTimer) clearInterval(G._dealTimer);
    if (G._dealWatchdog) clearTimeout(G._dealWatchdog);
    const st = G.service.getState();
    const per = st.players[0].hand.length;
    G._dealAnimating = true;
    G.handVisibleCount = 0;
    G.dealAnim = { active: true, counts: [0, 0, 0, 0], flyCards: [] };
    const counts = [0, 0, 0, 0];
    const flyCards = [];
    let dealt = 0, flySeq = 0;
    G._dealTimer = setInterval(() => {
      try {
        for (let k = 0; k < 4 && dealt < per * 4; k++) {
          const seat = dealt % 4;
          counts[seat] += 1;
          flySeq += 1;
          flyCards.push({ id: 'fly-' + flySeq, seat, delayMs: (k % 4) * 30 });
          dealt += 1;
        }
        while (flyCards.length > 8) flyCards.shift();
        G.handVisibleCount = counts[0];
        G.dealAnim = { active: true, counts: counts.slice(), flyCards: flyCards.slice() };
        renderAnim(G.service.getState());
        // 手牌同步逐张亮出（小程序版靠 setData 自动重渲，H5 需显式刷）
        renderHand(G.service.getState(), []);
        // 座位牌数轻量更新
        [2, 3, 1].forEach((i) => {
          const meta = $('seat-' + i).querySelector('.seat-info__cards');
          if (meta) meta.textContent = `剩 ${counts[i]} 张`;
        });
        if (dealt >= per * 4) {
          clearInterval(G._dealTimer);
          G._dealTimer = null;
          G._dealWatchdog = setTimeout(endDealAnim, 420);
        }
      } catch (e) {
        console.error('发牌动画异常', e);
        endDealAnim();
      }
    }, 110);
  }

  function endDealAnim() {
    if (G._dealTimer) { clearInterval(G._dealTimer); G._dealTimer = null; }
    if (G._dealWatchdog) { clearTimeout(G._dealWatchdog); G._dealWatchdog = null; }
    G._dealAnimating = false;
    G.handVisibleCount = 999;
    G.dealAnim = { active: false, counts: [0, 0, 0, 0], flyCards: [] };
    render();
    driveAI();
  }

  function startGrabBottomAnimation(dealerIdx) {
    if (G._grabAnimating || G._dealAnimating) return;
    if (G._grabTimer) { clearTimeout(G._grabTimer); G._grabTimer = null; }
    const st = G.service.getState();
    const bottomCount = st.config.bottomCards || 8;
    const dealerIsHuman = !!st.players[dealerIdx].isHuman;
    G._grabAnimating = true;
    const cards = [];
    for (let i = 0; i < bottomCount; i++) cards.push({ id: 'bottom-' + i, delay: i * 40 });
    if (dealerIsHuman) G.handVisibleCount = st.players[0].hand.length - bottomCount;
    G.grabBottom = { active: true, stage: 'show', dealerIdx, cards, flyCount: 0, flyCards: [] };
    render(); // 立即展示中央底牌
    G._grabTimer = setTimeout(() => {
      try { grabFlyTick(0, bottomCount, dealerIdx, dealerIsHuman, []); }
      catch (e) { console.error('抓底牌动画异常', e); endGrabBottom(); }
    }, 700);
  }

  function grabFlyTick(flown, total, dealerIdx, dealerIsHuman, flyCards) {
    const next = flown + 1;
    const newFly = flyCards.concat([{ id: 'grab-fly-' + next, seat: dealerIdx }]);
    while (newFly.length > 3) newFly.shift();
    G.grabBottom = {
      active: true, stage: 'fly', dealerIdx,
      cards: G.grabBottom.cards, flyCount: next, flyCards: newFly
    };
    if (dealerIsHuman) G.handVisibleCount += 1;
    renderAnim(G.service.getState());
    // 庄家座位牌数递增（庄家是真人时手牌区由 handVisibleCount 驱动）
    render();
    if (next >= total) {
      G._grabTimer = setTimeout(endGrabBottom, 480);
      return;
    }
    G._grabTimer = setTimeout(() => {
      try { grabFlyTick(next, total, dealerIdx, dealerIsHuman, newFly); }
      catch (e) { console.error('抓底牌动画异常', e); endGrabBottom(); }
    }, 120);
  }

  function endGrabBottom() {
    if (G._grabTimer) { clearTimeout(G._grabTimer); G._grabTimer = null; }
    G._grabAnimating = false;
    G.handVisibleCount = 999;
    G.grabBottom = { active: false, stage: 'done', dealerIdx: 0, cards: [], flyCount: 0, flyCards: [] };
    render();
    driveAI();
  }

  /* ---------- 看门狗 / 飘分（移植） ---------- */
  function scheduleWatchdog() {
    if (G._watchdog) clearTimeout(G._watchdog);
    G._watchdog = setTimeout(() => {
      G._watchdog = null;
      try {
        const st = G.service && G.service.getState();
        if (!st || st.phase === 'GAME_OVER' || st.phase === 'SCORING') return;
        if (G._dealAnimating || G._grabAnimating) return;
        const isSDY = st.config.gameMode === 'san_da_yi';
        const needAI = (st.phase === 'BIDDING' && (isSDY ? st.turnIdx !== 0 : !humanBidPending(st)))
          || (st.phase === 'CHOOSE_TRUMP' && !st.players[st.dealerIdx].isHuman)
          || (st.phase === 'BURYING' && !st.players[st.dealerIdx].isHuman)
          || (st.phase === 'PLAYING' && st.turnIdx !== 0)
          || (st.phase === 'INIT_DEAL');
        const waitingHuman = (st.phase === 'BIDDING' && (isSDY ? st.turnIdx === 0 : humanBidPending(st)))
          || (st.phase === 'CHOOSE_TRUMP' && st.players[st.dealerIdx].isHuman)
          || (st.phase === 'BURYING' && st.players[st.dealerIdx].isHuman)
          || (st.phase === 'PLAYING' && st.turnIdx === 0);
        if (needAI && !G._aiTimer && !waitingHuman) {
          console.warn('[watchdog] AI 调度断链，重启 driveAI phase=' + st.phase);
          driveAI();
        }
      } catch (e) { /* 静默 */ }
    }, 2500);
  }

  function maybeFloatPoints(st) {
    if (!st.completedTricks || !st.completedTricks.length) return;
    const last = st.completedTricks[st.completedTricks.length - 1];
    const lastKey = `${st.roundNo}-${st.completedTricks.length}`;
    if (G.lastFloatKey === lastKey) return;
    if (!last.points || last.points <= 0) { G.lastFloatKey = lastKey; return; }
    G.lastFloatKey = lastKey;
    const winnerTeam = st.players[last.winnerIdx].team;
    const mine = winnerTeam === 0;
    const fp = $('float-points');
    fp.textContent = (mine ? '+' : '-') + last.points;
    fp.hidden = false;
    fp.classList.remove('anim-float-up');
    requestAnimationFrame(() => requestAnimationFrame(() => fp.classList.add('anim-float-up')));
    setTimeout(() => { fp.hidden = true; }, 1400);
  }

  function humanBidPending(st) {
    const decided = st.bids.some((b) => b.playerIdx === 0) || (st.passedBidders || []).includes(0);
    return st.phase === 'BIDDING' && !decided;
  }

  function sumDealerPoints(st) {
    const t = st.sanDaYiTeams;
    let s = 0;
    st.completedTricks.forEach((tk) => { if (tk.winnerIdx === t.dealer) s += tk.points; });
    if (st.penaltyPoints) s += st.penaltyPoints.dealer;
    return s;
  }

  function sumAttackerPoints(st) {
    const t = st.sanDaYiTeams;
    let s = 0;
    st.completedTricks.forEach((tk) => { if (tk.winnerIdx !== t.dealer) s += tk.points; });
    if (st.penaltyPoints) s += st.penaltyPoints.attackers;
    return s;
  }

  /* ---------- AI 驱动（移植 driveAI） ---------- */
  function driveAI() {
    if (G._aiTimer) clearTimeout(G._aiTimer);
    if (G._dealAnimating) return;
    if (G._grabAnimating) return;
    const st = G.service.getState();
    if (!st) return;
    if (st.phase === 'GAME_OVER') return;
    const pace = st.config.aiPaceSeconds;
    const isNewTrick = !st.currentTrick || st.currentTrick.plays.length === 0;
    const base = (pace[0] + Math.random() * (pace[1] - pace[0])) * 1000;
    const delay = isNewTrick ? base * 1.25 : base * 0.75;
    G._aiTimer = setTimeout(() => {
      G._aiTimer = null;
      const cur = G.service.getState();
      if (!cur || cur.phase === 'GAME_OVER') return;
      const r = G.service.tick();
      if (r.acted) render();
      const now = G.service.getState();
      const isSDY = now.config.gameMode === 'san_da_yi';
      if (isSDY && now.phase === 'INIT_DEAL') {
        G.service.dispatch({ type: 'DEAL', rng: createRng() });
        render();
        driveAI();
        return;
      }
      const waitHuman = (now.phase === 'PLAYING' && now.turnIdx === 0)
        || (now.phase === 'BURYING' && now.players[now.dealerIdx].isHuman)
        || (now.phase === 'CHOOSE_TRUMP' && now.players[now.dealerIdx].isHuman)
        || (now.phase === 'BIDDING' && (isSDY ? now.turnIdx === 0 : humanBidPending(now)))
        || now.phase === 'SCORING' || now.phase === 'GAME_OVER'
        || !r.acted;
      if (!waitHuman) driveAI();
    }, delay);
  }

  /* ---------- 事件（移植） ---------- */
  function onChooseTrump(suit) {
    const r = G.service.chooseTrump(suit);
    if (!r.ok) { toast(r.reason || '选主失败'); return; }
    render();
    driveAI();
  }

  function onScoreBid(score) {
    const r = G.service.scoreBid(0, score);
    if (!r.ok) { toast(r.reason || '报分失败'); return; }
    render();
    driveAI();
  }

  function onPassBid() {
    G.service.dispatch({ type: 'PASS_BID', playerIdx: 0 });
    render();
    driveAI();
  }

  function smartToggle(st, card, isSelected) {
    // cardKey 等价：同 suit+rank（两副牌同名片）视为等价组
    const keyOf = (c) => c.isJoker ? c.rank : (c.suit + '-' + c.rank);
    const hasLead = !!(st.currentTrick && st.currentTrick.leadCombo);
    const n = hasLead ? st.currentTrick.leadCombo.n : 0;
    let ids = G.selectedIds.slice();
    if (isSelected) {
      // 收回：再点「刚刚选入的那张」→ 撤销本次整组；点组内其他已选牌 → 只收回该张（拆对出单/甩牌微调）
      if (G.lastAdded && G.lastPickId === card.id && G.lastAdded.every((id) => ids.includes(id))) {
        const undo = G.lastAdded;
        G.lastAdded = null;
        return ids.filter((id) => !undo.includes(id));
      }
      return ids.filter((id) => id !== card.id);
    }
    const key = keyOf(card);
    const groupIds = st.players[0].hand.filter((c) => keyOf(c) === key).map((c) => c.id);
    ids = ids.filter((id) => !groupIds.includes(id));
    const take = hasLead ? groupIds.slice(0, Math.max(1, n)) : groupIds;
    ids = ids.concat(take);
    if (hasLead && ids.length > n) ids = ids.slice(ids.length - n);
    G.lastPickId = card.id;
    G.lastAdded = take.filter((id) => ids.includes(id)); // 记录选入起点+实际选入，供「再点同一张撤销」
    return ids;
  }

  // 右键：先选牌再出牌——右键未选中的牌仅智能选入（成组），不出；
  // 右键已选中的牌才出当前选中组合（双击仍是直接出牌）
  function onCardContext(e, card) {
    if (e.button !== 2) return;               // 只认鼠标右键
    const st = G.service.getState();
    if (!(st.phase === 'PLAYING' && st.turnIdx === 0)) return; // 非己方出牌阶段保留系统菜单
    e.preventDefault();
    if (!G.selectedIds.includes(card.id)) {
      G.selectedIds = smartToggle(st, card, false);
      renderHand(st, []);
      renderActionBar(st, {
        needPlayCount: (st.currentTrick && st.currentTrick.leadCombo) ? st.currentTrick.leadCombo.n : G.selectedIds.length,
        isHumanTurnBid: false, isHumanDealer: false, needBuryCount: st.config.bottomCards
      });
      return;
    }
    onPlay();
  }

  function onCardTap(card) {
    const st = G.service.getState();
    if (st.phase === 'BURYING') {
      let ids = G.selectedIds.slice();
      const selected = ids.includes(card.id);
      if (selected) ids = ids.filter((id) => id !== card.id);
      else if (ids.length < st.config.bottomCards) ids.push(card.id);
      else { toast(`最多选 ${st.config.bottomCards} 张`); return; }
      G.selectedIds = ids;
      render();
      return;
    }
    if (st.phase === 'PLAYING' && st.turnIdx === 0) {
      const now = Date.now();
      const selected = G.selectedIds.includes(card.id);
      const isDoubleTap = G.lastTapCardId === card.id && (now - G.lastTapAt) < DOUBLE_TAP_MS;
      G.lastTapCardId = card.id;
      G.lastTapAt = now;
      if (isDoubleTap) {
        if (!selected) {
          G.selectedIds = smartToggle(st, card, false);
          renderHand(st, []);
        }
        setTimeout(onPlay, 60);
        return;
      }
      G.selectedIds = smartToggle(st, card, selected);
      renderHand(st, []);
      renderActionBar(st, {
        needPlayCount: (st.currentTrick && st.currentTrick.leadCombo) ? st.currentTrick.leadCombo.n : G.selectedIds.length,
        isHumanTurnBid: false, isHumanDealer: false, needBuryCount: st.config.bottomCards
      });
    }
  }

  function onClearSelect() {
    G.selectedIds = [];
    G.lastAdded = null;
    render();
  }

  function onBuryConfirm() {
    const st = G.service.getState();
    if (G.selectedIds.length !== st.config.bottomCards) {
      toast(`需选满 ${st.config.bottomCards} 张`);
      return;
    }
    const cards = G.selectedIds.map((id) => st.players[0].hand.find((c) => c.id === id)).filter(Boolean);
    const r = G.service.bury(cards);
    if (!r.ok) { toast(r.reason || '埋底失败'); return; }
    G.selectedIds = [];
    render();
    driveAI();
  }

  function onPlay() {
    const st = G.service.getState();
    const cards = G.selectedIds.map((id) => st.players[0].hand.find((c) => c.id === id)).filter(Boolean);
    const n = (st.currentTrick && st.currentTrick.leadCombo) ? st.currentTrick.leadCombo.n : cards.length;
    if (cards.length !== n) { toast(`本墩须出 ${n} 张`); return; }
    const r = G.service.play(0, cards);
    if (!r.ok) {
      toast(r.reason || '非法出牌');
      window.wx.vibrateShort();
      return;
    }
    if (r.replaced) toast(r.reason || '甩牌失败，已改出被压住的最小牌组');
    G.selectedIds = [];
    G.lastAdded = null;
    render();
    driveAI();
  }

  function onHint() {
    const st = G.service.getState();
    if (st.phase !== 'PLAYING' || st.turnIdx !== 0) { toast('当前无需出牌'); return; }
    const hint = getHint(st, 0);
    if (!hint.cards) { toast(hint.reason); return; }
    G.selectedIds = hint.cards.map((c) => c.id);
    render();
    if (hint.reason) toast(hint.reason);
  }

  function onHistory() {
    const st = G.service.getState();
    const mode = st.config.gameMode;
    const recent = st.completedTricks.slice(-8).reverse();
    $('history-title').textContent = `出牌历史（最近 ${recent.length} 墩）`;
    const list = $('history-list');
    list.innerHTML = '';
    if (!recent.length) {
      list.appendChild(el('div', 'history-modal__empty', '暂无出牌记录'));
    } else {
      recent.forEach((t, i) => {
        const no = st.completedTricks.length - Math.min(8, st.completedTricks.length) + i + 1;
        const cardText = (c) => c.isJoker ? (c.rank === 'BJ' ? '大王' : '小王') : (SYMBOLS[c.suit] + c.rank);
        const d = el('div', 'history-modal__trick');
        d.innerHTML = `<div class="history-modal__trick-head">第 ${no} 墩 · ${fmt.seatName(t.leadPlayerIdx, mode)} 领出 · 赢家 ${fmt.seatName(t.winnerIdx, mode)}${t.points ? ' · +' + t.points + ' 分' : ''}</div>`
          + t.plays.map((p) => `<span class="history-modal__play">${fmt.seatName(p.playerIdx, mode)}: ${p.cards.map(cardText).join(' ')}</span>`).join('');
        list.appendChild(d);
      });
    }
    $('history-modal').hidden = false;
  }

  function onNextRound() {
    const prevSettle = G.service.getState().lastSettle || {};
    const wasSDY = prevSettle.mode === 'san_da_yi';
    G.service.nextRound();
    const st = G.service.getState();
    const records = storage.get(STORAGE_KEYS.STATS) || [];
    const sdyWon = wasSDY
      ? (prevSettle.winnerTeam === 'dealer' ? prevSettle.dealerIdx === 0 : prevSettle.dealerIdx !== 0)
      : prevSettle.winnerTeam === 0;
    storage.set(STORAGE_KEYS.STATS, stats.appendRecord(records, {
      roundNo: st.roundNo,
      myTeamWon: sdyWon,
      passedA: prevSettle.passedA,
      attackPoints: prevSettle.attackPoints,
      tricksCount: st.completedTricks.length
    }));
    G.selectedIds = [];
    G.prevHandIds = null;
    render();
    driveAI();
  }

  function persist() {
    const st = G.service && G.service.getState();
    if (!st) return;
    if (st.phase === 'GAME_OVER') storage.remove(STORAGE_KEYS.CURRENT_GAME);
    else { try { storage.set(STORAGE_KEYS.CURRENT_GAME, G.service.serialize()); } catch (e) { /* 忽略 */ } }
  }

  /* ---------- 首页/规则页 ---------- */
  function renderHome() {
    const isSDY = ruleConfig.gameMode === 'san_da_yi';
    $('home-title').textContent = isSDY ? '三打一' : '拖拉机';
    $('home-subtitle').textContent = isSDY ? '1 庄 vs 3 家 · 报分 90 起' : '80 分 · 升级';
    const records = storage.get(STORAGE_KEYS.STATS) || [];
    const s = stats.summarize(records);
    $('home-stats').textContent = s.totalRounds
      ? `战绩 ${s.wins}胜 ${s.losses}负 · 胜率 ${(s.winRate * 100).toFixed(0)}%`
      : '';
  }

  function renderRules() {
    const cfg = buildConfig();
    const isSDY = cfg.gameMode === 'san_da_yi';
    $('rules-body').innerHTML = isSDY ? `
      <h3>三打一规则速查</h3>
      <p>两副牌 108 张，1 庄家 vs 3 闲家，每人 25 张，底牌 8 张。</p>
      <h3>叫分</h3>
      <li>从 90 分起叫，步长 10，最高 200 分（报 200 直接成交；加价可跳档）</li>
      <li>未放弃者可循环加价，直到无人再加；放弃后本局不能再叫</li>
      <li>四家全不叫 → 重新发牌（首报者轮到下家）</li>
      <h3>主牌</h3>
      <li>成交后庄家拿 8 张底牌（手牌 33 张），再自选一个花色做主牌</li>
      <li>主牌 = 大小王 + 全部 2 + 所选花色全部</li>
      <h3>出牌</h3>
      <li>庄家埋 8 张底牌后领出，可出单张/对子${cfg.sanDaYiAllowTractor ? '/拖拉机' : ''}/甩牌（同域组合）</li>
      ${cfg.sanDaYiAllowTractor ? '' : '<li>默认不打拖拉机：连对按多副对子甩牌，每个对子都必须无人能压；同样大不能压住先出的牌</li>'}
      <li>${cfg.throwPenalty === 'reject' ? '甩牌不成立时禁止出牌' : `甩牌失败只出本次甩牌中被压住的最小单张或对子，其余收回${cfg.throwPenalty === 'penalty_smallest' ? '；按原甩牌张数每张罚 10 分给对方' : '，不罚分'}`}</li>
      <h3>胜负</h3>
      <li>庄家得分 ≥ 合同分 → 庄家胜；否则三家胜</li>
      <li>最后一墩赢家收底牌分 ×1（不翻倍）</li>
      <li>庄家胜则继续坐庄，负则下家坐庄</li>
    ` : `
      <h3>拖拉机（升级）规则速查</h3>
      <p>两副牌，2v2 对战，从打 2 开始升级到过 A。</p>
      <h3>亮主</h3>
      <li>亮级牌定主；对级牌/对王可反主</li>
      <h3>计分</h3>
      <li>5/10/K 为分牌，攻方抢 80 分上台</li>
      <li>${fmt.passAText(cfg)}</li>
    `;
  }

  /* ---------- 绑定 ---------- */
  $('btn-start').addEventListener('click', () => {
    storage.remove(STORAGE_KEYS.CURRENT_GAME);
    startGame();
  });
  $('btn-rules').addEventListener('click', () => { renderRules(); showView('rules'); });
  $('btn-rules-back').addEventListener('click', () => showView('home'));
  $('btn-hint').addEventListener('click', onHint);
  $('btn-history').addEventListener('click', onHistory);
  $('btn-history-close').addEventListener('click', () => { $('history-modal').hidden = true; });
  $('history-mask').addEventListener('click', () => { $('history-modal').hidden = true; });
  $('btn-result-next').addEventListener('click', onNextRound);
  $('btn-result-home').addEventListener('click', () => {
    persist();
    renderHome();
    showView('home');
  });
  // 页面隐藏时暂停 AI（防后台定时器节流）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (G._aiTimer) { clearTimeout(G._aiTimer); G._aiTimer = null; }
      if (G._grabAnimating) {
        if (G._grabTimer) { clearTimeout(G._grabTimer); G._grabTimer = null; }
        G._grabAnimating = false;
        G.handVisibleCount = 999;
        G.grabBottom = { active: false, stage: 'done', dealerIdx: 0, cards: [], flyCount: 0, flyCards: [] };
        render();
      }
      persist();
    } else if (G.service && G.service.getState() && G.service.getState().phase !== 'GAME_OVER' && !$('view-table').hidden) {
      driveAI();
    }
  });

  renderHome();
})();
