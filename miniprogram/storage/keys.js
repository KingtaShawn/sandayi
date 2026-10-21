/**
 * storage/keys.js —— 存储键常量 + 序列化版本号（断线续玩恢复兼容，§8.8）。
 */

'use strict';

/** 当前 GameState 序列化结构版本（字段结构变化时 +1 并在 adapter 写迁移） */
const SCHEMA_VERSION = 1;

/** 存储键 */
const STORAGE_KEYS = {
  /** 进行中对局（GameState 序列化 JSON） */
  CURRENT_GAME: 'tractor:currentGame',
  /** 本地规则覆盖（房规） */
  RULE_OVERRIDES: 'tractor:ruleOverrides',
  /** 战绩统计 */
  STATS: 'tractor:stats',
  /** 设置（音效/动画/出牌方式） */
  SETTINGS: 'tractor:settings'
};

module.exports = { SCHEMA_VERSION, STORAGE_KEYS };
