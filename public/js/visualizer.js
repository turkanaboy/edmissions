import { audio, onPlayerEvent } from './player.js';

const canvas = document.getElementById('viz');
const ctx = canvas.getContext('2d');

// ponytail: visual level per mode mirrors the config/content.json defaults
const VISUAL_BY_MODE = { intense: 'full', vibing: 'medium', chill: 'ambient', off: 'off' };

let audioCtx = null;
let analyser = null;
let bins = null;
let mode = 'off';
let raf = 0;

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}
addEventListener('resize', resize);
resize();

// A MediaElementAudioSourceNode can only be created once per element — guard it.
function ensureGraph() {
  if (audioCtx) {
    audioCtx.resume().catch(() => {});
    return;
  }
  audioCtx = new AudioContext();
  const src = audioCtx.createMediaElementSource(audio);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;
  src.connect(analyser);
  analyser.connect(audioCtx.destination);
  bins = new Uint8Array(analyser.frequencyBinCount);
}

const avg = (from, to) => {
  let s = 0;
  for (let i = from; i < to; i++) s += bins[i];
  return s / ((to - from) * 255);
};

function drawFull(t) {
  const { width: w, height: h } = canvas;
  ctx.fillStyle = 'rgba(7, 7, 13, 0.24)';
  ctx.fillRect(0, 0, w, h);
  const bass = avg(0, 8);

  // bass pulse ring
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.42, 90 + bass * 260, 0, Math.PI * 2);
  ctx.strokeStyle = `hsla(${(t * 50) % 360} 95% 60% / ${0.12 + bass * 0.45})`;
  ctx.lineWidth = 2 + bass * 14;
  ctx.stroke();

  // full-width spectrum bars
  const n = 64;
  const bw = w / n;
  for (let i = 0; i < n; i++) {
    const v = bins[Math.floor((i * bins.length) / n)] / 255;
    const bh = v * h * 0.55;
    ctx.fillStyle = `hsla(${(i * 4 + t * 60) % 360} 95% 58% / 0.85)`;
    ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
  }
}

function drawMedium(t) {
  const { width: w, height: h } = canvas;
  ctx.fillStyle = 'rgba(7, 7, 13, 0.14)';
  ctx.fillRect(0, 0, w, h);
  const bass = avg(0, 8);
  const cx = w / 2;
  const cy = h * 0.45;
  const base = Math.min(w, h) * 0.16 + bass * 46;
  const spokes = 48;
  for (let i = 0; i < spokes; i++) {
    const v = bins[Math.floor((i * bins.length) / spokes)] / 255;
    const a = (i / spokes) * Math.PI * 2 + t * 0.25;
    const r1 = base;
    const r2 = base + 12 + v * 130;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.strokeStyle = `hsla(${190 + v * 130} 90% 60% / 0.5)`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

const blobs = [
  { hue: 315, sx: 0.23, sy: 0.31, ph: 0 },
  { hue: 192, sx: 0.17, sy: 0.23, ph: 2.1 },
  { hue: 85, sx: 0.13, sy: 0.19, ph: 4.2 },
];

function drawAmbient(t) {
  const { width: w, height: h } = canvas;
  ctx.fillStyle = 'rgba(7, 7, 13, 0.05)';
  ctx.fillRect(0, 0, w, h);
  const lift = bins ? avg(0, 16) : 0;
  for (const b of blobs) {
    const x = w * (0.5 + 0.34 * Math.sin(t * b.sx + b.ph));
    const y = h * (0.45 + 0.3 * Math.cos(t * b.sy + b.ph));
    const r = Math.min(w, h) * (0.18 + lift * 0.1);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${b.hue} 90% 60% / 0.09)`);
    g.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const PRESETS = { full: drawFull, medium: drawMedium, ambient: drawAmbient };

function frame() {
  raf = requestAnimationFrame(frame);
  if (analyser) analyser.getByteFrequencyData(bins);
  const draw = PRESETS[VISUAL_BY_MODE[mode]];
  if (draw) draw(performance.now() / 1000);
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height); // static CSS gradient shows through
}

onPlayerEvent((type, state) => {
  if (type !== 'mode') return;
  mode = state.mode;
  if (mode === 'off') {
    stop();
    return;
  }
  ensureGraph(); // the mode click is the user gesture that unlocks the AudioContext
  if (!raf) frame();
});
