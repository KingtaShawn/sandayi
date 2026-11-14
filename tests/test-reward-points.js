'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rewardForSettlement, summarize, appendRecord } = require('../miniprogram/services/stats');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');

for (const [dealerPoints, winnerTeam, dealerReward, attackerReward] of [
  [200, 'dealer', 2, -2], [0, 'attackers', -2, 2],
  [195, 'dealer', 1, -1], [5, 'attackers', -1, 1],
  [90, 'dealer', 1, -1], [85, 'attackers', -1, 1]
]) test(`奖惩积分：庄家${dealerPoints}分，庄家${dealerReward}、闲家${attackerReward}`, () => {
  const s = { mode: 'san_da_yi', dealerIdx: 2, dealerPoints, attackerPoints: 200 - dealerPoints, winnerTeam };
  assert.equal(rewardForSettlement(s, 2).points, dealerReward);
  for (const seat of [0, 1, 3]) assert.equal(rewardForSettlement(s, seat).points, attackerReward);
  assert.equal(rewardForSettlement(s, 2).multiplier, Math.abs(dealerReward));
});

test('新增奖惩不篡改牌面得分、不回填旧记录、不影响升级模式', () => {
  const s = { mode: 'san_da_yi', dealerIdx: 0, dealerPoints: 200, attackerPoints: 0, winnerTeam: 'dealer' };
  const before = structuredClone(s); rewardForSettlement(s);
  assert.deepEqual(s, before);
  assert.equal(summarize([{ myTeamWon: true, attackPoints: 0 }]).rewardPoints, 0);
  assert.equal(rewardForSettlement({ mode: 'shengji' }).points, 0);
});

test('累计积分允许为负，超过200局裁剪历史后仍保留之前的余额', () => {
  let records = [];
  for (let roundNo = 1; roundNo <= 250; roundNo++) records = appendRecord(records, {
    roundNo, rewardPoints: -2, rewardTotal: summarize(records).rewardPoints - 2
  });
  assert.equal(records.length, 200);
  assert.equal(summarize(records).rewardPoints, -500);
  const cloudCopy = JSON.parse(JSON.stringify(records));
  assert.equal(summarize(cloudCopy).rewardPoints, -500);
});

test('残局推演在合同已定后仍区分满分/零分的双倍奖惩', () => {
  const ai = new GreedyStrategy();
  const value = (points, winObjective) => ai._r5TerminalOf({ dealerIdx: 0, bankDealerPts: points,
    bottomPts: 0, tricks: [], contractScore: 90, winObjective });
  for (const objective of [true, false]) {
    assert.ok(value(200, objective) - value(195, objective) > 50);
    assert.ok(value(5, objective) - value(0, objective) > 50);
    assert.ok(value(90, objective) > value(85, objective));
  }
});
