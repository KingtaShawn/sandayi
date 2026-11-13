'use strict';

window.createMatch3UI = function ({ navigate, storage }) {
  const E = window.GameCore.Match3;
  const session = new window.GameCore.Match3Session(storage);
  const $ = (id) => document.getElementById(id);
  const board = $('match-board');
  let selected = null;
  let busy = false;
  let active = false;
  let generation = 0;
  let pointer = null;
  let suppressClick = false;
  let lastFocus = null;
  let primaryAction = null;
  let secondaryAction = null;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms));
  const cells = Array.from({ length: 64 }, (_, i) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.dataset.index = i;
    board.appendChild(cell);
    return cell;
  });
  const motion = window.createArcadeMotion(board, cells, 8);

  function renderBoard(values, options = {}) {
    cells.forEach((cell, i) => {
      cell.className = 'fruit' + (selected === i ? ' fruit--selected' : '')
        + (options.matched && options.matched.includes(i) ? ' fruit--pop' : '')
        + (options.drop ? ' fruit--drop' : '')
        + (options.invalid && options.invalid.includes(i) ? ' fruit--invalid' : '');
      cell.dataset.fruit = values[i];
      cell.textContent = E.FRUITS[values[i]];
      cell.setAttribute('aria-label', `第 ${Math.floor(i / 8) + 1} 行第 ${i % 8 + 1} 列，${E.NAMES[values[i]]}`);
      cell.setAttribute('aria-pressed', String(selected === i));
      cell.setAttribute('aria-disabled', String(busy || session.state.status !== 'playing'));
    });
  }

  function renderStats(score = session.state.score) {
    const s = session.state;
    const config = E.LEVELS[s.level - 1];
    $('match-level').textContent = `第 ${s.level} / ${E.LEVELS.length} 关`;
    $('match-score').textContent = score;
    $('match-moves').textContent = s.moves;
    $('match-moves').parentElement.classList.toggle('match-moves--low', s.moves <= 5);
    $('match-target').textContent = config.target;
    $('match-progress').max = config.target;
    $('match-progress').value = Math.min(score, config.target);
    $('match-percent').textContent = Math.min(100, Math.floor(score / config.target * 100)) + '%';
    $('match-best').textContent = session.best[s.level] || 0;
    $('btn-match-hint').disabled = busy || s.status !== 'playing';
    $('btn-match-restart').disabled = busy;
    board.setAttribute('aria-busy', String(busy));
    $('lobby-match-progress').textContent = `第 ${s.level} 关 · ${s.status === 'playing' ? '继续采摘' : s.status === 'won' ? '已通关' : '再来挑战'}`;
  }

  function closeDialog() {
    $('match-dialog').hidden = true;
    if (lastFocus && lastFocus.isConnected && active) lastFocus.focus({ preventScroll: true });
  }

  function dialog(title, body, icon, primary, secondary) {
    lastFocus = document.activeElement;
    $('match-dialog-title').textContent = title;
    $('match-dialog-body').textContent = body;
    $('match-dialog-icon').textContent = icon;
    $('match-dialog-primary').textContent = primary.label;
    $('match-dialog-secondary').textContent = secondary.label;
    primaryAction = primary.action;
    secondaryAction = secondary.action;
    $('match-dialog').hidden = false;
    $('match-dialog-primary').focus({ preventScroll: true });
  }

  function restart() {
    closeDialog();
    session.restart();
    selected = null;
    renderBoard(session.state.board);
    renderStats();
    $('match-status').textContent = '新的一盘，试试看能消出几次连锁';
  }

  function resultDialog() {
    const s = session.state;
    if (s.status === 'playing' || !active) return;
    const won = s.status === 'won';
    const last = s.level === E.LEVELS.length;
    dialog(won ? (last ? '果园全部通关！' : '这一关，收获满满！') : '再试一次，就差一点',
      `第 ${s.level} 关 · ${s.score} 分 / 目标 ${E.LEVELS[s.level - 1].target} 分\n${won ? `还剩 ${s.moves} 步，漂亮的收获。` : '多观察能引发连锁的位置，再来一盘吧。'}`,
      won ? '🌻' : '🌱',
      { label: won && !last ? '下一关 →' : '再玩本关', action: () => {
        if (won && !last) {
          session.next(); selected = null; renderBoard(session.state.board); renderStats();
          $('match-status').textContent = '新关卡，新的小挑战';
        } else restart();
      } },
      { label: '回游戏大厅', action: () => navigate('lobby') });
  }

  async function exchange(a, b) {
    if (!active || busy || !$('match-dialog').hidden || session.state.status !== 'playing') return;
    const original = session.state.board.slice();
    const result = session.move(a, b); // Persist the stable outcome before animation, including page close/reload.
    selected = null;
    busy = true;
    const run = ++generation;
    const valid = () => active && run === generation;
    const swapped = original.slice();
    [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
    renderStats(result.accepted ? result.frames[0].score - result.frames[0].gained : session.state.score);
    renderBoard(original);
    motion.swap(a, b);
    await delay(180);
    if (!valid()) return;
    motion.clearMoves();
    renderBoard(swapped);
    if (!result.accepted) {
      motion.swap(a, b);
      await delay(180);
      if (!valid()) return;
      motion.clearMoves();
      renderBoard(original, { invalid: [a, b] });
      $('match-status').textContent = '这次没有连成三个，不扣步数哦';
      await delay(260);
      if (!valid()) return;
    } else {
      for (const frame of result.frames) {
        motion.burst(frame.matched, `${frame.combo > 1 ? frame.combo + ' 连消 ' : ''}+${frame.gained}`);
        renderBoard(frame.board, { matched: frame.matched });
        renderStats(frame.score);
        $('match-status').textContent = frame.combo > 1
          ? `${frame.combo} 连消！ +${frame.gained} 分` : `消除 ${frame.matched.length} 枚水果，+${frame.gained} 分`;
        await delay(200);
        if (!valid()) return;
        renderBoard(frame.after);
        motion.fall(frame.sources);
        await delay(430);
        if (!valid()) return;
      }
      if (result.reshuffled) $('match-status').textContent = '没有可用交换，已自动整理果园，不扣步数';
    }
    busy = false;
    renderBoard(session.state.board);
    renderStats();
    resultDialog();
  }

  function select(i) {
    if (!active || busy || session.state.status !== 'playing' || !$('match-dialog').hidden) return;
    if (selected === i) selected = null;
    else if (selected !== null && E.adjacent(selected, i)) { void exchange(selected, i); return; }
    else selected = i;
    renderBoard(session.state.board);
  }

  board.addEventListener('click', (event) => {
    if (suppressClick) { suppressClick = false; return; }
    const cell = event.target.closest('[data-index]');
    if (cell) select(Number(cell.dataset.index));
  });
  board.addEventListener('pointerdown', (event) => {
    suppressClick = false;
    const cell = event.target.closest('[data-index]');
    if (cell && !busy && event.isPrimary !== false) {
      pointer = { id: event.pointerId, index: Number(cell.dataset.index), x: event.clientX, y: event.clientY };
      board.setPointerCapture(event.pointerId);
    }
  });
  board.addEventListener('pointerup', (event) => {
    const start = pointer;
    pointer = null;
    if (!start || start.id !== event.pointerId) return;
    // Release capture so a tap's synthesized click targets the fruit, not the board.
    if (board.hasPointerCapture(event.pointerId)) board.releasePointerCapture(event.pointerId);
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) {
      suppressClick = true;
      select(start.index);
      return;
    }
    suppressClick = true;
    const b = start.index + (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : -1) : (dy > 0 ? 8 : -8));
    if (E.adjacent(start.index, b)) void exchange(start.index, b);
  });
  board.addEventListener('pointercancel', () => { pointer = null; });
  board.addEventListener('keydown', (event) => {
    const cell = event.target.closest('[data-index]');
    if (!cell) return;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
    const i = Number(cell.dataset.index), next = i + offsets[event.key];
    if (event.key in offsets) {
      event.preventDefault();
      if (E.adjacent(i, next)) cells[next].focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      suppressClick = false;
    }
  });

  $('btn-match-home').addEventListener('click', () => navigate('lobby'));
  $('btn-match-hint').addEventListener('click', () => {
    if (busy || session.state.status !== 'playing') return;
    selected = null;
    renderBoard(session.state.board);
    const hint = E.findMove(session.state.board);
    if (hint) hint.forEach((i) => cells[i].classList.add('fruit--hint'));
    $('match-status').textContent = '交换这两枚亮起的水果试试，不扣步数';
  });
  $('btn-match-restart').addEventListener('click', () => {
    if (busy) return;
    dialog('重新开始这一关？', '本关分数和步数将重置。\n已解锁关卡与最佳分数会保留。', '↻',
      { label: '重新开始', action: restart }, { label: '继续这一盘', action() {} });
  });
  $('btn-match-rules').addEventListener('click', () => {
    if (busy) return;
    dialog('果园里的小规则', '点击两枚相邻水果，或滑动交换。\n横向或纵向连成 3 枚及以上就消除。\n每枚 10 分，连锁倍率逐次增加，最高 5 倍。\n无效交换不扣步数；连锁不额外扣步数。\n步数用完前达到目标即通关，死盘自动洗牌。\n共 12 关，进度仅保存在当前设备。', '🍎',
      { label: '明白了，开始采摘', action: resultDialog }, { label: '回游戏大厅', action: () => navigate('lobby') });
  });
  $('match-dialog-primary').addEventListener('click', () => { const action = primaryAction; closeDialog(); if (action) action(); });
  $('match-dialog-secondary').addEventListener('click', () => { const action = secondaryAction; closeDialog(); if (action) action(); });
  $('match-dialog').addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      (document.activeElement === $('match-dialog-primary') ? $('match-dialog-secondary') : $('match-dialog-primary')).focus();
    }
    if (event.key === 'Escape') {
      closeDialog();
      resultDialog();
    }
  });

  renderStats();
  return {
    open() { active = true; selected = null; busy = false; renderBoard(session.state.board); renderStats(); resultDialog(); },
    close() { active = false; generation++; motion.cancel(); busy = false; selected = null; pointer = null; closeDialog(); renderStats(); }
  };
};
