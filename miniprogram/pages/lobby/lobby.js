'use strict';

Page({
  onBreakout() { wx.navigateTo({ url: '/pages/breakout/breakout' }); },
  onSudoku() { wx.navigateTo({ url: '/pages/sudoku/sudoku' }); },
  onPoker() { wx.navigateTo({ url: '/pages/poker/poker' }); },
  onPopstar() { wx.navigateTo({ url: '/pages/popstar/popstar' }); },
  onCards() { wx.navigateTo({ url: '/pages/home/home' }); },
  onMatch3() { wx.navigateTo({ url: '/pages/match3/match3' }); }
});
