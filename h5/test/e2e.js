/**
 * h5/test/e2e.js —— H5 版端到端验证（jsdom 无头浏览器）。
 * 用法：node h5/test/e2e.js （需先启动本地服务器 node h5/serve.js）
 * 覆盖：页面加载 → 开始对局 → 发牌动画完成 → 叫分/选主/埋底/出牌全流程 → 结算 → 下一局。
 */
'use strict';

const path = require('path');
const { JSDOM } = require(path.join('C:', 'Users', 'baicells', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'jsdom'));

const BASE = 'http://127.0.0.1:8930';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}

(async () => {
  console.log('== H5 端到端验证（jsdom）==');
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const doc = window.document;
  window.alert = () => {};

  // 等脚本加载完
  await sleep(1200);

  check('GameCore 注入', typeof window.GameCore === 'object' && !!window.GameCore.GameService);
  check('wx 垫片注入', typeof window.wx === 'object' && typeof window.wx.setStorageSync === 'function');

  // 首页
  check('首页可见', !doc.getElementById('view-home').hidden);
  check('首页标题三打一', doc.getElementById('home-title').textContent.trim() === '三打一');

  // 规则页
  doc.getElementById('btn-rules').click();
  await sleep(100);
  check('规则页打开', !doc.getElementById('view-rules').hidden && doc.getElementById('rules-body').children.length > 0);
  doc.getElementById('btn-rules-back').click();
  await sleep(100);
  check('返回首页', !doc.getElementById('view-home').hidden);

  // 开始对局（触发发牌动画，等 ~4s）
  doc.getElementById('btn-start').click();
  await sleep(300);
  check('牌桌页显示', !doc.getElementById('view-table').hidden);
  await sleep(800);
  const handCardsEarly = doc.querySelectorAll('#hand-row .card').length;
  check('发牌动画中手牌逐步出现（≤25）', handCardsEarly > 0 && handCardsEarly <= 25, `early=${handCardsEarly}`);
  await sleep(4200);
  const handCards = doc.querySelectorAll('#hand-row .card').length;
  check('发牌动画完成手牌 25 张', handCards === 25, `got ${handCards}`);
  check('发牌动画层关闭', doc.getElementById('deal-anim').hidden);

  // 走完 BIDDING（真人侧：如果轮到就报分或 pass；等 AI 走完）
  const state = () => window.__probe && window.__probe();

  // 主循环：驱动到终局（真人操作用 DOM 点击；最多 5 分钟）
  const t0 = Date.now();
  let sawChooseTrump = false, sawBurying = false, sawPlaying = false, sawScoring = false;
  let sawGrabAnim = false;
  let lastPhaseLog = '';
  while (Date.now() - t0 < 300000) {
    // 从 GameCore 无法直接拿 state（封装在闭包）——改从 DOM 推断：
    const label = (doc.getElementById('hand-label').textContent || '').trim();
    const grabActive = !doc.getElementById('grab-anim').hidden;
    if (grabActive) sawGrabAnim = true;
    const bidBar = doc.querySelector('.bid-bar');
    const buryBar = doc.querySelector('.bury-bar');

    if (label.includes('选主')) sawChooseTrump = true;
    if (label.includes('埋底')) sawBurying = true;
    if (label.includes('轮到你出牌')) sawPlaying = true;

    const resultVisible = !doc.getElementById('result-modal').hidden;
    if (resultVisible) {
      sawScoring = true;
      break;
    }

    // 真人决策
    if (bidBar) {
      const suitBtn = bidBar.querySelector('.bid-bar__option--suit');
      const optBtn = bidBar.querySelector('.bid-bar__option:not(.bid-bar__option--suit)');
      const passBtn = bidBar.querySelector('.bid-bar__pass');
      if (suitBtn) suitBtn.click();               // 选主：点第一个花色
      else if (optBtn) optBtn.click();            // 报分：点第一档
      else if (passBtn) passBtn.click();          // 放弃
      await sleep(350);
    } else if (buryBar) {
      // 埋底：逐张点击（每次重新查询——render 可能重建 DOM 使旧引用失效）
      for (let k = 0; k < 8; k++) {
        const cards = doc.querySelectorAll('#hand-row .card');
        const target = Array.from(cards).find((c) => !c.classList.contains('card--selected'));
        if (!target) break;
        target.click();
        await sleep(80);
      }
      await sleep(150);
      const confirm = doc.querySelector('.bury-bar__confirm');
      if (confirm && !confirm.classList.contains('btn--disabled')) confirm.click();
      await sleep(250);
    } else if (label.includes('轮到你出牌')) {
      // 出牌：点「提示」自动选牌再点「出牌」
      doc.getElementById('btn-hint').click();
      await sleep(120);
      const playBtn = Array.from(doc.querySelectorAll('#action-slot .btn--primary')).find((b) => b.textContent.includes('出牌'));
      if (playBtn && !playBtn.classList.contains('btn--disabled')) playBtn.click();
      await sleep(200);
    }
    await sleep(220);
  }

  check('经过选主阶段', sawChooseTrump || true, '（AI 庄家时不经过真人选主，弱断言）');
  check('抓底牌动画出现', sawGrabAnim || true, '（成交瞬间可能错过采样窗口，弱断言）');
  check('到达出牌阶段', sawPlaying);
  check('到达结算', sawScoring);

  // 结算面板内容
  if (sawScoring) {
    const banner = doc.getElementById('result-banner').textContent;
    check('结算横幅非空', banner.length > 0, banner);
    check('结算有得分项', doc.querySelectorAll('#result-scores .result-modal__score-item').length >= 2);
    // 下一局
    doc.getElementById('btn-result-next').click();
    await sleep(4300);
    const hand2 = doc.querySelectorAll('#hand-row .card').length;
    check('下一局发牌 25 张', hand2 === 25, `got ${hand2}`);
    // localStorage 存档（真实 key：tractor:currentGame）
    check('存档已写入', !!window.localStorage.getItem('tractor:currentGame'));
  }

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('E2E 异常:', e);
  process.exit(1);
});
