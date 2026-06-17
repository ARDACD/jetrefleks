const video         = document.getElementById('videoEl');
const canvas        = document.getElementById('gameCanvas');
const ctx           = canvas.getContext('2d');
const statusEl      = document.getElementById('status');
const scoreValEl    = document.getElementById('score-val');
const comboBox      = document.getElementById('combo-box');
const comboValEl    = document.getElementById('combo-val');
const livesBox      = document.getElementById('lives-box');
const startScreen   = document.getElementById('start-screen');
const gameoverScreen= document.getElementById('gameover-screen');
const finalScoreEl  = document.getElementById('final-score');
const countdownEl   = document.getElementById('countdown');
const startBtn      = document.getElementById('start-btn');
const restartBtn    = document.getElementById('restart-btn');
const bgMusic       = document.getElementById('bgMusic');
const pauseScreen   = document.getElementById('pause-screen');

// ── State ────────────────────────────────────────────────
let detector  = null;
let smoothed  = {};
let gameState = 'idle'; // idle | countdown | playing | paused | over
let score     = 0;
let lives     = 3;
let combo     = 0;
let comboTimer= null;
let fruits    = [];
let particles = [];
let catchEffects = [];
let lastTime  = performance.now(), frames = 0;
let screenFlash = 0;
let lastDetectedPoses = [];

let noPoseFrames  = 0;
const NO_POSE_THRESHOLD = 45;

let allHands = [];
const HAND_RADIUS = 55;

// ── Fruit pool ───────────────────────────────────────────
const FRUIT_TYPES = [
  { emoji:'🍎', pts:10, color:'#ff4444' },
  { emoji:'🍊', pts:10, color:'#ff8800' },
  { emoji:'🍋', pts:10, color:'#ffdd00' },
  { emoji:'🍇', pts:15, color:'#9966ff' },
  { emoji:'🍓', pts:10, color:'#ff3366' },
  { emoji:'🍉', pts:20, color:'#33cc44' },
  { emoji:'🍑', pts:10, color:'#ffaa66' },
  { emoji:'🥝', pts:15, color:'#88cc00' },
  { emoji:'🫐', pts:15, color:'#6655cc' },
  { emoji:'🍒', pts:20, color:'#cc1133' },
  { emoji:'💣', pts:-30, color:'#333333' },
];

// ── Helpers ──────────────────────────────────────────────
function setStatus(t, c) { statusEl.textContent = t; statusEl.className = c; }
function lerp(a, b, t)   { return a + (b - a) * t; }

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function n2s(nx, ny) {
  const vw = video.videoWidth  || 640;
  const vh = video.videoHeight || 480;
  const sw = window.innerWidth, sh = window.innerHeight;
  const scale = Math.max(sw / vw, sh / vh);
  const dw = vw * scale, dh = vh * scale;
  const ox = (sw - dw) / 2, oy = (sh - dh) / 2;
  return { x: (1 - nx) * dw + ox, y: ny * dh + oy };
}

const KP = {
  nose:0,leftEye:1,rightEye:2,leftEar:3,rightEar:4,
  leftShoulder:5,rightShoulder:6,
  leftElbow:7,rightElbow:8,
  leftWrist:9,rightWrist:10,
  leftHip:11,rightHip:12,
  leftKnee:13,rightKnee:14,
  leftAnkle:15,rightAnkle:16
};

const SKEL = [
  ['leftShoulder','rightShoulder','#6ee7ff'],
  ['leftShoulder','leftHip','#6ee7ff'],['rightShoulder','rightHip','#6ee7ff'],['leftHip','rightHip','#6ee7ff'],
  ['leftShoulder','leftElbow','#a78bfa'],['leftElbow','leftWrist','#a78bfa'],
  ['rightShoulder','rightElbow','#a78bfa'],['rightElbow','rightWrist','#a78bfa'],
  ['leftHip','leftKnee','#34d399'],['leftKnee','leftAnkle','#34d399'],
  ['rightHip','rightKnee','#34d399'],['rightKnee','rightAnkle','#34d399'],
];

function getKP(keypoints, name) {
  const k = keypoints[KP[name]];
  if (!k) return null;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  return { nx: k.x / vw, ny: k.y / vh, score: k.score };
}

function smKP(name, nx, ny) {
  if (!smoothed[name]) { smoothed[name] = {nx, ny}; return {nx, ny}; }
  smoothed[name].nx = lerp(smoothed[name].nx, nx, 0.45);
  smoothed[name].ny = lerp(smoothed[name].ny, ny, 0.45);
  return { nx: smoothed[name].nx, ny: smoothed[name].ny };
}

// ── Lives display ────────────────────────────────────────
function updateLives() {
  livesBox.textContent = '❤️'.repeat(Math.max(0, lives)) + '🖤'.repeat(Math.max(0, 3 - lives));
}

// ── Score & Combo ────────────────────────────────────────
function addScore(pts, x, y, emoji) {
  if (gameState !== 'playing') return;

  if (pts < 0) {
    combo = 0;
    clearTimeout(comboTimer);
    comboBox.classList.remove('show');
    score = Math.max(0, score + pts);
    scoreValEl.textContent = score;
    catchEffects.push({ x, y, text: pts, emoji, t: 0, combo: 1 });
    spawnParticles(x, y, emoji);
    return;
  }

  combo++;
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => { combo = 0; comboBox.classList.remove('show'); }, 2500);

  const multiplier = combo >= 5 ? 3 : combo >= 3 ? 2 : 1;
  const gained = pts * multiplier;
  score = Math.max(0, score + gained);
  scoreValEl.textContent = score;

  if (combo >= 2) {
    comboValEl.textContent = multiplier + 'x';
    comboBox.classList.add('show');
  }

  catchEffects.push({ x, y, text: (gained > 0 ? '+' : '') + gained, emoji, t: 0, combo: multiplier });
  spawnParticles(x, y, emoji);
}

function missedFruit() {
  if (gameState !== 'playing') return;
  lives--;
  combo = 0;
  comboBox.classList.remove('show');
  updateLives();
  screenFlash = 8;
  if (lives <= 0) endGame();
}

// ── Particles ────────────────────────────────────────────
function spawnParticles(x, y, emoji) {
  if (particles.length > 60) return;
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 5;
    particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 2, alpha:1, size:10+Math.random()*8, emoji, t:0 });
  }
}

// ── Fruit spawning ───────────────────────────────────────
const MAX_FRUITS = 12;
let fruitTimer = null;

function scheduleFruit() {
  if (gameState !== 'playing') return;
  const delay = Math.max(900, 1800 - score * 1.2);
  fruitTimer = setTimeout(() => {
    if (fruits.length < MAX_FRUITS) spawnFruit();
    scheduleFruit();
  }, delay);
}

function spawnFruit() {
  if (gameState !== 'playing') return;
  const isBomb = Math.random() < 0.1;
  const type   = isBomb ? FRUIT_TYPES[FRUIT_TYPES.length - 1]
                        : FRUIT_TYPES[Math.floor(Math.random() * (FRUIT_TYPES.length - 1))];
  const sw = window.innerWidth;
  const size = 52 + Math.random() * 24;
  const x    = size + Math.random() * (sw - size * 2);
  const vy   = 2.5 + Math.random() * 3;
  const vx   = (Math.random() - 0.5) * 2.5;
  const wobble = (Math.random() - 0.5) * 0.04;
  fruits.push({ type, x, y: -size*2, vx, vy, size, wobble, angle:0, spin:(Math.random()-0.5)*0.06, caught:false, missed:false, flash:0 });
}

// ── Update ───────────────────────────────────────────────
function updateFruits() {
  const sh = window.innerHeight;
  fruits.forEach(f => {
    if (f.caught || f.missed) return;
    f.vy += 0.12;
    f.x  += f.vx + Math.sin(f.angle * 3) * f.wobble * 30;
    f.y  += f.vy;
    f.angle += f.spin;
    if (f.flash > 0) f.flash--;

    allHands.forEach(hand => {
      if (!hand || f.caught) return;
      const dx = hand.x - f.x, dy = hand.y - f.y;
      if (Math.sqrt(dx*dx + dy*dy) < HAND_RADIUS + f.size * 0.5) {
        f.caught = true;
        addScore(f.type.pts, f.x, f.y, f.type.emoji);
      }
    });

    if (!f.caught && f.y > sh + f.size * 2) {
      f.missed = true;
      if (f.type.pts > 0) missedFruit();
    }
  });
  fruits = fruits.filter(f => !f.caught && !f.missed);
}

function updateParticles() {
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.4;
    p.alpha = Math.max(0, p.alpha - 0.055);
    p.t++;
  });
  particles = particles.filter(p => p.alpha > 0);
  if (particles.length > 80) particles.length = 80;
}

function updateCatchEffects() {
  catchEffects.forEach(e => { e.t++; });
  catchEffects = catchEffects.filter(e => e.t < 35);
}

// ── Draw ─────────────────────────────────────────────────
function drawSkeleton(keypoints, poseIdx) {
  const THRESH = 0.15;
  const pid = 'sk' + poseIdx + '_';

  SKEL.forEach(([nameA, nameB, col]) => {
    const a = getKP(keypoints, nameA), b = getKP(keypoints, nameB);
    if (!a || !b || a.score < THRESH || b.score < THRESH) return;
    const sa = smKP(pid + nameA, a.nx, a.ny), sb = smKP(pid + nameB, b.nx, b.ny);
    const pA = n2s(sa.nx, sa.ny), pB = n2s(sb.nx, sb.ny);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3; ctx.strokeStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke();
    ctx.restore();
  });

  [KP.leftWrist, KP.rightWrist, KP.leftElbow, KP.rightElbow, KP.leftShoulder, KP.rightShoulder].forEach(idx => {
    const k = keypoints[idx];
    if (!k || k.score < THRESH) return;
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    const p = n2s(k.x / vw, k.y / vh);
    const col = idx >= KP.leftElbow ? '#a78bfa' : '#6ee7ff';
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.restore();
  });

  allHands.forEach((hand, i) => {
    if (!hand) return;
    const colors = ['#f9a8d4','#fbbf24','#6ee7ff','#a78bfa','#34d399','#fb923c'];
    const col = colors[i % colors.length];
    ctx.save();
    ctx.beginPath(); ctx.arc(hand.x, hand.y, HAND_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.globalAlpha = 0.5;
    ctx.setLineDash([8, 6]); ctx.stroke();
    ctx.restore();
  });
}

function drawFruits() {
  fruits.forEach(f => {
    ctx.save();
    ctx.translate(f.x, f.y); ctx.rotate(f.angle);
    ctx.font = `${f.size}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (f.type.pts < 0) { ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 20; }
    ctx.fillText(f.type.emoji, 0, 0);
    ctx.restore();
  });
}

function drawParticles() {
  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.font = `${p.size}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.emoji, p.x, p.y);
    ctx.restore();
  });
}

function drawCatchEffects() {
  catchEffects.forEach(e => {
    const alpha = Math.max(0, 1 - e.t / 35);
    const scale = 1 + (e.combo > 1 ? 0.3 : 0) + Math.min(e.t * 0.008, 0.4);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${Math.round(22 * scale)}px 'Courier New'`;
    ctx.textAlign = 'center';
    ctx.fillStyle = e.combo >= 3 ? '#facc15' : e.combo >= 2 ? '#fb923c' : '#ffffff';
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12;
    ctx.fillText(e.text, e.x, e.y - e.t * 1.8);
    ctx.restore();
  });
}

// ── Pose processing ───────────────────────────────────────
function estimateHandTip(elbowKP, wristKP, extend) {
  if (!elbowKP || !wristKP) return wristKP;
  return {
    nx: wristKP.nx + (wristKP.nx - elbowKP.nx) * extend,
    ny: wristKP.ny + (wristKP.ny - elbowKP.ny) * extend,
    score: wristKP.score
  };
}

function getPersonSize(keypoints) {
  const lSh = getKP(keypoints, 'leftShoulder');
  const rSh = getKP(keypoints, 'rightShoulder');
  if (!lSh || !rSh || lSh.score < 0.3 || rSh.score < 0.3) {
    const lH = getKP(keypoints, 'leftHip'), rH = getKP(keypoints, 'rightHip');
    if (!lH || !rH || lH.score < 0.3 || rH.score < 0.3) return 0;
    return Math.abs(lH.nx - rH.nx);
  }
  return Math.abs(lSh.nx - rSh.nx);
}

function processPoses(poses) {
  allHands = [];
  const POSE_SCORE_THRESH = 0.25;
  const MIN_SIZE = 0.08;
  const THRESH = 0.2;
  const EXTEND = 0.5;

  poses.forEach((pose, poseIdx) => {
    if (pose.score !== undefined && pose.score < POSE_SCORE_THRESH) return;
    const keypoints = pose.keypoints;
    const personSize = getPersonSize(keypoints);
    if (personSize < MIN_SIZE) return;

    const prefix = 'p' + poseIdx;
    const lw = getKP(keypoints, 'leftWrist');
    const rw = getKP(keypoints, 'rightWrist');
    const le = getKP(keypoints, 'leftElbow');
    const re = getKP(keypoints, 'rightElbow');
    const lSh = getKP(keypoints, 'leftShoulder');
    const rSh = getKP(keypoints, 'rightShoulder');
    const centerX = lSh && rSh ? (lSh.nx + rSh.nx) / 2 : null;
    const maxHandDist = personSize * 1.8;

    if (lw && lw.score >= THRESH) {
      const tip = estimateHandTip(le && le.score >= THRESH ? le : null, lw, EXTEND);
      if (centerX === null || Math.abs(tip.nx - centerX) < maxHandDist) {
        const s = smKP(prefix + '_lHand', tip.nx, tip.ny);
        allHands.push(n2s(s.nx, s.ny));
      }
    }
    if (rw && rw.score >= THRESH) {
      const tip = estimateHandTip(re && re.score >= THRESH ? re : null, rw, EXTEND);
      if (centerX === null || Math.abs(tip.nx - centerX) < maxHandDist) {
        const s = smKP(prefix + '_rHand', tip.nx, tip.ny);
        allHands.push(n2s(s.nx, s.ny));
      }
    }
  });
}

// ── Main loops ───────────────────────────────────────────
let poseRunning = false;

async function poseLoop() {
  if (poseRunning) return;
  poseRunning = true;
  while (true) {
    if (detector && video.readyState >= 2) {
      try {
        const poses = await detector.estimatePoses(video, { flipHorizontal: false, maxPoses: 15 });

        if (poses && poses.length > 0) {
          processPoses(poses);
          lastDetectedPoses = poses;
          noPoseFrames = 0;
          setStatus('Algılandı ✓' + (poses.length > 1 ? ` (${poses.length} kişi)` : ''), 'ready');

          const activePrefixes = new Set(poses.map((_, i) => 'p' + i));
          Object.keys(smoothed).forEach(k => {
            const prefix = k.split('_')[0];
            if (prefix.startsWith('p') && !activePrefixes.has(prefix)) delete smoothed[k];
          });

          if (gameState === 'paused') {
            gameState = 'playing';
            pauseScreen.style.display = 'none';
            bgMusic.play().catch(() => {});
            scheduleFruit();
          }
        } else {
          noPoseFrames++;
          allHands = [];
          lastDetectedPoses = [];
          smoothed = {};
          setStatus('Aranıyor…', 'noperson');
          if (gameState === 'playing' && noPoseFrames >= NO_POSE_THRESHOLD) {
            gameState = 'paused';
            clearTimeout(fruitTimer);
            bgMusic.pause();
            pauseScreen.style.display = 'flex';
          }
        }
      } catch(e) { /* ignore frame errors */ }
    }
    await new Promise(r => requestAnimationFrame(r));
  }
}

function renderLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (lastDetectedPoses && lastDetectedPoses.length > 0) {
    lastDetectedPoses.forEach((pose, poseIdx) => drawSkeleton(pose.keypoints, poseIdx));
  }

  if (gameState === 'playing') {
    updateFruits();
    updateParticles();
    updateCatchEffects();
    drawFruits();
    drawParticles();
    drawCatchEffects();
    if (screenFlash > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255,0,0,${0.18 * screenFlash / 8})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      screenFlash--;
    }
  }

  requestAnimationFrame(renderLoop);
}

// ── Game flow ─────────────────────────────────────────────
function startCountdown(cb) {
  countdownEl.style.display = 'flex';
  let n = 3;
  countdownEl.textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(iv);
      countdownEl.style.display = 'none';
      cb();
    } else {
      countdownEl.textContent = n;
    }
  }, 1000);
}

function startGame() {
  score = 0; lives = 3; combo = 0; fruits = []; particles = []; catchEffects = [];
  allHands = []; screenFlash = 0; noPoseFrames = 0; lastDetectedPoses = [];
  scoreValEl.textContent = 0;
  updateLives();
  comboBox.classList.remove('show');
  gameoverScreen.style.display = 'none';
  startScreen.style.display = 'none';
  pauseScreen.style.display = 'none';

  bgMusic.currentTime = 0;
  bgMusic.play().catch(e => { console.log('Müzik oynatılamadı:', e); });

  startCountdown(() => {
    gameState = 'playing';
    scheduleFruit();
    spawnFruit(); spawnFruit();
  });
}

let autoRestartTimer = null;
let autoRestartInterval = null;

function endGame() {
  gameState = 'over';
  clearTimeout(fruitTimer);
  fruits = [];
  bgMusic.pause();
  bgMusic.currentTime = 0;
  pauseScreen.style.display = 'none';
  finalScoreEl.textContent = 'Puan: ' + score;
  gameoverScreen.style.display = 'flex';
  startAutoRestart();
}

function startAutoRestart() {
  clearTimeout(autoRestartTimer);
  clearInterval(autoRestartInterval);
  const autoRestartEl = document.getElementById('auto-restart');
  const autoBar = document.getElementById('auto-bar');
  const SECS = 5;
  let remaining = SECS;
  autoRestartEl.textContent = remaining + ' saniyede otomatik başlıyor…';
  autoBar.style.transition = 'none';
  autoBar.style.width = '100%';
  autoBar.getBoundingClientRect();
  autoBar.style.transition = 'width ' + SECS + 's linear';
  autoBar.style.width = '0%';

  autoRestartInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(autoRestartInterval);
      autoRestartEl.textContent = 'Başlıyor!';
    } else {
      autoRestartEl.textContent = remaining + ' saniyede otomatik başlıyor…';
    }
  }, 1000);

  autoRestartTimer = setTimeout(() => { startGame(); }, SECS * 1000);
}

function cancelAutoRestart() {
  clearTimeout(autoRestartTimer);
  clearInterval(autoRestartInterval);
  const autoRestartEl = document.getElementById('auto-restart');
  const autoBar = document.getElementById('auto-bar');
  if (autoRestartEl) autoRestartEl.textContent = '';
  if (autoBar) { autoBar.style.transition = 'none'; autoBar.style.width = '0%'; }
}

startBtn.addEventListener('click', async () => {
  startScreen.style.display = 'none';
  if (!detector) await initDetector();
  startGame();
});
restartBtn.addEventListener('click', () => { cancelAutoRestart(); startGame(); });
document.addEventListener('mousemove', () => { if (gameState === 'over') cancelAutoRestart(); });

// ── Init ─────────────────────────────────────────────────
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width:{ideal:640}, height:{ideal:480}, facingMode:'user' }
    });
    video.srcObject = stream;
    await new Promise(r => { video.onloadedmetadata = r; });
    video.play();
  } catch(e) {
    setStatus('Kamera Hatası', 'error'); console.error(e);
  }
}

async function initDetector() {
  setStatus('Model yükleniyor…', 'loading');
  try {
    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING, enableSmoothing: true }
    );
    setStatus('Hazır', 'ready');
  } catch(e) {
    setStatus('Model Hatası', 'error'); console.error(e);
  }
}

(async () => {
  await initCamera();
  await initDetector();
  poseLoop();
  renderLoop();
})();
