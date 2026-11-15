'use strict';

Page({
  onPoker() { wx.navigateTo({ url: '/pages/poker/poker' }); },
  onPopstar() { wx.navigateTo({ url: '/pages/popstar/popstar' }); },
  onCards() { wx.navigateTo({ url: '/pages/home/home' }); },
  onMatch3() { wx.navigateTo({ url: '/pages/match3/match3' }); }
});
