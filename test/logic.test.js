'use strict';
// 문 패트롤 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const fresh = (level = 1, seed = 5) => L.newGame(L.rng(seed), level);
// 비어 있는 판: 코스의 물건 없음
function blank(level = 1) {
  const st = fresh(level);
  st.course = []; st.next = 0; st.obst = [];
  return st;
}
const run = (st, secs, input = {}) => { for (let i = 0; i < Math.round(secs / 0.01); i++) L.step(st, 0.01, input); };
const evs = (st, t) => st.events.filter((e) => e.t === t);
const allEvents = (st, secs, input = {}) => { const out = []; for (let i = 0; i < Math.round(secs / 0.01); i++) { L.step(st, 0.01, input); out.push(...st.events); } return out; };
const obst = (st, kind, x, extra = {}) => { const k = L.KINDS[kind]; const o = { kind, x, w: k.w, h: k.h, hp: k.hp || 0, passed: false, fireT: 1, bomb: false, ...extra }; st.obst.push(o); return o; };

test('course: 26 signs A to Z in order, major checkpoints E J O T Z', () => {
  const c = L.makeCourse(1, L.rng(1));
  const signs = c.filter((i) => i.kind === 'sign');
  assert.strictEqual(signs.length, 26);
  assert.deepStrictEqual(signs.map((s) => s.letter), [...Array(26).keys()]);
  assert.deepStrictEqual(L.MAJOR, [4, 9, 14, 19, 25]);
  for (let i = 1; i < c.length; i++) assert.ok(c[i].at >= c[i - 1].at, 'sorted');
});

test('course: ground obstacles are spaced so every jump is possible', () => {
  for (let seed = 1; seed <= 12; seed++) for (const level of [1, 2, 5]) {
    const g = L.makeCourse(level, L.rng(seed)).filter((i) => i.kind !== 'sign' && i.kind !== 'wave');
    for (let i = 1; i < g.length; i++) {
      const prev = L.KINDS[g[i - 1].kind], gap = g[i].at - (g[i - 1].at + prev.w);
      assert.ok(gap >= 70, `gap ${gap} between ${g[i - 1].kind} and ${g[i].kind}`);
    }
  }
});

test('course: harder stages bring bigger obstacles, mines and tanks', () => {
  const c = L.makeCourse(1, L.rng(3));
  const kinds = (a, b) => new Set(c.filter((i) => i.at >= a * L.SEG && i.at < b * L.SEG).map((i) => i.kind));
  assert.ok(!kinds(0, 5).has('tank') && !kinds(0, 5).has('mine') && !kinds(0, 5).has('rock2') && !kinds(0, 5).has('crater2'));
  const late = kinds(15, 26);
  assert.ok(late.has('tank') || late.has('mine'));
  const count = (a, b) => c.filter((i) => i.at >= a * L.SEG && i.at < b * L.SEG && !['sign', 'wave'].includes(i.kind)).length;
  assert.ok(count(20, 26) / 6 > count(0, 5) / 5, 'denser later');
});

test('speed control: slow, normal and fast with easing, scrolling the world', () => {
  const st = blank();
  run(st, 2, { speed: 1 });
  assert.ok(Math.abs(st.buggy.mult - 1.35) < 0.01);
  const d0 = st.dist; run(st, 1, { speed: 1 });
  assert.ok(Math.abs((st.dist - d0) - L.BASE * 1.35) < 2);
  run(st, 3, { speed: -1 });
  assert.ok(Math.abs(st.buggy.mult - 0.65) < 0.01);
  run(st, 2, { speed: 0 });
  assert.ok(Math.abs(st.buggy.mult - 1) < 0.01);
});

test('a jump reaches 50 pixels, lasts 0.9 seconds, and cannot be repeated in the air', () => {
  const st = blank();
  L.step(st, 0.01, { jump: true });
  assert.ok(evs(st, 'jump').length === 1);
  let max = 0, t = 0;
  while (st.buggy.air > 0 && t < 2) { L.step(st, 0.01, { jump: true }); max = Math.max(max, st.buggy.y); t += 0.01; }
  assert.ok(Math.abs(max - L.JUMP_H) < 1.5, 'height ' + max);
  assert.ok(Math.abs(t - 0.9) < 0.05, 'duration ' + t);
  const st2 = blank(); L.step(st2, 0.01, { jump: true }); let jumps = 0;
  for (let i = 0; i < 70; i++) { L.step(st2, 0.01, { jump: true }); jumps += evs(st2, 'jump').length; }
  assert.strictEqual(jumps, 0, 'no double jump');
});

test('falling into a crater costs a buggy, jumping over it does not', () => {
  const st = blank();
  obst(st, 'crater2', L.BUGGY_X - 4);
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'dying'); assert.strictEqual(evs(st, 'dead')[0].why, 'crater');
  const s2 = blank(); obst(s2, 'crater2', L.BUGGY_X + 60);
  const ev = [];
  for (let i = 0; i < 700; i++) { const o = s2.obst[0]; const d = o && (o.x - L.BUGGY_X) < 30 && (o.x - L.BUGGY_X) > 20; L.step(s2, 0.01, { jump: !!d }); ev.push(...s2.events); }
  assert.strictEqual(s2.phase, 'play');
  assert.ok(ev.some((e) => e.t === 'cleared'));
});

test('crater edges are safe: only the middle of the buggy counts', () => {
  const st = blank(); obst(st, 'crater', L.BUGGY_X + 8);
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'play');
});

test('rocks and mines destroy the buggy on the ground but not when jumped', () => {
  for (const kind of ['rock', 'rock2', 'mine']) {
    const st = blank(); obst(st, kind, L.BUGGY_X);
    L.step(st, 0.01, {});
    assert.strictEqual(st.phase, 'dying', kind);
    assert.strictEqual(evs(st, 'dead')[0].why, kind);
  }
  const st = blank(); st.buggy.y = 30; st.buggy.air = 0.4; obst(st, 'rock2', L.BUGGY_X);
  L.step(st, 0.001, {});
  assert.strictEqual(st.phase, 'play', 'flying over a big rock');
});

test('the forward cannon: small rock 1 hit, big rock 3 hits, tank 1 hit, mines and craters cannot be shot', () => {
  const st = blank(); const o = obst(st, 'rock', 120);
  run(st, 0.1, { fire: true });
  const ev = allEvents(st, 0.6, {});
  assert.ok(ev.some((e) => e.t === 'destroy' && e.pts === L.POINTS.rockShot));
  assert.ok(!st.obst.includes(o));
  const s2 = blank(); const big = obst(s2, 'rock2', 150);
  let hits = 0;
  for (let i = 0; i < 400 && s2.obst.includes(big); i++) { L.step(s2, 0.01, { fire: true }); hits += s2.events.filter((e) => e.t === 'chip' || e.t === 'destroy').length; }
  assert.strictEqual(hits, 3); assert.ok(!s2.obst.includes(big));
  const s3 = blank(); const t = obst(s3, 'tank', 130); run(s3, 0.8, { fire: true });
  assert.ok(!s3.obst.includes(t)); assert.ok(s3.score >= L.POINTS.tank);
  const s4 = blank(); const m = obst(s4, 'mine', 120); const c = obst(s4, 'crater', 180);
  run(s4, 0.5, { fire: true });
  assert.ok(s4.obst.includes(m)); assert.ok(s4.obst.includes(c));
});

test('the cannon is limited to two shots at a time', () => {
  const st = blank();
  run(st, 0.05, { fire: true });
  run(st, 0.3, { fire: true });
  assert.ok(st.shots.length <= 2);
});

test('a tank fires shells that can be jumped over and kill otherwise', () => {
  const st = blank(); const t = obst(st, 'tank', 200, { fireT: 0.01 });
  L.step(st, 0.05, {});
  assert.ok(st.shells.length === 1);
  const sh = st.shells[0]; sh.x = L.BUGGY_X + 6;
  L.step(st, 0.001, {});
  assert.strictEqual(st.phase, 'dying'); assert.strictEqual(evs(st, 'dead')[0].why, 'shell'); assert.ok(t);
  const s2 = blank(); s2.shells.push({ x: L.BUGGY_X + 6, y: 6 }); s2.buggy.y = 30; s2.buggy.air = 0.4;
  L.step(s2, 0.001, {});
  assert.strictEqual(s2.phase, 'play');
});

test('UFOs are shot with the upward cannon for 100 points', () => {
  const st = blank();
  st.waves.push({ n: 1, killed: 0, out: 0, spawned: 1 });
  st.ufos.push({ x: L.BUGGY_X, y: 70, base: 70, t: 0, ph: 0, wave: 0, vx: 0, dropAt: -99, bomb: false, dropped: false });
  const ev = allEvents(st, 1, { up: true });
  assert.ok(ev.some((e) => e.t === 'ufo'));
  assert.ok(st.score >= 100);
});

test('destroying a whole wave gives the 800 bonus, missing one does not', () => {
  const mk = (n) => { const st = blank(); st.waves.push({ n, killed: 0, out: 0, spawned: n }); for (let i = 0; i < n; i++) st.ufos.push({ x: L.BUGGY_X, y: 70, base: 70, t: 0, ph: 0, wave: 0, vx: 0, dropAt: -99, bomb: false, dropped: false }); return st; };
  const st = mk(2);
  const ev = allEvents(st, 1.5, { up: true });
  assert.strictEqual(ev.filter((e) => e.t === 'ufo').length, 2);
  assert.ok(ev.some((e) => e.t === 'wave'));
  assert.strictEqual(st.score, 200 + 800);
  const s2 = mk(2); s2.ufos[1].x = 200; s2.ufos[1].vx = 0;
  const ev2 = allEvents(s2, 1.5, { up: true });
  assert.ok(!ev2.some((e) => e.t === 'wave'));
});

test('a UFO bomb digs a new crater where it lands', () => {
  const st = blank();
  st.bombs.push({ x: 150, y: 100, vy: 20 });
  run(st, 1.2);
  assert.ok(st.obst.some((o) => o.kind === 'crater' && o.bomb));
  assert.strictEqual(st.bombs.length, 0);
});

test('a bomb landing on the buggy or flying into it kills', () => {
  const st = blank(); st.bombs.push({ x: L.BUGGY_X, y: 120, vy: 100 });
  run(st, 1);
  assert.strictEqual(st.phase, 'dying');
  assert.ok(evs(st, 'dead').length + 1);
});

test('bombs can be shot down with the upward cannon for 30', () => {
  const st = blank(); st.bombs.push({ x: L.BUGGY_X + 3, y: 120, vy: 0 });
  const ev = allEvents(st, 0.3, { up: true });
  assert.ok(ev.some((e) => e.t === 'bombshot'));
});

test('UFOs fly in waves of 3 to 5 and some drop bombs', () => {
  const st = fresh(1, 9);
  st.course = st.course.filter((i) => i.kind === 'wave' || i.kind === 'sign'); st.next = 0;
  const waves = st.course.filter((i) => i.kind === 'wave');
  assert.ok(waves.length >= 6);
  for (const w of waves) assert.ok(w.n >= 3 && w.n <= 5);
  let ufos = 0, bombs = 0;
  for (let i = 0; i < 3000; i++) { L.step(st, 0.02, { speed: 1 }); ufos = Math.max(ufos, st.ufos.length); for (const e of st.events) if (e.t === 'drop') bombs++; if (st.phase === 'dying') { st.lives = 9; L.rewind(st); } }
  assert.ok(ufos >= 3, 'a wave appeared'); assert.ok(bombs >= 1, 'a bomb was dropped');
});

test('checkpoints: passing the sign reports the letter; major ones give the time bonus', () => {
  const st = fresh(1, 2);
  st.course = [{ at: 0, kind: 'sign', letter: 4 }]; st.next = 0; st.sectionT = 20;
  const ev = allEvents(st, 3, { speed: 0 });
  const cp = ev.find((e) => e.t === 'checkpoint');
  assert.ok(cp && cp.letter === 4 && cp.major);
  assert.ok(cp.bonus >= 800 && cp.bonus <= 1200);
  const s2 = fresh(1, 2); s2.course = [{ at: 0, kind: 'sign', letter: 3 }]; s2.next = 0;
  const e2 = allEvents(s2, 3, {});
  assert.strictEqual(e2.find((e) => e.t === 'checkpoint').bonus, 0, 'minor checkpoint has no bonus');
  const s3 = fresh(1, 2); s3.course = [{ at: 0, kind: 'sign', letter: 9 }]; s3.next = 0; s3.sectionT = 80;
  assert.strictEqual(allEvents(s3, 3, {}).find((e) => e.t === 'checkpoint').bonus, 0, 'too slow: no bonus');
});

test('dying sends the buggy back to the last checkpoint, not to the start', () => {
  const st = fresh(1, 4);
  st.course = st.course.filter((i) => i.kind === 'sign'); st.next = 0;
  for (let i = 0; i < 5000 && st.checkpoint < 2; i++) { L.step(st, 0.02, { speed: 1 }); if (st.phase === 'dying') { st.lives = 9; L.rewind(st); } }
  assert.ok(st.checkpoint >= 2);
  const cp = st.checkpoint;
  L.die(st, 'rock'); const lives = st.lives;
  run(st, L.DYING + 0.1);
  assert.strictEqual(st.phase, 'play');
  assert.ok(st.dist >= cp * L.SEG - 200 && st.dist < (cp + 1) * L.SEG, 'restarts near checkpoint ' + st.dist);
  assert.strictEqual(st.lives, lives);
  assert.strictEqual(st.obst.length, 0, 'field cleared');
  const before = st.checkpoint; const ev = allEvents(st, 1, {});
  assert.ok(!ev.some((e) => e.t === 'checkpoint' && e.letter === before && e.bonus > 0), 'no second bonus for the same sign');
});

test('game over after the last buggy', () => {
  const st = blank(); st.lives = 1; L.die(st, 'rock');
  run(st, L.DYING + 0.1);
  assert.strictEqual(st.phase, 'over');
});

test('finishing the course (Z) gives 1000 and starts a harder course', () => {
  const st = blank();
  st.dist = L.LETTERS * L.SEG - 1;
  run(st, 0.1);
  assert.strictEqual(st.phase, 'finish'); assert.ok(st.score >= 1000);
  const speed1 = L.baseSpeed(1);
  run(st, 3.2);
  assert.strictEqual(st.level, 2); assert.strictEqual(st.phase, 'play'); assert.strictEqual(st.dist < 50, true);
  assert.ok(L.baseSpeed(2) > speed1);
  assert.ok(L.baseSpeed(50) <= L.BASE * 1.5 + 1e-9);
});

test('the passed-obstacle points: crater 10, small rock 15, big rock 20', () => {
  const st = blank(); st.buggy.y = 60; st.buggy.air = 0.4;     // 공중에서 지나감
  obst(st, 'crater', L.BUGGY_X - 40); obst(st, 'rock', L.BUGGY_X - 40); obst(st, 'rock2', L.BUGGY_X - 40);
  L.step(st, 0.001, {});
  assert.strictEqual(st.score, 10 + 15 + 20);
});

test('an extra buggy at 10000 and 50000 points, once each', () => {
  const st = blank(); st.score = 9990; st.lives = 3;
  obst(st, 'rock2', L.BUGGY_X - 40); L.step(st, 0.001, {});
  assert.strictEqual(st.lives, 4);
  st.score = 60000; obst(st, 'rock2', L.BUGGY_X - 40); L.step(st, 0.001, {});
  assert.strictEqual(st.lives, 5);
  obst(st, 'rock2', L.BUGGY_X - 40); L.step(st, 0.001, {});
  assert.strictEqual(st.lives, 5);
});

test('the course can be beaten: a simple lookahead bot gets through the first stage', () => {
  const st = fresh(1, 11);
  let deaths = 0;
  const probe = (st) => { // 장애물이 점프 한가운데에 오도록 이륙한다. 쏠 수 있으면 쏜다
    const b = st.buggy, v = L.baseSpeed(st.level) * b.mult; let jump = false;
    for (const o of st.obst) {
      if (o.kind === 'sign') continue;
      const d = o.x - b.x, ideal = (L.JUMP_T * v) / 2 - o.w / 2;
      if (d > ideal - 5 && d <= ideal + 1) jump = true;
    }
    return { jump, fire: false, up: true, speed: 0 };
  };
  for (let i = 0; i < 20000 && st.phase !== 'over' && st.dist < 5 * L.SEG; i++) { L.step(st, 0.01, probe(st)); if (st.phase === 'dying') { deaths++; st.lives = 9; } }
  assert.ok(st.dist >= 5 * L.SEG || deaths < 12, 'bot made it through stage 1 with ' + deaths + ' deaths');
});

test('random play never breaks the rules (fuzz)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = L.rng(seed), st = L.newGame(L.rng(seed * 3), 1 + (seed % 3));
    for (let i = 0; i < 8000 && st.phase !== 'over'; i++) {
      L.step(st, 0.02, { speed: Math.floor(r() * 3) - 1, jump: r() < 0.05, fire: r() < 0.3, up: r() < 0.3 });
      assert.ok(Number.isFinite(st.dist) && Number.isFinite(st.buggy.y) && st.buggy.y >= 0 && st.buggy.y <= L.JUMP_H + 1);
      assert.ok(st.lives >= 0 && st.score >= 0);
      assert.ok(st.shots.length <= 2 && st.upshots.length <= 2);
    }
  }
});
