/**
 * components/trick-area/trick-area.js —— 中央出牌区 v1.1。
 *
 * 输入：currentTrick（TrickData）+ levelRank（级牌角标）
 * v1.1：出牌的牌由 Page 预计算主牌态（isTrump/pointValue 附加到 card 上），
 *       本组件按方位拆分后纯展示；不再持有 trumpInfo。
 */

'use strict';

Component({
  properties: {
    currentTrick: { type: Object, value: null },
    bottomCount: { type: Number, value: 0 },
    /** v1.1：级牌字面（级牌角标） */
    levelRank: { type: String, value: '' },
    /** v1.3：残留墩模式（上一墩变暗保留，不出飞入动画） */
    dim: { type: Boolean, value: false }
  },
  data: {
    north: [],
    south: [],
    east: [],
    west: [],
    bottomCards: []
  },
  observers: {
    'currentTrick, bottomCount': function trickObserver(trick, bottomCount) {
      const empty = { north: [], south: [], east: [], west: [] };
      if (!trick || !trick.plays) {
        this.setData(Object.assign(empty, { bottomCards: this.padBottom(bottomCount) }));
        return;
      }
      const bySeat = { N: [], S: [], E: [], W: [] };
      trick.plays.forEach((p) => {
        const seat = ['S', 'E', 'N', 'W'][p.playerIdx];
        if (bySeat[seat]) bySeat[seat] = bySeat[seat].concat(p.cards);
      });
      this.setData({
        south: bySeat.S,
        east: bySeat.E,
        north: bySeat.N,
        west: bySeat.W,
        bottomCards: this.padBottom(bottomCount)
      });
    }
  },
  methods: {
    padBottom(count) {
      const arr = [];
      for (let i = 0; i < (count || 0); i++) arr.push({ id: `bottom-${i}` });
      return arr;
    }
  }
});
