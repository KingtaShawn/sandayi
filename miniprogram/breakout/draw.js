'use strict';
const E = require('./engine');
const COLORS = ['#f2b88b', '#efd08c', '#9fceb3', '#9cc8df', '#c5b2e3'];
// Shared Canvas 2D renderer for browsers and the WeChat canvas node.
function draw(ctx, s) {
  ctx.clearRect(0, 0, E.WIDTH, E.HEIGHT);
  ctx.fillStyle = '#132e33'; ctx.fillRect(0, 0, E.WIDTH, E.HEIGHT);
  ctx.fillStyle = '#ffffff08';
  for (let x = 18; x < E.WIDTH; x += 24) for (let y = 18; y < E.HEIGHT; y += 24) ctx.fillRect(x, y, 2, 2);
  for (const brick of s.bricks) {
    if (!brick.hp) continue;
    ctx.fillStyle = COLORS[brick.color]; ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
    ctx.fillStyle = '#ffffff45'; ctx.fillRect(brick.x, brick.y, brick.w, 3);
    if (brick.hp > 1) { ctx.fillStyle = '#193a41'; ctx.fillRect(brick.x + 15, brick.y + 7, 8, 4); }
  }
  ctx.fillStyle = '#9fceb3'; ctx.fillRect(s.paddle - E.PADDLE_WIDTH / 2, E.PADDLE_Y, E.PADDLE_WIDTH, 10);
  ctx.fillStyle = '#eef8d5'; ctx.fillRect(s.paddle - E.PADDLE_WIDTH / 2, E.PADDLE_Y, E.PADDLE_WIDTH, 3);
  ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, E.RADIUS, 0, Math.PI * 2); ctx.fillStyle = '#fff7da'; ctx.fill();
  if (s.status !== 'playing' || s.paused) {
    ctx.fillStyle = '#132e33b8'; ctx.fillRect(0, 210, E.WIDTH, 80);
    ctx.fillStyle = '#fff1cb'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(s.paused ? '已暂停' : s.status === 'ready' ? '准备好了吗？' : s.status === 'won' ? '漂亮，全部击破！' : '再试一次吧', E.WIDTH / 2, 246);
    ctx.font = '13px sans-serif'; ctx.fillText(E.actionLabel(s), E.WIDTH / 2, 272);
  }
}
module.exports = { draw };
