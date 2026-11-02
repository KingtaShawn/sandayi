/** 庄家训练：随公开出牌逐步开放队友的粗略牌力，模拟高手算牌；不开放完整手牌。 */
'use strict';

const { GreedyStrategy } = require('./strategy-greedy');
const { domainOf } = require('../engine/combo');

function canShareHands(state, viewerIdx) {
  if (state.config.gameMode !== 'san_da_yi' || state.phase !== 'PLAYING') return false;
  const dealer = state.sanDaYiTeams ? state.sanDaYiTeams.dealer : state.dealerIdx;
  return !!state.players[dealer].isHuman && viewerIdx !== dealer
    && state.players.every((p, seat) => seat === dealer || p.isHuman === false);
}

/** 仅由公开历史决定开启时机、可读的门及精度；大甩牌也不能一墩解锁全部信息。 */
function readingProgress(state) {
  const tricks = state.completedTricks || [], exposure = new Map();
  let played = 0;
  for (const t of tricks) {
    played += t.plays.reduce((n, p) => n + p.cards.length, 0);
    if (t.leadCombo && t.leadCombo.type !== 'eight') {
      const d = t.leadCombo.suit;
      exposure.set(d, (exposure.get(d) || 0) + 1);
    }
  }
  const stage = tricks.length < 3 || played < 16 ? 0
    : tricks.length >= 8 && played >= 48 ? 3
      : tricks.length >= 6 && played >= 32 ? 2 : 1;
  return { stage, exposure, width: stage === 3 ? 2 : stage === 2 ? 3 : 4 };
}

class SharedAttackStrategy extends GreedyStrategy {
  _buildCtx(state, playerIdx) {
    const ctx = super._buildCtx(state, playerIdx);
    if (!canShareHands(state, playerIdx)) return ctx;
    const progress = readingProgress(state);
    if (!progress.stage || !ctx.knowledge || !ctx.knowledge.consistent) return ctx;
    const domains = [...progress.exposure].filter(([d, times]) => times >= 2).map(([d]) => d);
    if (!domains.length) return ctx;
    ctx.teamReadings = new Map();
    ctx.readingStage = progress.stage;
    state.players.forEach((p, seat) => {
      if (seat === playerIdx || seat === ctx.sdy.dealerIdx) return;
      const readings = new Map();
      for (const d of domains) {
        const publicRange = ctx.knowledge.seats[seat].domains.get(d);
        // 公开信息已经足够精确时，不再读取暗牌；范围只作采样偏好，不当作锁墩证据。
        if (publicRange.count.max - publicRange.count.min < progress.width) continue;
        const count = p.hand.filter((c) => domainOf(c, state.trumpInfo) === d).length;
        const low = Math.floor(count / progress.width) * progress.width;
        readings.set(d, { min: low, max: low + progress.width - 1 });
      }
      if (readings.size) ctx.teamReadings.set(seat, readings);
    });
    return ctx;
  }

  _constrainPublicGroups(ctx, groups) {
    super._constrainPublicGroups(ctx, groups);
    if (ctx.teamReadings) for (const g of groups) g.teamReading = ctx.teamReadings.get(g.seat);
  }

  // 队友仍采样多种可能手牌，只对符合粗略长短判断的分布提高权重。
  // 保留四分之一原分布，避免把模拟读牌当成确定事实。庄家和底牌没有读取通道。
  _r5Assignments(unseen, groups, ti, sampleN, weightSpec) {
    if (!groups.some((g) => g.teamReading && g.teamReading.size)) {
      return super._r5Assignments(unseen, groups, ti, sampleN, weightSpec);
    }
    const count = sampleN || 48;
    const assignments = super._r5Assignments(unseen, groups, ti, count * 3, weightSpec);
    if (assignments.length <= count) return assignments;
    const ranked = assignments.map((asg, index) => {
      let cost = 0;
      groups.forEach((g, i) => {
        if (!g.teamReading) return;
        for (const [d, range] of g.teamReading) {
          const n = asg.hands[i].filter((c) => domainOf(c, ti) === d).length;
          cost += Math.max(0, range.min - n, n - range.max);
        }
      });
      return { asg, cost, index };
    }).sort((a, b) => a.cost - b.cost || a.index - b.index).map((e) => e.asg);
    const picked = [], used = new Set();
    let biased = 0, neutral = 0;
    for (let i = 0; i < count; i++) {
      const source = i % 4 === 3 ? assignments : ranked;
      let cursor = i % 4 === 3 ? neutral : biased;
      while (cursor < source.length && used.has(source[cursor])) cursor++;
      if (cursor >= source.length) break;
      const asg = source[cursor++];
      picked.push(asg); used.add(asg);
      if (i % 4 === 3) neutral = cursor;
      else biased = cursor;
    }
    return picked;
  }
}

module.exports = { SharedAttackStrategy, canShareHands, readingProgress };
