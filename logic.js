'use strict';
// 문 패트롤 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
const LOGIC_MOONPATROL = (() => {
  const W = 240, H = 240;
  const GROUND = 188;                                    // 땅 윗면 y
  const BUGGY_X = 56;                                    // 버기의 화면 x (가운데)
  const SEG = 500, LETTERS = 26;                         // 체크포인트 한 구간의 길이(픽셀)와 개수 (A~Z)
  const MAJOR = [4, 9, 14, 19, 25];                      // E J O T Z : 시간 보너스 체크포인트
  const BASE = 72;                                       // 기본 스크롤 속도(픽셀/초)
  const SPEED_MULT = [0.65, 1, 1.35];                    // 느리게 · 보통 · 빠르게
  const START_LIVES = 3;
  const JUMP_H = 50, JUMP_T = 0.9;                       // 점프 높이(픽셀)와 공중에 있는 시간
  const SHOT_SPEED = 220, UP_SPEED = 190, SHOT_COOL = 0.22, MAX_FWD = 2, MAX_UP = 2;
  const SPAWN_X = W + 14;
  const PAR_PER_SECTION = 32;                            // 다섯 구간(E,J,O,T,Z)마다의 기준 시간(초). 이보다 빠르면 1초당 100점
  const POINTS = { crater: 10, rock: 15, rock2: 20, mine: 15, rockShot: 50, rock2Shot: 100, tank: 200, ufo: 100, wave: 800, bomb: 30, second: 100, finish: 1000 };
  const EXTRA_LIFE_AT = [10000, 50000];
  const DYING = 1.6;

  // 땅 위 물건: 폭(w), 높이(h), 맞아야 하는 횟수(hp), 사격 가능 여부
  const KINDS = {
    crater: { w: 14, h: 0 }, crater2: { w: 28, h: 0 },
    rock: { w: 9, h: 9, hp: 1 }, rock2: { w: 15, h: 15, hp: 3 },
    mine: { w: 11, h: 5 }, tank: { w: 22, h: 12, hp: 1 },
  };

  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };
  const baseSpeed = (level) => BASE * Math.min(1.5, 1 + 0.1 * (level - 1));

  // 코스: 구간(A~Z)마다 땅 위 장애물과 UFO 떼를 정한다. 판(레벨)이 오르면 더 빽빽하다. 모두 scroll 거리(at) 기준
  function makeCourse(level, rand) {
    const items = [];
    for (let seg = 0; seg < LETTERS; seg++) {
      const start = seg * SEG, stage = Math.floor(seg / 5);
      // 체크포인트 표지판: 버기가 이 줄을 지나면 체크포인트
      items.push({ at: Math.max(0, start - (SPAWN_X - BUGGY_X)), kind: 'sign', letter: seg });
      const count = Math.min(6, [2, 3, 3, 4, 4, 5][stage] + (level > 1 ? 1 : 0)) - (seg === 0 ? 1 : 0);
      const gap = Math.max(86, 118 - 6 * stage - (level > 1 ? 8 : 0));
      let x = start + (seg === 0 ? 150 : 90), prev = null;
      for (let i = 0; i < count && x < start + SEG - 40; i++) {
        const pool = ['crater', 'rock'];
        if (stage >= 1) pool.push('crater2', 'rock2');
        if (stage >= 2) pool.push('mine', 'mine');
        if (stage >= 3) pool.push('tank');
        if (stage >= 4) pool.push('crater2', 'tank');
        let kind = pool[Math.floor(rand() * pool.length)];
        if (kind === prev && kind === 'tank') kind = 'mine';
        items.push({ at: x, kind });
        prev = kind;
        x += gap + (kind === 'tank' || kind === 'crater2' ? 24 : 0) + Math.floor(rand() * 40);
      }
      // UFO 떼: 둘째 구간부터 두 구간에 한 번 꼴
      if (seg >= 1 && (seg % 3 === 1 || (level > 1 && seg % 3 === 2))) {
        const n = Math.min(5, 3 + Math.floor(stage / 2) + (level > 1 ? 1 : 0));
        items.push({ at: start + 30, kind: 'wave', n });
      }
    }
    items.sort((a, b) => a.at - b.at);
    return items;
  }

  function newGame(rand = Math.random, level = 1) {
    const st = { rand, score: 0, lives: START_LIVES, level, t: 0, events: [], extra: 0, phase: 'play', time: 0 };
    startCourse(st, level);
    return st;
  }
  function startCourse(st, level) {
    st.level = level;
    st.course = makeCourse(level, st.rand);
    st.dist = 0; st.next = 0; st.checkpoint = -1; st.letter = 0; st.sectionT = 0; st.cpDist = 0;
    resetField(st);
    st.phase = 'play';
    emit(st, { t: 'course', level });
  }
  function resetField(st) {
    st.obst = []; st.ufos = []; st.bombs = []; st.shells = []; st.shots = []; st.upshots = []; st.pend = []; st.waves = [];
    st.buggy = { y: 0, vy: 0, air: 0, mult: 1, x: BUGGY_X, alive: true, cool: 0, coolUp: 0, wheel: 0 };
    st.invuln = 0;
  }

  function die(st, why) {
    if (st.phase !== 'play') return;
    st.buggy.alive = false;
    st.lives--; st.phase = 'dying'; st.dyingT = DYING;
    emit(st, { t: 'dead', why });
  }
  function addScore(st, n) {
    st.score += n;
    while (st.extra < EXTRA_LIFE_AT.length && st.score >= EXTRA_LIFE_AT[st.extra]) { st.extra++; st.lives++; emit(st, { t: 'extra' }); }
  }

  function spawn(st, it) {
    if (it.kind === 'sign') { st.obst.push({ kind: 'sign', x: SPAWN_X, w: 6, h: 0, letter: it.letter, passed: false }); return; }
    if (it.kind === 'wave') {
      const id = st.waves.length;
      st.waves.push({ n: it.n, killed: 0, out: 0, spawned: 0 });
      for (let i = 0; i < it.n; i++) st.pend.push({ t: 0.5 * i, wave: id, i });
      return;
    }
    const k = KINDS[it.kind];
    st.obst.push({ kind: it.kind, x: SPAWN_X, w: k.w, h: k.h, hp: k.hp || 0, passed: false, fireT: 1 + st.rand(), bomb: false });
  }

  function overlapX(a, aw, b, bw) { return a < b + bw && a + aw > b; }
  const buggyBox = (st) => ({ l: st.buggy.x - 8, r: st.buggy.x + 9 });
  const airborne = (st) => st.buggy.y > 0.5;

  function step(st, dt, input = {}) {
    const h = Math.min(dt, 0.05);
    st.events = [];
    if (st.phase === 'over') return;
    st.t += h;
    if (st.phase === 'dying') {
      st.dyingT -= h;
      if (st.dyingT <= 0) {
        if (st.lives <= 0) { st.phase = 'over'; emit(st, { t: 'over' }); return; }
        rewind(st);
      }
      return;
    }
    if (st.phase === 'finish') { st.finishT -= h; if (st.finishT <= 0) startCourse(st, st.level + 1); return; }
    const b = st.buggy;
    // 속도: 느리게/보통/빠르게
    const target = SPEED_MULT[(input.speed || 0) + 1];
    b.mult += Math.sign(target - b.mult) * Math.min(Math.abs(target - b.mult), 1.6 * h);
    const scroll = baseSpeed(st.level) * b.mult;
    st.dist += scroll * h; st.sectionT += h; st.time += h; b.wheel += scroll * h;
    // 점프
    if (b.y <= 0 && input.jump && b.vy === 0 && b.air === 0) { b.air = 0.0001; emit(st, { t: 'jump' }); }
    if (b.air > 0) {
      b.air += h;
      const p = b.air / JUMP_T;
      if (p >= 1) { b.air = 0; b.y = 0; emit(st, { t: 'land' }); } else b.y = 4 * JUMP_H * p * (1 - p);
    }
    // 코스에서 물건을 내보낸다
    while (st.next < st.course.length && st.course[st.next].at <= st.dist) spawn(st, st.course[st.next++]);
    for (let i = st.pend.length - 1; i >= 0; i--) {
      st.pend[i].t -= h;
      if (st.pend[i].t <= 0) { spawnUfo(st, st.pend[i]); st.pend.splice(i, 1); }
    }
    // 사격
    b.cool = Math.max(0, b.cool - h); b.coolUp = Math.max(0, b.coolUp - h);
    if (input.fire && b.cool <= 0 && st.shots.length < MAX_FWD) { st.shots.push({ x: b.x + 12, y: b.y + 6 }); b.cool = SHOT_COOL; emit(st, { t: 'shoot' }); }
    if (input.up && b.coolUp <= 0 && st.upshots.length < MAX_UP) { st.upshots.push({ x: b.x + 2, y: b.y + 10 }); b.coolUp = SHOT_COOL; emit(st, { t: 'shootup' }); }
    updateWorld(st, h, scroll);
    if (st.phase === 'play') collide(st);
    if (st.phase === 'play') checkFinish(st);
  }

  function spawnUfo(st, p) {
    const w = st.waves[p.wave];
    const lvlBomb = st.level > 1 ? 0.7 : 0.5;
    st.ufos.push({ x: SPAWN_X, y: 44 + st.rand() * 26, base: 44 + st.rand() * 26, t: 0, ph: st.rand() * 6, wave: p.wave, vx: -(46 + 8 * Math.min(st.level, 4)), dropAt: BUGGY_X + 24 + st.rand() * 80, bomb: st.rand() < lvlBomb, dropped: false });
    w.spawned++;
  }

  function updateWorld(st, h, scroll) {
    const b = st.buggy;
    // 땅 위 물건은 스크롤만큼 왼쪽으로
    for (const o of st.obst) {
      o.x -= scroll * h;
      if (o.kind === 'tank' && o.x < W - 16 && o.x > 20) {                  // 탱크는 화면에 들어오면 왼쪽으로 포탄을 쏜다
        o.fireT -= h;
        if (o.fireT <= 0) { st.shells.push({ x: o.x - 2, y: 6 }); o.fireT = 1.7 + st.rand(); emit(st, { t: 'tankfire' }); }
      }
      if (!o.passed && o.x + o.w < b.x - 9) {
        o.passed = true;
        if (o.kind === 'sign') reachCheckpoint(st, o.letter);
        else if (o.kind !== 'tank') { const pts = o.kind === 'crater' || o.kind === 'crater2' ? POINTS.crater : o.kind === 'rock2' ? POINTS.rock2 : o.kind === 'mine' ? POINTS.mine : POINTS.rock; addScore(st, pts); emit(st, { t: 'cleared', kind: o.kind, pts }); }
      }
    }
    st.obst = st.obst.filter((o) => o.x + o.w > -30);
    for (const s of st.shells) s.x -= (110 + scroll) * h;
    st.shells = st.shells.filter((s) => s.x > -10);
    // 앞쪽 포: 오른쪽으로 곧장
    for (const s of st.shots) s.x += SHOT_SPEED * h;
    st.shots = st.shots.filter((s) => s.x < W + 6);
    for (const s of st.shots) {
      for (const o of st.obst) {
        if (o.kind === 'crater' || o.kind === 'crater2' || o.kind === 'mine' || o.kind === 'sign') continue;
        if (o.hit) continue;
        if (s.x >= o.x && s.x <= o.x + o.w && s.y <= o.h + 4) {
          s.dead = true;
          o.hp--;
          if (o.hp <= 0) { o.hit = true; const pts = o.kind === 'tank' ? POINTS.tank : o.kind === 'rock2' ? POINTS.rock2Shot : POINTS.rockShot; addScore(st, pts); emit(st, { t: 'destroy', kind: o.kind, pts, x: o.x }); }
          else emit(st, { t: 'chip', x: o.x });
          break;
        }
      }
    }
    st.shots = st.shots.filter((s) => !s.dead);
    st.obst = st.obst.filter((o) => !o.hit);
    // 위쪽 포
    for (const s of st.upshots) s.y += UP_SPEED * h;
    st.upshots = st.upshots.filter((s) => s.y < GROUND - 8);
    // UFO
    for (const u of st.ufos) {
      u.t += h; u.x += u.vx * h; u.y = u.base + 12 * Math.sin(u.t * 3 + u.ph);
      if (u.bomb && !u.dropped && u.x <= u.dropAt) { u.dropped = true; st.bombs.push({ x: u.x, y: u.y, vy: 20 }); emit(st, { t: 'drop' }); }
    }
    // up-shot 은 아래에서 위로: 화면 y 로 바꿔서 비교 (UFO y 는 위에서부터)
    for (const s of st.upshots) {
      const sy = GROUND - s.y;                           // 화면 y (위가 작다)
      for (const u of st.ufos) if (!u.dead && Math.abs(s.x - u.x) < 9 && Math.abs(sy - u.y) < 9) { u.dead = true; s.hit = true; ufoKilled(st, u); break; }
      if (!s.hit) for (const bm of st.bombs) if (!bm.dead && Math.abs(s.x - bm.x) < 6 && Math.abs(sy - bm.y) < 8) { bm.dead = true; s.hit = true; addScore(st, POINTS.bomb); emit(st, { t: 'bombshot', pts: POINTS.bomb, x: bm.x }); break; }
    }
    st.upshots = st.upshots.filter((s) => !s.hit);
    for (const u of st.ufos) if (u.x < -16 && !u.dead) { u.dead = true; st.waves[u.wave].out++; }
    st.ufos = st.ufos.filter((u) => !u.dead);
    // 폭탄
    for (const bm of st.bombs) {
      bm.vy += 140 * h; bm.y += bm.vy * h; bm.x -= scroll * h * 0.0;
      if (!bm.dead && bm.y >= GROUND - 3) {
        bm.dead = true;
        st.obst.push({ kind: 'crater', x: bm.x - 7, w: 14, h: 0, hp: 0, passed: false, bomb: true });
        emit(st, { t: 'bombland', x: bm.x });
        if (!airborne(st) && Math.abs(bm.x - b.x) < 12) die(st, 'bomb');
      }
    }
    st.bombs = st.bombs.filter((bm) => !bm.dead);
  }

  function ufoKilled(st, u) {
    const w = st.waves[u.wave];
    w.killed++;
    addScore(st, POINTS.ufo);
    emit(st, { t: 'ufo', pts: POINTS.ufo, x: u.x, y: u.y });
    if (w.killed === w.n) { addScore(st, POINTS.wave); emit(st, { t: 'wave', pts: POINTS.wave }); }
  }

  function collide(st) {
    const b = st.buggy, bb = buggyBox(st);
    for (const o of st.obst) {
      if (o.kind === 'sign') continue;
      if (o.kind === 'crater' || o.kind === 'crater2') {
        // 구덩이: 땅에 닿아 있는데 몸통 가운데가 구덩이 안이면 빠진다
        if (b.y <= 0.5 && b.x > o.x + 2 && b.x < o.x + o.w - 2) return die(st, 'crater');
        continue;
      }
      if (overlapX(bb.l + 2, bb.r - bb.l - 4, o.x, o.w) && b.y < o.h) return die(st, o.kind === 'tank' ? 'tank' : o.kind);
    }
    for (const s of st.shells) if (overlapX(bb.l + 2, bb.r - bb.l - 4, s.x, 6) && b.y < s.y + 5 && b.y + 10 > s.y - 2) return die(st, 'shell');
    for (const bm of st.bombs) if (Math.abs(bm.x - b.x) < 9 && bm.y > GROUND - b.y - 14 && bm.y < GROUND - b.y + 2) return die(st, 'bomb');
  }

  function reachCheckpoint(st, letter) {
    st.letter = letter; st.checkpoint = letter; st.cpDist = Math.max(0, letter * SEG - (SPAWN_X - BUGGY_X));
    let bonus = 0;
    if (MAJOR.includes(letter)) {
      const par = PAR_PER_SECTION * BASE / baseSpeed(st.level);
      bonus = Math.max(0, Math.floor(par - st.sectionT)) * POINTS.second;
      st.sectionT = 0;
      if (bonus > 0) addScore(st, bonus);
    }
    emit(st, { t: 'checkpoint', letter, major: MAJOR.includes(letter), bonus });
  }
  function checkFinish(st) {
    if (st.dist >= LETTERS * SEG && st.phase === 'play') {
      addScore(st, POINTS.finish);
      st.phase = 'finish'; st.finishT = 3;
      emit(st, { t: 'finish', level: st.level, pts: POINTS.finish });
    }
  }
  // 죽으면 마지막 체크포인트부터 다시
  function rewind(st) {
    st.dist = st.cpDist || 0;
    st.next = st.course.findIndex((it) => (st.checkpoint >= 0 ? it.at > st.dist : it.at >= st.dist));
    if (st.next < 0) st.next = st.course.length;
    st.letter = Math.max(0, st.checkpoint);
    resetField(st);
    st.phase = 'play';
    emit(st, { t: 'respawn' });
  }

  return {
    W, H, GROUND, BUGGY_X, SEG, LETTERS, MAJOR, BASE, SPEED_MULT, START_LIVES, JUMP_H, JUMP_T, POINTS, EXTRA_LIFE_AT, KINDS, SPAWN_X, PAR_PER_SECTION, DYING,
    rng, baseSpeed, makeCourse, newGame, startCourse, step, die, spawn, rewind,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_MOONPATROL;
