/**
 * engine/trick.js —— 墩结算：争胜资格 / 逐家比较 / 赢墩 / 分牌收集。
 *
 * 争胜资格：
 *   1. 有效将吃的主牌 > 一切副牌；主牌之间按主牌序比；
 *      双将吃（两家皆有效毙甩牌）按领出结构对齐：对子槽比主对对头、
 *      单张槽逐张比强度（多余主对拆两张计），全同先出为大（R13）；
 *   2. 同为领出花色：按领出结构比较（拖头/对/甩逐单元）；
 *   3. 后压过者胜（逐家滚动比较，最终最大者赢墩）；
 *   4. 垫牌（缺门非主 / 主牌结构不对应 / 非领出花色）永远不争胜。
 */

'use strict';

const { parseCombo, canBeat, pointsOf, domainOf, strengthInDomain } = require('./combo');
const { pointValue, cardKey } = require('./card');
const { isEffectiveTrumpFollow } = require('./follow');

/**
 * 计算一次跟牌的争胜资格与比较组合。
 * @param {object} play PlayRecord（playerIdx/cards/combo/isDiscard/isEffectiveTrump）
 * @param {object} leadCombo
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {{contending: boolean, combo: object|null, kind: 'lead'|'trump'|'follow'|'discard'}}
 */
function playContendInfo(play, leadCombo, trumpInfo, cfg) {
  if (play.playerIdx === leadCombo.leadPlayerIdx) {
    return { contending: true, combo: play.combo, kind: 'lead' };
  }
  // 八张同点甩牌：跟牌唯有「更大的八张同点」争胜，其余（含主牌对子/将吃）一律垫牌
  if (leadCombo.type === 'eight') {
    const combo = parseCombo(play.cards, trumpInfo, cfg);
    if (combo && combo.type === 'eight' && combo.strength > leadCombo.strength) {
      return { contending: true, combo, kind: 'follow' };
    }
    return { contending: false, combo, kind: 'discard' };
  }
  const combo = parseCombo(play.cards, trumpInfo, cfg);
  if (!combo) return { contending: false, combo: null, kind: 'discard' };
  // 全主牌且领出非主 → 有效将吃判定重算（不信任序列化标志）
  const allTrump = play.cards.every((c) => domainOf(c, trumpInfo) === 'TRUMP');
  if (allTrump && !leadCombo.isTrump) {
    if (isEffectiveTrumpFollow(leadCombo, play.cards, trumpInfo, cfg)) {
      return { contending: true, combo, kind: 'trump' };
    }
    return { contending: false, combo: null, kind: 'discard' };
  }
  // 同为领出域副牌 → 正常争胜比较
  if (combo.suit === leadCombo.suit && !leadCombo.isTrump) {
    return { contending: true, combo, kind: 'follow' };
  }
  // 领出是主牌域：跟牌全主才争胜
  if (leadCombo.isTrump && allTrump) {
    return { contending: true, combo, kind: 'follow' };
  }
  return { contending: false, combo: null, kind: 'discard' };
}

/**
 * 判定 challenger 是否压过 incumbent。
 * @param {object} chInc playContendInfo(挑战者)
 * @param {object} incInc playContendInfo(当前最大者)
 * @param {object} leadCombo
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {boolean}
 */
function beats(chInc, incInc, leadCombo, trumpInfo, cfg) {
  // 八张同点甩：比八甩序（级牌八张最高，其余按点数），严格更大才压过
  if (leadCombo.type === 'eight') {
    return chInc.combo.strength > incInc.combo.strength;
  }
  // 副牌 vs 主牌（将吃）：主赢
  if (chInc.kind === 'trump' && incInc.kind !== 'trump') return true;
  if (chInc.kind !== 'trump' && incInc.kind === 'trump') return false;
  // 双将吃（甩牌领出、两家缺门皆有效毙）：按领出结构对齐比大小——领出的每个
  // 对子槽比双方主对对头（降序取前 L 个，L=领出对子数），余牌无论是否成对、
  // 逐张强度降序比单张槽（多余主对拆计两张）；首个分差定胜负，全同 → 先出为大（R13）。
  // 两家毙牌形状可不同（主对+主单 vs 全主单），canBeat 的形状对齐比不齐，须按槽位对齐。
  if (chInc.kind === 'trump' && incInc.kind === 'trump' && leadCombo.type === 'throw') {
    const L = leadCombo.units.filter((u) => u.type === 'pair').length;
    const profile = (combo) => {
      const byKey = new Map();
      combo.cards.forEach((c) => {
        const k = cardKey(c);
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(c);
      });
      const heads = [];
      const rest = [];
      byKey.forEach((cs) => {
        const s = strengthInDomain(cs[0], trumpInfo);
        while (cs.length >= 2) {
          heads.push(s);
          cs.splice(0, 2);
        }
        cs.forEach(() => rest.push(s));
      });
      heads.sort((a, b) => b - a);
      const slots = heads.slice(0, L);
      for (let i = L; i < heads.length; i++) {
        rest.push(heads[i], heads[i]); // 多余主对拆两张计
      }
      rest.sort((a, b) => b - a);
      return slots.concat(rest);
    };
    const ch = profile(chInc.combo);
    const inc = profile(incInc.combo);
    for (let i = 0; i < ch.length; i++) {
      if (ch[i] !== inc[i]) return ch[i] > inc[i];
    }
    return false; // 全同 → 先出为大
  }
  // 同类：组合比较（canBeat 语义=结构压过；tie 时返回 false → 先出为大）
  if (leadCombo.type === 'single' || leadCombo.type === 'pair' || leadCombo.type === 'tractor') {
    return canBeat(incInc.combo, chInc.combo);
  }
  // 甩牌：逐单元压过
  return canBeat(incInc.combo, chInc.combo);
}

/**
 * 墩结算。
 * @param {object} trick TrickData（plays 已含 4 家）
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {{winnerIdx: number, points: number, detail: Array}}
 */
function resolveTrick(trick, trumpInfo, cfg) {
  const leadCombo = trick.leadCombo;
  const infos = trick.plays.map((p) => playContendInfo(p, leadCombo, trumpInfo, cfg));
  let bestIdx = 0;
  for (let i = 1; i < trick.plays.length; i++) {
    const ch = infos[i];
    if (!ch.contending) continue;
    const inc = infos[bestIdx];
    if (beats(ch, inc, leadCombo, trumpInfo, cfg)) bestIdx = i;
  }
  const points = trick.plays.reduce(
    (s, p) => s + p.cards.reduce((x, c) => x + pointValue(c, cfg), 0), 0
  );
  trick.winnerIdx = trick.plays[bestIdx].playerIdx;
  trick.points = points;
  return {
    winnerIdx: trick.winnerIdx,
    points,
    detail: infos.map((info, i) => ({
      playerIdx: trick.plays[i].playerIdx,
      kind: info.kind,
      contending: info.contending
    }))
  };
}

/**
 * 最后一墩牌型（R10 按牌型加倍抠底用）。
 * @param {object} lastTrick
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {string} single|pair|tractor|throw（取赢家牌型；甩牌取最大单元）
 */
function lastTrickShape(lastTrick, trumpInfo, cfg) {
  const leadCombo = lastTrick.leadCombo;
  if (leadCombo.type !== 'throw') return leadCombo.type;
  // 甩牌取最大单元牌型
  const biggest = leadCombo.units.reduce((m, u) => (u.size > m.size ? u : m), leadCombo.units[0]);
  return biggest.type;
}

module.exports = { resolveTrick, playContendInfo, beats, lastTrickShape };
