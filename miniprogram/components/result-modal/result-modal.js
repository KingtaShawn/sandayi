/**
 * components/result-modal/result-modal.js —— 结算弹层 v1.4（三打一支持）。
 */

'use strict';

Component({
  properties: {
    visible: { type: Boolean, value: false },
    banner: { type: String, value: '' },
    isWin: { type: Boolean, value: false },
    /** v1.4：shengji | san_da_yi */
    mode: { type: String, value: 'shengji' },
    /** 三打一 */
    dealerPoints: { type: Number, value: 0 },
    attackerPoints: { type: Number, value: 0 },
    contractScore: { type: Number, value: 0 },
    penaltyTotal: { type: Number, value: 0 },
    /** 升级模式 */
    attackPoints: { type: Number, value: 0 },
    bottomGained: { type: Number, value: 0 },
    bottomMultiplier: { type: Number, value: 1 },
    levelsGained: { type: Number, value: 0 },
    myLevel: { type: String, value: '2' },
    enemyLevel: { type: String, value: '2' },
    bottomCards: { type: Array, value: [] },
    gameOver: { type: Boolean, value: false }
  },

  methods: {
    onNext() {
      this.triggerEvent('next', {});
    },
    onHome() {
      this.triggerEvent('home', {});
    },
    noop() { /* 阻止穿透 */ }
  }
});
