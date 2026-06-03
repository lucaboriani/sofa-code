import type { RoomMount } from '@/lib/webgl/types';
import type { AudioFactory } from '@/lib/audio/bus';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';

// Ported from bindu.html — every constant and formula is verbatim.
// Adaptations: AudioBus owns the AudioContext; the ॐ start overlay is replaced
// by the app's AudioPrompt; setInterval walkers run from tick().

const NUM_LINES = { preview: 300, full: 1200 } as const;
const SEGS = 80;
const VPL = SEGS + 1;
const FLOATS = 7;

// ─── Shared visual → audio state ─────────────────────────────────────────────

const sharedState = {
  dragX: 0,   // smoothed drag velocity, client px/frame
  dragY: 0,
  dist: 20    // camera distance (zoom)
};

// ─── Shaders (bindu.html L59-61) ─────────────────────────────────────────────

const VS = `attribute vec3 aPos;attribute vec4 aCol;uniform mat4 uMVP;varying vec4 vC;
void main(){gl_Position=uMVP*vec4(aPos,1.);vC=aCol;}`;
const FS = `precision mediump float;varying vec4 vC;void main(){gl_FragColor=vC;}`;

// ─── Math (bindu.html L72-94) ────────────────────────────────────────────────

function persp(fov: number, asp: number, n: number, f: number): Float32Array {
  const t = 1 / Math.tan(fov * 0.5), nf = 1 / (n - f);
  return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]);
}

function lookAt(ex: number, ey: number, ez: number): Float32Array {
  let zx = ex, zy = ey, zz = ez;
  const zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx: number, xy: number, xz: number;
  if (Math.abs(zy) > 0.99) { xx = 1; xy = 0; xz = 0; }
  else {
    xx = -zz; xy = 0; xz = zx;
    const xl = Math.sqrt(xx * xx + xz * xz) || 1;
    xx /= xl; xz /= xl;
  }
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * ex + xy * ey + xz * ez), -(yx * ex + yy * ey + yz * ez), -(zx * ex + zy * ey + zz * ez), 1
  ]);
}

function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[row + k * 4] * b[k + c * 4];
      r[row + c * 4] = v;
    }
  }
  return r;
}

// ─── Line templates (bindu.html L158-175) ────────────────────────────────────

interface Line {
  ta: number; ra: number; sa: number;
  dx: number; dy: number; dz: number;
  maxLen: number;
  cr: number; cg: number; cb: number;
  baseA: number;
  t: number;
  life: number;
}

function makeTemplate(): Omit<Line, 't' | 'life'> {
  let ta = Math.random(), ra = Math.random(), sa = Math.random();
  const tot = ta + ra + sa;
  ta /= tot; ra /= tot; sa /= tot;
  const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
  return {
    ta, ra, sa,
    dx: Math.sin(ph) * Math.cos(th), dy: Math.sin(ph) * Math.sin(th), dz: Math.cos(ph),
    maxLen: 0.5 + Math.random() * Math.random() * 4.2,
    cr: Math.min(1, ta * 0.06 + ra * 0.88 + sa * 1.0),
    cg: Math.min(1, ta * 0.02 + ra * 0.13 + sa * 1.0),
    cb: Math.min(1, ta * 0.10 + ra * 0.10 + sa * 1.0),
    baseA: 0.12 + sa * 0.46 + ra * 0.24
  };
}

function resetLine(ln: Line): void {
  Object.assign(ln, makeTemplate());
  ln.t = 0;
  ln.life = 3 + Math.random() * 7;
}

// ─── Audio factory (bindu.html L235-431) ─────────────────────────────────────

export const createAudio: AudioFactory = (ctx) => {
  // master is the node handed to the AudioBus (original connected it to destination)
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 5);

  // Long cave reverb (6 s)
  const conv = ctx.createConvolver();
  const irLen = Math.floor(ctx.sampleRate * 6);
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 1.35);
  }
  conv.buffer = ir;
  const convG = ctx.createGain();
  convG.gain.value = 0.65;
  conv.connect(convG); convG.connect(master);

  // Dry
  const dry = ctx.createGain();
  dry.gain.value = 0.35;
  dry.connect(master);

  // Low-pass — drag horizontal controls cutoff
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = 380; lpf.Q.value = 0.5;
  lpf.connect(dry); lpf.connect(conv);

  // Global pitch detune — drag vertical
  const det = ctx.createConstantSource();
  det.offset.value = 0;
  det.start();

  const ROOT = 55;

  const voices = [
    { d: 0, a: 0.30 }, { d: -4, a: 0.22 }, { d: 5, a: 0.20 }, { d: -8, a: 0.17 },
    { d: 13, a: 0.14 }, { d: -15, a: 0.11 }, { d: 20, a: 0.09 }, { d: -23, a: 0.08 }
  ];
  const harmonics = [
    { r: 1, g: 0.58 }, { r: 2, g: 0.30 }, { r: 3, g: 0.20 }, { r: 4, g: 0.09 },
    { r: 5, g: 0.14 }, { r: 6, g: 0.06 }, { r: 8, g: 0.04 }
  ];

  voices.forEach(({ d, a }) => {
    const vg = ctx.createGain();
    vg.gain.value = a;
    vg.connect(lpf);
    harmonics.forEach(({ r, g }) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = ROOT * r;
      osc.detune.value = d;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13 + Math.random() * 0.09;
      const lg = ctx.createGain();
      lg.gain.value = 0.8 + Math.random() * 0.6;
      lfo.connect(lg); lg.connect(osc.detune); lfo.start();
      det.connect(osc.detune);
      const hg = ctx.createGain();
      hg.gain.value = g;
      osc.connect(hg); hg.connect(vg); osc.start();
    });
  });

  // Sub: 27.5 Hz
  const sub = ctx.createOscillator();
  sub.type = 'sine'; sub.frequency.value = ROOT * 0.5;
  const subG = ctx.createGain();
  subG.gain.value = 0.12;
  det.connect(sub.detune);
  sub.connect(subG); subG.connect(master); sub.start();

  // Slow breath swell ~8s
  const sw = ctx.createOscillator();
  sw.frequency.value = 0.12;
  const swG = ctx.createGain();
  swG.gain.value = 0.05;
  sw.connect(swG); swG.connect(master.gain); sw.start();

  // Vowel bandpass, parallel with lpf
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass'; bpf.frequency.value = 220; bpf.Q.value = 4.5;
  lpf.connect(bpf);
  const bpG = ctx.createGain();
  bpG.gain.value = 0.12;
  bpf.connect(bpG); bpG.connect(dry); bpG.connect(conv);

  // Random walkers (original setInterval(50ms) → tick-driven accumulator)
  interface Walker { cur: number; target: number; min: number; max: number; nextAt: number; onTick(v: number): void; }
  const walkers: Walker[] = [
    {
      cur: 380, target: 380, min: 120, max: 700, nextAt: 0,
      onTick: v => { lpf.frequency.setTargetAtTime(v, ctx.currentTime, 1.2); }
    },
    {
      cur: 0.22, target: 0.22, min: 0.16, max: 0.26, nextAt: 0,
      onTick: v => { master.gain.setTargetAtTime(v, ctx.currentTime, 2.5); }
    },
    {
      cur: 220, target: 220, min: 90, max: 480, nextAt: 0,
      onTick: v => { bpf.frequency.setTargetAtTime(v, ctx.currentTime, 1.8); }
    }
  ];
  function scheduleWalker(w: Walker): void {
    w.target = w.min + Math.random() * (w.max - w.min);
    w.nextAt = ctx.currentTime + 4 + Math.random() * 10;
  }
  walkers.forEach(scheduleWalker);
  let lastWalk = ctx.currentTime;

  // Zoom-reactive white noise
  const noiseLen = Math.floor(ctx.sampleRate * 2);
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
  const noiseNode = ctx.createBufferSource();
  noiseNode.buffer = noiseBuf;
  noiseNode.loop = true;
  noiseNode.start();

  const nhpf = ctx.createBiquadFilter();
  nhpf.type = 'highpass'; nhpf.frequency.value = 800; nhpf.Q.value = 0.7;
  noiseNode.connect(nhpf);

  const nbpf = ctx.createBiquadFilter();
  nbpf.type = 'bandpass'; nbpf.frequency.value = 3000; nbpf.Q.value = 1.2;
  nhpf.connect(nbpf);

  const ng = ctx.createGain();
  ng.gain.value = 0;
  nbpf.connect(ng);
  ng.connect(master);

  return {
    node: master,
    tick(): void {
      const now = ctx.currentTime;

      // walkers at the original 50ms cadence (bindu.html L343-352)
      if (now - lastWalk >= 0.05) {
        lastWalk = now;
        for (const w of walkers) {
          w.cur += (w.target - w.cur) * 0.08;
          w.onTick(w.cur);
          if (now >= w.nextAt) scheduleWalker(w);
        }
      }

      // updateAudio(vx, vy, zoom) — bindu.html L389-431, formulas verbatim
      const vx = sharedState.dragX, vy = sharedState.dragY, zoom = sharedState.dist;

      const nt = Math.max(0, (9 - zoom) / (9 - 0.3));
      const noiseAmt = Math.min(0.025, 0.025 * Math.pow(nt, 4));
      ng.gain.setTargetAtTime(noiseAmt, now, 0.6);
      const hpTarget = Math.max(200, Math.min(4000, 800 + vx * 60));
      nhpf.frequency.setTargetAtTime(hpTarget, now, 0.15);
      const bpTarget = Math.max(800, Math.min(8000, 3000 - vy * 80));
      nbpf.frequency.setTargetAtTime(bpTarget, now, 0.15);

      const baseF = walkers[0].cur;
      const targetF = Math.max(40, Math.min(1800, baseF + vx * 55));
      lpf.frequency.setTargetAtTime(targetF, now, 0.12);

      const targetD = Math.max(-200, Math.min(200, -vy * 11));
      det.offset.setTargetAtTime(targetD, now, 0.18);

      const baseB = walkers[2].cur;
      const targetB = Math.max(60, Math.min(900, baseB + vx * 30));
      bpf.frequency.setTargetAtTime(targetB, now, 0.18);

      const baseG = walkers[1].cur;
      const targetG = Math.max(0.06, Math.min(0.40, baseG - vy * 0.008));
      walkers[1].cur = targetG;
    }
  };
};

// ─── Overlay (bindu.html L11-24, 39-44) ──────────────────────────────────────

function makeOverlay(): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-bindu-overlay', '');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';

  const title = document.createElement('div');
  title.textContent = 'Bindu · The Origin';
  title.style.cssText =
    'position:absolute;top:26px;left:50%;transform:translateX(-50%);' +
    "font-family:'Georgia',serif;font-size:12px;letter-spacing:.35em;" +
    'color:rgba(255,255,255,.14);text-transform:uppercase;white-space:nowrap;';

  const ui = document.createElement('div');
  ui.style.cssText =
    'position:absolute;bottom:26px;left:50%;transform:translateX(-50%);' +
    "display:flex;gap:26px;font-family:'Georgia',serif;font-size:10px;" +
    'letter-spacing:.22em;color:rgba(255,255,255,.22);text-transform:uppercase;';
  const gunas: [string, string][] = [
    ['Tamas', 'background:#111;border:1px solid #444'],
    ['Rajas', 'background:#c03020'],
    ['Sattva', 'background:rgba(255,255,255,.82)']
  ];
  for (const [label, dotStyle] of gunas) {
    const guna = document.createElement('div');
    guna.style.cssText = 'display:flex;align-items:center;gap:7px;';
    const dot = document.createElement('div');
    dot.style.cssText = `width:5px;height:5px;border-radius:50%;${dotStyle}`;
    guna.appendChild(dot);
    guna.appendChild(document.createTextNode(label));
    ui.appendChild(guna);
  }

  root.appendChild(title);
  root.appendChild(ui);
  return root;
}

// ─── Mount ───────────────────────────────────────────────────────────────────

export const mount: RoomMount = (canvas, opts) => {
  const gl = createContext(canvas, { version: 1, antialias: true, alpha: false }) as WebGLRenderingContext;
  gl.getExtension('OES_element_index_uint');
  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  const full = opts.quality === 'full';
  const NUM = NUM_LINES[opts.quality];

  // ── GL setup ───────────────────────────────────────────────────────────────
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS);
  const prog = linkProgram(gl, vs, fs);
  gl.useProgram(prog);
  const LP = gl.getAttribLocation(prog, 'aPos');
  const LC = gl.getAttribLocation(prog, 'aCol');
  const u = getUniforms(gl, prog, ['uMVP'] as const);

  // Original rendered at DPR 1 (canvas.width = innerWidth) — keep it for
  // identical 1-px additive line density.
  let W = 1, H = 1;
  const stopResize = observeResize(canvas, () => {
    W = canvas.width;
    H = canvas.height;
    gl.viewport(0, 0, W, H);
  }, 1);

  // ── Camera (bindu.html L96-151) ────────────────────────────────────────────
  const cam = { yaw: 0, pitch: 0.22, dist: 20, vy: 0.18, vp: 0 };
  const FRIC = 0.995, DSENS = 0.006;
  let isDrag = false, dX = 0, dY = 0, dDX = 0, dDY = 0;
  let sDX = 0, sDY = 0;
  const listenerCleanups: (() => void)[] = [];

  if (full) {
    const onMouseDown = (e: MouseEvent): void => {
      isDrag = true; dX = e.clientX; dY = e.clientY; dDX = dDY = 0;
    };
    const onMouseMove = (e: MouseEvent): void => {
      if (!isDrag) return;
      dDX = e.clientX - dX; dDY = e.clientY - dY;
      cam.yaw -= dDX * DSENS; cam.pitch -= dDY * DSENS * 0.55;
      cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch));
      dX = e.clientX; dY = e.clientY;
    };
    const onMouseUp = (): void => {
      if (isDrag) { cam.vy = -dDX * DSENS * 60; cam.vp = -dDY * DSENS * 0.55 * 60; }
      isDrag = false; dDX = dDY = 0;
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      cam.dist = Math.max(0.3, Math.min(60, cam.dist + e.deltaY * 0.012));
    };

    const touches: Record<number, { x: number; y: number; dx: number; dy: number }> = {};
    let pinch0: number | null = null;
    const onTouchStart = (e: TouchEvent): void => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        touches[t.identifier] = { x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
      }
      if (e.touches.length === 2) {
        const a = e.touches[0], b = e.touches[1];
        pinch0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      }
      if (e.touches.length === 1) { dDX = dDY = 0; }
    };
    const onTouchMove = (e: TouchEvent): void => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const a = e.touches[0], b = e.touches[1];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinch0 !== null) cam.dist = Math.max(0.3, Math.min(60, cam.dist - (d - pinch0) * 0.12));
        pinch0 = d;
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0], p = touches[t.identifier];
        if (p) {
          dDX = t.clientX - p.x; dDY = t.clientY - p.y;
          p.dx = dDX; p.dy = dDY;
          cam.yaw -= dDX * DSENS; cam.pitch -= dDY * DSENS * 0.55;
          cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch));
          p.x = t.clientX; p.y = t.clientY;
        }
      }
    };
    const onTouchEnd = (e: TouchEvent): void => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        const p = touches[t.identifier];
        if (p && e.touches.length === 0) { cam.vy = -p.dx * DSENS * 60; cam.vp = -p.dy * DSENS * 0.55 * 60; }
        delete touches[t.identifier];
      }
      if (e.touches.length < 2) pinch0 = null;
      if (e.touches.length === 0) { dDX = dDY = 0; isDrag = false; }
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    listenerCleanups.push(
      () => canvas.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => canvas.removeEventListener('wheel', onWheel),
      () => canvas.removeEventListener('touchstart', onTouchStart),
      () => canvas.removeEventListener('touchmove', onTouchMove),
      () => canvas.removeEventListener('touchend', onTouchEnd)
    );
  }

  // isDrag is mouse-only, exactly as in bindu.html: touch drags drive the
  // camera through dDX/dDY directly while isDrag stays false, so the audio
  // EMA below ((isDrag ? dDX : 0)) deliberately ignores touch drags.

  // ── Overlay (full mode only) ───────────────────────────────────────────────
  let overlayRoot: HTMLElement | null = null;
  if (full) {
    overlayRoot = makeOverlay();
    (canvas.parentElement ?? document.body).appendChild(overlayRoot);
  }

  // ── Lines (bindu.html L153-233) ────────────────────────────────────────────
  const vtx = new Float32Array(NUM * VPL * FLOATS);
  const lines: Line[] = [];
  for (let i = 0; i < NUM; i++) {
    lines.push({ ...makeTemplate(), t: Math.random() * (3 + Math.random() * 7), life: 3 + Math.random() * 7 });
  }

  function updateGeometry(): void {
    for (let l = 0; l < NUM; l++) {
      const ln = lines[l];
      const p = Math.min(ln.t / ln.life, 1);

      const travelDist = ln.maxLen * 1.6;
      const tipDist = travelDist * p;
      const tailLen = ln.maxLen * 0.55;
      const tailDist = Math.max(0, tipDist - tailLen);
      const birthRamp = Math.min(p / 0.08, 1.0);

      for (let seg = 0; seg <= SEGS; seg++) {
        const uu = seg / SEGS;
        const di = tailDist + uu * (tipDist - tailDist);

        let px = ln.dx * di, py = ln.dy * di, pz = ln.dz * di;
        py += ln.ta * di * di * 0.65;
        py -= ln.sa * di * di * 0.45;
        if (ln.ra > 0.03) {
          const ang = ln.ra * di * 3 + ln.t * ln.ra * 2.2;
          const ca = Math.cos(ang), si = Math.sin(ang);
          const nx = px * ca - pz * si, nz = px * si + pz * ca;
          px = nx; pz = nz;
          const ro = ln.ra * di * 0.22;
          px += Math.cos(ang * 1.3) * ro;
          py += Math.sin(ang * 0.7) * ro * 0.2;
        }

        const alpha = Math.min(ln.baseA * uu * uu * birthRamp, 1.0);

        const vi = (l * VPL + seg) * FLOATS;
        vtx[vi] = px; vtx[vi + 1] = py; vtx[vi + 2] = pz;
        vtx[vi + 3] = ln.cr; vtx[vi + 4] = ln.cg; vtx[vi + 5] = ln.cb; vtx[vi + 6] = alpha;
      }
    }
  }

  const idxArr = new Uint32Array(NUM * SEGS * 2);
  {
    let p = 0;
    for (let l = 0; l < NUM; l++) {
      const b = l * VPL;
      for (let s = 0; s < SEGS; s++) { idxArr[p++] = b + s; idxArr[p++] = b + s + 1; }
    }
  }
  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxArr, gl.STATIC_DRAW);
  const vtxBuf = gl.createBuffer();

  function uploadGeometry(): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, vtxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, vtx, gl.DYNAMIC_DRAW);
    const B = FLOATS * 4;
    gl.enableVertexAttribArray(LP); gl.vertexAttribPointer(LP, 3, gl.FLOAT, false, B, 0);
    gl.enableVertexAttribArray(LC); gl.vertexAttribPointer(LC, 4, gl.FLOAT, false, B, 12);
  }

  // ── Render loop (bindu.html L444-489) ──────────────────────────────────────
  const loop = createRafLoop((dtMs, _ts) => {
    const dt = Math.min(dtMs * 0.001, 0.05);

    // Camera inertia
    if (!isDrag) {
      cam.yaw += cam.vy * dt;
      cam.pitch += cam.vp * dt;
      cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch));
      cam.vy *= FRIC; cam.vp *= FRIC;
    }

    // Smooth drag velocity for audio (exponential moving average)
    sDX = sDX * 0.75 + (isDrag ? dDX : 0) * 0.25;
    sDY = sDY * 0.75 + (isDrag ? dDY : 0) * 0.25;
    if (full) {
      sharedState.dragX = sDX;
      sharedState.dragY = sDY;
      sharedState.dist = cam.dist;
    }

    // MVP
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const ex = cam.dist * cp * Math.sin(cam.yaw);
    const ey = cam.dist * sp;
    const ez = cam.dist * cp * Math.cos(cam.yaw);
    const mvp = mul4(persp(Math.PI / 3.5, W / H, 0.05, 120), lookAt(ex, ey, ez));
    gl.uniformMatrix4fv(u.uMVP, false, mvp);

    // Lines
    for (let l = 0; l < NUM; l++) {
      const ln = lines[l];
      ln.t += dt;
      if (ln.t >= ln.life) resetLine(ln);
    }
    updateGeometry();
    uploadGeometry();

    // Draw
    gl.clearColor(0.023, 0, 0.012, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.drawElements(gl.LINES, NUM * SEGS * 2, gl.UNSIGNED_INT, 0);
  }, ac.signal);

  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      for (const cleanup of listenerCleanups) cleanup();
      overlayRoot?.remove();
      try { gl.deleteProgram(prog); } catch { /* idempotent */ }
      try { gl.deleteBuffer(idxBuf); } catch { /* idempotent */ }
      try { gl.deleteBuffer(vtxBuf); } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
