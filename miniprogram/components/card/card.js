/**
 * components/card/card.js —— 单张牌组件（v1.1 雕琢版）。
 *
 * v1.1 数据流修正：isTrump/isLevel/pointValue 等展示属性由数据流直接携带
 * （Page 预计算），组件不再依赖 trumpInfo 判主（避免 Set 跨层序列化丢失）。
 * 卡片数据：{id, suit, rank, isJoker, isTrump, pointValue, levelRank?}
 * 属性：selected / disabled / shaking / glowing / playIn / styleText
 * 事件：tap → triggerEvent('cardtap', {card})
 */

'use strict';

const { SUIT_SYMBOLS } = require('../../engine/card');

Component({
  properties: {
    /** 卡片数据（含预计算 isTrump/pointValue） */
    card: {
      type: Object,
      value: null,
      observer() {
        this.refresh();
      }
    },
    /** 当前局级牌（'2'..'A'，级牌角标用；可选） */
    levelRank: { type: String, value: '', observer() { this.refresh(); } },
    selected: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    shaking: { type: Boolean, value: false },
    /** 可亮主呼吸光效 */
    glowing: { type: Boolean, value: false },
    /** 出牌飞入动画 */
    playIn: { type: Boolean, value: false },
    /** v1.9 发牌动画：飞入延迟（ms，逐张错开） */
    playInDelay: { type: Number, value: 0 },
    /** v1.2：紧凑模式（手牌 >24 张时缩小牌面） */
    dense: { type: Boolean, value: false },
    /** 相对位移样式（手牌扇形/重叠） */
    styleText: { type: String, value: '' }
  },
  data: {
    displayRank: '',
    suitSymbol: '',
    red: false,
    isTrump: false,
    isLevel: false,
    isJoker: false,
    isBigJoker: false,
    pointValue: 0
  },
  lifetimes: {
    attached() {
      this.refresh();
    }
  },
  methods: {
    refresh() {
      const card = this.properties.card;
      if (!card) return;
      const isJoker = !!card.isJoker;
      const red = isJoker ? card.rank === 'BJ' : card.suit === 'H' || card.suit === 'D';
      const levelRank = this.properties.levelRank;
      this.setData({
        // 王：大王=★（红）+正，小王=☆（黑）+副——星占牌面位、正/副占花色位
        displayRank: isJoker ? (card.rank === 'BJ' ? '★' : '☆') : card.rank,
        suitSymbol: isJoker ? (card.rank === 'BJ' ? '正' : '副') : (SUIT_SYMBOLS[card.suit] || ''),
        red,
        isTrump: !!card.isTrump,
        isLevel: !!(levelRank && card.rank === levelRank),
        isJoker,
        isBigJoker: card.rank === 'BJ',
        // 分牌角标（预计算值；5→5 10→10 K→10，数值来自 RuleConfig.pointValues）
        pointValue: card.pointValue || 0
      });
    },

    onTap() {
      if (this.properties.disabled) return;
      this.triggerEvent('cardtap', { card: this.properties.card });
    }
  }
});
