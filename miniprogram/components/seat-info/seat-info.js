/**
 * components/seat-info/seat-info.js —— 座位信息组件（v1.1：竖排模式 + 思考气泡 + 庄徽标）。
 */

'use strict';

Component({
  properties: {
    /** 0..3 座位下标 */
    playerIdx: { type: Number, value: 0 },
    name: { type: String, value: '' },
    handCount: { type: Number, value: 0 },
    isDealer: { type: Boolean, value: false },
    isTurn: { type: Boolean, value: false },
    /** 身份标签：升级=队友/对手方；三打一=庄家已用"庄"徽标，其余显示"对手" */
    teamLabel: { type: String, value: '' },
    /** v1.6：阵营标签（三打一：'对手'；升级模式可传 '队友'/'对手'） */
    campLabel: { type: String, value: '' },
    /** v1.1：竖排模式（东西家侧栏） */
    vertical: { type: Boolean, value: false },
    /** v1.1：思考气泡（AI 行动中） */
    thinking: { type: Boolean, value: true }
  },
  data: {
    seatLabel: ''
  },
  lifetimes: {
    attached() {
      const seatNames = ['南', '东', '北', '西'];
      this.setData({ seatLabel: seatNames[this.properties.playerIdx] || '?' });
    }
  }
});
