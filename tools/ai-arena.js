/** 多庄家风格、双方向、轮换首报位的配对评测。
 * node tools/ai-arena.js --count 2048 --seed-start 20001 --workers 4 --variants points,late --out /tmp/arena.json
 * --baseline/--candidate 可分别指定完整独立源码树中的strategy-greedy.js。
 * 训练与留出种子明确分开；测试合法性失败或分数不守恒会直接终止。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { createConfig } = require('../miniprogram/engine/config');
const { createInitialState, serializeState } = require('../miniprogram/core/state');
const { transition } = require('../miniprogram/core/statemachine');
const { scoreBidOptions } = require('../miniprogram/engine/bid');
const { parseCombo, domainOf, pointsOf, strengthInDomain } = require('../miniprogram/engine/combo');
const { pointValue } = require('../miniprogram/engine/card');
const { createRng } = require('../miniprogram/utils/random');

const ROOT = path.resolve(__dirname, '..');
const PROFILES = ['normal', 'pressure', 'cash', 'low-bottom'];
const VARIANTS = {
  points: { AI_WIN_OBJECTIVE: 'off', AI_WIN_SAMPLE_SCALE: '1' },
  endgame: { AI_WIN_OBJECTIVE: 'endgame', AI_WIN_SAMPLE_SCALE: '1' },
  all: { AI_WIN_OBJECTIVE: 'all', AI_WIN_SAMPLE_SCALE: '1' },
  late: { AI_WIN_OBJECTIVE: 'late', AI_WIN_SAMPLE_SCALE: '1' },
  critical: { AI_WIN_OBJECTIVE: 'critical', AI_WIN_SAMPLE_SCALE: '1' },
  wide: { AI_WIN_OBJECTIVE: 'late', AI_WIN_SAMPLE_SCALE: '2' }
};

function loadStrategy(file, flags = {}) {
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod.require = Module.createRequire(file);
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes('function envFlag(name) {')) throw Error('策略缺少独立开关入口');
  source = `'use strict';\nconst __arenaFlags = ${JSON.stringify(flags)};\n` + source.replace(
    /function envFlag\(name\) \{[\s\S]*?\n\}/,
    'function envFlag(name) { return __arenaFlags[name]; }');
  mod._compile(source, file);
  return new mod.exports.GreedyStrategy('normal');
}

function dealerProfile(file, name) {
  const ai = loadStrategy(file, { AI_WIN_OBJECTIVE: 'off' });
  if (name === 'pressure') {
    const lead = ai._scoreLeadSdy.bind(ai), bid = ai.decideScoreBid.bind(ai);
    ai._scoreLeadSdy = (st, seat, cs, ctx) => lead(st, seat, cs, ctx)
      + (parseCombo(cs, st.trumpInfo, st.config).isTrump ? 9 : 0);
    ai.decideScoreBid = (st, seat, opts, rng) => bid(st, seat, opts, rng) === null ? null : opts[Math.min(2, opts.length - 1)];
  } else if (name === 'cash') {
    const lead = ai._scoreLeadSdy.bind(ai);
    ai._scoreLeadSdy = (st, seat, cs, ctx) => {
      const co = parseCombo(cs, st.trumpInfo, st.config);
      return lead(st, seat, cs, ctx) + (ai._isSureCombo(co, ctx.di) ? pointsOf(cs, st.config) * 1.5 + 4 : 0);
    };
  } else if (name === 'low-bottom') {
    ai.decideBury = (st, seat) => {
      const hand = st.players[seat].hand, ti = st.trumpInfo, cfg = st.config;
      return hand.slice().sort((a, b) => {
        const value = (c) => (domainOf(c, ti) === 'TRUMP' ? 100 : 0)
          + pointValue(c, cfg) * 8 + strengthInDomain(c, ti) / 20;
        return value(a) - value(b);
      }).slice(0, cfg.bottomCards);
    };
  } else if (name !== 'normal') throw Error(`未知庄家风格 ${name}`);
  return ai;
}

function prepare(scenario, bidder, dealer) {
  const cfg = createConfig({ gameMode: 'san_da_yi', throwPenalty: 'penalty_smallest', playDirection: scenario.direction,
    ...(scenario.config || {}) });
  const rng = createRng(scenario.seed * 13 + 1);
  let st = createInitialState(cfg, null, createRng(scenario.seed), { dealerIdx: scenario.firstBidder });
  for (let step = 0; step < 200; step++) {
    if (st.phase === 'PLAYING') return st;
    if (st.phase === 'INIT_DEAL') st = transition(st, { type: 'DEAL', rng });
    else if (st.phase === 'BIDDING') {
      const seat = st.turnIdx, opts = scoreBidOptions(st, seat, cfg);
      const score = bidder.decideScoreBid(st, seat, opts, rng);
      st = transition(st, score === null ? { type: 'PASS_BID', playerIdx: seat, ts: 0 }
        : { type: 'SCORE_BID', playerIdx: seat, score, ts: 0 });
    } else if (st.phase === 'CHOOSE_TRUMP') st = transition(st, { type: 'CHOOSE_TRUMP', playerIdx: st.dealerIdx,
      suit: dealer.decideTrumpSuit(st, st.dealerIdx), ts: 0 });
    else if (st.phase === 'BURYING') st = transition(st, { type: 'BURY', playerIdx: st.dealerIdx,
      cards: dealer.decideBury(st, st.dealerIdx, rng), ts: 0 });
    else throw Error(`准备阶段异常 ${st.phase}`);
  }
  throw Error('发牌/竞价未完成');
}

function play(start, scenario, dealer, attacker, capture = false) {
  let st = structuredClone(start), decisions = 0;
  const coverage = { single: 0, pair: 0, tractor: 0, throw: 0, early: 0, middle: 0, end: 0, close: 0 };
  const trace = [];
  for (let step = 0; step < 500 && st.phase === 'PLAYING'; step++) {
    const seat = st.turnIdx, att = seat !== st.dealerIdx;
    const ai = att ? attacker : dealer;
    const pick = ai.decidePlay(st, seat, createRng(scenario.seed * 8191 + step * 31 + seat));
    if (att) {
      decisions++;
      const h = st.players[seat].hand.length;
      coverage[h > 10 ? 'early' : h > 2 ? 'middle' : 'end']++;
      const co = st.currentTrick ? st.currentTrick.leadCombo : parseCombo(pick, st.trumpInfo, st.config);
      if (coverage[co.type] !== undefined) coverage[co.type]++;
      const pts = st.completedTricks.filter((t) => t.winnerIdx === st.dealerIdx).reduce((n, t) => n + t.points, 0);
      if (Math.abs(st.contractScore - pts) <= 20) coverage.close++;
      if (capture && h <= 10) trace.push({ step, seat, cards: pick.map((c) => c.id), state: serializeState(st) });
    }
    st = transition(st, { type: 'PLAY', playerIdx: seat, cards: pick, ts: 0 });
  }
  if (st.phase !== 'SCORING') throw Error(`牌局未结束 ${st.phase}`);
  const s = st.lastSettle, last = st.completedTricks[st.completedTricks.length - 1];
  if (s.dealerPoints + s.attackerPoints !== 200) throw Error('分不守恒');
  return { win: s.winnerTeam === 'attackers', points: s.attackerPoints,
    bottom: last.winnerIdx !== st.dealerIdx, bottomPoints: last.winnerIdx !== st.dealerIdx ? s.bottomPoints : 0,
    decisions, coverage, trace };
}

function scenarios(count, start, profiles = PROFILES) {
  return Array.from({ length: count }, (_, i) => ({ seed: start + i,
    profile: profiles[i % profiles.length], direction: Math.floor(i / profiles.length) % 2 ? 'clockwise' : 'counterclockwise',
    firstBidder: Math.floor(i / (profiles.length * 2)) % 4 }));
}

function pairedStats(rows, variant) {
  const metric = (key) => {
    const diffs = rows.map((r) => Number(r.results[variant][key]) - Number(r.results.points[key]));
    const mean = diffs.reduce((n, d) => n + d, 0) / rows.length;
    const se = rows.length > 1 ? Math.sqrt(diffs.reduce((n, d) => n + (d - mean) ** 2, 0) / (rows.length - 1) / rows.length) : 0;
    return { mean, ci95: [mean - 1.96 * se, mean + 1.96 * se] };
  };
  return { n: rows.length, win: metric('win'), points: metric('points'), bottom: metric('bottom'), bottomPoints: metric('bottomPoints'),
    gained: rows.filter((r) => r.results[variant].win && !r.results.points.win).length,
    lost: rows.filter((r) => !r.results[variant].win && r.results.points.win).length };
}

function summarize(rows, variants) {
  const overall = {}, byProfile = {};
  for (const v of variants) {
    const total = rows.reduce((m, r) => {
      for (const k of ['win', 'points', 'bottom', 'bottomPoints', 'decisions']) m[k] += Number(r.results[v][k]);
      return m;
    }, { win: 0, points: 0, bottom: 0, bottomPoints: 0, decisions: 0 });
    overall[v] = { ...total, n: rows.length, winRate: total.win / rows.length,
      meanPoints: total.points / rows.length, bottomRate: total.bottom / rows.length };
    if (v !== 'points') overall[v].paired = pairedStats(rows, v);
  }
  for (const profile of [...new Set(rows.map((r) => r.scenario.profile))]) {
    const sub = rows.filter((r) => r.scenario.profile === profile);
    byProfile[profile] = Object.fromEntries(variants.filter((v) => v !== 'points').map((v) => [v, pairedStats(sub, v)]));
  }
  const coverage = {}, seats = {}, contracts = {}, directions = {};
  for (const r of rows) {
    seats[r.dealerSeat] = (seats[r.dealerSeat] || 0) + 1;
    contracts[r.contract] = (contracts[r.contract] || 0) + 1;
    directions[r.scenario.direction] = (directions[r.scenario.direction] || 0) + 1;
    for (const [k, n] of Object.entries(r.results.points.coverage)) coverage[k] = (coverage[k] || 0) + n;
  }
  return { overall, byProfile, coverage, seats, contracts, directions };
}

async function run(options, onProgress = () => {}) {
  const hashes = {
    baseline: crypto.createHash('sha256').update(fs.readFileSync(options.baseline)).digest('hex'),
    candidate: crypto.createHash('sha256').update(fs.readFileSync(options.candidate)).digest('hex'),
    runner: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex') };
  const jobs = scenarios(options.count, options.start, options.profiles);
  const count = Math.min(options.workers, jobs.length);
  const chunks = Array.from({ length: count }, () => []);
  jobs.forEach((job, i) => chunks[i % count].push(job));
  const rows = (await Promise.all(chunks.map((jobs) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { ...options, jobs } });
    worker.on('message', (m) => m.rows ? resolve(m.rows) : onProgress(m));
    worker.on('error', reject);
    worker.on('exit', (code) => { if (code) reject(Error(`worker exit ${code}`)); });
  })))).flat().sort((a, b) => a.scenario.seed - b.scenario.seed);
  return { options, hashes, variantFlags: Object.fromEntries(options.variants.map((v) => [v, VARIANTS[v]])),
  summary: summarize(rows, options.variants), rows };
}

if (!isMainThread) {
  const o = workerData;
  const attackers = Object.fromEntries(o.variants.map((v) => [v, loadStrategy(v === 'points' ? o.baseline : o.candidate, VARIANTS[v])]));
  const dealers = Object.fromEntries(o.profiles.map((p) => [p, dealerProfile(o.baseline, p)]));
  const rows = [];
  for (const scenario of o.jobs) {
    const dealer = dealers[scenario.profile], start = prepare(scenario, dealer, dealer), results = {};
    for (const v of o.variants) results[v] = play(start, scenario, dealer, attackers[v], o.capture);
    rows.push({ scenario, dealerSeat: start.dealerIdx, contract: start.contractScore,
      bottom: pointsOf(start.bottomCards, start.config), results });
    if (rows.length % 20 === 0) parentPort.postMessage({ progress: 20 });
  }
  if (rows.length % 20) parentPort.postMessage({ progress: rows.length % 20 });
  parentPort.postMessage({ rows });
} else if (require.main === module) {
  const args = process.argv.slice(2), get = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
  const options = { count: Number(get('--count', 256)), start: Number(get('--seed-start', 401)),
    workers: Number(get('--workers', 4)), profiles: get('--profiles', PROFILES.join(',')).split(','),
    variants: get('--variants', 'points,late').split(','),
    baseline: path.resolve(get('--baseline', 'miniprogram/ai/strategy-greedy.js')),
    candidate: path.resolve(get('--candidate', 'miniprogram/ai/strategy-greedy.js')), capture: args.includes('--capture') };
  if (!options.variants.includes('points') || options.variants.some((v) => !VARIANTS[v])
      || !Number.isInteger(options.count) || options.count < 1 || !Number.isInteger(options.workers) || options.workers < 1
      || !Number.isInteger(options.start) || options.start < 1) throw Error('参数无效');
  let done = 0;
  run(options, (m) => { done += m.progress; console.log(`progress=${Math.min(done, options.count)}/${options.count}`); })
    .then((result) => { fs.writeFileSync(path.resolve(get('--out', '/tmp/sandayi-arena.json')), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result.summary, null, 2)); })
    .catch((e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { loadStrategy, dealerProfile, prepare, play, scenarios, pairedStats, summarize, run };
