/**
 * tests/run-tests.js —— 测试入口：注册全部 test-*.js（node --test 或直接 node 执行均可）。
 */

'use strict';

const path = require('path');
const fs = require('fs');

const TEST_FILES = [
  'test-config.js',
  'test-deck.js',
  'test-trump.js',
  'test-combo.js',
  'test-bid.js',
  'test-validate-play.js',
  'test-throw-regressions.js',
  'test-trick.js',
  'test-settle.js',
  'test-statemachine.js',
  'test-ai-legal.js',
  'test-ai-team-follow.js',
  'test-ai-ruff-protect.js',
  'test-ai-trump-discard.js',
  'test-ai-throw-defense.js',
  'test-h5-bundle-throw-kill.js',
  'test-ai-pair-keep.js',
  'test-ai-point-plan.js',
  'test-ai-long-plan.js',
  'test-ai-arena.js',
  'test-ai-joker-reserve.js',
  'test-ai-shared-hands.js',
  'test-ai-trump-tail-feed.js',
  'test-ai-suit-defense.js',
  'test-ai-free-void-discard.js',
  'test-qa-tractor.js',
  'test-qa-follow-trump.js',
  'test-qa-settle-koudi.js',
  'test-qa-bid-resume-seed.js',
  'test-qa-e2e-rounds.js',
  'test-san-da-yi.js',
  'test-eight-throw.js',
  'test-cloud-api.js',
  'test-cloud-h5.js',
  'test-settle-accounting.js',
  'test-cloud-mp.js'
];

const dir = __dirname;
const missing = [];
TEST_FILES.forEach((f) => {
  const p = path.join(dir, f);
  if (fs.existsSync(p)) {
    require(p);
  } else {
    missing.push(f);
  }
});

if (missing.length) {
  console.warn(`[run-tests] 缺少测试文件（跳过）：${missing.join(', ')}`);
}
