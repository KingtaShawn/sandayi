/**
 * engine/validate.js —— 出牌校验总入口 + 合法出牌集合枚举。
 *
 * validatePlay：AI 与真人共用的唯一合法性真值（AI 铁律二次校验点）。
 * legalMoves：当前玩家全部（代表性）合法出牌组合；每个候选均经 validatePlay
 *             过滤后返回，保证集合内 100% 合法（reject 模式下甩牌不合法组合不出现）。
 */

'use strict';

const { parseCombo, domainOf, decomposeDomain, isPair, pointsOf } = require('./combo');
const { cardKey } = require('./card');
const { validateThrow } = require('./throw');
const { validateFollow } = require('./follow');
const { result } = require('./errors');

/**
 * 牌是否全在手。
 */
function allInHand(hand, cards_) {
  const ids = new Set(hand.map((c) => c.id));
  return cards_.every((c) => ids.has(c.id));
}

/**
 * 领出校验（含甩牌成立性）。
 * @param {object} state
 * @param {number} playerIdx
 * @param {Array<object>} cards
 * @param {object} cfg
 */
function validateLead(state, playerIdx, cards_, cfg) {
  const combo = parseCombo(cards_, state.trumpInfo, cfg);
  if (!combo) {
    return result(false, '出牌必须同域（一门副牌或全主牌）', 'E112');
  }
  if (combo.type === 'throw') {
    const t = validateThrow(state, combo, playerIdx, cfg);
    if (!t.ok) return t;
  }
  return result(true, null, null, { combo });
}

/**
 * 出牌校验总入口。
 * @param {object} state GameState
 * @param {number} playerIdx
 * @param {Array<object>} cards
 * @returns {{ok: boolean, reason?: string, errorCode?: string, meta?: object}}
 */
function validatePlay(state, playerIdx, cards_) {
  const cfg = state.config;
  if (!cards_ || cards_.length === 0) {
    return result(false, '请选择要出的牌', 'E101');
  }
  const hand = state.players[playerIdx].hand;
  if (!allInHand(hand, cards_)) {
    return result(false, '所出牌不在手牌中', 'E105');
  }
  const isLead = !state.currentTrick || state.currentTrick.plays.length === 0;
  if (isLead) {
    return validateLead(state, playerIdx, cards_, cfg);
  }
  const lead = state.currentTrick.leadCombo;
  if (cards_.length !== lead.n) {
    return result(false, `本墩须出 ${lead.n} 张牌`, 'E106');
  }
  return validateFollow(state, playerIdx, cards_, cfg);
}

/**
 * 埋底校验。
 * @param {object} state
 * @param {number} playerIdx
 * @param {Array<object>} cards
 */
function validateBury(state, playerIdx, cards_) {
  const cfg = state.config;
  if (state.phase !== 'BURYING') {
    return result(false, '当前不在埋底阶段', 'E202');
  }
  if (playerIdx !== state.dealerIdx) {
    return result(false, '只有庄家可以埋底', 'E108');
  }
  if (!cards_ || cards_.length !== cfg.bottomCards) {
    return result(false, `埋底张数须为 ${cfg.bottomCards} 张`, 'E107');
  }
  if (!allInHand(state.players[playerIdx].hand, cards_)) {
    return result(false, '埋底牌不在手牌中', 'E105');
  }
  return result(true);
}

/* ===================== 合法集合枚举（AI / 提示 F-10 共用） ===================== */

/** 组合去重键：排序后的 cardKey 序列 */
function playKey(cards_) {
  return cards_.map((c) => cardKey(c)).sort().join('|');
}

/**
 * 手牌按域分组。
 */
function groupByDomain(hand, trumpInfo) {
  const groups = new Map();
  hand.forEach((c) => {
    const d = domainOf(c, trumpInfo);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(c);
  });
  return groups;
}

/**
 * 域内全部对（cardKey → 两张牌）。
 */
function pairsOf(domainCards_, trumpInfo) {
  const byKey = new Map();
  domainCards_.forEach((c) => {
    const k = cardKey(c);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  });
  const pairs = [];
  byKey.forEach((list) => {
    for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  });
  return pairs;
}

/**
 * 域内全部相邻对链（窗口长度 ≥2 的所有连续拖拉机）。
 * @returns {Array<Array<object>>} 每项为 2k 张牌的拖拉机
 */
function tractorWindowsOf(domainCards_, trumpInfo, cfg) {
  const { pairAdjacent } = require('./combo');
  const units = pairsOf(domainCards_, trumpInfo)
    .map((p) => ({ cards: p, head: p[0] }))
    .sort((a, b) => strengthSortKey(a.head, trumpInfo) - strengthSortKey(b.head, trumpInfo));
  const windows = [];
  let chain = [];
  const flush = () => {
    for (let len = 2; len <= chain.length; len++) {
      for (let s = 0; s + len <= chain.length; s++) {
        windows.push(chain.slice(s, s + len).reduce((acc, u) => acc.concat(u.cards), []));
      }
    }
    chain = [];
  };
  units.forEach((u, i) => {
    if (i === 0 || pairAdjacent({ cards: units[i - 1].cards }, { cards: u.cards }, trumpInfo, cfg)) {
      chain.push(u);
    } else {
      flush();
      chain = [u];
    }
  });
  flush();
  return windows;
}

/** 域内强度（复用 combo.strengthInDomain 语义）：升序排序 → 小牌在前 */
function strengthSortKey(card, trumpInfo) {
  const { strengthInDomain } = require('./combo');
  return strengthInDomain(card, trumpInfo);
}

/**
 * 领出候选枚举。
 */
function leadCandidates(state, playerIdx) {
  const cfg = state.config;
  const hand = state.players[playerIdx].hand;
  const ti = state.trumpInfo;
  const groups = groupByDomain(hand, ti);
  const out = [];
  const push = (cards_) => out.push(cards_);

  groups.forEach((domainCards_, domain) => {
    // 单张（同名去重，取一张代表）
    const seenKey = new Set();
    domainCards_.forEach((c) => {
      const k = cardKey(c);
      if (!seenKey.has(k)) {
        seenKey.add(k);
        push([c]);
      }
    });
    // 对子
    pairsOf(domainCards_, ti).forEach((p) => push(p));
    // 拖拉机（全部连续窗口）
    tractorWindowsOf(domainCards_, ti, cfg).forEach((t) => push(t));
    // 甩牌候选（有分/有结构的常见组合）：整域最大单元组合、对+单、最大两单
    const units = decomposeDomain(domainCards_, ti, cfg);
    if (units.length >= 2) {
      push(units.reduce((acc, u) => acc.concat(u.cards), [])); // 全单元甩
      const pairU = units.find((u) => u.type === 'pair');
      const singleU = units.filter((u) => u.type === 'single');
      if (pairU && singleU.length) push(pairU.cards.concat(singleU[0].cards)); // 对+最大单
      if (singleU.length >= 2) push(singleU[0].cards.concat(singleU[1].cards)); // 双单甩
    }
  });
  return out;
}

/**
 * 跟牌候选枚举。
 */
function followCandidates(state, playerIdx) {
  const cfg = state.config;
  const hand = state.players[playerIdx].hand;
  const ti = state.trumpInfo;
  const lead = state.currentTrick.leadCombo;
  const n = lead.n;
  const domain = lead.suit;
  const avail = hand.filter((c) => domainOf(c, ti) === domain);
  const out = [];
  const push = (cards_) => {
    if (cards_.length === n) out.push(cards_);
  };

  if (avail.length > 0) {
    // 该门不足 n 张：全部给出 + 最小垫牌补齐（PRD §5.9 防御条款）
    if (avail.length < n) {
      const rest = hand.filter((c) => domainOf(c, ti) !== domain)
        .sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
      const k = n - avail.length;
      push(avail.concat(rest.slice(0, k))); // 最小垫牌
      // 分牌垫：队友稳赢时喂分（是否值得由 scorer 权衡）
      push(avail.concat(rest.slice().sort(
        (a, b) => pointsOf([b], cfg) - pointsOf([a], cfg) || strengthSortKey(a, ti) - strengthSortKey(b, ti)
      ).slice(0, k)));
      return out;
    }
    if (n === 1) {
      const seen = new Set();
      avail.forEach((c) => {
        const k = cardKey(c);
        if (!seen.has(k)) { seen.add(k); push([c]); }
      });
      return out;
    }
    if (lead.type === 'pair') {
      const pairs = pairsOf(avail, ti);
      pairs.forEach((p) => push(p));
      // 无对（或 R11 关）时的单+单组合（限量：最小单与其他单组合）
      const singles = avail.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
      if (pairs.length === 0 || !cfg.mustFollowPairAsPair) {
        for (let i = 0; i < singles.length && i < 6; i++) {
          for (let j = i + 1; j < singles.length && j < 8; j++) {
            push([singles[i], singles[j]]);
          }
        }
      }
      return out;
    }
    if (lead.type === 'tractor') {
      const k = lead.units[0].cards.length / 2;
      // 全部 k 对连续窗口拖拉机
      tractorWindowsOf(avail, ti, cfg).forEach((t) => push(t));
      // 对子 + 最小单补齐（j 对 + 2(k-j) 单）
      const pairs = pairsOf(avail, ti)
        .sort((a, b) => strengthSortKey(a[0], ti) - strengthSortKey(b[0], ti));
      const singles = avail.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
      const usedKeys = new Set();
      for (let j = k; j >= 0; j--) {
        const chosen = [];
        usedKeys.clear();
        for (let x = 0; x < j && x < pairs.length; x++) {
          chosen.push(...pairs[x]);
          pairs[x].forEach((c) => usedKeys.add(cardKey(c)));
        }
        const fill = [];
        for (const s of singles) {
          if (fill.length >= (n - chosen.length)) break;
          const cnt = chosen.filter((c) => c.id === s.id).length;
          const sameKeyUsed = chosen.filter((c) => cardKey(c) === cardKey(s)).length;
          const availCnt = avail.filter((c) => cardKey(c) === cardKey(s)).length;
          if (sameKeyUsed < availCnt && cnt === 0) fill.push(s);
        }
        if (chosen.length + fill.length === n) push(chosen.concat(fill));
      }
      return out;
    }
    // 甩牌领出：结构自由 → 最小 n 张、保对去单组合、最大 n 张
    const sorted = avail.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
    push(sorted.slice(0, n)); // 最小垫
    push(sorted.slice(-n).reverse()); // 最大
    const units = decomposeDomain(avail, ti, cfg);
    const keep = [];
    const singlesLeft = [];
    units.forEach((u) => {
      if (u.type === 'single') singlesLeft.push(...u.cards);
    });
    let take = 0;
    for (const u of units) {
      if (u.type === 'single') continue;
      if (take + u.size > n) continue;
      take += u.size;
      keep.push(...u.cards);
    }
    for (const s of singlesLeft) {
      if (take >= n) break;
      take++;
      keep.push(s);
    }
    if (keep.length === n) push(keep);
    return out;
  }

  // 缺门：任意 n 张合法。代表集：主牌结构对应（将吃）、最小垫、分牌垫
  const trumps = hand.filter((c) => domainOf(c, ti) === 'TRUMP');
  if (n === 1) {
    const seen = new Set();
    hand.forEach((c) => {
      const k = cardKey(c);
      if (!seen.has(k)) { seen.add(k); push([c]); }
    });
    return out;
  }
  if (lead.type === 'pair') {
    pairsOf(trumps, ti).forEach((p) => push(p)); // 主对将吃
    pairsOf(hand, ti).forEach((p) => push(p)); // 副对垫
    const singles = hand.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
    for (let i = 0; i < singles.length && i < 6; i++) {
      for (let j = i + 1; j < singles.length && j < 8; j++) push([singles[i], singles[j]]);
    }
    // 分牌垫：队友稳赢时喂分（是否值得由 scorer 权衡）
    push(hand.slice().sort(
      (a, b) => pointsOf([b], cfg) - pointsOf([a], cfg) || strengthSortKey(a, ti) - strengthSortKey(b, ti)
    ).slice(0, n));
    return out;
  }
  if (lead.type === 'tractor') {
    tractorWindowsOf(trumps, ti, cfg).forEach((t) => push(t)); // 主拖将吃
    tractorWindowsOf(hand, ti, cfg).forEach((t) => push(t));
    const k = lead.units[0].cards.length / 2;
    const pairs = pairsOf(hand, ti)
      .sort((a, b) => strengthSortKey(a[0], ti) - strengthSortKey(b[0], ti));
    const singles = hand.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
    const chosen = [];
    for (let x = 0; x < k && x < pairs.length; x++) chosen.push(...pairs[x]);
    const usedIds = new Set(chosen.map((c) => c.id));
    for (const s of singles) {
      if (chosen.length >= n) break;
      if (!usedIds.has(s.id)) { chosen.push(s); usedIds.add(s.id); }
    }
    if (chosen.length === n) push(chosen);
    push(singles.slice(0, n));
    // 分牌垫：队友稳赢时喂分（是否值得由 scorer 权衡）
    push(hand.slice().sort(
      (a, b) => pointsOf([b], cfg) - pointsOf([a], cfg) || strengthSortKey(a, ti) - strengthSortKey(b, ti)
    ).slice(0, n));
    return out;
  }
  // 甩牌缺门：主牌全压组合 / 最小垫
  const tSorted = trumps.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
  const tUnits = decomposeDomain(trumps, ti, cfg);
  const trumpKeep = [];
  let tk = 0;
  for (const u of tUnits) {
    if (u.type === 'single') continue;
    if (tk + u.size > n) continue;
    tk += u.size;
    trumpKeep.push(...u.cards);
  }
  for (const s of tSorted) {
    if (tk >= n) break;
    if (!trumpKeep.find((c) => c.id === s.id)) { tk++; trumpKeep.push(s); }
  }
  if (trumpKeep.length === n) push(trumpKeep);
  const all = hand.slice().sort((a, b) => strengthSortKey(a, ti) - strengthSortKey(b, ti));
  push(all.slice(0, n));
  const pointFirst = hand.slice().sort((a, b) => pointsOf([b], cfg) - pointsOf([a], cfg));
  const pf = [];
  const pfIds = new Set();
  for (const c of pointFirst) {
    if (pf.length >= n) break;
    if (pointsOf([c], cfg) > 0 && !pfIds.has(c.id)) { pf.push(c); pfIds.add(c.id); }
  }
  for (const c of all) {
    if (pf.length >= n) break;
    if (!pfIds.has(c.id)) { pf.push(c); pfIds.add(c.id); }
  }
  if (pf.length === n) push(pf);
  return out;
}

/**
 * 枚举当前玩家全部合法出牌（去重后逐个经 validatePlay 过滤）。
 * @param {object} state
 * @param {number} playerIdx
 * @returns {Array<Array<object>>} 合法 Card[][]
 */
function legalMoves(state, playerIdx) {
  const isLead = !state.currentTrick || state.currentTrick.plays.length === 0;
  const raw = isLead ? leadCandidates(state, playerIdx) : followCandidates(state, playerIdx);
  const seen = new Set();
  const out = [];
  raw.forEach((cards_) => {
    const key = playKey(cards_);
    if (seen.has(key)) return;
    seen.add(key);
    const v = validatePlay(state, playerIdx, cards_);
    if (v.ok) out.push(cards_);
  });
  return out;
}

module.exports = {
  validatePlay,
  validateLead,
  validateBury,
  legalMoves,
  _internals: { leadCandidates, followCandidates, pairsOf, tractorWindowsOf, groupByDomain, playKey }
};
