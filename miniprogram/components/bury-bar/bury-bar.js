/**
 * components/bury-bar/bury-bar.js —— 埋底操作条。
 */

'use strict';

Component({
  properties: {
    visible: { type: Boolean, value: false },
    needCount: { type: Number, value: 8 },
    selectedCount: { type: Number, value: 0 }
  },

  methods: {
    onConfirm() {
      if (this.properties.selectedCount !== this.properties.needCount) {
        wx.showToast({ title: `需选满 ${this.properties.needCount} 张`, icon: 'none' });
        return;
      }
      this.triggerEvent('confirm', {});
    }
  }
});
