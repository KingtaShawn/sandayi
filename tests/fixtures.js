/**
 * tests/fixtures.js —— 测试牌局夹具：构造特定手牌 / 特定局面的辅助（纯逻辑，Node 直跑）。
 */

'use strict';

const { DEFAULT_CONFIG } = require('../miniprogram/engine/config');
const { createCard } = require('../miniprogram/engine/card');
const { buildTrumpInfo } = require('../miniprogram/engine/trump');
const { createRng } = require('../miniprogram/utils/random');

/**
 * 便捷造牌（deckIndex 固定 0，重复取第二张用 idx=1）。
 * @param {string} suit 'S'|'H'|'C'|'D'|'JOKER'
 * @param {string} rank
 * @param {number} [deckIndex=0]
 */
function C(suit, rank, deckIndex) {
  return createCard(deckIndex === undefined ? 0 : deckIndex, suit, rank);
}

/**
 * 批量造牌：'S10' → C('S','10')；'BJ' → C('JOKER','BJ')。
 * @param {string[]} specs
 * @returns {Array<object>}
 */
function cards(...specs) {
  return specs.map((sp) => {
    if (sp === 'BJ') return C('JOKER', 'BJ');
    if (sp === 'RJ') return C('JOKER', 'RJ');
    const suit = sp[0];
    const rank = sp.slice(1);
    return C(suit, rank);
  });
}

/** 双张批量：cardsD('H5') → 两张 H5（不同副） */
function cardsD(...specs) {
  const out = [];
  specs.forEach((sp) => {
    if (sp === 'BJ' || sp === 'RJ') {
      out.push(C('JOKER', sp, 0));
      out.push(C('JOKER', sp, 1));
      return;
    }
    const suit = sp[0];
    const rank = sp.slice(1);
    out.push(C(suit, rank, 0));
    out.push(C(suit, rank, 1));
  });
  return out;
}

/**
 * 构建主牌信息（默认打 2、♥主）。
 * @param {object} [opts] {level, suit, noTrump}
 */
function trump(opts) {
  const o = opts || {};
  return buildTrumpInfo(
    o.noTrump ? null : (o.suit || 'H'),
    o.level || '2',
    DEFAULT_CONFIG
  );
}

/**
 * 构造测试用最小 GameState（PLAYING 中途局面）。
 * @param {object} [opts] {level, suit, noTrump, hands, dealerIdx}
 * @returns {object} GameState
 */
/**
 * 构造测试用最小 GameState（PLAYING 中途局面，手工构建，不依赖 core/state）。
 * @param {object} [opts] {level, suit, noTrump, hands, dealerIdx, attackTeam, currentTrick}
 * @returns {object} GameState 形状对象
 */
function makeState(opts) {
  const o = opts || {};
  const ti = buildTrumpInfo(
    o.noTrump ? null : (o.suit || 'H'),
    o.level || '2',
    DEFAULT_CONFIG
  );
  const hands = o.hands || [[], [], [], []];
  return {
    schemaVersion: 1,
    config: DEFAULT_CONFIG,
    roundNo: 1,
    phase: o.phase || 'PLAYING',
    players: hands.map((h, i) => ({
      seat: ['S', 'E', 'N', 'W'][i],
      team: i % 2 === 0 ? 0 : 1, // S,N=0 我方；E,W=1 敌方
      isHuman: i === 0,
      name: `P${i}`,
      hand: h.slice()
    })),
    turnIdx: o.turnIdx === undefined ? 0 : o.turnIdx,
    playOrder: [0, 1, 2, 3],
    deck: [],
    bottomCards: [],
    bottomRevealed: false,
    bids: o.bids || [],
    trumpInfo: ti,
    dealerIdx: o.dealerIdx === undefined ? 0 : o.dealerIdx,
    bidWinnerIdx: o.bidWinnerIdx === undefined ? (o.dealerIdx === undefined ? 0 : o.dealerIdx) : o.bidWinnerIdx,
    buryDone: true,
    currentTrick: o.currentTrick || null,
    completedTricks: [],
    scores: { team0: 0, team1: 0 },
    levels: { team0: o.level || '2', team1: o.level || '2' },
    attackTeam: o.attackTeam === undefined ? 1 : o.attackTeam,
    lastSettle: null,
    seed: 42
  };
}

module.exports = { C, cards, cardsD, trump, makeState, DEFAULT_CONFIG };
