/**
 * components/status-bar/status-bar.js —— 状态栏组件 v1.4（三打一支持）。
 */

'use strict';

Component({
  properties: {
    trumpText: { type: String, value: '定主中…' },
    myScore: { type: Number, value: 0 },
    enemyScore: { type: Number, value: 0 },
    /** v1.4 三打一：计分标签（庄家/三家 或 我方/敌方） */
    myScoreLabel: { type: String, value: '我方' },
    enemyScoreLabel: { type: String, value: '敌方' },
    /** v1.4：gameMode（shengji | san_da_yi） */
    gameMode: { type: String, value: 'shengji' },
    /** v1.4 三打一：合同分 */
    contractScore: { type: String, value: '' },
    roundNo: { type: Number, value: 1 },
    trickInfo: { type: String, value: '' }
  }
});
