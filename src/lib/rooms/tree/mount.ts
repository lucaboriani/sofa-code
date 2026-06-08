import type { RoomMount } from '@/lib/webgl/types';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import { makeOverlay } from './overlay';

// Ported from tree-silhouette.html — a 2D-canvas generative room.
// Every constant and formula is verbatim; the standalone file's self-driving
// requestAnimationFrame becomes the shared raf loop, and the DPR is pinned to 1
// (as the original ran) so gesture coordinates map 1:1 to canvas pixels.

const TOTAL = 14; // seconds for a tree to fully grow

interface Point { x: number; y: number; }
interface Branch { x1: number; y1: number; x2: number; y2: number; w: number; delay: number; dur: number; pid: number; curve: number; }
interface Leaf { x: number; y: number; r: number; delay: number; }
interface Tree { branches: Branch[]; leaves: Leaf[]; rootY: number; startNow: number | null; r: number; g: number; b: number; }
interface Firefly { x: number; y: number; vx: number; vy: number; phase: number; speed: number; }

function rand(a: number, b: number): number { return a + Math.random() * (b - a); }
function ease(t: number): number { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

export const mount: RoomMount = (canvas, opts) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  const full = opts.quality === 'full';

  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  let trees: Tree[] = [];
  let fireflies: Firefly[] = [];
  let globalStart: number | null = null;
  let state: 'waiting' | 'drawing' | 'growing' = 'waiting';
  let gesture: Point[] = [];

  // Original rendered at DPR 1; keep it so gesture pixels match canvas pixels.
  const stopResize = observeResize(canvas, () => { initFireflies(); buildSeed(); }, 1);

  // ── Tree builder (tree-silhouette.html L44-150) ────────────────────────────
  function buildTree(pts: Point[]): Tree | null {
    const branches: Branch[] = [], leaves: Leaf[] = [];
    if (pts.length < 2) return null;

    let totalLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      totalLen += Math.sqrt(dx * dx + dy * dy);
    }
    if (totalLen < 15) return null;

    const N = 8;
    const sampled: Point[] = [pts[0]];
    let acc = 0;
    const step = totalLen / N;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      const seg = Math.sqrt(dx * dx + dy * dy);
      acc += seg;
      while (acc >= step && sampled.length < N) {
        const t = 1 - (acc - step) / seg;
        sampled.push({ x: pts[i - 1].x + dx * t, y: pts[i - 1].y + dy * t });
        acc -= step;
      }
    }
    sampled.push(pts[pts.length - 1]);

    const rootY = sampled[0].y;
    const lf = Math.min(1, totalLen / (canvas.height * 0.6));

    const spread = rand(0.45, 0.75);
    const ratio = rand(0.55, 0.68);
    const depth = Math.floor(rand(5, 7) + lf * 2);
    const asym = rand(-0.1, 0.1);

    const tip = sampled[sampled.length - 1], root0 = sampled[0];
    const tilt = Math.atan2(tip.y - root0.y, tip.x - root0.x) - (-Math.PI / 2);

    function grow(x1: number, y1: number, angle: number, len: number, dep: number, del: number, par: number, maxW: number): void {
      if (dep < 0 || len < 3) return;
      const x2 = x1 + Math.cos(angle) * len, y2 = y1 + Math.sin(angle) * len;
      const dur = 0.04 + rand(0, 0.03);
      const w = Math.min(maxW, Math.max(1, dep * 0.7 + 0.8));
      const idx = branches.length;
      branches.push({ x1, y1, x2, y2, w, delay: del, dur, pid: par, curve: rand(-0.9, 0.9) });

      if (dep === 0) {
        for (let k = 0; k < Math.floor(rand(3, 7)); k++)
          leaves.push({ x: x2 + rand(-10, 10), y: y2 + rand(-10, 10), r: rand(1.5, 3.5), delay: del + dur + rand(0, 0.25) });
      } else {
        const cor = -tilt * 0.2 * (dep / depth);
        const cd = del + dur + rand(0, 0.01);
        const sp = spread + rand(-0.08, 0.08);
        let n = dep >= 3 ? (Math.random() < 0.5 ? 3 : 2) : 2;
        if (Math.random() < 0.15) n++;
        for (let i = 0; i < n; i++) {
          const side = n === 1 ? 0 : (i === 0 ? -sp : i === n - 1 ? sp : rand(-sp * 0.4, sp * 0.4));
          const droop = (i === n - 1 && Math.random() < 0.22) ? rand(0.3, 0.65) : 0;
          const off = side + cor + asym * rand(0.4, 1) + rand(-0.07, 0.07) + droop;
          grow(x2, y2, angle + off, len * (ratio + rand(-0.05, 0.05)), dep - 1, cd + i * 0.01, idx, w * 0.72);
        }
      }
    }

    let delay = 0, pid = -1;
    for (let s = 0; s < sampled.length - 1; s++) {
      const x1 = sampled[s].x, y1 = sampled[s].y, x2 = sampled[s + 1].x, y2 = sampled[s + 1].y;
      const slen = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
      const dur = 0.035 + rand(0, 0.02);
      const w = Math.max(2.5, (sampled.length - s) * 0.9);
      const idx = branches.length;
      branches.push({ x1, y1, x2, y2, w, delay, dur, pid, curve: rand(-0.2, 0.2) });
      delay += dur;
      pid = idx;

      if (s >= 1) {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        grow(x2, y2, ang + rand(0.45, 0.85), slen * rand(0.7, 1.1), depth - 1, delay, idx, w * 0.55);
        grow(x2, y2, ang - rand(0.45, 0.85), slen * rand(0.7, 1.1), depth - 1, delay, idx, w * 0.55);
        if (Math.random() < 0.4)
          grow(x2, y2, ang + rand(-0.2, 0.2), slen * rand(0.5, 0.8), depth - 2, delay, idx, w * 0.45);
      }
    }

    const last = sampled[sampled.length - 1], prev = sampled[sampled.length - 2];
    const tipAng = Math.atan2(last.y - prev.y, last.x - prev.x);
    const tipLen = Math.sqrt((last.x - prev.x) * (last.x - prev.x) + (last.y - prev.y) * (last.y - prev.y));
    const tipW = Math.max(2, 1.5);
    grow(last.x, last.y, tipAng - rand(0.2, 0.5), tipLen * rand(0.5, 0.8), depth, delay, pid, tipW);
    grow(last.x, last.y, tipAng + rand(0.2, 0.5), tipLen * rand(0.5, 0.8), depth, delay, pid, tipW);
    grow(last.x, last.y, tipAng + rand(-0.1, 0.1), tipLen * rand(0.4, 0.65), depth - 1, delay, pid, tipW * 0.8);

    const depthT = rootY / canvas.height;
    return {
      branches, leaves, rootY, startNow: null,
      r: Math.round(lerp(28, 5, depthT)),
      g: Math.round(lerp(45, 12, depthT)),
      b: Math.round(lerp(30, 7, depthT))
    };
  }

  function initFireflies(): void {
    fireflies = [];
    for (let i = 0; i < 9; i++)
      fireflies.push({
        x: rand(50, canvas.width - 50), y: rand(50, canvas.height - 50),
        vx: rand(-0.25, 0.25), vy: rand(-0.2, 0.2), phase: rand(0, Math.PI * 2), speed: rand(0.7, 1.8)
      });
  }

  // Preview/static mode: there is no gesture, so seed one tree from a synthetic
  // upward stroke and render it fully grown.
  function buildSeed(): void {
    if (full) return;
    trees = [];
    const W = canvas.width, H = canvas.height;
    const seed: Point[] = [];
    for (let i = 0; i <= 10; i++) {
      const p = i / 10;
      seed.push({ x: W * 0.5 + Math.sin(p * 2.4) * W * 0.04, y: H * 0.92 - p * H * 0.58 });
    }
    const tree = buildTree(seed);
    if (tree) trees.push(tree);
  }

  function drawBg(el: number): void {
    const W = canvas.width, H = canvas.height;
    const g = ctx!.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a2214'); g.addColorStop(1, '#111a14');
    ctx!.fillStyle = g; ctx!.fillRect(0, 0, W, H);
    const mt = Math.min(1, Math.max(0, (el || 0) - 1) / 4);
    if (mt > 0) {
      const mx = W * 0.65, my = H * 0.2, mr = H * 0.11;
      const grd = ctx!.createRadialGradient(mx, my, 0, mx, my, mr * 2.5);
      grd.addColorStop(0, 'rgba(140,200,150,' + (0.12 * ease(mt)).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(140,200,150,0)');
      ctx!.fillStyle = grd; ctx!.beginPath(); ctx!.arc(mx, my, mr * 2.5, 0, Math.PI * 2); ctx!.fill();
      ctx!.fillStyle = 'rgba(180,220,170,' + (0.15 * ease(mt)).toFixed(3) + ')';
      ctx!.beginPath(); ctx!.arc(mx, my, mr, 0, Math.PI * 2); ctx!.fill();
    }
  }

  function renderTree(tree: Tree, now: number): void {
    if (!tree.startNow) tree.startNow = now;
    const T = full ? Math.min((now - tree.startNow) / 1000 / TOTAL, 1) : 1;
    const W = canvas.width, H = canvas.height;
    const r0 = tree.r, g0 = tree.g, b0 = tree.b;

    const gnd = ctx!.createLinearGradient(0, tree.rootY, 0, H);
    gnd.addColorStop(0, 'rgba(' + r0 + ',' + g0 + ',' + b0 + ',0.82)');
    gnd.addColorStop(0.2, 'rgba(' + r0 + ',' + g0 + ',' + b0 + ',0.97)');
    gnd.addColorStop(1, 'rgba(' + Math.max(0, r0 - 3) + ',' + Math.max(0, g0 - 4) + ',' + Math.max(0, b0 - 2) + ',1)');
    ctx!.fillStyle = gnd; ctx!.fillRect(0, tree.rootY, W, H - tree.rootY);

    ctx!.lineCap = 'round'; ctx!.lineJoin = 'round';
    const br = Math.max(0, r0 - 28), bg = Math.max(0, g0 - 40), bb = Math.max(0, b0 - 28);
    for (let i = 0; i < tree.branches.length; i++) {
      const b = tree.branches[i];
      const lt = Math.max(0, Math.min(1, (T - b.delay) / b.dur));
      if (lt <= 0) continue;
      const e = ease(lt);
      let sx = b.x1, sy = b.y1;
      if (b.pid >= 0) {
        const p = tree.branches[b.pid];
        const pe = ease(Math.max(0, Math.min(1, (T - p.delay) / p.dur)));
        sx = lerp(p.x1, p.x2, pe); sy = lerp(p.y1, p.y2, pe);
      }
      const ex = lerp(sx, b.x2, e), ey = lerp(sy, b.y2, e);
      const cmx = (sx + ex) / 2 + b.curve * (ey - sy) * 0.18;
      const cmy = (sy + ey) / 2 - b.curve * (ex - sx) * 0.18;
      ctx!.beginPath(); ctx!.moveTo(sx, sy);
      ctx!.quadraticCurveTo(cmx, cmy, ex, ey);
      ctx!.strokeStyle = 'rgb(' + br + ',' + bg + ',' + bb + ')';
      ctx!.lineWidth = b.w; ctx!.stroke();
    }

    for (let j = 0; j < tree.leaves.length; j++) {
      const lf = tree.leaves[j];
      const lt2 = Math.max(0, Math.min(1, (T - lf.delay) / 0.25));
      if (lt2 <= 0) continue;
      ctx!.beginPath(); ctx!.arc(lf.x, lf.y, lf.r, 0, Math.PI * 2);
      ctx!.fillStyle = 'rgba(90,130,80,' + (ease(lt2) * 0.65).toFixed(3) + ')'; ctx!.fill();
    }
  }

  function render(now: number): void {
    if (globalStart === null) globalStart = now;
    const el = full ? (now - globalStart) / 1000 : 6;
    const W = canvas.width, H = canvas.height;
    ctx!.clearRect(0, 0, W, H);
    drawBg(trees.length > 0 ? el : 0);

    if (state === 'drawing' && gesture.length > 1) {
      ctx!.save(); ctx!.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx!.lineWidth = 1; ctx!.setLineDash([4, 6]); ctx!.lineCap = 'round';
      ctx!.beginPath(); ctx!.moveTo(gesture[0].x, gesture[0].y);
      for (let i = 1; i < gesture.length; i++) ctx!.lineTo(gesture[i].x, gesture[i].y);
      ctx!.stroke(); ctx!.restore();
    }

    const sorted = trees.slice().sort((a, b) => a.rootY - b.rootY);
    for (let t = 0; t < sorted.length; t++) renderTree(sorted[t], now);

    if (trees.length > 0) {
      const fft = full ? Math.max(0, el - 4) : 3;
      if (fft > 0) for (let f = 0; f < fireflies.length; f++) {
        const ff = fireflies[f];
        ff.x += ff.vx * 0.4 + Math.sin(el * ff.speed + ff.phase) * 0.3;
        ff.y += ff.vy * 0.4 + Math.cos(el * ff.speed * 0.7 + ff.phase) * 0.2;
        if (ff.x < 0) ff.x = W; if (ff.x > W) ff.x = 0;
        if (ff.y < 0) ff.y = H; if (ff.y > H) ff.y = 0;
        const blink = Math.max(0, Math.sin(el * ff.speed * 1.5 + ff.phase));
        const al = ((0.4 + 0.6 * blink) * Math.min(1, fft / 3));
        if (al < 0.05) continue;
        const als = al.toFixed(3);
        const grd2 = ctx!.createRadialGradient(ff.x, ff.y, 0, ff.x, ff.y, 4);
        grd2.addColorStop(0, 'rgba(200,255,180,' + als + ')');
        grd2.addColorStop(1, 'rgba(200,255,180,0)');
        ctx!.fillStyle = grd2; ctx!.beginPath(); ctx!.arc(ff.x, ff.y, 4, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = 'rgba(230,255,210,' + als + ')';
        ctx!.beginPath(); ctx!.arc(ff.x, ff.y, 1, 0, Math.PI * 2); ctx!.fill();
      }
    }

    if (state === 'waiting' && trees.length === 0 && hint) hint.style.opacity = '1';
  }

  // ── Input (full mode only) ─────────────────────────────────────────────────
  const listenerCleanups: (() => void)[] = [];
  function getPos(clientX: number, clientY: number): Point {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  let overlayRoot: HTMLElement | null = null;
  let hint: HTMLElement | null = null;

  if (full) {
    const ov = makeOverlay(() => {
      trees = []; gesture = []; globalStart = null; state = 'waiting';
      if (hint) hint.style.opacity = '1';
    });
    overlayRoot = ov.root; hint = ov.hint;
    (canvas.parentElement ?? document.body).appendChild(overlayRoot);

    const onStart = (clientX: number, clientY: number): void => {
      state = 'drawing'; gesture = [getPos(clientX, clientY)];
      if (hint) hint.style.opacity = '0';
    };
    const onMove = (clientX: number, clientY: number): void => {
      if (state !== 'drawing') return; gesture.push(getPos(clientX, clientY));
    };
    const onEnd = (): void => {
      if (state !== 'drawing') return;
      if (gesture.length < 2) { state = 'waiting'; return; }
      const tree = buildTree(gesture);
      if (tree) trees.push(tree);
      gesture = []; state = 'growing';
    };

    const md = (e: MouseEvent): void => onStart(e.clientX, e.clientY);
    const mm = (e: MouseEvent): void => onMove(e.clientX, e.clientY);
    const mu = (): void => onEnd();
    const ts = (e: TouchEvent): void => { e.preventDefault(); onStart(e.touches[0].clientX, e.touches[0].clientY); };
    const tm = (e: TouchEvent): void => { if (state !== 'drawing') return; e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); };
    const te = (e: TouchEvent): void => { e.preventDefault(); onEnd(); };

    canvas.addEventListener('mousedown', md);
    canvas.addEventListener('mousemove', mm);
    canvas.addEventListener('mouseup', mu);
    canvas.addEventListener('touchstart', ts, { passive: false });
    canvas.addEventListener('touchmove', tm, { passive: false });
    canvas.addEventListener('touchend', te, { passive: false });
    listenerCleanups.push(
      () => canvas.removeEventListener('mousedown', md),
      () => canvas.removeEventListener('mousemove', mm),
      () => canvas.removeEventListener('mouseup', mu),
      () => canvas.removeEventListener('touchstart', ts),
      () => canvas.removeEventListener('touchmove', tm),
      () => canvas.removeEventListener('touchend', te)
    );
  } else {
    buildSeed();
  }

  const loop = createRafLoop((_dt, tMs) => render(tMs), ac.signal);
  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      for (const c of listenerCleanups) c();
      overlayRoot?.remove();
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
