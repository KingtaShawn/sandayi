'use strict';
(function (root) {
  // Convert client coordinates into an element's unrotated local coordinate system.
  function toLocal(point, box, width, height, matrix) {
    const m = matrix || {a:1,b:0,c:0,d:1};
    const xs = [0, m.a*width, m.c*height, m.a*width+m.c*height];
    const ys = [0, m.b*width, m.d*height, m.b*width+m.d*height];
    const x = point.x - box.left + Math.min(...xs), y = point.y - box.top + Math.min(...ys);
    const det = m.a*m.d-m.b*m.c;
    if (!det) return null;
    return {x:(m.d*x-m.c*y)/det,y:(-m.b*x+m.a*y)/det};
  }
  function matrixFromCss(value) {
    if (!value || value === 'none') return {a:1,b:0,c:0,d:1};
    const match = /^matrix(3d)?\(([^)]+)\)$/.exec(value.trim());
    if (!match) return null;
    const n = match[2].split(',').map(Number);
    if (n.some(v => !Number.isFinite(v))) return null;
    if (match[1] && n.length === 16) return {a:n[0],b:n[1],c:n[4],d:n[5]};
    if (!match[1] && n.length === 6) return {a:n[0],b:n[1],c:n[2],d:n[3]};
    return null;
  }
  function center(rect) { return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}; }
  function between(from, to) { return {x:to.x-from.x,y:to.y-from.y}; }
  // Each card lands before the next leaves the dealer; allow time for the last landing.
  const DEAL_STEP = 460;
  function dealDuration(count) { return Math.max(500, count * DEAL_STEP + 200); }
  // Seat coordinates skip players who were not dealt a hand and deal from left of button.
  function dealOrder(players, dealer) {
    const seats=[]; if(dealer<0) return seats;
    const live=players.filter(p=>p.hole && p.hole.length).length;
    for(let k=0;k<players.length;k++){
      const i=(dealer+(live===2?0:1)+k)%players.length;
      if(players[i].hole && players[i].hole.length) seats.push(i);
    }
    return seats;
  }
  const api={toLocal,matrixFromCss,center,between,dealOrder,DEAL_STEP,dealDuration};
  if(typeof module!=='undefined') module.exports=api; else root.PokerMotion=api;
})(typeof window!=='undefined'?window:globalThis);
