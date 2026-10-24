/**
 * engine/settle.js —— 一局结算：攻方分汇总 / 抠底加倍(R9/R10) / 升级表(R18) / 过A(R15) / 庄传递(R16) / 终局(R24)。
 */

'use strict';

const { pointValue, rankValue } = require('./card');
const { rankSequence } = require('./config');
const { lastTrickShape } = require('./trick');

/**
 * 底牌分合计。
 * @param {Array<object>} bottomCards
 * @param {object} cfg
 * @returns {number}
 */
function bottomPoints(bottomCards, cfg) {
  return (bottomCards || []).reduce((s, c) => s + pointValue(c, cfg), 0);
}

/**
 * 抠底倍数（R9 统一 / R10 牌型）。
 * @param {object} lastTrick
 * @param {object} trumpInfo
 * @param {object} cfg
 * @returns {number}
 */
function bottomMultiplier(lastTrick, trumpInfo, cfg) {
  if (!cfg.bottomMultiplierByType) {
    return cfg.bottomMultiplier; // R9
  }
  const shape = lastTrickShape(lastTrick, trumpInfo, cfg); // R10
  const table = cfg.bottomMultiplierTable;
  return table[shape] || cfg.bottomMultiplier;
}

/**
 * 升级数计算（R18 standard 表，公式化）。
 * @param {number} s 攻方得分
 * @param {object} cfg
 * @returns {{winnerTeam: 'defense'|'attack', levels: number}}
 *   winnerTeam 以阵营角色表达（defense=庄家方胜, attack=攻方胜）
 */
function computeLevelGain(s, cfg) {
  const P = cfg.pointsPerLevel;
  const T = cfg.pointsToTake;
  if (s >= T) {
    // 攻方上台：1 + floor((S-T)/P)，200 分封顶按公式自然得 4
    return { winnerTeam: 'attack', levels: 1 + Math.floor((s - T) / P) };
  }
  if (s === 0) {
    return { winnerTeam: 'defense', levels: 2 + cfg.cleanSweepBonusLevels };
  }
  if (s < P) {
    return { winnerTeam: 'defense', levels: 2 }; // 小光 1~P-1 → 2 级
  }
  return { winnerTeam: 'defense', levels: 2 - Math.floor(s / P) }; // 40-79 → 1
}

/**
 * 级数推进（跳过序不存在，2→A 顺序；封顶 A）。
 * @param {string} rank 当前级
 * @param {number} levels 升级数
 * @param {object} cfg
 * @returns {string} 新级
 */
function advanceRank(rank, levels, cfg) {
  const seq = rankSequence(cfg);
  let i = seq.indexOf(rank);
  if (i < 0) i = 0;
  i = Math.min(i + levels, seq.length - 1);
  return seq[i];
}

/**
 * 过 A 判定（R15）。
 * @param {object} params {winnerTeamIsDealer, attackPoints, dealerRank, cfg}
 * @returns {{passedA: boolean, levelsGained: number}}
 *   未过A：按小光升 2 级但封顶停在 A
 */
function checkPassA(params) {
  const { winnerIsDealer, attackPoints, dealerRank, cfg } = params;
  const P = cfg.pointsPerLevel;
  if (dealerRank !== cfg.rankEnd) {
    return { passedA: false, levelsGained: null };
  }
  // 庄家方正在打 A
  if (!winnerIsDealer) {
    // 攻方上台 → 庄家方（打A者）下台，过A失败
    return { passedA: false, levelsGained: null };
  }
  const cond = cfg.passACondition;
  let passOk = false;
  if (cond === 'small_light') passOk = attackPoints < P;
  else if (cond === 'big_light') passOk = attackPoints === 0;
  else if (cond === 'win') passOk = true;
  if (passOk) return { passedA: true, levelsGained: null };
  // 未过A：庄家方按小光升 2 级但封顶 A（继续打A）
  return { passedA: false, levelsGained: 2, cappedAtA: true };
}

/**
 * 下局庄家（R16）。
 * @param {object} params {dealerTeam, attackTeam, dealerIdx, bidWinnerIdx, winnerTeam, players, dealerPassRule, lastDealerIdx}
 * @returns {number} nextDealerIdx
 */
function nextDealer(params) {
  const {
    dealerTeam, winnerTeam, dealerIdx, bidWinnerIdx, players,
    dealerPassRule, lastDealerIdx
  } = params;
  const attackWon = winnerTeam !== dealerTeam;
  if (dealerPassRule === 'bidder_always') {
    return bidWinnerIdx !== null && bidWinnerIdx !== undefined ? bidWinnerIdx : dealerIdx;
  }
  if (!attackWon) {
    if (dealerPassRule === 'rotate') {
      // 庄家方队友坐庄
      return (dealerIdx + 2) % 4;
    }
    return dealerIdx; // winner_stays
  }
  // 攻方上台：攻方成员当庄
  if (dealerPassRule === 'rotate') {
    return (dealerIdx + 2) % 4; // 对面（攻方成员，因 2v2 对面为队友关系相反）
  }
  // winner_stays：定主者当庄；翻底定主（无人亮主）→ 上局庄家的下家
  if (bidWinnerIdx !== null && bidWinnerIdx !== undefined) {
    return bidWinnerIdx;
  }
  const base = lastDealerIdx === undefined ? dealerIdx : lastDealerIdx;
  return nextSeatOfOpponentTeam(base, players);
}

/**
 * 上局庄家的下家中属于攻方的成员（对面即上局庄家的对家=上局庄家方；下家属攻方）。
 * 座位顺序 0S→1E→2N→3W 逆时针；下家 = (idx+1)%4。
 */
function nextSeatOfOpponentTeam(baseIdx, players) {
  return (baseIdx + 1) % 4;
}

/**
 * 三打一结算（R26）。
 * 庄家最终得分 = 庄家赢墩分 + （庄家赢末墩时）底牌分×1；
 * 庄家得分 ≥ 合同分（contractScore）→ 庄家胜；否则三家胜。
 * 甩牌失败罚分（每张 10 分给对方阵营）由状态机在出牌时记入 penaltyPoints。
 * @param {object} state
 * @returns {object} SettleResult（三打一形态）
 */
function settleRoundSanDaYi(state) {
  const cfg = state.config;
  const teams = state.sanDaYiTeams;
  const dealerIdx = teams ? teams.dealer : state.dealerIdx;
  const attackerSet = new Set(teams ? teams.attackers : [0, 1, 2, 3].filter((i) => i !== dealerIdx));

  // 场上分
  let dealerPointsOnTable = 0;
  let attackerPointsOnTable = 0;
  state.completedTricks.forEach((t) => {
    if (attackerSet.has(t.winnerIdx)) attackerPointsOnTable += t.points;
    else dealerPointsOnTable += t.points;
  });

  // 甩牌罚分（罚给对方阵营）
  const pen = state.penaltyPoints || { dealer: 0, attackers: 0 };
  dealerPointsOnTable += 0; // 罚分从对方扣还是加给己方？——采用"加给对方"模型：
  attackerPointsOnTable += pen.attackers; // 攻方被罚 → 分加给庄家；庄家被罚 → 分加给攻方
  dealerPointsOnTable += pen.dealer;

  // 底牌：末墩赢家收底 ×1（不翻倍）
  const lastTrick = state.completedTricks[state.completedTricks.length - 1];
  const bp = bottomPoints(state.bottomCards, cfg);
  const dealerTookBottom = !attackerSet.has(lastTrick.winnerIdx);
  const bottomGained = dealerTookBottom ? bp : 0;
  const attackerBottomGained = dealerTookBottom ? 0 : bp;

  const dealerPoints = dealerPointsOnTable + bottomGained;
  const attackerPoints = attackerPointsOnTable + attackerBottomGained;
  const contract = state.contractScore;
  const dealerWon = dealerPoints >= contract;

  // 下局首报者：上局赢家先报（庄家赢→庄家；三家赢→庄家下家）
  const nextFirstBidder = dealerWon ? dealerIdx : (dealerIdx + 1) % 4;
  // 下局庄家占位（三打一庄家由报分产生，doDeal 用 sanDaYiFirstBidder 定首报）
  const nextDealerIdx = nextFirstBidder;

  return {
    mode: 'san_da_yi',
    dealerIdx,
    contractScore: contract,
    dealerPoints,
    attackerPoints,
    bottomPoints: bp,
    bottomMultiplierUsed: 1,
    bottomGained,
    penaltyPoints: pen,
    winnerTeam: dealerWon ? 'dealer' : 'attackers',
    levelsGained: 0,
    passedA: false,
    nextDealerIdx,
    nextFirstBidder,
    nextLevels: { team0: state.levels.team0, team1: state.levels.team1 },
    gameOver: false, // 三打一无过A概念，连续对局；胜负统计记入战绩
    attackPoints: attackerPoints // 兼容字段（历史/统计展示攻方分）
  };
}

/**
 * 一局结算总入口。
 * @param {object} state GameState（completedTricks 已全部完成、bottomCards、attackTeam、players…）
 * @returns {object} SettleResult
 */
function settleRound(state) {
  if (state.config.gameMode === 'san_da_yi') {
    return settleRoundSanDaYi(state);
  }
  const cfg = state.config;
  const attackTeam = state.attackTeam;
  const dealerTeam = state.players[state.dealerIdx].team;
  const defenseTeam = dealerTeam;

  // 场上分（按赢墩阵营累计；scores 由状态机维护，这里重算校验用 completedTricks）
  const attackPointsOnTable = state.completedTricks
    .filter((t) => state.players[t.winnerIdx].team === attackTeam)
    .reduce((s, t) => s + t.points, 0);

  // 抠底：最后一墩赢家
  const lastTrick = state.completedTricks[state.completedTricks.length - 1];
  const lastWinnerTeam = state.players[lastTrick.winnerIdx].team;
  const bp = bottomPoints(state.bottomCards, cfg);
  let mult = 1;
  let bottomGained = 0;
  if (lastWinnerTeam === attackTeam && bp > 0) {
    mult = bottomMultiplier(lastTrick, state.trumpInfo, cfg);
    bottomGained = bp * mult;
  }
  const attackPoints = attackPointsOnTable + bottomGained;

  // 升级数与胜方
  const gain = computeLevelGain(attackPoints, cfg);
  const winnerTeam = gain.winnerTeam === 'attack' ? attackTeam : defenseTeam;
  let levelsGained = gain.levels;

  // 过 A（R15）：庄家方打 A
  const dealerRank = state.levels[`team${dealerTeam}`];
  let passedA = false;
  if (dealerRank === cfg.rankEnd) {
    const pa = checkPassA({
      winnerIsDealer: winnerTeam === dealerTeam,
      attackPoints,
      dealerRank,
      cfg
    });
    passedA = pa.passedA;
    if (pa.cappedAtA) levelsGained = pa.levelsGained; // 停在 A 按小光 2 级（封顶 A）
    if (passedA) levelsGained = gain.levels;
  }

  // 攻方上台且攻方打A获胜（攻方当庄打A过A情形也需处理）
  const attackRank = state.levels[`team${attackTeam}`];
  if (!passedA && attackRank === cfg.rankEnd && winnerTeam === attackTeam) {
    // 攻方打 A 上台：本局以庄家队级数（dealer 的对家同队）为准——
    // 注意：本局级牌 = 庄家队级数；攻方过A判定发生在其当庄的下一局，这里不动。
  }

  // 级数推进（胜方升级；未过A封顶 A 由 advanceRank 天然保证）
  const nextLevels = { team0: state.levels.team0, team1: state.levels.team1 };
  if (levelsGained > 0) {
    const key = `team${winnerTeam}`;
    nextLevels[key] = advanceRank(nextLevels[key], levelsGained, cfg);
  }

  // 下局庄家（R16）
  const nextDealerIdx = nextDealer({
    dealerTeam,
    winnerTeam,
    dealerIdx: state.dealerIdx,
    bidWinnerIdx: state.bidWinnerIdx,
    players: state.players,
    dealerPassRule: cfg.dealerPassRule,
    lastDealerIdx: state.lastDealerIdx === undefined ? state.dealerIdx : state.lastDealerIdx
  });

  // 终局（R24）：过A 且 roundGoal=first_pass_A
  const gameOver = passedA && cfg.roundGoal === 'first_pass_A';

  return {
    attackPoints,
    attackPointsOnTable,
    bottomPoints: bp,
    bottomMultiplierUsed: mult,
    bottomGained,
    winnerTeam,
    levelsGained,
    passedA,
    nextDealerIdx,
    nextLevels,
    gameOver
  };
}

module.exports = {
  bottomPoints,
  bottomMultiplier,
  computeLevelGain,
  advanceRank,
  checkPassA,
  nextDealer,
  settleRound,
  settleRoundSanDaYi
};
