/**
 * pages/table/table.js —— 牌桌 Presenter（核心页面）v1.1 雕琢版。
 *
 * 职责（架构 §2.2）：
 *   1. 持有 GameService，转发用户事件（亮主/埋底/出牌）；
 *   2. 渲染 GameState 派生视图模型（setData）；
 *   3. AI 节奏驱动（R23：aiPaceSeconds 区间随机 setTimeout → tick）；
 *   4. 每步落盘 storage（断线续玩 F-09）；
 *   5. onShow 恢复对局（mode=resume）。
 *
 * v1.1 交互雕琢（QQ 升级风格）：
 *   - 智能选牌：点一张自动带上等价牌成组（对子/拖拉机感知）
 *   - 双击出牌：同一张牌 300ms 内二次点击 = 确认出牌
 *   - 可亮主牌呼吸光效（亮主阶段）
 *   - 收墩飘分动画（+5/+10 上浮消散）
 *   - AI 出牌节奏优化（首张稍慢、连出稍快，更拟人）
 *
 * 本文件是 engine/core/ai 之外的 UI 适配层，wx.* 只在此与组件内出现。
 */

'use strict';

const { GameService } = require('../../services/game-service');
const { getHint } = require('../../services/hint');
const storage = require('../../storage/adapter');
const { STORAGE_KEYS } = require('../../storage/keys');
const { createRng } = require('../../utils/random');
const fmt = require('../../utils/format');
const { summarize, appendRecord } = require('../../services/stats');
const { cardKey } = require('../../engine/card');

/** AI 节奏定时器句柄 */
let aiTimer = null;

/** 双击判定窗口（ms） */
const DOUBLE_TAP_MS = 320;

Page({
  data: {
    phase: 'INIT_DEAL',
    roundNo: 1,
    handVisibleCount: 999,
    players: [],
    turnIdx: -1,
    dealerIdx: 0,
    trumpText: '定主中…',
    trumpChipText: '',
    myScore: 0,
    enemyScore: 0,
    trickInfo: '',
    currentTrick: null,
    bottomCount: 0,
    myHand: [],
    handOverlap: -28,
    handLabel: '',
    selectedIds: [],
    glowingIds: [],
    playInIds: [],
    floatPoints: { visible: false, text: '', anim: false },
    needPlayCount: 1,
    needBuryCount: 8,
    isHumanTurnBid: false,
    isHumanDealer: false,
    bidOptionsView: [],
    bidTipText: '亮主阶段：选择要亮的牌',
    settle: null,
    settleBanner: '',
    settleIsWin: false,
    settleBottomCards: [],
    levels: { team0: '2', team1: '2' },
    historyVisible: false,
    historyTricks: []
  },

  onLoad(query) {
    const app = getApp();
    this.service = new GameService({ config: app.globalData.config, rng: createRng() });
    this.burySelected = [];
    this.lastTapCardId = '';
    this.lastTapAt = 0;
    if (query && query.mode === 'resume') {
      const saved = storage.get(STORAGE_KEYS.CURRENT_GAME);
      if (saved) {
        try {
          this.service.resume(saved);
        } catch (e) {
          wx.showToast({ title: '存档损坏，已重新开局', icon: 'none' });
          this.service.startGame();
        }
      } else {
        this.service.startGame();
      }
    } else {
      this.service.startGame();
    }
    this.render();
    this.driveAI();
  },

  onShow() {
    // 页面回到前台：继续驱动 AI
    if (this.service && this.service.getState() && this.service.getState().phase !== 'GAME_OVER') {
      this.driveAI();
    }
  },

  onHide() {
    // 切后台暂停 AI 节奏（§9.3）
    if (aiTimer) {
      clearTimeout(aiTimer);
      aiTimer = null;
    }
    this.persist();
  },

  onUnload() {
    if (aiTimer) {
      clearTimeout(aiTimer);
      aiTimer = null;
    }
    this.persist();
  },

  /* ==================== 渲染 ==================== */

  /** 渲染：手牌每张牌预计算 isTrump（组件纯展示，不跨层传 Set） */
  buildHandView(st) {
    const ti = st.trumpInfo;
    const cfg = st.config;
    return st.players[0].hand.map((c) => {
      let isTrump = false;
      if (ti) {
        try {
          isTrump = c.isJoker || (ti.trumpIds && ti.trumpIds.has ? ti.trumpIds.has(`${c.suit}-${c.rank}`) : false);
        } catch (e) { isTrump = false; }
        if (ti.isNoTrump && !c.isJoker && c.rank === ti.levelRank) isTrump = true;
      }
      return {
        id: c.id,
        suit: c.suit,
        rank: c.rank,
        isJoker: !!c.isJoker,
        isTrump,
        pointValue: (cfg.pointValues && cfg.pointValues[c.rank]) || 0
      };
    });
  },

  /** 出牌区视图：当前墩各家牌附加预计算 isTrump/pointValue */
  buildTrickView(st) {
    const t = st.currentTrick;
    if (!t || !t.plays) return null;
    return this.buildTrickFromData(st, t);
  },

  /** 从墩数据构造出牌区视图（当前墩 / 残留墩共用） */
  buildTrickFromData(st, t) {
    const decorate = (c) => this.decorateCard(st, c);
    return Object.assign({}, t, {
      plays: t.plays.map((p) => Object.assign({}, p, { cards: p.cards.map(decorate) }))
    });
  },

  /** 结算底牌视图（附加预计算字段） */
  buildBottomView(st) {
    return (st.bottomCards || []).map((c) => this.decorateCard(st, c));
  },

  /** 单牌装饰：附加 isTrump/pointValue（Page 层预计算） */
  decorateCard(st, c) {
    const ti = st.trumpInfo;
    let isTrump = false;
    if (ti) {
      try {
        isTrump = c.isJoker || (ti.trumpIds && ti.trumpIds.has ? ti.trumpIds.has(`${c.suit}-${c.rank}`) : false);
      } catch (e) { isTrump = false; }
      if (ti.isNoTrump && !c.isJoker && c.rank === ti.levelRank) isTrump = true;
    }
    return Object.assign({}, c, {
      isTrump,
      pointValue: (st.config.pointValues && st.config.pointValues[c.rank]) || 0
    });
  },

  render() {
    const st = this.service.getState();
    if (!st) return;
    const isSanDaYi = st.config.gameMode === 'san_da_yi';
    const myTeam = 0;
    const dealerTeam = isSanDaYi && st.sanDaYiTeams ? 0 : st.players[st.dealerIdx].team;
    const isHumanDealer = (st.phase === 'BURYING' || st.phase === 'CHOOSE_TRUMP') && st.players[st.dealerIdx].isHuman;
    // 三打一：轮到真人报分 = BIDDING 且 turnIdx=0；升级：未表态
    const isHumanTurnBid = st.phase === 'BIDDING'
      && (isSanDaYi ? st.turnIdx === 0 : this.humanBidPending(st));
    // 三打一：真人庄家选主
    const isHumanChooseTrump = st.phase === 'CHOOSE_TRUMP' && st.players[st.dealerIdx].isHuman;
    const needPlayCount = (st.currentTrick && st.currentTrick.leadCombo) ? st.currentTrick.leadCombo.n : this.data.selectedIds.length;
    // 手牌变化检测（飞入动画：新增牌 id）
    const newIds = this.detectNewCards(st);
    // 可亮牌呼吸（仅升级模式亮主阶段；三打一无亮主概念——主牌由庄家拿底后自选）
    const glowingIds = (isHumanTurnBid && !isSanDaYi) ? this.computeGlowingIds(st) : [];
    // v1.3 残留墩展示：上一墩牌保留在桌面变暗，直到新墩第一张打出
    // 状态机在第 4 家出牌的同一 tick 内结算并把 currentTrick 置 null——
    // 此时渲染最后一墩（来自 completedTricks）变暗保留，避免"一闪而过"
    let trickView = this.buildTrickView(st);
    let lastTrickDim = false;
    if (st.phase === 'PLAYING' && !st.currentTrick && st.completedTricks.length) {
      const last = st.completedTricks[st.completedTricks.length - 1];
      trickView = this.buildTrickFromData(st, last);
      lastTrickDim = true;
    }
    const view = {
      phase: st.phase,
      roundNo: st.roundNo,
      turnIdx: st.turnIdx,
      dealerIdx: st.dealerIdx,
      gameMode: st.config.gameMode,
      trumpText: fmt.trumpLabel(st.trumpInfo),
      trumpChipText: isSanDaYi
        ? (st.trumpInfo ? '三打一 · 主=王+2' : '三打一 · 报分中')
        : (st.trumpInfo ? `打 ${st.trumpInfo.levelRank}${st.trumpInfo.isNoTrump ? ' · 无主' : ''}` : ''),
      myScore: isSanDaYi && st.sanDaYiTeams
        ? (st.sanDaYiTeams.dealer === 0 ? this.sumDealerPoints(st) : this.sumAttackerPoints(st))
        : st.scores.team0,
      enemyScore: isSanDaYi && st.sanDaYiTeams
        ? (st.sanDaYiTeams.dealer === 0 ? this.sumAttackerPoints(st) : this.sumDealerPoints(st))
        : st.scores.team1,
      myScoreLabel: isSanDaYi && st.sanDaYiTeams ? (st.sanDaYiTeams.dealer === 0 ? '庄家' : '三家') : '我方',
      enemyScoreLabel: isSanDaYi && st.sanDaYiTeams ? (st.sanDaYiTeams.dealer === 0 ? '三家' : '庄家') : '敌方',
      contractScore: st.contractScore || '',
      trickInfo: st.completedTricks.length ? `已 ${st.completedTricks.length} 墩` : '',
      currentTrick: trickView,
      lastTrickDim,
      bottomCount: st.bottomCards.length,
      levelRank: st.trumpInfo ? st.trumpInfo.levelRank : '',
      // v1.1：手牌视图（Page 预计算 isTrump/pointValue，组件纯展示）
      myHand: this.buildHandView(st),
      handVisibleCount: this.data.handVisibleCount === undefined ? 999 : this.data.handVisibleCount,
      handOverlap: st.players[0].hand.length > 27 ? -44 : -28,
      handLabel: st.phase === 'PLAYING'
        ? (st.turnIdx === 0 ? '轮到你出牌（点牌智能成组，双击出牌）' : '等待其他玩家…')
        : (st.phase === 'BIDDING'
          ? (isSanDaYi
            ? (st.turnIdx === 0 && !(st.passedBidders || []).includes(0) && !(st.bids || []).some((b) => b.type === 'score_bid' && b.playerIdx === 0)
              ? '轮到你叫分'
              : '等待其他玩家叫分…')
            : '亮主阶段')
          : (st.phase === 'CHOOSE_TRUMP' ? (st.players[st.dealerIdx].isHuman ? '轮到你选主牌花色' : '庄家选主中…') : (st.phase === 'BURYING' ? '埋底阶段' : ''))),
      needPlayCount,
      needBuryCount: st.config.bottomCards,
      isHumanTurnBid,
      isHumanDealer,
      isHumanChooseTrump,
      glowingIds,
      playInIds: newIds,
      levels: st.levels,
      players: st.players.map((p, i) => ({
        name: p.name,
        handCount: p.hand.length,
        // 三打一：庄家用"庄"徽标，其余三家都是"对手"；升级模式：北家=队友，东西=对手
        campLabel: isSanDaYi
          ? (st.sanDaYiTeams && st.sanDaYiTeams.dealer === i ? '' : '对手')
          : (i === 2 ? '队友' : (i === 0 ? '' : '对手'))
      }))
    };
    // 结算视图
    if (st.lastSettle && (st.phase === 'SCORING' || st.phase === 'GAME_OVER')) {
      const sl = st.lastSettle;
      view.settle = {
        attackPoints: sl.attackPoints,
        dealerPoints: sl.dealerPoints,
        contractScore: sl.contractScore,
        penaltyTotal: sl.penaltyPoints ? (sl.penaltyPoints.dealer + sl.penaltyPoints.attackers) : 0,
        bottomGained: sl.bottomGained,
        bottomMultiplierUsed: sl.bottomMultiplierUsed,
        levelsGained: sl.levelsGained,
        winnerTeam: sl.winnerTeam
      };
      view.settleBanner = fmt.settleBanner(st.lastSettle, dealerTeam, st.config);
      // 胜负（三打一：真人是庄家则 dealer=我方胜；升级：winnerTeam===0）
      view.settleIsWin = isSanDaYi
        ? (st.lastSettle.winnerTeam === 'dealer' ? st.lastSettle.dealerIdx === 0 : st.lastSettle.dealerIdx !== 0)
        : st.lastSettle.winnerTeam === myTeam;
      view.settleBottomCards = this.buildBottomView(st);
    }
    // 亮主/报分/选主选项（仅轮到真人决策时）
    if (isHumanTurnBid) {
      if (isSanDaYi) {
        // 三打一：报分选项（QQ 规则 60 起 +5~15）
        const { scoreBidOptions } = require('../../engine/bid');
        view.bidMode = 'score';
        view.scoreOptionsView = scoreBidOptions(st, 0, st.config);
        const highest = st.scoreBidHighest;
        const myPassed = (st.passedBidders || []).includes(0);
        const myBidded = (st.bids || []).some((b) => b.type === 'score_bid' && b.playerIdx === 0);
        if (myPassed || myBidded) {
          // 已用掉机会：等待他人
          view.isHumanTurnBid = false;
          view.bidTipText = highest ? `等待他人……当前最高 ${highest.score} 分（P${highest.playerIdx + 1}）` : '等待他人叫分……';
        } else {
          view.bidTipText = highest ? `当前最高 ${highest.score} 分（P${highest.playerIdx + 1}）——加 10 分或放弃（放弃后本局不能再叫）` : '三打一叫分：从 90 分起，每档 +10（叫分 = 承诺拿到的分数）';
        }
        view.passLabel = highest ? '不叫（放弃）' : '不叫';
        // 叫分气泡记录（各家叫过的分）
        view.bidBubble = (st.bids || []).filter((b) => b.type === 'score_bid').map((b) => ({
          idx: b.playerIdx,
          score: b.score
        }));
      } else {
        const opts = this.service.bidOptions(0);
        view.bidMode = 'classic';
        view.bidOptionsView = opts.map((o, i) => ({
          key: `opt-${i}`,
          label: bidOptionLabel(o),
          sub: o.isNoTrump ? '无主局' : `${fmt.suitSymbol(o.trumpSuit)} 为主`,
          needsConfirm: st.bids.length > 0,
          bid: { cards: o.cards.map((c) => c.id), type: o.type, isNoTrump: o.isNoTrump, trumpSuit: o.trumpSuit }
        }));
        view.bidTipText = st.bids.length ? '可反主（更高优先级）' : '亮主阶段：选择要亮的牌';
      }
    }
    // 三打一：真人庄家选主（四个花色，显示各门张数辅助决策）
    if (isHumanChooseTrump) {
      const SYMBOLS = { S: '♠', H: '♥', C: '♣', D: '♦' };
      const hand = st.players[0].hand;
      view.bidMode = 'trump';
      view.suitOptionsView = ['S', 'H', 'C', 'D'].map((su) => ({
        suit: su,
        symbol: SYMBOLS[su],
        red: su === 'H' || su === 'D',
        count: hand.filter((c) => c.suit === su).length
      }));
      const peekNote = st.bottomPeekable ? '（本局叫分低，闲家可以看底牌）' : '';
      view.bidTipText = `你是庄家（合同 ${st.contractScore} 分）——选一个花色做主牌${peekNote}`;
    }
    // 三打一：底牌明示（成交分 ≤ peek 阈值 闲家可看：CHOOSE_TRUMP 起向所有人展示底牌内容）
    view.bottomRevealCards = (isSanDaYi && st.bottomPeekable && st.phase !== 'BIDDING' && st.phase !== 'INIT_DEAL' && st.bottomCards.length && !st.bottomMerged)
      ? st.bottomCards.map((c, i) => ({ id: 'peek-' + i, suit: c.suit, rank: c.rank, isJoker: !!c.isJoker }))
      : [];
    try {
      this.setData(view);
    } catch (e) {
      // 渲染异常不阻断对局驱动（数据视图降级：只保留核心字段）
      console.error('render setData 异常', e);
      this.setData({ phase: st.phase, turnIdx: st.turnIdx, myHand: view.myHand || [] });
    }
    this.persist();
    this.scheduleWatchdog();
    // 收墩飘分（墩完成后触发）
    try { this.maybeFloatPoints(st); } catch (e) { /* 动画失败不影响 */ }
    // 清理飞入动画（一次性）
    if (newIds.length) {
      setTimeout(() => this.setData({ playInIds: [] }), 800);
    }
  },

  /**
   * v1.8 看门狗：render 后若游戏在非真人阶段却没有排程中的 AI 定时器，强制重启调度。
   * 防御历史 bug：定时器链断裂/渲染异常导致界面假死（用户报告"停留等待界面"）。
   */
  scheduleWatchdog() {
    const self = this;
    if (this._watchdog) clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      self._watchdog = null;
      try {
        const st = self.service && self.service.getState();
        if (!st || st.phase === 'GAME_OVER' || st.phase === 'SCORING') return;
        const isSDY = st.config.gameMode === 'san_da_yi';
        const needAI = (st.phase === 'BIDDING' && (isSDY ? st.turnIdx !== 0 : !self.humanBidPending(st)))
          || (st.phase === 'CHOOSE_TRUMP' && !st.players[st.dealerIdx].isHuman)
          || (st.phase === 'BURYING' && !st.players[st.dealerIdx].isHuman)
          || (st.phase === 'PLAYING' && st.turnIdx !== 0)
          || (st.phase === 'INIT_DEAL');
        const waitingHuman = (st.phase === 'BIDDING' && (isSDY ? st.turnIdx === 0 : self.humanBidPending(st)))
          || (st.phase === 'CHOOSE_TRUMP' && st.players[st.dealerIdx].isHuman)
          || (st.phase === 'BURYING' && st.players[st.dealerIdx].isHuman)
          || (st.phase === 'PLAYING' && st.turnIdx === 0);
        if (needAI && !aiTimer && !waitingHuman) {
          console.warn('[watchdog] AI 调度断链，重启 driveAI phase=' + st.phase);
          self.driveAI();
        }
      } catch (e) { /* 看门狗自身异常静默 */ }
    }, 2500);
  },

  /** 手牌新增检测（摸底牌/发牌动画）——基于真实手牌 id */
  detectNewCards(st) {
    const ids = st.players[0].hand.map((c) => c.id);
    const hadPrev = !!this.prevHandIds;
    const prevCount = hadPrev ? this.prevHandIds.length : 0;
    // v1.9 发牌动画：手牌从空（0 张）突变到 ≥20 张（新局发牌，含首次进入与下一局）
    // → 5 张 5 张飞入。首次进入因 prevHandIds 尚不存在，prevCount 视为 0，可正确触发。
    if (prevCount === 0 && ids.length >= 20) {
      this.startDealAnimation();
    }
    const added = hadPrev ? ids.filter((id) => !this.prevHandIds.includes(id)) : [];
    this.prevHandIds = ids;
    return added;
  },

  /** v1.9 发牌动画：5 张一批飞入（每批 120ms），期间 visibleCount 递增 */
  startDealAnimation() {
    if (this._dealTimer) clearInterval(this._dealTimer);
    if (this._dealWatchdog) clearTimeout(this._dealWatchdog);
    // 动态读取本局手牌数（两副牌 4 人玩法每人 25 张；避免硬编码）
    const st = this.service && this.service.getState();
    const total = (st && st.players && st.players[0]) ? st.players[0].hand.length : 25;
    this.setData({ handVisibleCount: 0 });
    let shown = 0;
    this._dealTimer = setInterval(() => {
      shown += 5;
      this.setData({ handVisibleCount: Math.min(shown, total) });
      if (shown >= total) {
        clearInterval(this._dealTimer);
        this._dealTimer = null;
        // 动画结束兜底：全部可见
        this._dealWatchdog = setTimeout(() => this.setData({ handVisibleCount: 999 }), 800);
      }
    }, 120);
  },

  /** 亮主阶段可亮牌 id（级牌/王，呼吸提示） */
  computeGlowingIds(st) {
    try {
      const opts = this.service.bidOptions(0) || [];
      const ids = [];
      opts.forEach((o) => (o.cards || []).forEach((c) => ids.push(c.id)));
      return ids;
    } catch (e) {
      return [];
    }
  },

  /** 收墩飘分：最新完成墩有分且属于我方/敌方时展示 +N */
  maybeFloatPoints(st) {
    if (!st.completedTricks || !st.completedTricks.length) return;
    const last = st.completedTricks[st.completedTricks.length - 1];
    const lastKey = `${st.roundNo}-${st.completedTricks.length}`;
    if (this.lastFloatKey === lastKey) return; // 同一墩只飘一次
    if (!last.points || last.points <= 0) { this.lastFloatKey = lastKey; return; }
    this.lastFloatKey = lastKey;
    const winnerTeam = st.players[last.winnerIdx].team;
    const mine = winnerTeam === 0;
    const text = (mine ? '+' : '-') + last.points;
    this.setData({ floatPoints: { visible: true, text, anim: false } });
    setTimeout(() => this.setData({ floatPoints: { visible: true, text, anim: true } }), 20);
    setTimeout(() => this.setData({ floatPoints: { visible: false, text: '', anim: false } }), 1400);
  },

  /** 真人是否处于待亮主状态（升级模式：未亮且未表态） */
  humanBidPending(st) {
    const decided = st.bids.some((b) => b.playerIdx === 0) || (st.passedBidders || []).includes(0);
    return st.phase === 'BIDDING' && !decided;
  },

  /** 三打一：庄家当前得分（场上赢墩分） */
  sumDealerPoints(st) {
    const t = st.sanDaYiTeams;
    let s = 0;
    st.completedTricks.forEach((tk) => {
      if (tk.winnerIdx === t.dealer) s += tk.points;
    });
    if (st.penaltyPoints) s += st.penaltyPoints.dealer;
    return s;
  },

  /** 三打一：三家当前得分 */
  sumAttackerPoints(st) {
    const t = st.sanDaYiTeams;
    let s = 0;
    st.completedTricks.forEach((tk) => {
      if (tk.winnerIdx !== t.dealer) s += tk.points;
    });
    if (st.penaltyPoints) s += st.penaltyPoints.attackers;
    return s;
  },

  /* ==================== AI 驱动（R23，v1.1 节奏优化） ==================== */

  driveAI() {
    if (aiTimer) clearTimeout(aiTimer);
    const st = this.service.getState();
    if (!st) return;
    if (st.phase === 'GAME_OVER') return;
    const pace = st.config.aiPaceSeconds; // [0.8, 1.5]
    // v1.1 拟人节奏：新墩第一张稍慢（思考），连续出牌稍快
    const isNewTrick = !st.currentTrick || st.currentTrick.plays.length === 0;
    const base = (pace[0] + Math.random() * (pace[1] - pace[0])) * 1000;
    const delay = isNewTrick ? base * 1.25 : base * 0.75;
    aiTimer = setTimeout(() => {
      aiTimer = null;
      const cur = this.service.getState();
      if (!cur || cur.phase === 'GAME_OVER') return;
      const r = this.service.tick();
      if (r.acted) {
        this.render();
      }
      // 需要人类行动的阶段不继续排程
      const now = this.service.getState();
      const isSDY = now.config.gameMode === 'san_da_yi';
      // 三打一全员不报/下一局 → INIT_DEAL：自动发牌后必须继续驱动 AI（否则卡死）
      if (isSDY && now.phase === 'INIT_DEAL') {
        this.service.dispatch({ type: 'DEAL', rng: createRng() });
        this.render();
        this.driveAI(); // 关键：发完牌继续 AI 流程（首报者是 AI 时立即推进）
        return;
      }
      const waitHuman = (now.phase === 'PLAYING' && now.turnIdx === 0)
        || (now.phase === 'BURYING' && now.players[now.dealerIdx].isHuman)
        || (now.phase === 'CHOOSE_TRUMP' && now.players[now.dealerIdx].isHuman)
        || (now.phase === 'BIDDING' && (isSDY ? now.turnIdx === 0 : this.humanBidPending(now)))
        || now.phase === 'SCORING' || now.phase === 'GAME_OVER'
        || !r.acted;
      if (!waitHuman) this.driveAI();
    }, delay);
  },

  /* ==================== 事件：亮主 / 三打一报分 ==================== */

  /** 三打一：庄家选主花色 */
  onChooseTrump(e) {
    const suit = e.detail.suit;
    const r = this.service.chooseTrump(suit);
    if (!r.ok) {
      wx.showToast({ title: r.reason || '选主失败', icon: 'none' });
      return;
    }
    this.render();
    this.driveAI();
  },

  /** 三打一：真人报分 */
  onScoreBid(e) {
    const score = e.detail.score;
    const r = this.service.scoreBid(0, score);
    if (!r.ok) {
      wx.showToast({ title: r.reason || '报分失败', icon: 'none' });
      return;
    }
    this.render();
    this.driveAI();
  },

  onBid(e) {
    const bid = e.detail.bid;
    const st = this.service.getState();
    const cards = bid.cards.map((id) => st.players[0].hand.find((c) => c.id === id)).filter(Boolean);
    if (!cards.length) return;
    const r = this.service.bid(0, cards);
    if (!r.ok) {
      wx.showToast({ title: r.reason || '亮主失败', icon: 'none' });
      return;
    }
    this.render();
    this.driveAI();
  },

  onPassBid() {
    // 真人放弃（升级=不亮主；三打一=不加价/不报）
    const r = this.service.dispatch({ type: 'PASS_BID', playerIdx: 0 });
    void r;
    const st = this.service.getState();
    if (st.config.gameMode !== 'san_da_yi' && st.phase === 'BIDDING' && st.bids.length === 0) {
      // 升级模式：检查 AI 是否都已表态 → 翻底
      const allAiDecided = [1, 2, 3].every((i) =>
        st.bids.some((b) => b.playerIdx === i) || (st.passedBidders || []).includes(i));
      if (allAiDecided) {
        this.service.dispatch({ type: 'FLIP_BOTTOM' });
      }
    }
    this.render();
    this.driveAI();
  },

  /* ==================== v1.1 智能选牌 ==================== */

  /**
   * 智能选牌：点一张牌时自动带上等价组合。
   * 规则（QQ 升级风格）：
   *   - 出牌阶段：点 A 时若手中有同名同花色对子 → 两张齐选（对子结构优先）
   *   - 反选取消时：整组一起取消
   *   - 张数超出本墩需求时保留最新组
   */
  // 实时同步"出牌按钮所需张数"：选牌时 render 不重跑，必须手动更新，否则领出多选后按钮永久置灰
  _syncNeedPlayCount() {
    const st = this.service.getState();
    if (!st || st.phase !== 'PLAYING' || st.turnIdx !== 0) return;
    const needPlayCount = (st.currentTrick && st.currentTrick.leadCombo) ? st.currentTrick.leadCombo.n : this.data.selectedIds.length;
    if (this.data.needPlayCount !== needPlayCount) {
      this.setData({ needPlayCount });
    }
  },

  smartToggle(st, card, isSelected) {
    const hasLead = !!(st.currentTrick && st.currentTrick.leadCombo);
    // 领出时 n=0：不限制张数，由引擎按牌型（单/对/拖拉/甩）判定合法性
    const n = hasLead ? st.currentTrick.leadCombo.n : 0;
    let ids = this.data.selectedIds.slice();
    if (isSelected) {
      // 取消：该牌所在等价组一起取消
      const key = cardKey(card);
      const groupIds = st.players[0].hand
        .filter((c) => cardKey(c) === key)
        .map((c) => c.id);
      if (!hasLead) {
        // 领出：整组已全选时（如对子 2 张都选中），再点其中一张降级为单张，便于拆对出单
        const allSelected = groupIds.every((id) => ids.includes(id));
        if (allSelected) {
          return ids.filter((id) => id === card.id);
        }
      }
      ids = ids.filter((id) => !groupIds.includes(id));
      return ids;
    }
    // 选中：带上等价组
    const key = cardKey(card);
    const groupCards = st.players[0].hand.filter((c) => cardKey(c) === key);
    // 先移除旧选择中与该组重叠的（重新点选场景）
    const groupIds = groupCards.map((c) => c.id);
    ids = ids.filter((id) => !groupIds.includes(id));
    // 领出：选整组（对子 2 张 / 拖拉机多张），让用户自由组牌型；跟牌：补齐到 n 张
    const take = hasLead ? groupIds.slice(0, Math.max(1, n)) : groupIds;
    ids = ids.concat(take);
    // 跟牌超出张数：保留最新选择（领出不限制）
    if (hasLead && ids.length > n) ids = ids.slice(ids.length - n);
    return ids;
  },

  onCardTap(e) {
    const { card, selected } = e.detail;
    const st = this.service.getState();
    if (st.phase === 'BURYING') {
      // 多选埋底（保持原逻辑）
      let ids = this.data.selectedIds.slice();
      if (selected) {
        ids = ids.filter((id) => id !== card.id);
      } else if (ids.length < st.config.bottomCards) {
        ids.push(card.id);
      } else {
        wx.showToast({ title: `最多选 ${st.config.bottomCards} 张`, icon: 'none' });
        return;
      }
      this.setData({ selectedIds: ids });
      return;
    }
    if (st.phase === 'PLAYING' && st.turnIdx === 0) {
      // v1.1 智能选牌 + 双击出牌
      const now = Date.now();
      const isDoubleTap = this.lastTapCardId === card.id && (now - this.lastTapAt) < DOUBLE_TAP_MS;
      this.lastTapCardId = card.id;
      this.lastTapAt = now;
      if (isDoubleTap) {
        // 双击直接出牌：若该牌未选中先智能选中再出
        let ids = this.data.selectedIds.slice();
        if (!ids.includes(card.id)) {
          ids = this.smartToggle(st, card, false);
          this.setData({ selectedIds: ids });
          this._syncNeedPlayCount();
        }
        // 等视图同步后出牌
        setTimeout(() => this.onPlay(), 60);
        return;
      }
      const ids = this.smartToggle(st, card, selected);
      this.setData({ selectedIds: ids });
      this._syncNeedPlayCount();
    }
  },

  onClearSelect() {
    this.setData({ selectedIds: [] });
    this._syncNeedPlayCount();
  },

  onBuryConfirm() {
    const st = this.service.getState();
    const ids = this.data.selectedIds;
    if (ids.length !== st.config.bottomCards) {
      wx.showToast({ title: `需选满 ${st.config.bottomCards} 张`, icon: 'none' });
      return;
    }
    const cards = ids.map((id) => st.players[0].hand.find((c) => c.id === id)).filter(Boolean);
    const r = this.service.bury(cards);
    if (!r.ok) {
      wx.showToast({ title: r.reason || '埋底失败', icon: 'none' });
      return;
    }
    this.setData({ selectedIds: [] });
    this.render();
    this.driveAI();
  },

  /* ==================== 事件：出牌 ==================== */

  onPlay() {
    const st = this.service.getState();
    const ids = this.data.selectedIds;
    const cards = ids.map((id) => st.players[0].hand.find((c) => c.id === id)).filter(Boolean);
    // 领出时无 leadCombo：n 取用户实际选的张数（引擎按牌型判定单/对/拖拉/甩）；跟牌须等于 leadCombo.n
    const n = (st.currentTrick && st.currentTrick.leadCombo) ? st.currentTrick.leadCombo.n : cards.length;
    if (cards.length !== n) {
      wx.showToast({ title: `本墩须出 ${n} 张`, icon: 'none' });
      return;
    }
    const r = this.service.play(0, cards);
    if (!r.ok) {
      // F-08：抖动 + 原因提示
      wx.showToast({ title: r.reason || '非法出牌', icon: 'none' });
      wx.vibrateShort({ type: 'medium' });
      return;
    }
    this.setData({ selectedIds: [] });
    this.render();
    this.driveAI();
  },

  /* ==================== 工具：提示/历史 ==================== */

  onHint() {
    const st = this.service.getState();
    if (st.phase !== 'PLAYING' || st.turnIdx !== 0) {
      wx.showToast({ title: '当前无需出牌', icon: 'none' });
      return;
    }
    const hint = getHint(st, 0);
    if (!hint.cards) {
      wx.showToast({ title: hint.reason, icon: 'none' });
      return;
    }
    this.setData({ selectedIds: hint.cards.map((c) => c.id) });
    this._syncNeedPlayCount();
    wx.showToast({ title: hint.reason, icon: 'none' });
  },

  onHistory() {
    const st = this.service.getState();
    const recent = st.completedTricks.slice(-8).reverse();
    const mode = st.config.gameMode;
    const tricks = recent.map((t, i) => ({
      no: st.completedTricks.length - Math.min(8, st.completedTricks.length) + i + 1,
      leadName: fmt.seatName(t.leadPlayerIdx, mode),
      winnerName: fmt.seatName(t.winnerIdx, mode),
      points: t.points,
      plays: t.plays.map((p) => ({
        name: fmt.seatName(p.playerIdx, mode),
        text: p.cards.map((c) => cardText(c)).join(' ')
      }))
    }));
    this.setData({ historyVisible: true, historyTricks: tricks });
  },

  onHistoryClose() {
    this.setData({ historyVisible: false });
  },

  /* ==================== 结算 ==================== */

  onNextRound() {
    const prevSettle = this.service.getState().lastSettle || {};
    const wasSDY = prevSettle.mode === 'san_da_yi';
    this.service.nextRound();
    const st = this.service.getState();
    // 记录战绩（三打一：真人阵营胜负；升级：队伍胜负）
    const records = storage.get(STORAGE_KEYS.STATS) || [];
    const myWon = wasSDY
      ? (prevSettle.winnerTeam === 'dealer' ? st.lastDealerIdx === 0 : st.lastDealerIdx !== 0)
      : prevSettle.winnerTeam === 0;
    // 注：三打一庄家身份以结算时 sanDaYiTeams 为准，此处用 prevSettle.dealerIdx
    const sdyWon = wasSDY
      ? (prevSettle.winnerTeam === 'dealer' ? prevSettle.dealerIdx === 0 : prevSettle.dealerIdx !== 0)
      : prevSettle.winnerTeam === 0;
    void myWon;
    storage.set(STORAGE_KEYS.STATS, appendRecord(records, {
      roundNo: st.roundNo,
      myTeamWon: sdyWon,
      passedA: prevSettle.passedA,
      attackPoints: prevSettle.attackPoints,
      tricksCount: st.completedTricks.length
    }));
    this.setData({ selectedIds: [] });
    if (st.phase === 'GAME_OVER') {
      const stats = summarize(storage.get(STORAGE_KEYS.STATS) || []);
      wx.showModal({
        title: '🏆 过A获胜！',
        content: `用时 ${stats.totalRounds} 局，胜率 ${(stats.winRate * 100).toFixed(0)}%`,
        showCancel: false,
        success: () => {
          storage.remove(STORAGE_KEYS.CURRENT_GAME);
          wx.navigateBack({ delta: 1 });
        }
      });
      return;
    }
    this.render();
    this.driveAI();
  },

  onHome() {
    this.persist();
    wx.navigateBack({ delta: 1 });
  },

  /* ==================== 持久化 ==================== */

  persist() {
    const st = this.service && this.service.getState();
    if (!st) return;
    if (st.phase === 'GAME_OVER') {
      storage.remove(STORAGE_KEYS.CURRENT_GAME);
    } else {
      try {
        storage.set(STORAGE_KEYS.CURRENT_GAME, this.service.serialize());
      } catch (e) { /* 存储失败不阻断对局 */ }
    }
  }
});

/** 亮主选项文案 */
function bidOptionLabel(o) {
  if (o.type === 'joker_pair') {
    return o.cards[0].rank === 'BJ' ? '对大王' : '对小王';
  }
  if (o.type === 'pair_rank') {
    return `对${fmt.suitSymbol(o.trumpSuit)}级牌`;
  }
  return `${fmt.suitSymbol(o.trumpSuit)}级牌`;
}

/** 牌面简写（历史列表用） */
function cardText(c) {
  if (c.isJoker) return c.rank === 'BJ' ? '大王' : '小王';
  return fmt.suitSymbol(c.suit) + c.rank;
}
