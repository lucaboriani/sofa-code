import type { RoomMount } from '@/lib/webgl/types';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import { VS, FS } from './shaders';
import { sharedState, pushPluck, pushHover, resetState } from './state';

// Ported from line-of-beauty.html — Hogarth's S-curve as a morphing WebGL
// ribbon with a 2D construction-grid overlay. Geometry/colour is verbatim.
// Adaptations: DPR pinned to 1 (the standalone file's overlay/hit-test maths
// only line up at DPR 1); the overlay is a sibling canvas added in full mode
// only; audio moves to the bus (./audio) and is driven through sharedState.

interface Params {
  color: number[];
  reachTopBase: number; reachBotBase: number; tensTopBase: number; tensBotBase: number; halfHBase: number;
  freqRT: number; freqRB: number; freqTT: number; freqTB: number; freqHH: number;
  ampRT: number; ampRB: number; ampTT: number; ampTB: number; ampHH: number;
  phRT: number; phRB: number; phTT: number; phTB: number; phHH: number;
  rot: number; rotSpeed: number; driftSpeed: number; driftAmp: number;
}

type Pt = [number, number];

export const mount: RoomMount = (canvas, opts) => {
  const gl = createContext(canvas, { version: 1, antialias: true, alpha: false }) as WebGLRenderingContext;
  const full = opts.quality === 'full';
  resetState();

  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  // ── GL program ─────────────────────────────────────────────────────────────
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS);
  const prog = linkProgram(gl, vs, fs);
  gl.useProgram(prog);
  const aPos = gl.getAttribLocation(prog, 'pos');
  const aAlpha = gl.getAttribLocation(prog, 'alpha');
  const u = getUniforms(gl, prog, ['res', 'col'] as const);
  const bPos = gl.createBuffer(), bAlpha = gl.createBuffer();
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  // ── Overlay (full mode only — it is a fixed full-screen canvas) ────────────
  let ov: HTMLCanvasElement | null = null;
  let octx: CanvasRenderingContext2D | null = null;
  if (full) {
    ov = document.createElement('canvas');
    ov.setAttribute('data-beauty-overlay', '');
    ov.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    (canvas.parentElement ?? document.body).appendChild(ov);
    octx = ov.getContext('2d');
  }

  // Original rendered at DPR 1; keep it so the overlay grid and hit-tests align.
  let W = 1, H = 1;
  const stopResize = observeResize(canvas, () => {
    W = canvas.width; H = canvas.height;
    gl.viewport(0, 0, W, H);
    if (ov && octx) { ov.width = W; ov.height = H; octx.setTransform(1, 0, 0, 1, 0, 0); }
  }, 1);

  // ── Colour ─────────────────────────────────────────────────────────────────
  function hsl(h: number, s: number, l: number): number[] {
    h /= 360;
    const f = (n: number): number => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  }
  function randCol(): number[] {
    const p = [
      (): number[] => hsl(5 + Math.random() * 12, .92, .54),
      (): number[] => hsl(352 + Math.random() * 12, .92, .54),
      (): number[] => hsl(25 + Math.random() * 13, .95, .56),
      (): number[] => hsl(282 + Math.random() * 28, .78, .58)
    ];
    return p[Math.floor(Math.random() * p.length)]();
  }

  // ── Params (line-of-beauty.html L100-137) ──────────────────────────────────
  let P: Params, t = 0;
  function randomize(): void {
    P = {
      color: randCol(),
      reachTopBase: 0.28 + Math.random() * 0.20,
      reachBotBase: 0.18 + Math.random() * 0.20,
      tensTopBase: 0.55 + Math.random() * 0.25,
      tensBotBase: 0.50 + Math.random() * 0.25,
      halfHBase: 0.30 + Math.random() * 0.10,
      freqRT: 0.00120 + Math.random() * 0.00080,
      freqRB: 0.00140 + Math.random() * 0.00080,
      freqTT: 0.00110 + Math.random() * 0.00070,
      freqTB: 0.00130 + Math.random() * 0.00070,
      freqHH: 0.00080 + Math.random() * 0.00060,
      ampRT: 0.10, ampRB: 0.10, ampTT: 0.18, ampTB: 0.18, ampHH: 0.06,
      phRT: Math.random() * Math.PI * 2, phRB: Math.random() * Math.PI * 2,
      phTT: Math.random() * Math.PI * 2, phTB: Math.random() * Math.PI * 2,
      phHH: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: 0.00025 + Math.random() * 0.00035,
      driftSpeed: 0.00014 + Math.random() * 0.00010,
      driftAmp: 0.014
    };
    t = 0;
  }
  randomize();

  function liveParams(frame: number): { reachTop: number; reachBot: number; tensTop: number; tensBot: number; halfH: number } {
    return {
      reachTop: P.reachTopBase + Math.sin(frame * P.freqRT + P.phRT) * P.ampRT,
      reachBot: P.reachBotBase + Math.sin(frame * P.freqRB + P.phRB) * P.ampRB,
      tensTop: P.tensTopBase + Math.sin(frame * P.freqTT + P.phTT) * P.ampTT,
      tensBot: P.tensBotBase + Math.sin(frame * P.freqTB + P.phTB) * P.ampTB,
      halfH: P.halfHBase + Math.sin(frame * P.freqHH + P.phHH) * P.ampHH
    };
  }

  function getCtrl(frame: number): { top: Pt; mid: Pt; bot: Pt; c1: Pt; c2: Pt; c3: Pt; c4: Pt } {
    const lp = liveParams(frame);
    const cx = W / 2, cy = H / 2;
    const hH = H * lp.halfH;
    const d = Math.sin(frame * P.driftSpeed) * H * P.driftAmp;
    const yTop = cy - hH + d, yMid = cy + d, yBot = cy + hH + d;
    const rT = W * lp.reachTop, rB = W * lp.reachBot;
    const c1y = yTop + (yMid - yTop) * lp.tensTop * 0.4;
    const c2y = yMid - (yMid - yTop) * (1 - lp.tensTop) * 0.4;
    const c1: Pt = [cx - rT, c1y], c2: Pt = [cx - rT, c2y];
    const c3: Pt = [2 * cx - c2[0], 2 * yMid - c2[1]];
    const c4y = yBot - (yBot - yMid) * lp.tensBot * 0.4;
    const c4: Pt = [cx + rB, c4y];
    return { top: [cx, yTop], mid: [cx, yMid], bot: [cx, yBot], c1, c2, c3, c4 };
  }

  function rotPt(p: Pt, a: number): Pt {
    const cx = W / 2, cy = H / 2, dx = p[0] - cx, dy = p[1] - cy;
    return [cx + dx * Math.cos(a) + dy * Math.sin(a), cy - dx * Math.sin(a) + dy * Math.cos(a)];
  }

  function evalS(uu: number, frame: number): Pt {
    const { top, mid, bot, c1, c2, c3, c4 } = getCtrl(frame);
    const bez = (tt: number, p0: number, p1: number, p2: number, p3: number): number => {
      const m = 1 - tt; return m * m * m * p0 + 3 * m * m * tt * p1 + 3 * m * tt * tt * p2 + tt * tt * tt * p3;
    };
    let x: number, y: number;
    if (uu <= 0.5) { const s = uu * 2; x = bez(s, top[0], c1[0], c2[0], mid[0]); y = bez(s, top[1], c1[1], c2[1], mid[1]); }
    else { const s = (uu - 0.5) * 2; x = bez(s, mid[0], c3[0], c4[0], bot[0]); y = bez(s, mid[1], c3[1], c4[1], bot[1]); }
    return rotPt([x, y], P.rot + frame * P.rotSpeed);
  }

  // ── WebGL ribbon (line-of-beauty.html L182-196) ────────────────────────────
  const N = 500;
  function buildRibbon(frame: number, ga: number): { pos: Float32Array; alp: Float32Array; count: number } {
    const spine: Pt[] = [];
    for (let i = 0; i <= N; i++) spine.push(evalS(i / N, frame));
    const pos: number[] = [], alp: number[] = [];
    for (let i = 0; i <= N; i++) {
      const p = spine[i], prev = spine[Math.max(0, i - 1)], next = spine[Math.min(N, i + 1)];
      const dx = next[0] - prev[0], dy = next[1] - prev[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len, ny = dx / len, fade = Math.sin(i / N * Math.PI) * ga;
      pos.push(p[0] + nx * 1.2, p[1] + ny * 1.2, p[0] - nx * 1.2, p[1] - ny * 1.2);
      alp.push(fade, fade);
    }
    return { pos: new Float32Array(pos), alp: new Float32Array(alp), count: (N + 1) * 2 };
  }

  // ── String hit detection ─────────────────────────────────────────────────
  let currentAxes: [Pt, Pt][] = [];
  let struckProximity = 1.0;
  let struckAxis = -1, struckExcite = 0;
  let hoverCooldown = 0, lastHoverAxis = -1;

  function distToLine(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy) || 1;
    return Math.abs((py - ay) * dx - (px - ax) * dy) / len;
  }
  function hitAxis(mx: number, my: number): number {
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < currentAxes.length; i++) {
      const [a, b] = currentAxes[i];
      const d = distToLine(mx, my, a[0], a[1], b[0], b[1]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    struckProximity = Math.max(0, 1 - bestDist / 300);
    return best;
  }

  // ── 2D construction overlay (line-of-beauty.html L221-296) ──────────────────
  function drawConstruction(frame: number): void {
    if (!octx || !ov) return;
    octx.clearRect(0, 0, ov.width, ov.height);
    const angle = P.rot + frame * P.rotSpeed;
    const { top, mid, bot, c1, c2, c3, c4 } = getCtrl(frame);
    const rTop = rotPt(top, angle), rMid = rotPt(mid, angle), rBot = rotPt(bot, angle);
    const rC1 = rotPt(c1, angle), rC2 = rotPt(c2, angle);
    const rC3 = rotPt(c3, angle), rC4 = rotPt(c4, angle);

    const FAR = 5000;
    const GRID_LINES = 18;
    const GRID_STEP = 28;

    function grid(a: Pt, b: Pt, baseAlpha: number, excite: number): void {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ax = dx / len, ay = dy / len;
      const px = -ay, py = ax;

      function gridLine(ox: number, oy: number, alpha: number, glow = false): void {
        const sx = a[0] + ox, sy = a[1] + oy;
        if (glow) {
          octx!.lineWidth = 1.0 + excite * 2;
          octx!.strokeStyle = `rgba(220,200,180,${alpha})`;
        } else {
          octx!.lineWidth = 0.5;
          octx!.strokeStyle = `rgba(110,110,110,${alpha})`;
        }
        const x0 = Math.round(sx - ax * FAR) + 0.5, y0 = Math.round(sy - ay * FAR) + 0.5;
        const x1 = Math.round(sx + ax * FAR) + 0.5, y1 = Math.round(sy + ay * FAR) + 0.5;
        octx!.beginPath();
        octx!.moveTo(x0, y0);
        octx!.lineTo(x1, y1);
        octx!.stroke();
      }

      const vibAmp = excite * 6 * Math.sin(t * 0.8);
      const vox = px * vibAmp, voy = py * vibAmp;
      gridLine(vox, voy, baseAlpha, excite > 0.01);
      for (let i = 1; i <= GRID_LINES; i++) {
        const fade = Math.pow(1 - i / GRID_LINES, 1.4) * baseAlpha * 0.85;
        if (fade < 0.01) continue;
        const ox = px * i * GRID_STEP, oy = py * i * GRID_STEP;
        gridLine(ox + vox * 0.3, oy + voy * 0.3, fade);
        gridLine(-ox + vox * 0.3, -oy + voy * 0.3, fade);
      }
    }

    currentAxes = [[rTop, rC1], [rC2, rMid], [rMid, rC3], [rC4, rBot], [rC1, rC2], [rC3, rC4]];
    const baseAlphas = [0.62, 0.58, 0.58, 0.62, 0.42, 0.42];
    currentAxes.forEach(([a, b], i) => {
      const lit = (i === struckAxis);
      const ex = lit ? struckExcite : 0;
      const ba = baseAlphas[i] * (1 + ex * 2.5);
      grid(a, b, ba, lit ? ex : 0);
    });

    const dot = (p: Pt, r: number): void => { octx!.beginPath(); octx!.arc(p[0], p[1], r, 0, Math.PI * 2); octx!.fill(); };
    octx.fillStyle = 'rgba(90,90,90,0.80)';
    dot(rTop, 2.2); dot(rMid, 2.2); dot(rBot, 2.2);

    if (struckExcite > 0) struckExcite *= 0.97;
    else struckExcite = 0;
  }

  // ── Render (line-of-beauty.html L298-321) ───────────────────────────────────
  const TRAILS = 24, TGAP = 15;
  const loop = createRafLoop(() => {
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.res, W, H);
    gl.uniform3f(u.col, P.color[0], P.color[1], P.color[2]);
    for (let g = TRAILS; g >= 0; g--) {
      const ft = t - g * TGAP; if (ft < 0) continue;
      const a = g === 0 ? 0.95 : Math.pow(1 - g / TRAILS, 3) * 0.20;
      const { pos, alp, count } = buildRibbon(ft, a);
      gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bAlpha); gl.bufferData(gl.ARRAY_BUFFER, alp, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aAlpha); gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);
    }
    if (full) drawConstruction(t);
    if (full) {
      sharedState.angle = P.rot + t * P.rotSpeed;
      // dragVel/isDragging are written by the pointer handlers
    }
    t++;
  }, ac.signal);

  // ── Input (full mode only) ─────────────────────────────────────────────────
  const listenerCleanups: (() => void)[] = [];
  let dragX: number | null = null;

  function onDragStart(x: number): void { dragX = x; sharedState.isDragging = true; sharedState.dragVel = 0; }
  function onDragMove(x: number): void {
    if (dragX === null) return;
    const dx = x - dragX;
    sharedState.dragVel = dx;
    P.rot += dx * 0.008;
    dragX = x;
  }
  function onDragEnd(): void { dragX = null; sharedState.isDragging = false; }

  function pluckString(mx: number, my: number): void {
    const axis = hitAxis(mx, my);
    if (axis < 0) return;
    struckAxis = axis;
    struckExcite = 0.4 + struckProximity * 0.6;
    pushPluck({ axis, prox: struckProximity });
  }
  function hoverString(mx: number, my: number): void {
    const axis = hitAxis(mx, my);
    if (hoverCooldown > 0) { hoverCooldown--; return; }
    if (axis === lastHoverAxis) return;
    lastHoverAxis = axis;
    hoverCooldown = 8;
    if (struckAxis !== axis) {
      struckAxis = axis;
      struckExcite = 0.15 + struckProximity * 0.12;
    }
    if (axis >= 0) pushHover({ axis, prox: struckProximity });
  }
  function releaseString(): void { struckAxis = -1; }

  if (full) {
    let lastTap = 0;
    const rect = (): DOMRect => canvas.getBoundingClientRect();
    const md = (e: MouseEvent): void => { const r = rect(); onDragStart(e.clientX); pluckString(e.clientX - r.left, e.clientY - r.top); };
    const mu = (): void => releaseString();
    const dbl = (): void => randomize();
    const ts = (e: TouchEvent): void => { e.preventDefault(); const r = rect(); onDragStart(e.touches[0].clientX); pluckString(e.touches[0].clientX - r.left, e.touches[0].clientY - r.top); };
    const te = (e: TouchEvent): void => {
      onDragEnd(); releaseString();
      const n = e.timeStamp; if (n - lastTap < 300) randomize(); lastTap = n;
    };
    const wmm = (e: MouseEvent): void => {
      const r = rect();
      if (dragX !== null) onDragMove(e.clientX);
      if (!sharedState.isDragging) hoverString(e.clientX - r.left, e.clientY - r.top);
    };
    const wmu = (): void => onDragEnd();
    const wtm = (e: TouchEvent): void => { if (dragX !== null) { e.preventDefault(); onDragMove(e.touches[0].clientX); } };

    canvas.addEventListener('mousedown', md);
    canvas.addEventListener('mouseup', mu);
    canvas.addEventListener('dblclick', dbl);
    canvas.addEventListener('touchstart', ts, { passive: false });
    canvas.addEventListener('touchend', te);
    window.addEventListener('mousemove', wmm);
    window.addEventListener('mouseup', wmu);
    window.addEventListener('touchmove', wtm, { passive: false });
    listenerCleanups.push(
      () => canvas.removeEventListener('mousedown', md),
      () => canvas.removeEventListener('mouseup', mu),
      () => canvas.removeEventListener('dblclick', dbl),
      () => canvas.removeEventListener('touchstart', ts),
      () => canvas.removeEventListener('touchend', te),
      () => window.removeEventListener('mousemove', wmm),
      () => window.removeEventListener('mouseup', wmu),
      () => window.removeEventListener('touchmove', wtm)
    );
  }

  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      for (const c of listenerCleanups) c();
      ov?.remove();
      try { gl.deleteProgram(prog); } catch { /* idempotent */ }
      try { gl.deleteBuffer(bPos); } catch { /* idempotent */ }
      try { gl.deleteBuffer(bAlpha); } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
