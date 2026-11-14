/** 有公开持牌证据的副牌门：保留反压牌及承受庄家对子消耗所需的长度。 */
'use strict';
const { domainOf, strengthInDomain, pointsOf } = require('../engine/combo');

function buildSuitControl(state, playerIdx, ctx) {
  const roles = new Map(), k = ctx.knowledge;
  if (ctx.sdy.isDealer || !k || !k.consistent) return roles;
  const ti = state.trumpInfo, hand = state.players[playerIdx].hand;
  const tricks = (state.completedTricks || []).concat(state.currentTrick ? [state.currentTrick] : []);
  for (const suit of ['S', 'H', 'C', 'D']) {
    if (ctx.sdy.voids.dealer.has(suit)) continue;
    const range = k.seats[ctx.sdy.dealerIdx].domains.get(suit);
    const domain = k.domains.get(suit);
    if (!range.count.max || !domain.remainingPoints) continue;
    // 曾经出过不等于现在必有；作为保牌线索，确凿缺门与容量上界始终优先。
    const shown = tricks.some((t) => t.plays.some((p) => p.playerIdx === ctx.sdy.dealerIdx
      && p.cards.some((c) => domainOf(c, ti) === suit)));
    if (!shown && range.count.min === 0) continue;
    const mine = hand.filter((c) => domainOf(c, ti) === suit);
    if (!mine.length) continue;
    const top = Math.max(...mine.map((c) => strengthInDomain(c, ti)));
    const higher = domain.entries.reduce((n, e) => n + (e.strength > top ? e.n : 0), 0);
    if (top < 12 || higher > 2) continue;
    roles.set(suit, { target: range.pairs.max > 0 ? 5 : 3, top });
  }
  return roles;
}

function suitControlCost(cards, hand, ti, ctx) {
  if (!ctx || !ctx.suitControl || !ctx.suitControl.size || ctx.suitDefense) return 0;
  // 已锁进我方的分先入袋，不为了虚构的后续机会拒绝跑分。
  if (ctx.suitControlSafeFeed && pointsOf(cards, { pointValues: ctx.pointValues }) > 0) return 0;
  let cost = 0;
  for (const [suit, role] of ctx.suitControl) {
    const mine = hand.filter((c) => domainOf(c, ti) === suit);
    const spent = cards.filter((c) => domainOf(c, ti) === suit);
    for (let n = mine.length; n > mine.length - spent.length; n--) {
      cost += n > role.target ? 2 : n >= 3 ? 16 : 20;
    }
    if (spent.some((c) => strengthInDomain(c, ti) === role.top)) cost += 8;
  }
  return cost;
}

module.exports = { buildSuitControl, suitControlCost };
