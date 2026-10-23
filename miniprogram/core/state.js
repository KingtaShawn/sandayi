/**
 * core/state.js —— GameState 创建 / clone / 序列化与反序列化（断线续玩 F-09）。
 *
 * GameState 全量可序列化：JSON.stringify 后可完整恢复。
 * 序列化特殊处理（§8.8）：
 *   - trumpInfo：trumpIds(Set) → 数组；order 含 Card 引用 → 存三元组重建；
 *   - logger 不入 state（服务层独立）。
 */

'use strict';

const { DEFAULT_CONFIG, createConfig } = require('../engine/config');
const { buildDeck, shuffle, dealInitial } = require('../engine/deck');
const { buildTrumpInfo } = require('../engine/trump');
const { createRng } = require('../utils/random');
const { RuleError } = require('../engine/errors');

/** 当前结构版本 */
const SCHEMA_VERSION = 1;

/** 默认玩家表（§8.2：0=S 南真人，1=E 东，2=N 北，3=W 西）
 *  team 仅升级模式（2v2）有意义；三打一阵营由 sanDaYiTeams 动态决定（庄 vs 三家） */
const DEFAULT_PLAYERS = [
  { seat: 'S', team: 0, isHuman: true, name: '你' },
  { seat: 'E', team: 1, isHuman: false, name: '三毛玉' },
  { seat: 'N', team: 0, isHuman: false, name: '年狗子' },
  { seat: 'W', team: 1, isHuman: false, name: '鹅燕军' }
];

/**
 * 创建初始状态。
 * @param {object} [config] RuleConfig（缺省 DEFAULT_CONFIG）
 * @param {Array<object>} [players] 4 人（缺省默认表）
 * @param {object} [rng] 随机源（缺省自建）
 * @param {object} [opts] {seed, dealerIdx, levels}
 * @returns {object} GameState
 */
function createInitialState(config, players, rng, opts) {
  const cfg = config || DEFAULT_CONFIG;
  const o = opts || {};
  const rand = rng || createRng(o.seed);
  const state = {
    schemaVersion: SCHEMA_VERSION,
    config: cfg,
    roundNo: 1,
    phase: 'INIT_DEAL',
    players: (players || DEFAULT_PLAYERS).map((p) => ({
      seat: p.seat,
      team: p.team,
      isHuman: p.isHuman,
      name: p.name,
      hand: []
    })),
    turnIdx: o.dealerIdx !== undefined ? o.dealerIdx : 0,
    playOrder: cfg.playDirection === 'clockwise' ? [0, 3, 2, 1] : [0, 1, 2, 3],
    deck: [],
    bottomCards: [],
    bottomRevealed: false,
    bids: [],
    trumpInfo: null,
    dealerIdx: o.dealerIdx !== undefined ? o.dealerIdx : 0,
    bidWinnerIdx: null,
    passedBidders: [],
    bottomMerged: false,
    buryDone: false,
    currentTrick: null,
    completedTricks: [],
    scores: { team0: 0, team1: 0 },
    levels: o.levels || { team0: cfg.rankStart, team1: cfg.rankStart },
    attackTeam: 1,
    lastSettle: null,
    lastDealerIdx: o.dealerIdx !== undefined ? o.dealerIdx : 0,
    seed: rand.seed,
    gameOver: false,
    roundHistory: []
  };
  return state;
}

/**
 * 洗牌并把整副牌放入 deck（发牌动作由 statemachine DEAL 执行）。
 * @param {object} state
 * @param {object} [rng]
 */
function prepareDeck(state, rng) {
  const rand = rng || createRng();
  const base = buildDeck(state.config);
  state.deck = shuffle(base, rand);
  state.seed = rand.seed;
}

/**
 * 执行发牌切分（DEAL action 内部使用）。
 * @param {object} state
 */
function dealHands(state) {
  const { hands, bottom } = dealInitial(state.deck, state.config);
  state.players.forEach((p, i) => {
    p.hand = hands[i];
  });
  state.bottomCards = bottom;
  state.deck = [];
}

/**
 * 浅 clone state（结构共享：reducer 返回新引用，深层字段按需替换）。
 * @param {object} state
 * @returns {object}
 */
function cloneState(state) {
  return Object.assign({}, state, {
    players: state.players.map((p) => Object.assign({}, p, { hand: p.hand.slice() })),
    playOrder: state.playOrder.slice(),
    deck: state.deck.slice(),
    bottomCards: state.bottomCards.slice(),
    bids: state.bids.map((b) => Object.assign({}, b, { cards: b.cards.slice() })),
    passedBidders: (state.passedBidders || []).slice(),
    completedTricks: state.completedTricks.map((t) => cloneTrick(t)),
    currentTrick: state.currentTrick ? cloneTrick(state.currentTrick) : null,
    scores: Object.assign({}, state.scores),
    levels: Object.assign({}, state.levels),
    lastSettle: state.lastSettle ? Object.assign({}, state.lastSettle) : null,
    roundHistory: state.roundHistory.slice(),
    config: state.config
  });
}

/** clone 一墩 */
function cloneTrick(trick) {
  return Object.assign({}, trick, {
    plays: trick.plays.map((p) => Object.assign({}, p, {
      cards: p.cards.slice(),
      combo: p.combo ? Object.assign({}, p.combo) : null
    })),
    leadCombo: Object.assign({}, trick.leadCombo)
  });
}

/**
 * 序列化（JSON 安全）。
 * @param {object} state
 * @returns {object} 可 JSON.stringify 的普通对象
 */
function serializeState(state) {
  const plain = cloneState(state);
  // trumpInfo：Set → 数组；order 重建材料 = (levelRank, trumpSuit, isNoTrump)
  plain.trumpInfo = state.trumpInfo ? {
    levelRank: state.trumpInfo.levelRank,
    trumpSuit: state.trumpInfo.trumpSuit,
    isNoTrump: state.trumpInfo.isNoTrump
  } : null;
  return plain;
}

/**
 * 反序列化（版本兼容检查 E301）。
 * @param {object|string} json
 * @returns {object} GameState（trumpInfo.trumpIds/order 重建）
 * @throws {RuleError} E301 版本过新 / E302 数据损坏
 */
function deserializeState(json) {
  let obj = json;
  if (typeof json === 'string') {
    try {
      obj = JSON.parse(json);
    } catch (e) {
      throw new RuleError('E302', '存档 JSON 解析失败');
    }
  }
  if (!obj || typeof obj !== 'object' || !obj.phase) {
    throw new RuleError('E302', '存档缺少 phase 字段');
  }
  if (obj.schemaVersion > SCHEMA_VERSION) {
    throw new RuleError('E301', `存档版本 ${obj.schemaVersion} 高于当前 ${SCHEMA_VERSION}`);
  }
  const state = Object.assign({}, obj);
  // 重建 trumpInfo
  if (state.trumpInfo && state.trumpInfo.levelRank) {
    const ti = state.trumpInfo;
    state.trumpInfo = buildTrumpInfo(ti.trumpSuit, ti.levelRank, state.config || DEFAULT_CONFIG);
  } else {
    state.trumpInfo = null;
  }
  return state;
}

/**
 * 校验 state 完整可恢复（QA 工具）。
 * @param {object} state
 * @returns {boolean}
 */
function roundTripOk(state) {
  const restored = deserializeState(serializeState(state));
  return restored.phase === state.phase
    && restored.players.length === state.players.length
    && restored.players.every((p, i) => p.hand.length === state.players[i].hand.length)
    && (!state.trumpInfo || (
      restored.trumpInfo.levelRank === state.trumpInfo.levelRank
      && restored.trumpInfo.trumpSuit === state.trumpInfo.trumpSuit
      && restored.trumpInfo.isNoTrump === state.trumpInfo.isNoTrump
    ));
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_PLAYERS,
  createInitialState,
  prepareDeck,
  dealHands,
  cloneState,
  serializeState,
  deserializeState,
  roundTripOk
};
