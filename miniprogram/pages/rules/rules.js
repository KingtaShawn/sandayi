/**
 * pages/rules/rules.js —— 规则速查页：文案由 RuleConfig 动态渲染（验收标准 2）。
 */

'use strict';

const fmt = require('../../utils/format');

Page({
  data: {
    cfg: null,
    totalCards: 108,
    totalPoints: 200,
    perPlayer: 25,
    levelUpRows: [],
    passAText: '',
    dealerPassText: '',
    noBidText: '',
    throwText: ''
  },

  onLoad() {
    const app = getApp();
    const cfg = app.globalData.config;
    const totalCards = 54 * cfg.deckCount;
    const perPlayer = (totalCards - cfg.bottomCards) / 4;
    this.setData({
      cfg: {
        deckCount: cfg.deckCount,
        bottomCards: cfg.bottomCards,
        rankStart: cfg.rankStart,
        rankEnd: cfg.rankEnd,
        pointsToTake: cfg.pointsToTake,
        bottomMultiplier: cfg.bottomMultiplier,
        allowNoTrump: cfg.allowNoTrump,
        mustFollowPairAsPair: cfg.mustFollowPairAsPair,
        mustFollowTractorAsTractor: cfg.mustFollowTractorAsTractor,
        bottomMultiplierByType: cfg.bottomMultiplierByType
      },
      totalCards,
      totalPoints: totalCards / 54 * 100,
      perPlayer,
      levelUpRows: fmt.levelUpTableText(cfg),
      passAText: fmt.passAText(cfg),
      dealerPassText: {
        winner_stays: '庄家方胜连庄；攻方上台由定主者坐庄',
        rotate: '获胜方两人轮换坐庄',
        bidder_always: '每局定主者坐庄'
      }[cfg.dealerPassRule] || cfg.dealerPassRule,
      noBidText: cfg.noBidFallback === 'flip_bottom' ? '翻开底牌第一张定主，庄家随机' : '重新发牌',
      throwText: cfg.throwPenalty === 'reject' ? '不成立时界面直接禁止（须每个单元都最大）' : '不成立时罚出该门最小等量牌'
    });
  }
});
