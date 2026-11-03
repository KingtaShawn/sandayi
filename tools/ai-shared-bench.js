/** 同牌局比较公开闲家和共享闲家。只改变真人庄家对手的信息权限，不改变庄家策略。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { GreedyStrategy } = require('../miniprogram/ai/strategy-greedy');
const { SharedAttackStrategy } = require('../miniprogram/ai/strategy-shared');
const { prepare, play, scenarios, dealerProfile, summarize } = require('./ai-arena');
const { domainOf, parseCombo, pointsOf } = require('../miniprogram/engine/combo');
const { legalMoves } = require('../miniprogram/engine/validate');
const { playKey } = require('../miniprogram/ai/hand-plan');

/** 专门检验用户所说的庄家：白墩垫最短门的无分牌，分墩尝试以主牌接管。 */
function shortDiscardDealer(ai) {
  const original = ai.decidePlay;
  ai.decidePlay = function (st, seat, rng) {
    const t = st.currentTrick, ti = st.trumpInfo, cfg = st.config;
    const hand = st.players[seat].hand, domain = (c) => domainOf(c, ti);
    if (t && t.leadCombo.type === 'single' && !t.leadCombo.isTrump
        && !hand.some((c) => domain(c) === t.leadCombo.suit)) {
      const points = t.plays.reduce((n, p) => n + pointsOf(p.cards, cfg), 0);
      const legal = legalMoves(st, seat);
      if (points === 0) {
        const len = (c) => hand.filter((p) => domain(p) === domain(c)).length;
        const off = legal.filter((cs) => domain(cs[0]) !== 'TRUMP' && pointsOf(cs, cfg) === 0);
        off.sort((a, b) => len(a[0]) - len(b[0]));
        if (off.length) return off[0];
      } else {
        const ruff = legal.find((cs) => domain(cs[0]) === 'TRUMP'
          && this._wouldWin(st, t, seat, cs, parseCombo(cs, ti, cfg)));
        if (ruff) return ruff;
      }
    }
    return original.call(this, st, seat, rng);
  };
  return ai;
}

function run(count = 128, seedStart = 48001, compareTail = false, baselineFile = null, shortDiscard = false) {
  const file = path.resolve(__dirname, '../miniprogram/ai/strategy-greedy.js');
  const publicAI = baselineFile ? new (require(path.resolve(baselineFile)).SharedAttackStrategy)()
    : compareTail ? new SharedAttackStrategy() : new GreedyStrategy(), sharedAI = new SharedAttackStrategy();
  const reference = compareTail || baselineFile ? 'previous' : 'public';
  if (compareTail) publicAI.trumpTailEnabled = false;
  const leadSwitches = { proposed: 0, accepted: 0 };
  let proposed = null;
  const switchSuit = sharedAI._switchAfterFreeDiscard, decide = sharedAI.decidePlay;
  sharedAI._switchAfterFreeDiscard = function (...args) {
    const cards = switchSuit.apply(this, args);
    if (cards) { proposed = cards; leadSwitches.proposed++; }
    return cards;
  };
  sharedAI.decidePlay = function (...args) {
    proposed = null;
    const cards = decide.apply(this, args);
    if (proposed && playKey(proposed) === playKey(cards)) leadSwitches.accepted++;
    return cards;
  };
  const tailReadings = { canCash: 0, cannotCash: 0 };
  let suitDefenseDecisions = 0;
  const buildCtx = sharedAI._buildCtx;
  sharedAI._buildCtx = function (...args) {
    const ctx = buildCtx.apply(this, args);
    if (ctx.suitDefense) suitDefenseDecisions++;
    return ctx;
  };
  const readTail = sharedAI._readTrumpTail;
  sharedAI._readTrumpTail = function (...args) {
    const result = readTail.apply(this, args);
    if (result) tailReadings[result.canCash ? 'canCash' : 'cannotCash']++;
    return result;
  };
  const rows = [], started = Date.now();
  for (const scenario of scenarios(count, seedStart)) {
    const dealer = dealerProfile(file, scenario.profile);
    if (shortDiscard) shortDiscardDealer(dealer);
    const st = prepare(scenario, dealer, dealer);
    // 评测庄家策略代替真人出牌，其余三席明确都是AI；轮换首报位和双方向。
    st.players.forEach((p, seat) => { p.isHuman = seat === st.dealerIdx; });
    rows.push({ scenario, dealerSeat: st.dealerIdx, contract: st.contractScore, results: {
      [reference]: play(st, scenario, dealer, publicAI),
      shared: play(st, scenario, dealer, sharedAI)
    } });
    if (rows.length % 32 === 0) console.log(`progress=${rows.length}/${count}`);
  }
  const summary = summarize(rows, [reference, 'shared'], reference);
  for (const variant of [reference, 'shared']) {
    summary.overall[variant].dealerSweeps = rows.filter((r) => r.results[variant].points === 0).length;
  }
  summary.sweepChanges = {
    prevented: rows.filter((r) => r.results[reference].points === 0 && r.results.shared.points > 0).length,
    introduced: rows.filter((r) => r.results[reference].points > 0 && r.results.shared.points === 0).length
  };
  const sources = ['miniprogram/ai/strategy-greedy.js', 'miniprogram/ai/strategy-shared.js', 'miniprogram/ai/suit-defense.js',
    'miniprogram/ai/public-knowledge.js', 'miniprogram/engine/validate.js'];
  return { seedStart, count, elapsedMs: Date.now() - started,
    hashes: Object.fromEntries(sources.map((f) => [f, crypto.createHash('sha256')
      .update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex')])),
    note: 'winRate为闲家胜率；庄家由四种固定AI风格代替真人，不代表真人胜率或最优策略。',
    reference, baselineFile, shortDiscard, leadSwitches, tailReadings, suitDefenseDecisions, summary, rows };
}

if (require.main === module) {
  const args = process.argv.slice(2), get = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const result = run(Number(get('--count', 128)), Number(get('--seed-start', 48001)), args.includes('--compare-tail'),
    get('--baseline-shared', null), args.includes('--short-discard'));
  fs.writeFileSync(path.resolve(get('--out', '/tmp/sandayi-shared-bench.json')), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ elapsedMs: result.elapsedMs, summary: result.summary }, null, 2));
}
module.exports = { run };
