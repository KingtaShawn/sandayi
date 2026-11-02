/** 庄家训练：随公开出牌逐步开放队友的粗略牌力，模拟高手算牌；不开放完整手牌。 */
'use strict';

const { GreedyStrategy } = require('./strategy-greedy');
const { domainOf, pointsOf, strengthInDomain } = require('../engine/combo');
const { buildSuitDefense, suitDiscardCost } = require('./suit-defense');

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
    ctx.trumpTail = this._readTrumpTail(state, playerIdx, ctx, progress);
    if (this.suitDefenseEnabled !== false) ctx.suitDefense = buildSuitDefense(state, playerIdx, ctx);
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

  /**
   * 清主至少三轮、公开未见主牌至多六张时，只开放“后位能否接当前单主”这一位信息。
   * 不给出王的种类、牌面或真手牌；张数已公开为0的队友也不再读取暗牌。
   */
  _readTrumpTail(state, playerIdx, ctx, progress) {
    const trick = state.currentTrick, ti = state.trumpInfo;
    if (this.trumpTailEnabled === false || state.turnIdx !== playerIdx
        || !trick || trick.leadPlayerIdx !== ctx.sdy.dealerIdx
        || !trick.leadCombo.isTrump || trick.leadCombo.type !== 'single'
        || (progress.exposure.get('TRUMP') || 0) < 3
        || ctx.knowledge.domains.get('TRUMP').unseen > 6
        || state.players[playerIdx].hand.some((c) => domainOf(c, ti) === 'TRUMP')) return null;
    const winner = this._currentWinnerPlay(state, trick, ti, state.config);
    if (!winner || winner.playerIdx !== ctx.sdy.dealerIdx) return null;
    const threshold = strengthInDomain(winner.cards[0], ti);
    const pending = state.players.map((p, seat) => seat).filter((seat) => seat !== playerIdx
      && seat !== ctx.sdy.dealerIdx && !trick.plays.some((p) => p.playerIdx === seat));
    if (!pending.length) return null;
    const readings = pending.map((seat) => {
      if (ctx.knowledge.seats[seat].domains.get('TRUMP').count.max === 0) return false;
      const trumps = state.players[seat].hand.filter((c) => domainOf(c, ti) === 'TRUMP');
      if (trumps.length > 2) return null; // 主力还多，不据此提前开放大牌情报。
      return trumps.some((c) => strengthInDomain(c, ti) > threshold);
    });
    if (readings.some((canBeat) => canBeat === true)) return { canCash: true };
    return readings.every((canBeat) => canBeat === false) ? { canCash: false } : null;
  }

  _chooseTeamFollow(state, playerIdx, ctx, candidates, pick) {
    if (ctx.suitDefense) {
      const score = (cards) => this._scoreFollow(state, playerIdx, cards, ctx);
      return candidates.reduce((best, cards) => score(cards) > score(best) + 1e-9 ? cards : best, pick);
    }
    if (!ctx.trumpTail) return super._chooseTeamFollow(state, playerIdx, ctx, candidates, pick);
    // 庄家已先出单主，后续只剩同阵营；若有后位可反压，本家垫分不会改变赢墩归属。
    const sign = ctx.trumpTail.canCash ? 1 : -1;
    const hand = state.players[playerIdx].hand, ti = state.trumpInfo;
    const score = (cards) => sign * pointsOf(cards, state.config) * 4
      + (20 - this._maxStrength(cards, ti)) / 20 * 6 + this._discardKeep(cards, hand, ti, ctx);
    return candidates.reduce((best, cards) => score(cards) > score(best) + 1e-9 ? cards : best, pick);
  }

  _solveEarlyPlan(state, playerIdx, ctx, candidates, pick) {
    // 两墩采样不能把已获得的接手情报丢掉，再用随机假设改成送分或错过跑分。
    if (ctx.trumpTail || ctx.suitDefense) return null;
    return super._solveEarlyPlan(state, playerIdx, ctx, candidates, pick);
  }

  _discardKeep(cards, hand, ti, ctx) {
    const keep = super._discardKeep(cards, hand, ti, ctx);
    return ctx && ctx.suitDefense ? keep - suitDiscardCost(cards, hand, ti, ctx.suitDefense.suit) : keep;
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
