'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 문 패트롤: 화면·입력·소리. 규칙은 logic.js (LOGIC_MOONPATROL). 여기서는 st.events 를 보고 소리·효과를 만든다.
const L = LOGIC_MOONPATROL;
const { W, H, GROUND, BUGGY_X } = L;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const controls = $('controls');
  const ctrlH = getComputedStyle(controls).display === 'none' ? 0 : controls.offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - ctrlH) / H);
  const cssW = Math.max(150, Math.floor(W * scale)), cssH = Math.floor(cssW * H / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('moonpatrolMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.045, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function noise(dur, vol = 0.08, lowpass = 1500) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(audio.destination); s.start();
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.05) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  jump: () => tone(300, 0.25, 'square', 0.04, 500),
  land: () => tone(120, 0.06, 'sine', 0.05, -30),
  shoot: () => tone(900, 0.08, 'sawtooth', 0.03, -500),
  shootup: () => tone(600, 0.1, 'sawtooth', 0.03, 400),
  destroy: () => { noise(0.2, 0.09, 1400); tone(200, 0.15, 'square', 0.04, -100); },
  chip: () => tone(260, 0.05, 'square', 0.04, -80),
  ufo: () => { noise(0.18, 0.07, 3000); melody([880, 1175, 1568], 50, 'sine', 0.05); },
  drop: () => tone(700, 0.35, 'sine', 0.03, -450),
  bombland: () => noise(0.25, 0.09, 700),
  tankfire: () => tone(160, 0.12, 'sawtooth', 0.04, -80),
  dead: () => { noise(0.5, 0.1, 900); melody([392, 330, 262, 196, 147], 130, 'sawtooth', 0.05); },
  cleared: () => tone(1000, 0.05, 'triangle', 0.025),
  checkpoint: () => melody([523, 659, 784], 70, 'square', 0.05),
  major: () => melody([523, 659, 784, 1047, 1319], 80, 'square', 0.055),
  wave: () => melody([784, 988, 1175, 1568], 70, 'sine', 0.06),
  start: () => melody([262, 330, 392, 523], 100),
  over: () => melody([392, 330, 262, 196], 220, 'sawtooth', 0.06),
  extra: () => melody([659, 784, 1047, 1319], 90, 'sine', 0.07),
  finish: () => melody([523, 659, 784, 1047, 784, 1047, 1319, 1568], 100),
};
let engineT = 0;

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                           // title · play · paused · over
let best = Number(store.get('moonpatrolBest')) || 0;
let fxs = [];
let banner = { text: '', sub: '', t: 0, color: '#ffb04a' };
let clock = 0, speedSignalled = false;
let kSpeed = 0, kFire = false, kUp = false, jumpQ = false, jumpQT = 0;
let bSlow = false, bFast = false, bFire = false, bUp = false;

/* @test-hooks:start */
window.__mp = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt) };
/* @test-hooks:end */

// ---------- 입력 ----------
const held = new Set();
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
  if (k === ' ' || k === 'Enter') {
    if (state === 'title' || state === 'over') { if (!e.repeat) onOverlayButton(); return; }
    if (state === 'paused') { if (!e.repeat) resume(); return; }
  }
  if (!e.repeat && (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W')) { jumpQ = true; jumpQT = 0.2; }
  held.add(k);
  if (k === 'p' || k === 'P') { if (state === 'paused') resume(); else pause(); }
  else if (k === 'm' || k === 'M') toggleMute();
});
addEventListener('keyup', (e) => { held.delete(e.key); });
addEventListener('blur', () => held.clear());

function hold(btn, on, off) {
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch (_) {} btn.classList.add('on'); on(); });
  const up = () => { btn.classList.remove('on'); off(); };
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
}
hold($('slowBtn'), () => { bSlow = true; }, () => { bSlow = false; });
hold($('fastBtn'), () => { bFast = true; }, () => { bFast = false; });
hold($('fireBtn'), () => { bFire = true; }, () => { bFire = false; });
hold($('upBtn'), () => { bUp = true; }, () => { bUp = false; });
hold($('jumpBtn'), () => { jumpQ = true; jumpQT = 0.2; }, () => {});

function readInput() {
  const left = held.has('ArrowLeft') || held.has('a') || held.has('A') || bSlow;
  const right = held.has('ArrowRight') || held.has('d') || held.has('D') || bFast;
  const speed = right && !left ? 1 : left && !right ? -1 : 0;
  const fire = held.has('z') || held.has('Z') || held.has('j') || held.has('J') || bFire;
  const up = held.has('x') || held.has('X') || held.has('k') || held.has('K') || bUp;
  const jump = jumpQ;
  return { speed, fire, up, jump };
}

// ---------- 흐름 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelector('button').onclick = onOverlayButton; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function setBanner(text, sub = '', color = '#ffb04a', t = 2) { banner = { text, sub, t, color }; }
const courseName = (lv) => (lv === 1 ? 'BEGINNER COURSE' : `CHAMPION COURSE ${lv - 1}`);
function startGame() {
  G = L.newGame();
  if (/[?&]tutorial=1/.test(location.search)) {                       // 튜토리얼: 몇 번 죽어도 되고, 처음부터 구덩이·바위·UFO 가 차례로 나온다
    G.lives = 9;
    G.course = G.course.filter((i) => i.kind === 'sign' && i.letter > 0);
    const add = (at, kind, n) => G.course.push({ at, kind, n });
    add(110, 'crater'); add(240, 'rock'); add(370, 'rock'); add(480, 'mine'); add(560, 'wave', 3); add(780, 'rock'); add(900, 'crater2'); add(1020, 'wave', 3); add(1200, 'rock2');
    G.course.sort((a, b) => a.at - b.at);
  }
  fxs = []; held.clear(); jumpQ = false; speedSignalled = false;
  state = 'play';
  setBanner(courseName(1), '구덩이와 바위를 넘고 UFO 를 쏴요');
  hideOverlay();
  sfx.start();
}
function onOverlayButton() { if (state === 'paused') resume(); else startGame(); }
let pausedFrom = null;
function pause() {
  if (state !== 'play') return;
  pausedFrom = state; state = 'paused'; held.clear(); bSlow = bFast = bFire = bUp = false;
  showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>');
}
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); }
function gameOver() {
  state = 'over';
  const rec = G.score > best;
  if (rec) { best = G.score; store.set('moonpatrolBest', String(best)); }
  sfx.over();
  showOverlay(`<h2>GAME OVER</h2><p class="big">${G.score.toLocaleString()}점</p><p>${courseName(G.level)} · 체크포인트 ${String.fromCharCode(65 + Math.max(0, G.checkpoint))}${rec ? '<br>🏆 최고 기록!' : ''}</p><button id="startBtn">다시 하기</button>`);
}

function handleEvents() {
  for (const e of G.events) {
    if (e.t === 'jump') { sfx.jump(); tutorialSignal('jump'); }
    else if (e.t === 'land') sfx.land();
    else if (e.t === 'shoot') { sfx.shoot(); tutorialSignal('shoot'); }
    else if (e.t === 'shootup') { sfx.shootup(); tutorialSignal('shootup'); }
    else if (e.t === 'destroy') { sfx.destroy(); tutorialSignal('destroy'); fxs.push({ kind: 'boom', x: e.x + 6, y: GROUND - 8, t: 0, life: 0.45 }, { kind: 'text', x: e.x + 6, y: GROUND - 14, t: 0, life: 0.9, text: String(e.pts) }); }
    else if (e.t === 'chip') sfx.chip();
    else if (e.t === 'ufo') { sfx.ufo(); tutorialSignal('ufo'); fxs.push({ kind: 'boom', x: e.x, y: e.y, t: 0, life: 0.4 }, { kind: 'text', x: e.x, y: e.y - 6, t: 0, life: 0.9, text: String(e.pts) }); }
    else if (e.t === 'wave') { sfx.wave(); setBanner('UFO WAVE CLEAR', `+${e.pts}`, '#ffe14a', 1.6); }
    else if (e.t === 'drop') sfx.drop();
    else if (e.t === 'bombland') { sfx.bombland(); fxs.push({ kind: 'boom', x: e.x, y: GROUND - 2, t: 0, life: 0.4 }); }
    else if (e.t === 'bombshot') { sfx.destroy(); fxs.push({ kind: 'text', x: e.x, y: 90, t: 0, life: 0.7, text: String(e.pts) }); }
    else if (e.t === 'tankfire') sfx.tankfire();
    else if (e.t === 'cleared') { sfx.cleared(); tutorialSignal('cleared'); fxs.push({ kind: 'text', x: BUGGY_X - 10, y: GROUND - 20, t: 0, life: 0.7, text: String(e.pts), color: '#9ae8ff' }); }
    else if (e.t === 'checkpoint') {
      tutorialSignal('checkpoint');
      if (e.major) { sfx.major(); setBanner(`CHECKPOINT ${String.fromCharCode(65 + e.letter)}`, e.bonus ? `TIME BONUS +${e.bonus}` : 'TIME BONUS 0', '#ffe14a', 2.4); }
      else { sfx.checkpoint(); setBanner(`CHECKPOINT ${String.fromCharCode(65 + e.letter)}`, '', '#9ae8ff', 1.2); }
    }
    else if (e.t === 'dead') { sfx.dead(); fxs.push({ kind: 'boom', x: BUGGY_X, y: GROUND - 8 - G.buggy.y, t: 0, life: 0.9, big: true }); }
    else if (e.t === 'extra') { sfx.extra(); setBanner('1UP', '버기가 한 대 늘었어요', '#ffe14a', 1.8); }
    else if (e.t === 'finish') { sfx.finish(); setBanner('COURSE CLEAR!', `+${e.pts}`, '#ffe14a', 3); }
    else if (e.t === 'course') { if (e.level > 1) { setBanner(courseName(e.level), '더 빠르고 더 빽빽해요', '#ff8a4a', 2.4); sfx.start(); } }
    else if (e.t === 'respawn') setBanner(`FROM ${String.fromCharCode(65 + Math.max(0, G.checkpoint))}`, '', '#ffb04a', 1.2);
    else if (e.t === 'over') gameOver();
  }
}

function update(dt) {
  clock += dt;
  if (state !== 'play') return;
  jumpQT -= dt; if (jumpQT <= 0) jumpQ = false;
  const input = readInput();
  L.step(G, dt, input);
  if (input.jump && G.buggy.air > 0) jumpQ = false;
  handleEvents();
  if (!speedSignalled && Math.abs(G.buggy.mult - 1) > 0.2) { speedSignalled = true; tutorialSignal('speed'); }
  banner.t = Math.max(0, banner.t - dt);
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
  engineT += dt;
}

// ---------- 그리기 ----------
function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
const STARS = Array.from({ length: 36 }, (_, i) => ({ x: (i * 53) % W, y: 22 + ((i * 37) % 80), s: i % 3 === 0 ? 2 : 1 }));
function mountains(offset, base, hgt, step, color, seed) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, base);
  for (let x = -step; x <= W + step; x += 4) {
    const wx = x + offset, v = Math.abs(Math.sin(wx / step * 1.7 + seed)) * 0.6 + Math.abs(Math.sin(wx / step * 0.6 + seed * 2)) * 0.4;
    ctx.lineTo(x, base - v * hgt);
  }
  ctx.lineTo(W + 4, base); ctx.closePath(); ctx.fill();
}
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND); g.addColorStop(0, '#05051a'); g.addColorStop(1, '#2a1a4a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND);
  ctx.fillStyle = '#fff';
  for (const s of STARS) { if ((s.x + Math.floor(clock * 3 + s.y)) % 7) ctx.fillRect(s.x, s.y, s.s, s.s); }
  rect(188, 34, 22, 22, '#c8d8ff'); rect(194, 40, 6, 6, '#a0b0e0');                                // 멀리 보이는 지구
  const d = G.dist;
  mountains(d * 0.06, 150, 52, 60, '#3a2a6a', 1.3);
  mountains(d * 0.18, 168, 34, 40, '#5a3a8a', 4.1);
  // 땅
  rect(0, GROUND, W, H - GROUND, '#8a5a3a'); rect(0, GROUND, W, 3, '#c8905a');
  for (let i = 0; i < 18; i++) { const x = ((i * 47 - d) % (W + 20) + (W + 20)) % (W + 20) - 10; rect(x, GROUND + 8 + (i * 13) % 36, 4 + i % 3 * 2, 2, '#6a3a22'); }
}
function drawObst(o) {
  const x = o.x, y = GROUND;
  if (x > W + 30 || x + o.w < -30) return;
  if (o.kind === 'crater' || o.kind === 'crater2') {
    ctx.fillStyle = '#05051a'; ctx.beginPath(); ctx.ellipse(x + o.w / 2, y + 2, o.w / 2, 4, 0, 0, Math.PI); ctx.fill();
    rect(x + 1, y - 1, o.w - 2, 4, '#3a1a0a'); rect(x - 1, y - 1, 2, 2, '#c8905a'); rect(x + o.w - 1, y - 1, 2, 2, '#c8905a');
  } else if (o.kind === 'rock' || o.kind === 'rock2') {
    const hgt = o.h;
    ctx.fillStyle = '#9a9aa8'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + o.w * 0.2, y - hgt * 0.8); ctx.lineTo(x + o.w * 0.55, y - hgt); ctx.lineTo(x + o.w, y - hgt * 0.4); ctx.lineTo(x + o.w, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c8c8d8'; ctx.fillRect(x + o.w * 0.3, y - hgt * 0.9, o.w * 0.25, 2);
    if (o.kind === 'rock2' && o.hp < 3) { ctx.strokeStyle = '#444'; ctx.beginPath(); ctx.moveTo(x + o.w * 0.5, y - hgt); ctx.lineTo(x + o.w * 0.4, y - hgt * 0.4); ctx.stroke(); }
  } else if (o.kind === 'mine') {
    rect(x + 1, y - 4, o.w - 2, 4, '#555'); rect(x + 3, y - 6, o.w - 6, 2, '#888');
    if (Math.floor(clock * 4) % 2) rect(x + o.w / 2 - 1, y - 8, 2, 2, '#ff3a3a');
  } else if (o.kind === 'tank') {
    rect(x, y - 6, o.w, 6, '#2a4a2a'); rect(x + 1, y - 4, o.w - 2, 4, '#1a2a1a'); rect(x + 4, y - 11, o.w - 10, 6, '#3a6a3a'); rect(x - 6, y - 9, 12, 2, '#3a6a3a');
    for (let i = 0; i < 4; i++) rect(x + 2 + i * 5, y - 2, 3, 2, '#888');
  } else if (o.kind === 'sign') {
    rect(x + 2, y - 22, 2, 22, '#ccc'); rect(x - 5, y - 30, 16, 11, '#e8e82a'); ctx.fillStyle = '#000'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String.fromCharCode(65 + o.letter), x + 3, y - 24);
  }
}
function drawBuggy() {
  const b = G.buggy;
  if (!b.alive) return;
  const x = b.x, y = GROUND - b.y;
  const bounce = b.y <= 0 ? Math.sin(G.buggy.wheel * 0.5) * 0.8 : 0;
  const by = y + bounce;
  rect(x - 10, by - 11, 21, 6, '#4aa8ff'); rect(x - 10, by - 11, 21, 2, '#8ad0ff');               // 차체
  rect(x - 5, by - 16, 9, 6, '#bfe8ff'); rect(x - 4, by - 15, 7, 4, '#2a4a6a');                   // 운전석
  rect(x + 8, by - 13, 7, 2, '#ffd23a'); rect(x + 15, by - 14, 2, 4, '#ffd23a');                  // 앞 포
  rect(x - 3, by - 20, 1, 5, '#ccc'); rect(x - 5, by - 21, 5, 2, '#f55');                          // 위 포(안테나)
  for (const wx of [-9, -3, 3, 9]) {                                                                // 바퀴
    const wy = b.y <= 0 ? Math.sin(G.buggy.wheel * 0.5 + wx) * 0.8 : 0;
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x + wx, y - 3 + wy, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#aaa'; ctx.fillRect(x + wx - 1, y - 4 + wy, 2, 2);
  }
}
function drawUfo(u) {
  const x = u.x, y = u.y;
  ctx.fillStyle = '#9a9ac8'; ctx.beginPath(); ctx.ellipse(x, y + 1, 9, 3.5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#d8d8f8'; ctx.beginPath(); ctx.ellipse(x, y - 1, 5, 4, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = Math.floor(clock * 8 + u.ph) % 2 ? '#ff4a4a' : '#ffe14a'; ctx.fillRect(x - 6, y + 1, 2, 2); ctx.fillRect(x + 4, y + 1, 2, 2);
  if (u.bomb && !u.dropped) { ctx.fillStyle = '#222'; ctx.fillRect(x - 1, y + 4, 3, 3); }
}
function drawFx() {
  for (const f of fxs) {
    const k = f.t / f.life;
    if (f.kind === 'boom') { const r = (f.big ? 22 : 10) * (0.3 + k); ctx.fillStyle = `rgba(255,${Math.floor(200 - 140 * k)},40,${1 - k})`; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 7); ctx.fill(); ctx.fillStyle = `rgba(255,255,200,${0.8 - k})`; ctx.beginPath(); ctx.arc(f.x, f.y, r * 0.5, 0, 7); ctx.fill(); }
    else if (f.kind === 'text') { ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.fillStyle = f.color || '#fff'; ctx.strokeText(f.text, f.x, f.y - k * 14); ctx.fillText(f.text, f.x, f.y - k * 14); }
  }
}
function drawHud() {
  rect(0, 0, W, 20, '#000');
  ctx.textBaseline = 'middle'; ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'left'; ctx.fillStyle = '#ff6a6a'; ctx.fillText('1UP', 4, 7); ctx.fillStyle = '#fff'; ctx.fillText(String(G.score), 26, 7);
  ctx.textAlign = 'center'; ctx.fillStyle = '#7fd0ff'; ctx.fillText('HI', 100, 7); ctx.fillStyle = '#fff'; ctx.fillText(String(Math.max(best, G.score)), 122, 7);
  // 체크포인트 막대 A~Z
  const x0 = 4, bw = 8.2;
  for (let i = 0; i < L.LETTERS; i++) {
    const done = i <= G.checkpoint, major = L.MAJOR.includes(i);
    rect(x0 + i * bw, 13, bw - 1.4, 4, done ? (major ? '#ffe14a' : '#5ad85a') : (major ? '#6a5a1a' : '#2a3a2a'));
  }
  const prog = Math.min(1, G.dist / (L.LETTERS * L.SEG));
  rect(x0 + prog * (L.LETTERS * bw - 2), 11, 2, 8, '#fff');
  // 남은 버기: 아이콘 하나와 ×개수
  const n = Math.max(0, G.lives - 1);
  rect(146, 6, 10, 4, '#4aa8ff'); rect(148, 4, 5, 3, '#bfe8ff');
  ctx.textAlign = 'left'; ctx.fillStyle = '#9ae8ff'; ctx.fillText(`x${n}`, 160, 7);
}
function draw() {
  drawBackground();
  for (const o of G.obst) drawObst(o);
  for (const s of G.shells) { rect(s.x, GROUND - s.y - 2, 6, 3, '#ffd23a'); rect(s.x + 6, GROUND - s.y - 1, 2, 1, '#fff'); }
  for (const b of G.bombs) { ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.ellipse(b.x, b.y, 2.5, 3.5, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#f55'; ctx.fillRect(b.x - 1, b.y - 4, 2, 2); }
  for (const u of G.ufos) drawUfo(u);
  for (const s of G.shots) rect(s.x - 3, GROUND - s.y - 1, 7, 2, '#fff');
  for (const s of G.upshots) rect(s.x - 1, GROUND - s.y - 4, 2, 6, '#fff');
  drawBuggy(); drawFx(); drawHud();
  if (banner.t > 0) {
    rect(0, 90, W, banner.sub ? 40 : 24, 'rgba(0,0,0,.6)');
    ctx.fillStyle = banner.color; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, W / 2, banner.sub ? 102 : 102);
    if (banner.sub) { ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, W / 2, 119); }
  }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('moonpatrolMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
requestAnimationFrame(frame);
