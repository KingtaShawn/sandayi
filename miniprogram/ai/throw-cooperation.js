/** 庄家公开绝门后，短门闲家清理拦牌，为长门队友准备甩牌。只用本家牌和公开范围。 */
'use strict';

const { domainOf, strengthInDomain } = require('../engine/combo');

function buildThrowCooperation(state, playerIdx, ctx) {
  const roles = new Map(), k = ctx.knowledge;
  if (ctx.sdy.isDealer || !k || !k.consistent) return roles;
  const hand = state.players[playerIdx].hand, ti = state.trumpInfo;
  for (const suit of ['S', 'H', 'C', 'D']) {
    if (!ctx.sdy.voids.dealer.has(suit)) continue;
    const mine = hand.filter((c) => domainOf(c, ti) === suit);
    // 只有公开估计显示队友比自己更长时才让路；不把可能持牌上界当成真实长度。
    if (!mine.length || hand.length <= 4
        || !mine.some((c) => strengthInDomain(c, ti) >= 11)) continue;
    const mates = [0, 1, 2, 3].filter((s) => s !== playerIdx && s !== ctx.sdy.dealerIdx)
      .map((seat) => ({ seat, range: k.seats[seat].domains.get(suit) }))
      .filter(({ range }) => range.count.expected >= Math.max(3, mine.length + 1))
      .sort((a, b) => (b.range.count.expected + 2 * b.range.pairs.expected)
        - (a.range.count.expected + 2 * a.range.pairs.expected) || a.seat - b.seat);
    if (mates.length) roles.set(suit, mates[0].seat);
  }
  return roles;
}

function clearanceValue(cards, hand, ti, roles) {
  if (!roles || !roles.size) return 0;
  const played = new Set(cards.map((c) => c.id));
  let value = 0;
  for (const c of cards) {
    if (!roles.has(domainOf(c, ti))) continue;
    const strength = strengthInDomain(c, ti);
    if (strength < 11) continue;
    value += (strength - 10) * 2;
    // 拆开大对仍留下拦牌；整对清掉才真正腾出同门对子甩牌的空间。
    if (hand.some((h) => h.suit === c.suit && h.rank === c.rank && !played.has(h.id))) value -= 10;
  }
  return Math.max(0, Math.min(16, value));
}

module.exports = { buildThrowCooperation, clearanceValue };
