/**
 * components/hand-area/hand-area.js —— 手牌区组件 v1.2。
 *
 * v1.2（QQ 风格一屏全显）：
 *   - 去掉横向 scroll-view，手牌全部挤在一屏内
 *   - 按牌数动态计算重叠间距（33 张也能放下）
 *   - 牌多时自动切换 dense 模式（缩小牌面与角标字体）
 *   - 间距由本组件计算（styleText 内联 margin-left），无需 JS 测量
 *
 * 数据流（v1.1 修正保持）：接收 Page 预计算的 handView（isTrump/pointValue 预计算）。
 * 事件：cardtap → 父级处理选牌；selectedIds 由父级回传同步。
 */

'use strict';

Component({
  properties: {
    /** Page 预计算的手牌视图 [{id, suit, rank, isJoker, isTrump, pointValue}]（排序由本组件完成） */
    hand: {
      type: Array,
      value: [],
      observer() {
        this.refresh();
      }
    },
    /** 已选牌 id 集合（字符串数组） */
    selectedIds: { type: Array, value: [] },
    /** 置灰牌 id（非法提示用） */
    disabledIds: { type: Array, value: [] },
    /** 卡片重叠间距 rpx（v1.2 起自动计算，此属性仅作上限兜底） */
    overlap: { type: Number, value: -28 },
    label: { type: String, value: '' },
    /** 级牌字面（级牌角标透传给 card；主牌区排序也用于识别常主组） */
    levelRank: { type: String, value: '' },
    /** 主花色（主级牌排同级牌最前；选主前为空） */
    trumpSuit: { type: String, value: '' },
    /** 抖动牌 id（非法出牌动画） */
    shakingIds: { type: Array, value: [] },
    /** 可亮主呼吸光效牌 id */
    glowingIds: { type: Array, value: [] },
    /** 飞入动画牌 id */
    playInIds: { type: Array, value: [] },
    /** v1.9 发牌动画：当前可见张数（<hand.length 时逐批+5；由 Page 驱动定时器） */
    visibleCount: { type: Number, value: 999 }
  },
  data: {
    viewCards: [],
    dense: false
  },
  lifetimes: {
    attached() {
      this.refresh();
    }
  },
  observers: {
    'selectedIds, disabledIds, shakingIds, glowingIds, playInIds, visibleCount': function selectedObserver() {
      this.refresh();
    }
  },
  methods: {
    refresh() {
      const { hand, selectedIds, disabledIds, shakingIds, glowingIds, playInIds, visibleCount } = this.properties;
      const cards = (hand || []).slice(0, Math.max(0, visibleCount));
      const n = cards.length;
      // v1.2 一屏全显策略（QQ 风格）：
      //   总宽 = 卡宽 + (n-1)×露出宽 ≤ 可用宽 700rpx
      //   margin = 露出宽 - 卡宽（负值）；牌 >24 张切 dense 小牌面（64rpx 宽）
      const dense = n > 24;
      const usable = 700;
      const cardW = dense ? 64 : 88;
      let margin = n > 1 ? Math.floor((usable - cardW) / (n - 1)) - cardW : 0;
      if (margin > -6) margin = -6;   // 牌少时不铺太开
      if (margin < -66) margin = -66; // 保底：至少露出 22rpx
      // 排序：副牌按花色/牌面升序在左，主牌在右（isTrump 已由 Page 预计算）
      const suitOrder = { S: 1, H: 2, C: 3, D: 4 };
      const rankVal = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14, RJ: 15, BJ: 16 };
      // 主牌区再分「王+级牌（常主）」与主花色两段：2 不散落各花色，主级牌排最前
      const levelRank = this.properties.levelRank || '';
      const trumpSuit = this.properties.trumpSuit || '';
      const sorted = cards.slice().sort((a, b) => {
        const ta = a.isTrump ? 1 : 0;
        const tb = b.isTrump ? 1 : 0;
        if (ta !== tb) return ta - tb;
        const ga = (a.isJoker || a.rank === levelRank) ? 0 : 1;
        const gb = (b.isJoker || b.rank === levelRank) ? 0 : 1;
        if (ga !== gb) return ga - gb;
        if (a.rank === levelRank && b.rank === levelRank) {
          const pa = a.suit === trumpSuit ? 0 : 1;
          const pb = b.suit === trumpSuit ? 0 : 1;
          if (pa !== pb) return pa - pb;
        }
        const sa = a.isJoker ? 0 : suitOrder[a.suit] || 9;
        const sb = b.isJoker ? 0 : suitOrder[b.suit] || 9;
        if (sa !== sb) return sa - sb;
        return (rankVal[a.rank] || 0) - (rankVal[b.rank] || 0);
      });
      let firstTrumpSeen = false;
      const isDealing = (hand || []).length > n; // 发牌动画进行中
      const viewCards = sorted.map((c, i) => {
        const isTrumpHead = c.isTrump && !firstTrumpSeen;
        if (isTrumpHead) firstTrumpSeen = true;
        const styleText = i === 0
          ? ''
          : `margin-left: ${isTrumpHead ? Math.max(margin, -40) : margin}rpx`;
        return {
          id: c.id,
          card: c,
          isTrump: c.isTrump,
          isTrumpHead,
          styleText,
          selected: (selectedIds || []).includes(c.id),
          disabled: (disabledIds || []).includes(c.id),
          shaking: (shakingIds || []).includes(c.id),
          glowing: (glowingIds || []).includes(c.id),
          // 发牌中：最后一批的牌逐张错开飞入（每张延迟 30ms）
          playIn: isDealing || (playInIds || []).includes(c.id),
          playInDelay: isDealing ? (i % 5) * 30 : 0
        };
      });
      this.setData({ viewCards, dense });
    },

    onCardTap(e) {
      const idx = e.currentTarget.dataset.index;
      const item = this.data.viewCards[idx];
      if (!item || item.disabled) return;
      this.triggerEvent('cardtap', { card: item.card, selected: item.selected });
    }
  }
});
