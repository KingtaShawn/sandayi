/**
 * components/bid-bar/bid-bar.js —— 亮主/反主 & 三打一报分/选主操作条 v1.5。
 *
 * mode='classic'：options: [{key, label, sub, bid}]，事件 bid → {bid}
 * mode='score'：scoreOptions: [90,100,...]，事件 scorebid → {score}；pass → {}
 * mode='trump'：suitOptions: [{suit, symbol, count, red}]，事件 chooseTrump → {suit}
 */

'use strict';

Component({
  properties: {
    visible: { type: Boolean, value: false },
    /** classic=升级亮主 | score=三打一报分 | trump=三打一选主 */
    mode: { type: String, value: 'classic' },
    options: { type: Array, value: [] },
    /** 三打一：可报分值列表 */
    scoreOptions: { type: Array, value: [] },
    /** 三打一选主：花色选项 */
    suitOptions: { type: Array, value: [] },
    tipText: { type: String, value: '亮主阶段：选择要亮的牌' },
    /** 三打一：pass 按钮文案（有报价时="不加价"） */
    passLabel: { type: String, value: '不报分' }
  },
  methods: {
    onOptionTap(e) {
      const idx = e.currentTarget.dataset.index;
      const opt = this.properties.options[idx];
      if (!opt) return;
      // 二次确认仅对反主（非首次亮）
      if (opt.needsConfirm) {
        wx.showModal({
          title: '确认反主',
          content: `确定用「${opt.label}」反主吗？`,
          success: (res) => {
            if (res.confirm) this.triggerEvent('bid', { bid: opt.bid });
          }
        });
        return;
      }
      this.triggerEvent('bid', { bid: opt.bid });
    },

    /** 三打一：报分 */
    onScoreTap(e) {
      const score = e.currentTarget.dataset.score;
      if (!score) return;
      this.triggerEvent('scorebid', { score });
    },

    /** 三打一：选主花色 */
    onSuitTap(e) {
      const suit = e.currentTarget.dataset.suit;
      if (!suit) return;
      this.triggerEvent('chooseTrump', { suit });
    },

    onPass() {
      this.triggerEvent('pass', {});
    }
  }
});
