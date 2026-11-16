'use strict';

// Small, focus-trapped dialogs shared by the two new games.
function miniGameDialog(root, onClose = () => {}) {
  const overlay = document.createElement('div');
  overlay.className = 'arcade-dialog'; overlay.hidden = true; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = '<div class="arcade-dialog__panel"><h2></h2><p></p><div class="arcade-dialog__actions"><button class="arcade-button" data-confirm></button><button class="arcade-button arcade-button--light" data-cancel>取消</button></div></div>';
  const title = overlay.querySelector('h2'), body = overlay.querySelector('p'), yes = overlay.querySelector('[data-confirm]'), no = overlay.querySelector('[data-cancel]');
  title.id = root.id + '-dialog-title'; overlay.setAttribute('aria-labelledby', title.id); root.appendChild(overlay);
  let action, previous;
  function close() { overlay.hidden = true; onClose(); if (previous && previous.isConnected && !root.hidden) previous.focus({ preventScroll: true }); action = null; }
  yes.addEventListener('click', () => { const fn = action; close(); if (fn) fn(); });
  no.addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === yes && !no.hidden ? no : yes).focus(); }
  });
  return { get visible() { return !overlay.hidden; }, close,
    open(heading, text, label, fn, cancellable = true) {
      previous = document.activeElement; title.textContent = heading; body.textContent = text;
      yes.textContent = label; no.hidden = !cancellable; action = fn; overlay.hidden = false; yes.focus();
    }
  };
}

window.createBreakoutUI = function ({ navigate, storage }) {
  const E = window.GameCore.Breakout, session = new window.GameCore.BreakoutSession(storage);
  const $ = (id) => document.getElementById('breakout-' + id), root = document.getElementById('view-breakout');
  const canvas = $('canvas'), dialog = miniGameDialog(root), keys = new Set();
  let ctx, active = false, frameId = null, last = 0, summary = '';
  function render() {
    const s = session.state, next = [s.score, s.level, s.lives, s.status, s.paused, session.best].join(':');
    if (next !== summary) {
      summary = next; $('score').textContent = s.score; $('level').textContent = s.level + ' / ' + E.LEVELS;
      $('lives').textContent = s.lives; $('best').textContent = session.best;
      $('status').textContent = E.message(s); $('action').textContent = E.actionLabel(s);
      canvas.setAttribute('aria-label', `弹球场地，第 ${s.level} 关，${s.score} 分，剩余 ${s.lives} 条生命。${E.message(s)}`);
    }
    if (ctx) window.GameCore.drawBreakout(ctx, s);
  }
  function frame(now) {
    if (!active) return;
    const dt = last ? Math.min((now - last) / 1000, .05) : 0; last = now;
    const direction = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
    if (direction) E.movePaddle(session.state, session.state.paddle + direction * 440 * dt);
    session.step(dt); render(); frameId = requestAnimationFrame(frame);
  }
  function pause() { keys.clear(); E.pause(session.state); last = 0; session.save(); render(); }
  function action() { if (!active || dialog.visible || document.hidden) return; session.action(); last = 0; render(); }
  function pointer(e) {
    if (!active || dialog.visible || (e.type === 'pointermove' && e.pointerType === 'touch' && !canvas.hasPointerCapture(e.pointerId))) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width) E.movePaddle(session.state, (e.clientX - rect.left) / rect.width * E.WIDTH);
    render();
  }
  canvas.addEventListener('pointerdown', (e) => { canvas.focus({ preventScroll: true }); canvas.setPointerCapture(e.pointerId); pointer(e); });
  canvas.addEventListener('pointermove', pointer);
  ['pointerup', 'pointercancel'].forEach((name) => canvas.addEventListener(name, (e) => { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); }));
  root.addEventListener('keydown', (e) => {
    if (!active || dialog.visible || e.altKey || e.ctrlKey || e.metaKey) return;
    if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(e.key)) { e.preventDefault(); keys.add(e.key); }
    if (e.code === 'Space' && e.target.tagName !== 'BUTTON') { e.preventDefault(); if (!e.repeat) action(); }
    if (e.key === 'Escape' || e.key.toLowerCase() === 'p') { e.preventDefault(); pause(); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));
  window.addEventListener('blur', () => { if (active) pause(); });
  document.addEventListener('visibilitychange', () => { if (active && document.hidden) pause(); });
  window.addEventListener('pagehide', () => { if (active) pause(); });
  $('action').addEventListener('click', action);
  $('home').addEventListener('click', () => navigate('lobby'));
  $('restart').addEventListener('click', () => { pause(); dialog.open('重新开始？', '从第 1 关、3 条生命开始，历史最高分保留。', '重新开始', () => { session.restart(); render(); }); });
  $('rules').addEventListener('click', () => { pause(); dialog.open('经典弹球 · 玩法', '移动鼠标、拖动场地或按 ← → / A D 控制挡板，点击发球或在场地按空格开始。\n挡板边缘能改变反弹方向，每次击中砖块得 10 分。带标记的砖块需要击中两次。\n共有 6 关、3 条生命，清空砖块进入下一关。按 P / Esc 暂停。\n切换游戏或离开窗口自动暂停；刷新后重新开局，最高分保存在本机。', '明白了', null, false); });
  return {
    open() {
      active = true; last = 0;
      if (!ctx) {
        ctx = canvas.getContext('2d');
        if (ctx) { const ratio = Math.min(window.devicePixelRatio || 1, 3); canvas.width = E.WIDTH * ratio; canvas.height = E.HEIGHT * ratio; ctx.scale(ratio, ratio); }
      }
      render(); canvas.focus({ preventScroll: true }); frameId = requestAnimationFrame(frame);
    },
    close() { if (!active) return; pause(); active = false; cancelAnimationFrame(frameId); frameId = null; dialog.close(); }
  };
};

window.createSudokuUI = function ({ navigate, storage }) {
  const E = window.GameCore.Sudoku;
  const $ = (id) => document.getElementById('sudoku-' + id), root = document.getElementById('view-sudoku');
  let session, selected = -1, pencil = false, active = false, paused = false, timer = null, last = 0;
  const dialog = miniGameDialog(root, () => { last = Date.now(); }), cells = [], digits = [];
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('button'); cell.type = 'button'; cell.dataset.index = i; cell.className = 'sudoku-cell';
    cell.innerHTML = '<span class="sudoku-value"></span><span class="sudoku-notes">' + '<span></span>'.repeat(9) + '</span>';
    cell.addEventListener('click', () => { if (!paused && !dialog.visible) { selected = i; render(); } });
    $('board').appendChild(cell); cells.push(cell);
  }
  for (let n = 1; n <= 9; n++) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.setAttribute('aria-label', '填入数字 ' + n);
    b.addEventListener('click', () => enter(n)); $('digits').appendChild(b); digits.push(b);
  }
  function tick() {
    const now = Date.now();
    if (active && !paused && !dialog.visible && !document.hidden && last) session.addTime(now - last);
    last = now;
  }
  function render() {
    if (!session) return;
    const s = session.state, locked = paused || s.status === 'won';
    E.cells(s, selected).forEach((item, i) => {
      const cell = cells[i];
      cell.className = 'sudoku-cell' + ['given', 'selected', 'related', 'same', 'conflict', 'right', 'bottom'].filter((key) => item[key]).map((key) => ' is-' + key).join('');
      cell.querySelector('.sudoku-value').textContent = item.value;
      cell.querySelectorAll('.sudoku-notes span').forEach((span, j) => { span.textContent = item.notes[j]; });
      cell.disabled = paused; cell.tabIndex = i === selected ? 0 : -1;
      cell.setAttribute('aria-pressed', String(i === selected));
      cell.setAttribute('aria-label', `第 ${Math.floor(i / 9) + 1} 行第 ${i % 9 + 1} 列，${item.value || '空格'}${item.given ? '，题目数字' : ''}${item.conflict ? '，存在冲突' : ''}${!item.value && s.notes[i] ? '，笔记 ' + item.notes.filter(Boolean).join(' ') : ''}`);
      cell.setAttribute('aria-invalid', String(item.conflict));
    });
    $('time').textContent = E.timeLabel(s.elapsedMs); $('filled').textContent = s.board.filter(Boolean).length + ' / 81'; $('hints').textContent = s.hints;
    $('difficulty').value = s.difficulty; $('pause').textContent = paused ? '继续游戏' : '暂停';
    $('cover').hidden = !paused; $('pause').disabled = s.status === 'won';
    $('pencil').setAttribute('aria-pressed', String(pencil)); $('pencil').textContent = pencil ? '笔记：开' : '笔记：关';
    ['pencil', 'erase', 'hint', 'check'].forEach((id) => { $(id).disabled = locked; });
    digits.forEach((b) => { b.disabled = locked; }); $('undo').disabled = locked || !session.history.length;
    if (s.status === 'won') $('status').textContent = `完成！用时 ${E.timeLabel(s.elapsedMs)}，使用 ${s.hints} 次提示。可以换一题继续挑战。`;
  }
  function enter(n) {
    if (!active || paused || dialog.visible || document.hidden) return;
    tick();
    if (session.move(selected, n, pencil)) {
      $('status').textContent = E.conflicts(session.state.board).some(Boolean) ? '标红数字在同一行、列或宫中重复，请检查' : '每行、每列、每个九宫格填入 1–9，不重复';
    } else if (session.state.givens[selected]) $('status').textContent = '这是题目数字，请选择一个空格';
    render();
  }
  function newGame(difficulty) {
    session.restart(difficulty); selected = session.state.board.findIndex((v) => !v); pencil = false; paused = false; last = Date.now();
    $('status').textContent = '新题准备好了，从一个空格开始吧'; render(); cells[selected].focus({ preventScroll: true });
  }
  function confirmNew(difficulty) {
    tick(); dialog.open('换一道新题？', '当前题目会被替换，新题保证只有一个解。', '开始新题', () => newGame(difficulty)); render();
  }
  function pause() { if (!active) return; tick(); paused = session.state.status === 'playing'; session.save(); render(); }
  $('home').addEventListener('click', () => navigate('lobby'));
  $('new').addEventListener('click', () => confirmNew(session.state.difficulty));
  $('difficulty').addEventListener('change', (e) => confirmNew(e.target.value));
  $('pause').addEventListener('click', () => { tick(); paused = !paused; last = Date.now(); render(); });
  $('pencil').addEventListener('click', () => { pencil = !pencil; render(); });
  $('erase').addEventListener('click', () => enter(0));
  $('undo').addEventListener('click', () => { tick(); if (session.undo()) $('status').textContent = '已撤销上一步'; render(); });
  $('hint').addEventListener('click', () => { tick(); const i = session.hint(selected); if (i >= 0) { selected = i; $('status').textContent = '已填入一个正确数字；提示次数已记录'; } render(); });
  $('check').addEventListener('click', () => {
    const s = session.state, wrong = s.board.filter((n, i) => n && n !== s.solution[i]).length;
    $('status').textContent = wrong ? `已填数字中有 ${wrong} 处错误，再检查一下吧` : '目前已填的数字都正确，继续加油';
  });
  $('rules').addEventListener('click', () => { tick(); dialog.open('数独 · 玩法', '在空格中填入 1–9，使每行、每列和每个 3×3 九宫格都不重复。深色数字是固定题目。\n点击格子后使用下方数字键或键盘输入；方向键移动，Delete / Backspace 清空，N 切换笔记。\n笔记记录候选数；撤销可恢复本次打开期间的操作。检查核对已填数字，提示填入一个正确数字。\n难度按留白数量区分，每题保证唯一解；进度自动保存在本机，暂停及离开页面不计时。', '明白了', null, false); });
  $('board').addEventListener('keydown', (e) => {
    if (!active || paused || dialog.visible || e.altKey || e.ctrlKey || e.metaKey) return;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 };
    if (e.key in offsets) { e.preventDefault(); selected = Math.max(0, Math.min(80, selected + offsets[e.key])); render(); cells[selected].focus(); }
    else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); enter(Number(e.key)); }
    else if (['Backspace', 'Delete', '0'].includes(e.key)) { e.preventDefault(); enter(0); }
    else if (e.key.toLowerCase() === 'n') { e.preventDefault(); pencil = !pencil; render(); }
  });
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', pause);
  return {
    open() {
      if (!session) { session = new window.GameCore.SudokuSession(storage); selected = session.state.board.findIndex((v) => !v); if (selected < 0) selected = 0; }
      active = true; last = Date.now(); session.save(); render();
      timer = setInterval(() => { tick(); $('time').textContent = E.timeLabel(session.state.elapsedMs); session.save(); }, 1000);
    },
    close() { if (!active) return; pause(); active = false; clearInterval(timer); timer = null; dialog.close(); }
  };
};
