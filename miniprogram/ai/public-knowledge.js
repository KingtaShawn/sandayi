/** 闲家公开记牌：各门剩余分、各席位持牌/对子范围。未知底牌始终占一个独立牌仓。 */
'use strict';

const { buildDeck } = require('../engine/deck');
const { domainOf, parseCombo, strengthInDomain } = require('../engine/combo');
const { pointValue } = require('../engine/card');

const DOMAINS = ['TRUMP', 'S', 'H', 'C', 'D'];
const sum = (xs, fn) => xs.reduce((n, x) => n + fn(x), 0);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function project(cells, total) {
  for (let pass = 0; pass <= cells.length; pass++) {
    const delta = total - sum(cells, (b) => b.expected);
    if (Math.abs(delta) < 1e-8) break;
    const free = cells.filter((b) => delta > 0 ? b.expected < b.max - 1e-9 : b.expected > b.min + 1e-9);
    const weight = sum(free, (b) => Math.max(0.01, b.expected));
    if (!weight) break;
    free.forEach((b) => { b.expected = clamp(b.expected + delta * Math.max(0.01, b.expected) / weight, b.min, b.max); });
  }
}

function bottomPointBound(domains, row, size, descending) {
  let total = 0, used = 0;
  const extra = [];
  DOMAINS.forEach((d, j) => {
    const values = [];
    for (const e of domains.get(d).entries) for (let i = 0; i < e.n; i++) values.push(e.points);
    values.sort((a, b) => descending ? b - a : a - b);
    const b = row[j];
    total += values.slice(0, b.min).reduce((n, p) => n + p, 0);
    used += b.min;
    extra.push(...values.slice(b.min, b.max));
  });
  extra.sort((a, b) => descending ? b - a : a - b);
  return total + extra.slice(0, Math.max(0, size - used)).reduce((n, p) => n + p, 0);
}

function buildPublicKnowledge(state, viewerIdx, mem) {
  const cfg = state.config, ti = state.trumpInfo;
  const hand = state.players[viewerIdx].hand;
  const domains = new Map(DOMAINS.map((d) => [d, {
    entries: [], unseen: 0, unseenPoints: 0, remainingPoints: 0, remainingPointCards: 0
  }]));
  const keys = new Set();
  for (const c of buildDeck(cfg)) {
    const key = `${c.suit}-${c.rank}`;
    if (keys.has(key)) continue;
    keys.add(key);
    const n = mem.remainingOfKey(key), pts = pointValue(c, cfg);
    const dom = domains.get(domainOf(c, ti));
    dom.entries.push({ key, n, points: pts, strength: strengthInDomain(c, ti) });
    dom.unseen += n;
    dom.unseenPoints += n * pts;
    dom.remainingPoints += n * pts;
    if (pts > 0) dom.remainingPointCards += n;
  }
  for (const c of hand) {
    const dom = domains.get(domainOf(c, ti)), pts = pointValue(c, cfg);
    dom.remainingPoints += pts;
    if (pts > 0) dom.remainingPointCards++;
  }

  const voids = Array.from({ length: 4 }, () => new Set());
  const noPairs = Array.from({ length: 4 }, () => new Set());
  const tricks = (state.completedTricks || []).concat(state.currentTrick ? [state.currentTrick] : []);
  for (const t of tricks) {
    const lead = t.leadCombo;
    if (!lead || lead.type === 'eight') continue; // 八张同点甩有独立跟牌规则
    for (const p of t.plays) {
      if (p.playerIdx === t.leadPlayerIdx) continue;
      const followed = p.cards.filter((c) => domainOf(c, ti) === lead.suit);
      // 半跟说明该家当时已经出尽该门，此后不会再摸牌。
      if (followed.length < lead.n) voids[p.playerIdx].add(lead.suit);
      if (cfg.mustFollowPairAsPair && lead.type === 'pair') {
        const combo = parseCombo(p.cards, ti, cfg);
        if (followed.length < 2 || !combo || combo.type !== 'pair') noPairs[p.playerIdx].add(lead.suit);
      }
    }
  }

  const current = state.currentTrick ? state.currentTrick.plays : [];
  const playedNow = (seat) => sum(current.filter((p) => p.playerIdx === seat), (p) => p.cards.length);
  const beforeTrick = hand.length + playedNow(viewerIdx);
  const seats = Array.from({ length: 4 }, (_, seat) => ({
    handCount: Math.max(0, beforeTrick - playedNow(seat)), domains: new Map()
  }));
  const groups = [];
  for (let seat = 0; seat < 4; seat++) {
    if (seat !== viewerIdx) groups.push({ seat, size: seats[seat].handCount });
  }
  groups.push({ seat: 4, size: cfg.bottomCards }); // 不读取 state.bottomCards
  const balanced = sum(groups, (g) => g.size) === mem.remainingCount;
  const bounds = groups.map((g) => DOMAINS.map((d) => {
    const dom = domains.get(d);
    let max = Math.min(g.size, dom.unseen);
    if (g.seat < 4 && voids[g.seat].has(d)) max = 0;
    if (g.seat < 4 && noPairs[g.seat].has(d)) {
      max = Math.min(max, dom.entries.filter((e) => e.n > 0).length);
    }
    return { min: 0, max };
  }));
  // 行和=每家剩余张数，列和=全副未见张数。反复收紧，底牌容量也必须参与。
  let consistent = balanced;
  if (balanced) {
    for (let pass = 0; pass < 32; pass++) {
      let changed = false;
      const tighten = (cells, total) => {
        const lo = sum(cells, (b) => b.min), hi = sum(cells, (b) => b.max);
        for (const b of cells) {
          const min = Math.max(b.min, total - hi + b.max);
          const max = Math.min(b.max, total - lo + b.min);
          if (min > max) { consistent = false; return; }
          if (min !== b.min || max !== b.max) changed = true;
          b.min = min; b.max = max;
        }
      };
      bounds.forEach((row, i) => tighten(row, groups[i].size));
      DOMAINS.forEach((d, j) => tighten(bounds.map((row) => row[j]), domains.get(d).unseen));
      if (!consistent || !changed) break;
    }
  }
  const dealerIdx = state.sanDaYiTeams ? state.sanDaYiTeams.dealer : state.dealerIdx;
  // 软估计也须遵守每家容量和全副牌守恒；不把独立持主份额当成联合概率。
  groups.forEach((g, i) => DOMAINS.forEach((d, j) => {
    const share = d === 'TRUMP' && g.seat === dealerIdx
      ? Math.min(0.8, 0.57 + Math.max(0, (state.contractScore || 90) - 90) * 0.02)
      : g.size / Math.max(1, mem.remainingCount) * (g.seat === 4 && d === 'TRUMP' ? 0.2 : 1);
    const b = bounds[i][j];
    b.expected = clamp(domains.get(d).unseen * share, b.min, b.max);
  }));
  if (consistent) {
    // 残局多家缺门、底牌接近强制分配时收敛较慢，仍须满足各家容量；收敛即停。
    for (let pass = 0; pass < 4096; pass++) {
      bounds.forEach((row, i) => project(row, groups[i].size));
      DOMAINS.forEach((d, j) => project(bounds.map((row) => row[j]), domains.get(d).unseen));
      if (bounds.every((row, i) => Math.abs(sum(row, (b) => b.expected) - groups[i].size) < 1e-7)) break;
    }
  }
  groups.forEach((g, i) => {
    if (g.seat === 4) return;
    DOMAINS.forEach((d, j) => {
      const dom = domains.get(d);
      const b = consistent ? bounds[i][j] : {
        min: 0, max: voids[g.seat].has(d) ? 0 : Math.min(g.size, dom.unseen)
      };
      const possiblePairs = sum(dom.entries, (e) => Math.floor(e.n / 2));
      const pairMax = noPairs[g.seat].has(d) ? 0 : Math.min(possiblePairs, Math.floor(b.max / 2));
      const keyCount = dom.entries.filter((e) => e.n > 0).length;
      const pairMin = pairMax === 0 ? 0 : Math.max(0,
        Math.ceil((b.min - keyCount) / Math.max(1, cfg.deckCount - 1)));
      // 仅为估计：庄家选主的持主富集先验；所有判断「不能毙」都只用严格上界。
      const expected = consistent ? bounds[i][j].expected
        : clamp(dom.unseen * g.size / Math.max(1, mem.remainingCount), b.min, b.max);
      const pairExpected = possiblePairs * expected * Math.max(0, expected - 1)
        / Math.max(1, dom.unseen * (dom.unseen - 1));
      seats[g.seat].domains.set(d, {
        count: { min: b.min, max: b.max, expected },
        pairs: { min: pairMin, max: pairMax, expected: clamp(pairExpected, pairMin, pairMax) }
      });
    });
  });
  for (const d of DOMAINS) {
    const mine = hand.filter((c) => domainOf(c, ti) === d), byKey = new Map();
    mine.forEach((c) => { const k = `${c.suit}-${c.rank}`; byKey.set(k, (byKey.get(k) || 0) + 1); });
    const pairs = sum([...byKey.values()], (n) => Math.floor(n / 2));
    seats[viewerIdx].domains.set(d, {
      count: { min: mine.length, max: mine.length, expected: mine.length },
      pairs: { min: pairs, max: pairs, expected: pairs }
    });
  }
  const bottomRow = bounds[bounds.length - 1];
  const pointMin = bottomPointBound(domains, bottomRow, cfg.bottomCards, false);
  const pointMax = bottomPointBound(domains, bottomRow, cfg.bottomCards, true);
  const bottom = { size: cfg.bottomCards,
    domains: new Map(DOMAINS.map((d, j) => [d, { ...bottomRow[j] }])),
    points: { min: pointMin, max: pointMax, expected: clamp(35 * cfg.deckCount / 2, pointMin, pointMax) } };
  return { domains, seats, voids, noPairs, consistent, dealerIdx, viewerIdx, bottom };
}

module.exports = { buildPublicKnowledge };
