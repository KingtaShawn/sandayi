'use strict';
const WIDTH = 360, HEIGHT = 480, RADIUS = 7, PADDLE_Y = 440, PADDLE_WIDTH = 76, LEVELS = 6;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function bricksFor(level) {
  const bricks = [];
  for (let row = 0; row < Math.min(3 + level, 7); row++) for (let col = 0; col < 8; col++) {
    bricks.push({ x: 12 + col * 42, y: 48 + row * 25, w: 38, h: 18, hp: level >= 4 && row % 2 === 0 ? 2 : 1, color: row % 5 });
  }
  return bricks;
}
function dock(s) { s.ball = { x: s.paddle, y: PADDLE_Y - RADIUS - 1, vx: 0, vy: 0 }; }
function createGame() {
  const s = { level: 1, score: 0, lives: 3, paddle: WIDTH / 2, bricks: bricksFor(1), status: 'ready', paused: false };
  dock(s); return s;
}
function movePaddle(s, x) {
  if (!Number.isFinite(x) || s.paused || !['ready', 'playing'].includes(s.status)) return;
  s.paddle = clamp(x, PADDLE_WIDTH / 2, WIDTH - PADDLE_WIDTH / 2);
  if (s.status === 'ready') dock(s);
}
function launch(s) {
  if (s.status !== 'ready' || s.paused) return false;
  const speed = 270 + s.level * 24;
  s.ball.vx = speed * .35; s.ball.vy = -speed * Math.sqrt(1 - .35 * .35); s.status = 'playing'; return true;
}
function next(s) {
  if (s.status !== 'won' || s.level >= LEVELS) return false;
  s.level++; s.bricks = bricksFor(s.level); s.status = 'ready'; s.paused = false; dock(s); return true;
}
function pause(s) { if (s.status === 'playing') s.paused = true; }
function resume(s) { s.paused = false; }
// Substeps keep travel below the radius, including at the maximum speed.
function step(s, seconds) {
  if (s.status !== 'playing' || s.paused || !Number.isFinite(seconds) || seconds <= 0) return;
  const dt = Math.min(seconds, .05), steps = Math.ceil(dt * 240), delta = dt / steps;
  for (let n = 0; n < steps && s.status === 'playing'; n++) {
    const b = s.ball, previousY = b.y;
    b.x += b.vx * delta; b.y += b.vy * delta;
    if (b.x < RADIUS) { b.x = RADIUS; b.vx = Math.abs(b.vx); }
    if (b.x > WIDTH - RADIUS) { b.x = WIDTH - RADIUS; b.vx = -Math.abs(b.vx); }
    if (b.y < RADIUS) { b.y = RADIUS; b.vy = Math.abs(b.vy); }
    if (b.vy > 0 && previousY + RADIUS <= PADDLE_Y && b.y + RADIUS >= PADDLE_Y && Math.abs(b.x - s.paddle) <= PADDLE_WIDTH / 2 + RADIUS) {
      const speed = Math.hypot(b.vx, b.vy), angle = clamp((b.x - s.paddle) / (PADDLE_WIDTH / 2), -.95, .95) * Math.PI / 3;
      b.vx = speed * Math.sin(angle); b.vy = -speed * Math.cos(angle); b.y = PADDLE_Y - RADIUS;
    }
    for (const brick of s.bricks) {
      if (!brick.hp) continue;
      const nearX = clamp(b.x, brick.x, brick.x + brick.w), nearY = clamp(b.y, brick.y, brick.y + brick.h);
      const dx = b.x - nearX, dy = b.y - nearY, distance = Math.hypot(dx, dy);
      if (distance > RADIUS) continue;
      if (distance > 0) {
        const nx = dx / distance, ny = dy / distance, dot = b.vx * nx + b.vy * ny;
        if (dot >= 0) continue;
        b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
        b.x = nearX + nx * (RADIUS + .01); b.y = nearY + ny * (RADIUS + .01);
      } else { b.vy *= -1; b.y = previousY; }
      // Avoid an almost horizontal trajectory after a corner bounce.
      const speed = Math.hypot(b.vx, b.vy);
      if (Math.abs(b.vy) < speed * .25) { b.vy = (b.vy < 0 ? -1 : 1) * speed * .25; b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(speed * speed - b.vy * b.vy); }
      brick.hp--; s.score += 10;
      if (s.bricks.every((v) => v.hp === 0)) s.status = 'won';
      break;
    }
    if (s.status === 'playing' && b.y - RADIUS > HEIGHT) {
      s.lives--; s.status = s.lives ? 'ready' : 'lost'; s.paused = false; dock(s);
    }
  }
}
function message(s) {
  if (s.status === 'won') return s.level === LEVELS ? '六关全部完成！再来挑战最高分吧' : '本关完成！点击下一关继续';
  if (s.status === 'lost') return '本局结束，重新挑战吧';
  if (s.paused) return '已暂停，点击继续游戏';
  return s.status === 'ready' ? '移动挡板，点击发球开始' : '接住小球，清空所有砖块';
}
function actionLabel(s) { return s.status === 'won' ? (s.level < LEVELS ? '下一关' : '再来一局') : s.status === 'lost' ? '再来一局' : s.status === 'ready' ? '发球' : s.paused ? '继续游戏' : '暂停'; }
module.exports = { WIDTH, HEIGHT, RADIUS, PADDLE_Y, PADDLE_WIDTH, LEVELS, createGame, movePaddle, launch, next, pause, resume, step, message, actionLabel };
