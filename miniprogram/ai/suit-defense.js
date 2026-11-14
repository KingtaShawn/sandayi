/** 三家公开无主后交换守门意向；清主和副牌展开期间均保留守门长度。 */
'use strict';
const { domainOf, strengthInDomain } = require('../engine/combo');

function anchorOf(state, attackers) {
  const voids = new Set();
  let anchor = -1;
  (state.completedTricks || []).forEach((t, i) => {
    const lead = t.leadCombo;
    if (!lead || lead.type === 'eight') return;
    if (lead.isTrump) for (const p of t.plays) {
      if (p.playerIdx !== t.leadPlayerIdx && attackers.includes(p.playerIdx)
          && p.cards.filter((c) => domainOf(c, state.trumpInfo) === 'TRUMP').length < lead.n) voids.add(p.playerIdx);
    }
    if (anchor < 0 && attackers.every((s) => voids.has(s))) anchor = i + 1;
    // 副牌已实际展开过时重新协商；连续清主期间恢复同一个起点，避免逐张换门。
    if (anchor >= 0 && !lead.isTrump) anchor = i + 1;
  });
  return anchor;
}

function buildSuitDefense(state, playerIdx, ctx) {
  const trick = state.currentTrick, ti = state.trumpInfo;
  if (!trick || state.players[playerIdx].hand.length < 4) return null;
  const attackers = state.playOrder.filter((s) => s !== ctx.sdy.dealerIdx);
  // 庄家最后一张主已经亮在桌上时，未见主=0，仍须保住接下来抵抗副牌的长度。
  if (!attackers.every((s) => ctx.knowledge.seats[s].domains.get('TRUMP').count.max === 0)) return null;
  const anchor = anchorOf(state, attackers);
  if (anchor < 0) return null;
  const offers = attackers.map((seat) => {
    const hand = state.players[seat].hand;
    const original = hand.slice();
    for (const t of state.completedTricks.slice(anchor).concat([trick])) {
      for (const p of t.plays) if (p.playerIdx === seat) original.push(...p.cards);
    }
    // 各家用自己的牌产生粗略守门意向。外部只拿到最终角色，不获得张数、大牌或对子。
    return ['S', 'H', 'C', 'D'].map((suit) => {
      if (ctx.knowledge.seats[ctx.sdy.dealerIdx].domains.get(suit).count.max === 0) return null;
      const cards = original.filter((c) => domainOf(c, ti) === suit);
      if (!cards.length || !hand.some((c) => domainOf(c, ti) === suit)) return null;
      const length = cards.length >= 7 ? 4 : cards.length >= 5 ? 3 : cards.length >= 3 ? 2 : cards.length >= 2 ? 1 : 0;
      const top = Math.max(...cards.map((c) => strengthInDomain(c, ti)));
      const control = top >= 13 ? 2 : top >= 11 ? 1 : 0;
      const groups = new Map();
      cards.forEach((c) => groups.set(c.rank, (groups.get(c.rank) || 0) + 1));
      const pairs = [...groups.values()].reduce((n, count) => n + Math.floor(count / 2), 0);
      return { suit, score: length * 4 + control * 2 + Math.min(2, pairs) * 3, long: cards.length >= 3 };
    }).filter(Boolean);
  });
  // 某家已无可守的活门时不拖垮另外两家的分工。
  offers.forEach((list) => { if (!list.length) list.push({ suit: null, score: 0, long: false }); });
  let best = null, bestScore = -Infinity;
  const choose = (i, selected, score) => {
    if (i === attackers.length) {
      const coverage = new Set(selected.filter((o) => o.long).map((o) => o.suit)).size;
      const value = score + coverage * 100;
      if (value > bestScore) { bestScore = value; best = selected.slice(); }
      return;
    }
    for (const offer of offers[i]) { selected.push(offer); choose(i + 1, selected, score + offer.score); selected.pop(); }
  };
  choose(0, [], 0);
  const roles = new Map(attackers.map((seat, i) => [seat, best[i].suit]));
  const suit = roles.get(playerIdx);
  if (state.players[playerIdx].hand.filter((c) => domainOf(c, ti) === suit).length < 2) return null;
  return { suit, roles };
}

/** 小牌也有缓冲价值：先保住3～4张主守门，长度充裕时仍可正常垫其小牌。 */
function suitDiscardCost(cards, hand, ti, suit) {
  const before = hand.filter((c) => domainOf(c, ti) === suit).length;
  const spent = cards.filter((c) => domainOf(c, ti) === suit).length;
  let cost = 0;
  for (let n = before; n > before - spent; n--) cost += n >= 6 ? 6 : n === 5 ? 12 : n === 4 ? 22 : n === 3 ? 32 : 28;
  return cost;
}

module.exports = { buildSuitDefense, suitDiscardCost };
