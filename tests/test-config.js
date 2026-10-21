/**
 * tests/test-config.js —— RuleConfig 参数校验 / 合并 / 冻结 / 参数生效性（验收标准 2）。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_CONFIG,
  createConfig,
  validateConfig,
  rankSequence,
  PARAM_RANGES
} = require('../miniprogram/engine/config');

test('默认配置包含 R1~R24 全部参数且值符合传统规则', () => {
  assert.equal(DEFAULT_CONFIG.deckCount, 2);
  assert.equal(DEFAULT_CONFIG.bottomCards, 8);
  assert.equal(DEFAULT_CONFIG.rankStart, '2');
  assert.equal(DEFAULT_CONFIG.rankEnd, 'A');
  assert.equal(DEFAULT_CONFIG.pointsToTake, 80);
  assert.equal(DEFAULT_CONFIG.pointsPerLevel, 40);
  assert.equal(DEFAULT_CONFIG.cleanSweepBonusLevels, 1);
  assert.equal(DEFAULT_CONFIG.allowNoTrump, true);
  assert.equal(DEFAULT_CONFIG.bottomMultiplier, 2);
  assert.equal(DEFAULT_CONFIG.bottomMultiplierByType, false);
  assert.equal(DEFAULT_CONFIG.mustFollowPairAsPair, true);
  assert.equal(DEFAULT_CONFIG.mustFollowTractorAsTractor, true);
  assert.equal(DEFAULT_CONFIG.throwPenalty, 'reject');
  assert.equal(DEFAULT_CONFIG.passACondition, 'small_light');
  assert.equal(DEFAULT_CONFIG.dealerPassRule, 'winner_stays');
  assert.equal(DEFAULT_CONFIG.levelUpTable, 'standard');
  assert.equal(DEFAULT_CONFIG.offSuitRankTieFirstWin, true);
  assert.equal(DEFAULT_CONFIG.allowSingleJokerOverride, false);
  assert.equal(DEFAULT_CONFIG.offSuitRankPairAsTractor, false);
  assert.equal(DEFAULT_CONFIG.playDirection, 'counterclockwise');
  assert.deepEqual(DEFAULT_CONFIG.aiPaceSeconds, [0.8, 1.5]);
});

test('默认配置自身校验通过', () => {
  const r = validateConfig(DEFAULT_CONFIG);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('默认配置深冻结，运行期不可篡改', () => {
  assert.throws(() => { DEFAULT_CONFIG.pointsToTake = 60; }, TypeError);
  assert.throws(() => { DEFAULT_CONFIG.pointValues['5'] = 99; }, TypeError);
  // 冻结不影响 createConfig 派生新配置
  const cfg = createConfig({ pointsToTake: 60 });
  assert.equal(cfg.pointsToTake, 60);
  assert.equal(DEFAULT_CONFIG.pointsToTake, 80);
});

test('createConfig 合并覆盖并归一化 rankStart 数字', () => {
  const cfg = createConfig({ rankStart: 3, pointsToTake: 60 });
  assert.equal(cfg.rankStart, '3');
  assert.equal(cfg.pointsToTake, 60);
  assert.equal(cfg.bottomCards, 8); // 未覆盖项沿用默认
});

test('非法配置被拒绝并给出全部错误', () => {
  assert.throws(() => createConfig({ deckCount: 4 }), /deckCount/);
  assert.throws(() => createConfig({ throwPenalty: 'xxx' }), /throwPenalty/);
  assert.throws(() => createConfig({ aiPaceSeconds: [3, 1] }), /aiPaceSeconds/);
  const r = validateConfig(Object.assign({}, DEFAULT_CONFIG, { bottomCards: 9, pointsToTake: -5 }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 2);
});

test('R2 底牌张数必须满足 4 家整除', () => {
  // 108 - 9 = 99 不能被 4 整除 → 拒绝
  assert.throws(() => createConfig({ bottomCards: 9 }), /整除/);
  // 108 - 8 = 100 → 每人 25 张 ✓
  assert.doesNotThrow(() => createConfig({ bottomCards: 8 }));
});

test('R5=60 改参后配置生效（参数化验证，验收 2 基础）', () => {
  const cfg60 = createConfig({ pointsToTake: 60 });
  assert.equal(cfg60.pointsToTake, 60);
  assert.notEqual(cfg60, DEFAULT_CONFIG);
});

test('rankSequence 返回 rankStart→rankEnd 完整序列', () => {
  assert.deepEqual(rankSequence(DEFAULT_CONFIG)[0], '2');
  assert.deepEqual(rankSequence(DEFAULT_CONFIG).slice(-1)[0], 'A');
  assert.equal(rankSequence(DEFAULT_CONFIG).length, 13);
  const cfgK = createConfig({ rankEnd: 'K' });
  assert.equal(rankSequence(cfgK).length, 12);
});

test('PARAM_RANGES 覆盖全部枚举参数（规则速查页渲染源）', () => {
  ['throwPenalty', 'passACondition', 'dealerPassRule', 'bidDeadLine',
    'playDirection', 'noBidFallback', 'levelUpTable', 'roundGoal'].forEach((k) => {
    assert.ok(Array.isArray(PARAM_RANGES[k]) && PARAM_RANGES[k].length >= 2, `${k} 缺少可选范围`);
  });
});
