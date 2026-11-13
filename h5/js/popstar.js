'use strict';
window.createPopstarUI = function ({ navigate, storage }) {
  const E = window.GameCore.Popstar, session = new window.GameCore.PopstarSession(storage);
  const $ = (id) => document.getElementById('star-' + id);
  const button = (id) => document.getElementById('btn-star-' + id);
  const board = $('board');
  let active = false, busy = false, generation = 0, primary, secondary, focusBefore;
  const cells = Array.from({ length: 100 }, (_, i) => {
    const cell = document.createElement('button'); cell.type = 'button'; cell.dataset.index = i;
    board.appendChild(cell); return cell;
  });
  const motion = window.createArcadeMotion(board, cells, 10);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms));
  function render(values = session.state.board, hits = [], hint = []) {
    cells.forEach((cell, i) => {
      const value = values[i];
      cell.className = 'fruit star-piece' + (value === null ? ' star-piece--empty' : '') + (hits.includes(i) ? ' fruit--pop' : '') + (hint.includes(i) ? ' fruit--hint' : '');
      cell.dataset.fruit = value; cell.textContent = value === null ? '' : '★';
      cell.disabled = value === null;
      cell.setAttribute('aria-disabled', String(value === null || busy || session.state.status !== 'playing'));
      cell.setAttribute('aria-label', `第 ${Math.floor(i / 10) + 1} 行第 ${i % 10 + 1} 列，${value === null ? '空格' : E.NAMES[value] + '星星'}`);
    });
  }
  function stats() {
    const s = session.state, goal = E.target(s.level);
    $('level').textContent = `第 ${s.level} 关`;
    $('score').textContent = s.score; $('moves').textContent = s.board.filter((v) => v !== null).length;
    $('target').textContent = goal; $('best').textContent = session.best;
    $('progress').max = goal; $('progress').value = Math.min(goal, s.score);
    $('percent').textContent = Math.min(100, Math.floor(s.score / goal * 100)) + '%';
    button('hint').disabled = busy || s.status !== 'playing'; button('restart').disabled = busy;
    board.setAttribute('aria-busy', String(busy));
    document.getElementById('lobby-star-progress').textContent = `第 ${s.level} 关 · 累计 ${s.score} 分`;
  }
  function closeDialog() {
    $('dialog').hidden = true;
    if (active && focusBefore && focusBefore.isConnected) focusBefore.focus({ preventScroll: true });
  }
  function dialog(title, body, first, second) {
    focusBefore = document.activeElement;
    $('dialog-title').textContent = title; $('dialog-body').textContent = body; $('dialog-icon').textContent = '✦';
    $('dialog-primary').textContent = first.label; $('dialog-secondary').textContent = second.label;
    primary = first.action; secondary = second.action; $('dialog').hidden = false;
    $('dialog-primary').focus({ preventScroll: true });
  }
  function restart() {
    session.restart(); render(); stats(); cells.find((c) => !c.disabled).focus({ preventScroll: true }); $('status').textContent = '保留入关分数，重新收集这一片星光';
  }
  function result() {
    if (!active || session.state.status === 'playing') return;
    const s = session.state, won = s.status === 'won', final = s.level >= 1000;
    dialog(won ? (final ? '星光挑战全部完成！' : '星光收集成功！') : '再试一次，凑出更大片',
      `累计 ${s.score} 分 / 目标 ${E.target(s.level)} 分\n剩余 ${s.board.filter((v) => v !== null).length} 颗，奖励 ${s.bonus} 分。\n${won ? '得分带入下一关，继续收集星光。' : '重玩本关会保留入关前的累计得分。'}`,
      { label: won && !final ? '下一关 →' : '重玩本关', action: () => { if (!session.next()) restart(); render(); stats(); cells.find((c) => !c.disabled).focus({ preventScroll: true }); $('status').textContent = '同色星星越多，得分越高'; } },
      { label: '回游戏大厅', action: () => navigate('lobby') });
  }
  async function remove(i) {
    if (!active || busy || !$('dialog').hidden || session.state.status !== 'playing') return;
    const before = session.state.board.slice(), outcome = session.move(i);
    if (!outcome.accepted) { $('status').textContent = '至少两颗同色星星相连才能消除'; return; }
    busy = true; const run = ++generation;
    const valid = () => active && generation === run;
    stats(); render(before, outcome.matched);
    motion.burst(outcome.matched, `+${outcome.gained}`);
    $('status').textContent = `${outcome.matched.length} 颗一齐消除！ +${outcome.gained} 分`;
    await wait(220); if (!valid()) return;
    render(); motion.fall(outcome.sources);
    await wait(430); if (!valid()) return;
    busy = false; render(); stats(); result();
  }
  board.addEventListener('click', (event) => { const cell = event.target.closest('[data-index]'); if (cell) void remove(Number(cell.dataset.index)); });
  board.addEventListener('keydown', (event) => {
    const cell = event.target.closest('[data-index]'); if (!cell) return;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -10, ArrowDown: 10 };
    if (!(event.key in offsets)) return;
    event.preventDefault(); let i = Number(cell.dataset.index), j = i + offsets[event.key];
    while (j >= 0 && j < 100 && (Math.abs(offsets[event.key]) === 10 || Math.floor(i / 10) === Math.floor(j / 10))) {
      if (!cells[j].disabled) { cells[j].focus(); break; } j += offsets[event.key];
    }
  });
  button('home').addEventListener('click', () => navigate('lobby'));
  button('hint').addEventListener('click', () => {
    if (busy || session.state.status !== 'playing') return;
    const found = E.hint(session.state.board); render(session.state.board, [], found);
    $('status').textContent = `这片 ${found.length} 颗星星，可得 ${5 * found.length * found.length} 分`;
  });
  button('restart').addEventListener('click', () => {
    if (busy) return;
    dialog('重玩这一关？', '本关盘面重新生成，分数回到入关时。\n历史最高分会保留。', { label: '重玩本关', action: restart }, { label: '继续摘星', action() {} });
  });
  button('rules').addEventListener('click', () => {
    if (busy) return;
    dialog('消灭星星 · 玩法', '点击横竖相连的至少 2 颗同色星星。\n一次消除 n 颗，得分为 5 × n × n。\n星星下落、空列左移，不补新星星。\n无法再消除时结算：剩余少于 10 颗可获奖励，清空奖励 2000 分。\n达到目标后进入下一关，累计得分带入。\n没有时间或步数限制，进度保存在本机。',
      { label: '明白了', action: result }, { label: '回游戏大厅', action: () => navigate('lobby') });
  });
  $('dialog-primary').addEventListener('click', () => { const action = primary; closeDialog(); if (action) action(); });
  $('dialog-secondary').addEventListener('click', () => { const action = secondary; closeDialog(); if (action) action(); });
  $('dialog').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === $('dialog-primary') ? $('dialog-secondary') : $('dialog-primary')).focus(); }
    if (e.key === 'Escape') { closeDialog(); result(); }
  });
  stats();
  return {
    open() { active = true; busy = false; render(); stats(); result(); },
    close() { active = false; generation++; busy = false; motion.cancel(); closeDialog(); stats(); }
  };
};
