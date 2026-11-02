'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stats = require('../miniprogram/services/stats');

const source = fs.readFileSync(path.join(__dirname, '../h5/js/app.js'), 'utf8');
const accountSource = source.slice(source.indexOf('  function accountSettle()'), source.indexOf('  function backfillMaxBids()'));
const resultSource = source.slice(source.indexOf('  function renderResult('), source.indexOf('  function render()'));

function settled({ seed = 101, roundNo = 1, dealerIdx = 0, dealerPoints = 200 } = {}) {
  return { seed, roundNo, phase: 'SCORING', completedTricks: [], bottomCards: [],
    lastSettle: { mode: 'san_da_yi', dealerIdx, dealerPoints, attackPoints: 200 - dealerPoints,
      attackerPoints: 200 - dealerPoints, winnerTeam: 'dealer' } };
}

function presenter(state, persisted = new Map()) {
  const records = persisted;
  const counters = new Map();
  const nodes = new Map();
  const cloud = { notifyLocal() { counters.set('notify', (counters.get('notify') || 0) + 1); },
    flush() { counters.set('flush', (counters.get('flush') || 0) + 1); return Promise.resolve(); } };
  const g = { service: { getState: () => state }, accountedRoundNo: -1, settlePause: false };
  const ctx = { G: g, stats, STORAGE_KEYS: { STATS: 'stats' },
    storage: { get: k => records.get(k), set: (k, v) => records.set(k, v) },
    localStorage: { getItem: k => records.get(k) ?? null, setItem: (k, v) => records.set(k, String(v)) },
    window: { Cloud: cloud }, Cloud: cloud, toast() {}, Sfx: { play() {} },
    $: id => { if (!nodes.has(id)) nodes.set(id, { hidden: true, appendChild() {} }); return nodes.get(id); },
    el: () => ({}) };
  vm.createContext(ctx);
  vm.runInContext(accountSource + '\n' + resultSource, ctx);
  return { ctx, records, counters, show: () => ctx.renderResult(state, { settle: state.lastSettle, settleIsWin: true, settleBanner: '胜利' }) };
}

test('200分结算面板出现即落账并上传，不依赖再点下一局或回首页', () => {
  const { show, records, counters } = presenter(settled());
  show();
  assert.equal(records.get('tractor:maxBids'), '1');
  assert.equal(records.get('stats').length, 1);
  assert.equal(counters.get('flush'), 1);
});

test('结算重复渲染、出口再记账、恢复已结算局都不能重复加满分次数', () => {
  const state = settled();
  const first = presenter(state);
  first.show(); first.show(); first.ctx.accountSettle();
  assert.equal(first.records.get('tractor:maxBids'), '1');
  const resumed = presenter(structuredClone(state), first.records);
  resumed.show(); resumed.ctx.accountSettle();
  assert.equal(first.records.get('tractor:maxBids'), '1');
  assert.equal(first.records.get('stats').length, 1);
  const next = presenter(settled({ roundNo: 2 }), first.records);
  next.show();
  assert.equal(first.records.get('tractor:maxBids'), '2');
});

test('庄家不足200分、或者真人不是庄家时都不增加满分坐庄次数', () => {
  for (const state of [settled({ dealerPoints: 195 }), settled({ dealerIdx: 1 })]) {
    const p = presenter(state); p.show();
    assert.equal(p.records.get('tractor:maxBids'), undefined);
    assert.equal(p.records.get('stats').length, 1);
  }
});
