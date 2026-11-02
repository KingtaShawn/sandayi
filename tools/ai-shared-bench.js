/** 同牌局比较公开闲家和共享闲家。只改变真人庄家对手的信息权限，不改变庄家策略。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { SharedAttackStrategy } = require('../miniprogram/ai/strategy-shared');
const { prepare, play, scenarios, dealerProfile, summarize } = require('./ai-arena');

function run(count = 128, seedStart = 48001) {
  const file = path.resolve(__dirname, '../miniprogram/ai/strategy-greedy.js');
  const publicAI = new GreedyStrategy(), sharedAI = new SharedAttackStrategy();
  const rows = [], started = Date.now();
  for (const scenario of scenarios(count, seedStart)) {
    const dealer = dealerProfile(file, scenario.profile);
    const st = prepare(scenario, dealer, dealer);
    // 评测庄家策略代替真人出牌，其余三席明确都是AI；轮换首报位和双方向。
    st.players.forEach((p, seat) => { p.isHuman = seat === st.dealerIdx; });
    rows.push({ scenario, dealerSeat: st.dealerIdx, contract: st.contractScore, results: {
      public: play(st, scenario, dealer, publicAI),
      shared: play(st, scenario, dealer, sharedAI)
    } });
    if (rows.length % 32 === 0) console.log(`progress=${rows.length}/${count}`);
  }
  const sources = ['miniprogram/ai/strategy-greedy.js', 'miniprogram/ai/strategy-shared.js',
    'miniprogram/ai/public-knowledge.js', 'miniprogram/engine/validate.js'];
  return { seedStart, count, elapsedMs: Date.now() - started,
    hashes: Object.fromEntries(sources.map((f) => [f, crypto.createHash('sha256')
      .update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex')])),
    note: 'winRate为闲家胜率；庄家由四种固定AI风格代替真人，不代表真人胜率或最优策略。',
    summary: summarize(rows, ['public', 'shared'], 'public'), rows };
}

if (require.main === module) {
  const args = process.argv.slice(2), get = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const result = run(Number(get('--count', 128)), Number(get('--seed-start', 48001)));
  fs.writeFileSync(path.resolve(get('--out', '/tmp/sandayi-shared-bench.json')), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ elapsedMs: result.elapsedMs, summary: result.summary }, null, 2));
}
module.exports = { run };
