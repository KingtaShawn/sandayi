/** 自己剩余手牌的兑现路线。只接收自己的牌和公开威胁判断，不接收对手手牌。 */
'use strict';

const { parseCombo, pointsOf, domainOf, strengthInDomain } = require('../engine/combo');

const playKey = (cards) => cards.map((c) => c.id).sort().join('|');

function handUnits(hand) {
  const groups = new Map();
  for (const c of hand) {
    const key = `${c.suit}-${c.rank}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const units = hand.map((c) => [c]);
  for (const cards of groups.values()) {
    for (let i = 0; i + 1 < cards.length; i += 2) units.push(cards.slice(i, i + 2));
  }
  return units;
}

/** 同一张牌只计一次；先兑现安全分对，再计算未被占用的安全单张。 */
function cashPlan(hand, ti, cfg, canBeat) {
  const safe = handUnits(hand).filter((cs) => !canBeat(parseCombo(cs, ti, cfg)));
  const used = new Set();
  let points = 0;
  const runs = [];
  safe.sort((a, b) => b.length - a.length || pointsOf(b, cfg) - pointsOf(a, cfg));
  for (const cs of safe) {
    if (cs.some((c) => used.has(c.id))) continue;
    cs.forEach((c) => used.add(c.id));
    points += pointsOf(cs, cfg);
    runs.push(cs);
  }
  return { points, runs, safe };
}

/** 按手中单/对结构估计需要几次出牌，不随当前候选张数跳变。 */
function handTempo(hand) {
  return hand.length - handUnits(hand).filter((cs) => cs.length === 2).length;
}

/** 保守甩牌视图：每家只放公开信息仍允许它持有的牌，未知底牌不冒充已知。 */
function publicPlayView(state, viewerIdx, unseen, knowledge) {
  const ti = state.trumpInfo;
  return {
    config: state.config,
    trumpInfo: ti,
    currentTrick: state.currentTrick,
    players: state.players.map((p, seat) => {
      if (seat === viewerIdx) return { hand: p.hand };
      const seen = new Set();
      const ranges = knowledge && knowledge.seats[seat].domains;
      const hand = unseen.filter((c) => {
        if (!ranges) return true;
        const range = ranges.get(domainOf(c, ti));
        if (range.count.max === 0) return false;
        const key = `${c.suit}-${c.rank}`;
        if (range.pairs.max === 0 && seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { hand };
    })
  };
}

/** 模拟中的末墩牌力：单张与对子分开比较，副对必须有领出入口。 */
function controlValue(hand, ti) {
  let value = 0;
  for (const cs of handUnits(hand)) {
    const c = cs[0], trump = domainOf(c, ti) === 'TRUMP';
    const strength = strengthInDomain(c, ti);
    const v = trump ? Math.max(0, (strength - 910) / 30) + (cs.length === 2 ? 3 : 0)
      : cs.length === 2 ? 1.5 + strength / 14 : strength >= 14 ? 1 : 0;
    value = Math.max(value, v);
  }
  return value;
}

module.exports = { playKey, handUnits, cashPlan, handTempo, publicPlayView, controlValue };
