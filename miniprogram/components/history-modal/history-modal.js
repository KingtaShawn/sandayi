/**
 * components/history-modal/history-modal.js —— 出牌历史回看（P1 F-12）。
 */

'use strict';

Component({
  properties: {
    visible: { type: Boolean, value: false },
    /** [{no, leadName, winnerName, points, plays: [{name, text}]}] */
    tricks: { type: Array, value: [] }
  },

  methods: {
    onClose() {
      this.triggerEvent('close', {});
    }
  }
});
