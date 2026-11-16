'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../miniprogram/breakout/engine');
const { BreakoutSession, KEY } = require('../miniprogram/breakout/session');
test('弹球：发球前跟随挡板，限制边界，发球后暂停和恢复', () => {
  const s = E.createGame(); E.movePaddle(s, -10); assert.equal(s.paddle, E.PADDLE_WIDTH / 2); assert.equal(s.ball.x, s.paddle);
  E.movePaddle(s, 999); assert.equal(s.paddle, E.WIDTH - E.PADDLE_WIDTH / 2);
  assert.ok(E.launch(s)); assert.equal(E.launch(s), false);
  E.pause(s); const before = structuredClone(s); E.step(s, .05); E.movePaddle(s, 50); assert.deepEqual(s, before);
  E.resume(s); E.step(s, .05); assert.ok(s.ball.y < before.ball.y);
});
test('弹球：左右和上墙反弹，挡板边缘改变方向', () => {
  for (const [ball, axis, sign] of [[{ x: 8, y: 220, vx: -300, vy: 30 }, 'vx', 1], [{ x: 352, y: 220, vx: 300, vy: 30 }, 'vx', -1], [{ x: 180, y: 8, vx: 30, vy: -300 }, 'vy', 1]]) {
    const s = E.createGame(); E.launch(s); s.ball = ball; E.step(s, .02); assert.ok(s.ball[axis] * sign > 0);
  }
  for (const offset of [-30, 0, 30]) {
    const s = E.createGame(); E.launch(s); s.ball = { x: s.paddle + offset, y: E.PADDLE_Y - E.RADIUS - 2, vx: 0, vy: 400 }; E.step(s, .02);
    assert.ok(s.ball.vy < 0); assert.equal(Math.sign(s.ball.vx), Math.sign(offset));
  }
});
test('弹球：高速砖块碰撞不穿透，多次击打、得分与清关', () => {
  const s = E.createGame(); E.launch(s); s.bricks = [{ x: 100, y: 80, w: 38, h: 18, hp: 2, color: 0 }];
  for (let hit = 0; hit < 2; hit++) {
    s.ball = { x: 119, y: 110, vx: 0, vy: -450 }; E.step(s, .05);
    assert.equal(s.bricks[0].hp, 1 - hit); assert.equal(s.score, (hit + 1) * 10); assert.ok(s.ball.vy > 0);
  }
  assert.equal(s.status, 'won'); assert.ok(E.next(s)); assert.equal(s.level, 2); assert.equal(s.score, 20); assert.equal(s.lives, 3); assert.equal(s.status, 'ready');
  s.level = E.LEVELS; s.status = 'won'; assert.equal(E.next(s), false);
});
test('弹球：漏接只扣一次生命，三次掉球结束，不在暂停时掉球', () => {
  const s = E.createGame();
  for (let lives = 2; lives >= 0; lives--) {
    E.launch(s); s.ball = { x: 10, y: E.HEIGHT + E.RADIUS - 1, vx: 0, vy: 300 }; E.step(s, .05);
    assert.equal(s.lives, lives); assert.equal(s.status, lives ? 'ready' : 'lost');
    E.step(s, .05); assert.equal(s.lives, lives);
  }
  assert.equal(E.launch(s), false);
});
test('弹球：长帧限幅、不同帧率近似一致，最高分持久化且不影响其他游戏', () => {
  const a = E.createGame(), b = E.createGame(); E.launch(a); E.launch(b);
  for (let i = 0; i < 60; i++) E.step(a, 1 / 60);
  for (let i = 0; i < 30; i++) E.step(b, 1 / 30);
  assert.ok(Math.abs(a.ball.x - b.ball.x) < 1); assert.ok(Math.abs(a.ball.y - b.ball.y) < 1);
  const c = E.createGame(); E.launch(c); E.step(c, 100); assert.equal(c.lives, 3);
  const values = new Map([['sudoku:progress:v1', { sentinel: true }]]), storage = { get: (k) => values.get(k), set: (k, v) => values.set(k, v) };
  const session = new BreakoutSession(storage); session.state.score = 120; session.save(); session.restart();
  assert.equal(session.best, 120); assert.equal(session.state.score, 0); assert.equal(new BreakoutSession(storage).best, 120);
  assert.deepEqual(values.get('sudoku:progress:v1'), { sentinel: true }); assert.equal(values.get(KEY).best, 120);
});
