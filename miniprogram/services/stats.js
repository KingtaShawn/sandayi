/**
 * services/stats.js —— 战绩统计（F-14，P1）：局数/胜率/最快过A 的纯计算。
 */

'use strict';

/**
 * 汇总战绩。
 * @param {Array<object>} records [{roundNo, myTeamWon, passedA, attackPoints, tricksCount, durationMs}]
 * @returns {object} 统计视图
 */
function summarize(records) {
  const list = Array.isArray(records) ? records : [];
  const total = list.length;
  const wins = list.filter((r) => r.myTeamWon).length;
  const passARecords = list.filter((r) => r.passedA);
  const fastestPassA = passARecords.length
    ? Math.min(...passARecords.map((r) => r.roundNo || 0))
    : null;
  const totalTricks = list.reduce((s, r) => s + (r.tricksCount || 0), 0);
  return {
    totalRounds: total,
    wins,
    losses: total - wins,
    winRate: total ? +(wins / total).toFixed(3) : 0,
    passACount: passARecords.length,
    fastestPassA,
    avgTricks: total ? +(totalTricks / total).toFixed(1) : 0
  };
}

/**
 * 追加一局记录（增量）。
 * @param {Array<object>} records
 * @param {object} record
 * @param {number} [cap=200] 上限
 * @returns {Array<object>}
 */
function appendRecord(records, record, cap) {
  const list = (records || []).slice();
  list.push(record);
  const limit = cap || 200;
  if (list.length > limit) list.splice(0, list.length - limit);
  return list;
}

module.exports = { summarize, appendRecord };
