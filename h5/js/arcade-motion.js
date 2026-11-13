'use strict';

// Each surface owns its animations. Leaving cancels both movement and particles.
window.createArcadeMotion = function (board, cells, size) {
  const running = new Map();
  const particles = new Set();
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animate(node, frames, options) {
    if (reduced() || typeof node.animate !== 'function') return;
    const animation = node.animate(frames, options);
    running.set(animation, node);
    animation.finished.catch(() => {}).finally(() => { if (options.fill !== 'forwards') running.delete(animation); });
    return animation;
  }
  function pitch() {
    return { x: cells[1].getBoundingClientRect().left - cells[0].getBoundingClientRect().left,
      y: cells[size].getBoundingClientRect().top - cells[0].getBoundingClientRect().top };
  }
  return {
    swap(a, b) {
      const p = pitch();
      const dx = (b % size - a % size) * p.x, dy = (Math.floor(b / size) - Math.floor(a / size)) * p.y;
      [[a, dx, dy], [b, -dx, -dy]].forEach(([i, x, y]) => animate(cells[i], [
        { transform: 'translate(0,0)', zIndex: 2 }, { transform: `translate(${x}px,${y}px)`, zIndex: 2 }
      ], { duration: 180, easing: 'cubic-bezier(.3,.05,.25,1)', fill: 'forwards' }));
    },
    fall(sources) {
      const p = pitch();
      sources.forEach((from, to) => {
        if (from === null || from === to) return;
        const col = ((from % size) + size) % size;
        const dx = (col - to % size) * p.x;
        const dy = (Math.floor(from / size) - Math.floor(to / size)) * p.y;
        animate(cells[to], [
          { transform: `translate(${dx}px,${dy}px)`, opacity: from < 0 ? 0 : 1 },
          ...(dx ? [{ transform: `translate(${dx}px,0px)`, opacity: 1, offset: .62 }] : []),
          { transform: 'translate(0,3px)', opacity: 1, offset: .9 },
          { transform: 'translate(0,0)', opacity: 1 }
        ], { duration: 300 + Math.min(120, Math.abs(Math.floor(from / size) - Math.floor(to / size)) * 18), easing: 'cubic-bezier(.3,.05,.65,1)' });
      });
    },
    burst(indices, text) {
      if (reduced()) return;
      const base = board.getBoundingClientRect();
      function spark(i, label, x, y, score) {
        const rect = cells[i].getBoundingClientRect();
        const node = document.createElement('span');
        node.className = score ? 'arcade-float' : 'arcade-spark'; node.textContent = label;
        node.style.left = `${rect.left - base.left + rect.width / 2}px`;
        node.style.top = `${score ? Math.max(55, rect.top - base.top + rect.height / 2) : rect.top - base.top + rect.height / 2}px`;
        board.appendChild(node); particles.add(node);
        const animation = animate(node, [{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 1 },
          { transform: `translate(calc(-50% + ${x}px),calc(-50% + ${y}px)) scale(${score ? 1.12 : .2})`, opacity: 0 }],
        { duration: score ? 800 : 450, easing: 'ease-out', fill: 'forwards' });
        setTimeout(() => { if (animation) { animation.cancel(); running.delete(animation); } node.remove(); particles.delete(node); }, 850);
      }
      indices.slice(0, 24).forEach((i) => { spark(i, '✦', -16, -24, false); spark(i, '·', 18, -14, false); });
      spark(indices[Math.floor(indices.length / 2)], text, 0, -48, true);
    },
    clearMoves() { running.forEach((node, a) => { if (cells.includes(node)) { a.cancel(); running.delete(a); } }); },
    cancel() { running.forEach((node, a) => a.cancel()); running.clear(); particles.forEach((node) => node.remove()); particles.clear(); }
  };
};
