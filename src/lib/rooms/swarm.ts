import type { RoomMount } from '@/lib/webgl/types';
import type { AudioFactory } from '@/lib/audio/bus';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';

const WEB_COUNT = { preview: 40, full: 260 } as const;

// ── Shared state: bridges the RAF loop (visual) → audio tick ─────────────────
const sharedState = {
  speedEMA: 0,   // EMA of mean |velocity| across webs, normalised [0..1]
  alphaEMA: 0,   // EMA of mean web alpha [0..1]
  pinchScale: 1  // current pinch scale from interaction (1 = no pinch)
};

// ── Shader sources ────────────────────────────────────────────────────────────

const STRAND_VS = `
attribute vec2 aA;
attribute vec2 aB;
attribute float aBaseAlpha;
attribute float aSide;
attribute float aT;
uniform vec2  uTrans;
uniform float uScale;
uniform float uCos;
uniform float uSin;
uniform float uAlpha;
uniform vec2  uRes;
uniform float uW;
uniform vec3  uCol;
varying float vSide;
varying float vAl;
varying vec3  vCol;
void main(){
  vec2 rA=vec2(aA.x*uCos-aA.y*uSin, aA.x*uSin+aA.y*uCos)*uScale+uTrans;
  vec2 rB=vec2(aB.x*uCos-aB.y*uSin, aB.x*uSin+aB.y*uCos)*uScale+uTrans;
  vec2 d=rB-rA;
  float len=length(d);
  vec2 n=(len>0.001)?vec2(-d.y,d.x)/len:vec2(0.,1.);
  vec2 pos=mix(rA,rB,aT)+n*aSide*uW;
  vec2 clip=(pos/uRes)*2.-1.;
  gl_Position=vec4(clip.x,-clip.y,0.,1.);
  vSide=aSide;
  vAl=aBaseAlpha*uAlpha;
  vCol=uCol;
}`.trim();

const STRAND_FS = `
precision mediump float;
varying float vSide;
varying float vAl;
varying vec3  vCol;
void main(){
  float a=smoothstep(1.,.1,abs(vSide))*vAl;
  gl_FragColor=vec4(vCol*a,a);
}`.trim();

const QUAD_VS = `
attribute vec2 aPos; varying vec2 vUv;
void main(){vUv=aPos*.5+.5;gl_Position=vec4(aPos,0.,1.);}`.trim();

function makeBlurFS(horiz: boolean): string {
  const d = horiz
    ? 'vec2(float(i-3)*px.x*2.,0.)'
    : 'vec2(0.,float(i-3)*px.y*2.)';
  return [
    'precision mediump float;',
    'uniform sampler2D uTex;uniform vec2 uRes;varying vec2 vUv;',
    'float w(int i){if(i==0||i==6)return 0.0625;if(i==1||i==5)return 0.109375;if(i==2||i==4)return 0.21875;return 0.25;}',
    `void main(){vec2 px=1./uRes;vec4 c=vec4(0.);for(int i=0;i<7;i++)c+=texture2D(uTex,vUv+${d})*w(i);gl_FragColor=c;}`
  ].join('\n');
}

const COMP_FS = `
precision mediump float;
uniform sampler2D uSharp,uBlur;uniform float uBloom;varying vec2 vUv;
void main(){gl_FragColor=clamp(texture2D(uSharp,vUv)+texture2D(uBlur,vUv)*uBloom,0.,1.);}`.trim();

// ── Geometry helpers (local unit coords) ─────────────────────────────────────

// Stride: aA(2)+aB(2)+aBaseAlpha(1)+aSide(1)+aT(1) = 7 floats
const STRIDE = 7;
const SEG = 18; // bezier subdivisions

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function rand(a: number, b: number): number { return a + Math.random() * (b - a); }

function pushSeg(buf: number[], ax: number, ay: number, bx: number, by: number, alA: number, alB: number): void {
  // 6 verts × 7 floats — expanded line quad. Each row: aA.xy aB.xy aBaseAlpha aSide aT
  buf.push(
    ax, ay, bx, by, alA, -1, 0,
    ax, ay, bx, by, alA, +1, 0,
    ax, ay, bx, by, alB, -1, 1,
    ax, ay, bx, by, alB, -1, 1,
    ax, ay, bx, by, alA, +1, 0,
    ax, ay, bx, by, alB, +1, 1,
  );
}

function pushBez(buf: number[], ax: number, ay: number, cx: number, cy: number, bx: number, by: number, alA: number, alB: number): void {
  let px = ax, py = ay, pal = alA;
  for (let i = 1; i <= SEG; i++) {
    const t = i / SEG, u = 1 - t;
    const qx = u * u * ax + 2 * u * t * cx + t * t * bx;
    const qy = u * u * ay + 2 * u * t * cy + t * t * by;
    const al = lerp(alA, alB, t);
    pushSeg(buf, px, py, qx, qy, pal, al);
    px = qx; py = qy; pal = al;
  }
}

function makeAngles(n: number, jitter: number): number[] {
  const base = (Math.PI * 2) / n;
  let acc = 0;
  const out: number[] = [];
  for (let s = 0; s < n; s++) { acc += base * rand(1 - jitter, 1 + jitter); out.push(acc); }
  const sc = (Math.PI * 2) / acc;
  for (let s = 0; s < n; s++) out[s] *= sc;
  return out;
}

// ── Web type bakers (return Float32Array in local unit coords) ────────────────

function bakeOrb(): Float32Array {
  const buf: number[] = [];
  const ns = Math.round(rand(10, 17));
  const nr = Math.round(rand(6, 11));
  const hubR = rand(0.04, 0.09);
  const angls = makeAngles(ns, 0.28);
  const spokeL: number[] = [];
  for (let s = 0; s < ns; s++) spokeL.push(rand(0.72, 1.18));
  const ringR: number[] = [];
  for (let i = 0; i < nr; i++) ringR.push(Math.pow((i + 1) / nr, 0.75) * rand(0.92, 1.08));
  const sag: number[][] = [];
  for (let i = 0; i < nr; i++) {
    const row: number[] = [];
    for (let s = 0; s < ns; s++) row.push(rand(0.06, 0.16));
    sag.push(row);
  }
  const tx: number[] = [], ty: number[] = [];
  for (let s = 0; s < ns; s++) {
    const l = spokeL[s];
    tx.push(Math.cos(angls[s]) * l);
    ty.push(Math.sin(angls[s]) * l);
  }
  // Hub ring
  for (let i = 0; i < 20; i++) {
    const a1 = (i / 20) * Math.PI * 2, a2 = ((i + 1) / 20) * Math.PI * 2;
    pushSeg(buf, Math.cos(a1) * hubR, Math.sin(a1) * hubR, Math.cos(a2) * hubR, Math.sin(a2) * hubR, 0.5, 0.5);
  }
  // Spokes hub → tip, then extend off-screen
  for (let s = 0; s < ns; s++) {
    const hx = Math.cos(angls[s]) * hubR, hy = Math.sin(angls[s]) * hubR;
    pushBez(buf, hx, hy, (hx + tx[s]) * 0.5, (hy + ty[s]) * 0.5, tx[s], ty[s], 0.3, 1.0);
    const ex = tx[s] * 2.2, ey = ty[s] * 2.2;
    pushBez(buf, tx[s], ty[s], (tx[s] + ex) * 0.5, (ty[s] + ey) * 0.5, ex, ey, 1.0, 0.0);
  }
  // Rings
  for (let ring = 0; ring < nr; ring++) {
    const t = ringR[ring];
    const ra = 0.65 + 0.35 * (1 - t * 0.35);
    for (let s = 0; s < ns; s++) {
      const sN = (s + 1) % ns;
      const ax = tx[s] * t, ay = ty[s] * t;
      const bx = tx[sN] * t, by = ty[sN] * t;
      const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
      const outLen = Math.sqrt(mx * mx + my * my) + 0.001;
      const clen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) + 0.001;
      const sd = clen * sag[ring][s];
      pushBez(buf, ax, ay, mx + (mx / outLen) * sd, my + (my / outLen) * sd, bx, by, ra, ra);
    }
  }
  // Frame ring
  const ot = ringR[nr - 1] * 1.03;
  for (let s = 0; s < ns; s++) {
    const sN = (s + 1) % ns;
    pushSeg(buf, tx[s] * ot, ty[s] * ot, tx[sN] * ot, ty[sN] * ot, 0.55, 0.55);
  }
  return new Float32Array(buf);
}

function bakeCob(): Float32Array {
  const buf: number[] = [];
  const n = Math.round(rand(14, 26));
  const ax: number[] = [], ay: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), d = rand(0.1, 1.0);
    ax.push(d * Math.cos(a)); ay.push(d * Math.sin(a));
  }
  for (let i = 0; i < n; i++) {
    const conns = Math.round(rand(1, 3));
    for (let c = 0; c < conns; c++) {
      const j = Math.floor(rand(0, n));
      if (j === i) continue;
      const dr = rand(0.04, 0.28);
      const mxC = (ax[i] + ax[j]) * 0.5, myC = (ay[i] + ay[j]) * 0.5;
      const clen = Math.sqrt((ax[j] - ax[i]) * (ax[j] - ax[i]) + (ay[j] - ay[i]) * (ay[j] - ay[i])) + 0.001;
      pushBez(buf, ax[i], ay[i], mxC, myC + clen * dr, ax[j], ay[j], 0.7, 0.7);
    }
  }
  const esc = Math.round(rand(3, 8));
  for (let k = 0; k < esc; k++) {
    const ang = rand(0, Math.PI * 2);
    const ox = Math.cos(ang) * rand(0.1, 0.5), oy = Math.sin(ang) * rand(0.1, 0.5);
    const ex = Math.cos(ang) * 2.2, ey = Math.sin(ang) * 2.2;
    pushBez(buf, ox, oy, (ox + ex) * 0.5, (oy + ey) * 0.5, ex, ey, 0.6, 0.0);
  }
  return new Float32Array(buf);
}

function bakeFunnel(): Float32Array {
  const buf: number[] = [];
  const rows = Math.round(rand(5, 9));
  const cols = Math.round(rand(6, 12));
  const fd = rand(0.3, 0.7);
  const rowSag: number[] = [];
  for (let r = 0; r <= rows; r++) rowSag.push(rand(0.04, 0.12));

  function pt(u: number, v: number): [number, number] {
    const spread = 1 - v * fd;
    const x = u * spread;
    const sag = 0.1 * v * (1 - v) * rowSag[Math.min(Math.floor(v * rows), rows - 1)];
    return [x, v + sag];
  }

  for (let c = 0; c <= cols; c++) {
    const u = lerp(-1, 1, c / cols);
    let prev = pt(u, 0);
    for (let seg = 1; seg <= 10; seg++) {
      const p = pt(u, seg / 10);
      pushSeg(buf, prev[0], prev[1], p[0], p[1], 0.5, 0.5);
      prev = p;
    }
    const tip = pt(u, 1);
    pushBez(buf, tip[0], tip[1], tip[0] * 1.2, tip[1] * 1.5, tip[0] * 2.2, tip[1] * 2.2, 0.4, 0.0);
  }
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    const pts: [number, number][] = [];
    for (let c = 0; c <= cols; c++) pts.push(pt(lerp(-1, 1, c / cols), v));
    for (let c = 0; c < cols; c++) {
      const [ax, ay] = pts[c], [bx, by] = pts[c + 1];
      const clen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) + 0.001;
      pushBez(buf, ax, ay, (ax + bx) * 0.5, (ay + by) * 0.5 + clen * 0.06, bx, by, 0.65, 0.65);
    }
    const lp = pt(-1, v), rp = pt(1, v);
    pushBez(buf, lp[0], lp[1], lp[0] - 0.5, lp[1], lp[0] - 2.2, lp[1], 0.5, 0.0);
    pushBez(buf, rp[0], rp[1], rp[0] + 0.5, rp[1], rp[0] + 2.2, rp[1], 0.5, 0.0);
  }
  return new Float32Array(buf);
}

function bakeSpiral(): Float32Array {
  const buf: number[] = [];
  const turns = rand(3, 6);
  const n = Math.round(rand(90, 160));
  const ns = Math.round(rand(8, 14));
  const angls = makeAngles(ns, 0.20);
  const spokeL: number[] = [];
  for (let s = 0; s < ns; s++) spokeL.push(rand(0.82, 1.12));
  const noise: number[] = [];
  for (let i = 0; i < n; i++) noise.push(rand(-0.04, 0.04));
  for (let i = 0; i < n - 1; i++) {
    const fA = i / (n - 1), fB = (i + 1) / (n - 1);
    const aA = fA * turns * Math.PI * 2, aB = fB * turns * Math.PI * 2;
    const rA = fA * (1 + noise[i]), rB = fB * (1 + noise[i + 1]);
    pushSeg(buf,
      Math.cos(aA) * rA, Math.sin(aA) * rA,
      Math.cos(aB) * rB, Math.sin(aB) * rB,
      lerp(0.25, 1.0, fA), lerp(0.25, 1.0, fB));
  }
  for (let s = 0; s < ns; s++) {
    const l = spokeL[s];
    const tx = Math.cos(angls[s]) * l, ty = Math.sin(angls[s]) * l;
    pushSeg(buf, 0, 0, tx, ty, 0.2, 0.5);
    pushBez(buf, tx, ty, tx * 1.5, ty * 1.5, tx * 2.2, ty * 2.2, 0.5, 0.0);
  }
  return new Float32Array(buf);
}

function bakeMesh(): Float32Array {
  const buf: number[] = [];
  const n = Math.round(rand(16, 30));
  const nx: number[] = [], ny: number[] = [];
  const scX = rand(0.6, 1.2), scY = rand(0.35, 0.75);
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), r = Math.sqrt(rand(0, 1));
    nx.push(r * Math.cos(a) * scX); ny.push(r * Math.sin(a) * scY);
  }
  const seen: Record<string, boolean> = {};
  for (let i = 0; i < n; i++) {
    const dists: { j: number; d: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = nx[i] - nx[j], dy = ny[i] - ny[j];
      dists.push({ j, d: dx * dx + dy * dy });
    }
    dists.sort((a, b) => a.d - b.d);
    const conns = Math.round(rand(2, 4));
    for (let k = 0; k < Math.min(conns, dists.length); k++) {
      const j = dists[k].j;
      const key = `${Math.min(i, j)},${Math.max(i, j)}`;
      if (seen[key]) continue; seen[key] = true;
      const ax = nx[i], ay = ny[i], bx = nx[j], by = ny[j];
      const clen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) + 0.001;
      const sag = rand(0.04, 0.18) * clen;
      pushBez(buf, ax, ay, (ax + bx) * 0.5, (ay + by) * 0.5 + sag, bx, by, 0.75, 0.75);
    }
  }
  const anch = Math.round(rand(4, 9));
  for (let k = 0; k < anch; k++) {
    const ang = rand(0, Math.PI * 2);
    const ni = Math.floor(rand(0, n));
    const ox = nx[ni], oy = ny[ni];
    const ex = ox + Math.cos(ang) * 2.2, ey = oy + Math.sin(ang) * 2.2;
    pushBez(buf, ox, oy, (ox + ex) * 0.5, (oy + ey) * 0.5, ex, ey, 0.55, 0.0);
  }
  return new Float32Array(buf);
}

const BAKERS = [bakeOrb, bakeCob, bakeFunnel, bakeSpiral, bakeMesh] as const;

// ── FBO helper ───────────────────────────────────────────────────────────────

interface FBO { tex: WebGLTexture; fb: WebGLFramebuffer; }

function makeFBO(gl: WebGLRenderingContext, w: number, h: number): FBO {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb };
}

// ── Color helper ─────────────────────────────────────────────────────────────

function webColor(hue: number): [number, number, number] {
  return [
    lerp(0.58, 0.80, Math.sin(hue * Math.PI)),
    lerp(0.65, 0.88, Math.cos(hue * Math.PI * 0.7)),
    lerp(0.80, 1.0, 1 - hue * 0.3),
  ];
}

// ── Web instance type ─────────────────────────────────────────────────────────

interface WebInstance {
  glBuf: WebGLBuffer;
  cx: number; cy: number;
  r: number;
  angle: number; spin: number;
  alpha: number; targetAlpha: number;
  life: number; maxLife: number;
  vx: number; vy: number;
  hue: number;
  dying: boolean;
  geom: Float32Array;
  vertCount: number;
}

// ── Audio factory ─────────────────────────────────────────────────────────────
//
// Ported from spiderweb-swarm.html initAudio():
//   - 5 chord oscillators (sine for low freqs, triangle for upper) at 55/82.4/110/164.8/220 Hz
//     each tripled with ±2 cent detune → into a per-note gain → shared lowpass filter
//   - LFO at 0.07 Hz modulating master gain ±0.06
//   - Filter LFO at 0.04 Hz modulating filter cutoff ±280 Hz
//   - Sub-bass: two sine oscillators at 36 Hz (±3 cent detune) → lowpass 120 Hz → bass gain
//   - Bass LFO at 0.12 Hz (no destination in original; kept as a slow rumble by making it
//     wiggle the bass filter frequency instead, faithful to the "slow oscillation" intent)
//   - Master fades from 0 → 0.10 over ~4 s; bass gain fades 0 → 0.18 over ~5 s
//
// The AudioBus connects masterGain to ctx.destination for us — we must NOT do it here.

export const createAudio: AudioFactory = (ctx) => {
  // ── Master gain (all signal paths merge here) ─────────────────────────────
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0;

  // ── Dry / wet split into convolution reverb ───────────────────────────────
  const irLen = Math.floor(ctx.sampleRate * 4);
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < irLen; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.5);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  conv.connect(masterGain);

  const dry = ctx.createGain();
  dry.gain.value = 0.35;
  dry.connect(masterGain);

  const wet = ctx.createGain();
  wet.gain.value = 0.65;
  wet.connect(conv);

  // ── Shared lowpass filter ─────────────────────────────────────────────────
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 900;
  lpf.Q.value = 1.2;
  lpf.connect(dry);
  lpf.connect(wet);

  // ── Chord oscillators: 55 / 82.4 / 110 / 164.8 / 220 Hz ─────────────────
  // Original gains: [0.22, 0.14, 0.10, 0.06, 0.04]
  const chordFreqs: [number, number][] = [
    [55,    0.22],
    [82.4,  0.14],
    [110,   0.10],
    [164.8, 0.06],
    [220,   0.04],
  ];
  chordFreqs.forEach(([freq, gainVal], idx) => {
    const g = ctx.createGain();
    g.gain.value = gainVal;
    g.connect(lpf);
    const type: OscillatorType = idx < 2 ? 'sine' : 'triangle';
    for (const det of [-2, 0, 2]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(g);
      o.start();
    }
  });

  // ── Amplitude LFO (0.07 Hz) → master gain ────────────────────────────────
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain);
  lfoGain.connect(masterGain.gain);
  lfo.start();

  // ── Filter LFO (0.04 Hz) → lpf frequency ─────────────────────────────────
  const flfo = ctx.createOscillator();
  flfo.frequency.value = 0.04;
  const flfoGain = ctx.createGain();
  flfoGain.gain.value = 280;
  flfo.connect(flfoGain);
  flfoGain.connect(lpf.frequency);
  flfo.start();

  // masterGain.gain is driven per-frame by tick() via sharedState.alphaEMA

  // ── Sub-bass: two sine oscillators at 36 Hz → lowpass → bass gain ─────────
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0;
  bassGain.connect(masterGain);

  const bassLpf = ctx.createBiquadFilter();
  bassLpf.type = 'lowpass';
  bassLpf.frequency.value = 120;
  bassLpf.Q.value = 0.7;
  bassLpf.connect(bassGain);

  for (const det of [-3, 3]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 36;
    o.detune.value = det;
    o.connect(bassLpf);
    o.start();
  }

  // Bass LFO (0.12 Hz) → bass filter frequency wobble
  const blfo = ctx.createOscillator();
  blfo.frequency.value = 0.12;
  const blfoGain = ctx.createGain();
  blfoGain.gain.value = 8;
  blfo.connect(blfoGain);
  blfoGain.connect(bassLpf.frequency);
  blfo.start();

  // bassGain.gain is driven per-frame by tick() via sharedState.alphaEMA

  // ── Tick: drives audio graph from sharedState (populated by the RAF loop) ──
  return {
    node: masterGain,
    tick() {
      const t = ctx.currentTime;
      // Clamp pinch scale to a useful pitch-bend range
      const pinchMul = sharedState.pinchScale > 0
        ? Math.max(0.5, Math.min(2.5, sharedState.pinchScale))
        : 1;
      // 1. Speed → filter brightness
      lpf.frequency.setTargetAtTime(900 + sharedState.speedEMA * 6000 * pinchMul, t, 0.2);
      // 2. Alpha → master volume
      masterGain.gain.setTargetAtTime(sharedState.alphaEMA * 0.10, t, 0.3);
      // 3. Bass inversely coupled to master, swells with alpha
      bassGain.gain.setTargetAtTime(0.18 * Math.min(1, sharedState.alphaEMA * 1.4), t, 0.4);
    }
  };
};

// ── Mount ─────────────────────────────────────────────────────────────────────

export const mount: RoomMount = (canvas, opts) => {
  const gl = createContext(canvas, { version: 1, antialias: true, alpha: false }) as WebGLRenderingContext;
  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  const webCount = WEB_COUNT[opts.quality];

  // ── Shader programs ──────────────────────────────────────────────────────

  const strandVs = compileShader(gl, gl.VERTEX_SHADER, STRAND_VS);
  const strandFs = compileShader(gl, gl.FRAGMENT_SHADER, STRAND_FS);
  const strandProg = linkProgram(gl, strandVs, strandFs);

  const quadVs = compileShader(gl, gl.VERTEX_SHADER, QUAD_VS);
  const blurHFs = compileShader(gl, gl.FRAGMENT_SHADER, makeBlurFS(true));
  const blurVFs = compileShader(gl, gl.FRAGMENT_SHADER, makeBlurFS(false));
  const compFs  = compileShader(gl, gl.FRAGMENT_SHADER, COMP_FS);

  const blurHP   = linkProgram(gl, quadVs, blurHFs);
  const blurVP   = linkProgram(gl, quadVs, blurVFs);
  const compP    = linkProgram(gl, quadVs, compFs);

  // Cached uniform locations for strand program
  const su = getUniforms(gl, strandProg, [
    'uTrans', 'uScale', 'uCos', 'uSin', 'uAlpha', 'uRes', 'uW', 'uCol',
  ] as const);

  const aALoc    = gl.getAttribLocation(strandProg, 'aA');
  const aBLoc    = gl.getAttribLocation(strandProg, 'aB');
  const aBALoc   = gl.getAttribLocation(strandProg, 'aBaseAlpha');
  const aSideLoc = gl.getAttribLocation(strandProg, 'aSide');
  const aTLoc    = gl.getAttribLocation(strandProg, 'aT');

  // ── Quad buffer (shared across post-process passes) ──────────────────────

  const quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

  // ── FBOs (sized in resize callback) ─────────────────────────────────────

  let W = 1, H = 1;
  let fboSharp = makeFBO(gl, 1, 1);
  let fboPingA = makeFBO(gl, 1, 1);
  let fboPingB = makeFBO(gl, 1, 1);

  const stopResize = observeResize(canvas, (cssW, cssH) => {
    W = canvas.width;
    H = canvas.height;
    // cssW/cssH provided by observeResize but we use canvas pixel dims after DPR scaling
    void cssW; void cssH;
    fboSharp = makeFBO(gl, W, H);
    fboPingA = makeFBO(gl, W, H);
    fboPingB = makeFBO(gl, W, H);
    gl.viewport(0, 0, W, H);
  });

  // ── Web pool ─────────────────────────────────────────────────────────────

  function makeWeb(init: boolean): WebInstance {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const cx = rand(W * 0.08, W * 0.92);
    const cy = rand(H * 0.08, H * 0.92);
    const r  = rand(55, 185) * dpr;
    const hue = rand(0, 1);
    const targetAlpha = rand(0.12, 0.48);
    const baker = BAKERS[Math.floor(Math.random() * BAKERS.length)];
    const geom = baker();
    const glBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geom, gl.STATIC_DRAW);
    return {
      glBuf, cx, cy, r,
      angle: rand(0, Math.PI * 2),
      spin: rand(-0.001, 0.001),
      alpha: init ? rand(0.04, 0.48) : 0.0,
      targetAlpha,
      life: 0,
      maxLife: rand(900, 2200),
      vx: rand(-0.06, 0.06),
      vy: rand(-0.05, 0.05),
      hue,
      dying: false,
      geom,
      vertCount: geom.length / STRIDE,
    };
  }

  function resetWeb(web: WebInstance): void {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    web.cx = rand(W * 0.08, W * 0.92);
    web.cy = rand(H * 0.08, H * 0.92);
    web.r  = rand(55, 185) * dpr;
    web.angle = rand(0, Math.PI * 2);
    web.spin  = rand(-0.001, 0.001);
    web.alpha = 0.0;
    web.targetAlpha = rand(0.12, 0.48);
    web.life = 0;
    web.maxLife = rand(900, 2200);
    web.vx = rand(-0.06, 0.06);
    web.vy = rand(-0.05, 0.05);
    web.hue = rand(0, 1);
    web.dying = false;
    const baker = BAKERS[Math.floor(Math.random() * BAKERS.length)];
    web.geom = baker();
    web.vertCount = web.geom.length / STRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, web.glBuf);
    gl.bufferData(gl.ARRAY_BUFFER, web.geom, gl.STATIC_DRAW);
  }

  const webs: WebInstance[] = [];
  for (let i = 0; i < webCount; i++) webs.push(makeWeb(true));

  // ── Post-process helpers ─────────────────────────────────────────────────

  function bindQuad(prog: WebGLProgram): void {
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    const a = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  }

  function blurPass(prog: WebGLProgram, src: WebGLTexture, dstFb: WebGLFramebuffer): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFb);
    gl.viewport(0, 0, W, H);
    gl.clear(gl.COLOR_BUFFER_BIT);
    bindQuad(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ── Per-web update and draw ──────────────────────────────────────────────

  function updateWeb(web: WebInstance): void {
    web.life++;
    web.angle += web.spin;
    web.cx += web.vx; web.cy += web.vy;
    web.vx *= 0.97; web.vy *= 0.97;

    const offscreen = (web.cx < -web.r * 2 || web.cx > W + web.r * 2 ||
                       web.cy < -web.r * 2 || web.cy > H + web.r * 2);
    if (offscreen || web.life > web.maxLife * 0.78) web.dying = true;

    const t = web.life / web.maxLife;
    if (!web.dying && t < 0.12)   web.alpha = lerp(0.0, web.targetAlpha, t / 0.12);
    else if (web.dying)            web.alpha = Math.max(0, web.alpha - 0.003);

    if (web.dying && web.alpha <= 0.001) resetWeb(web);
  }

  function drawWeb(web: WebInstance): void {
    if (web.alpha < 0.001) return;
    const col = webColor(web.hue);
    gl.uniform3f(su.uCol, col[0], col[1], col[2]);
    gl.uniform2f(su.uTrans, web.cx, web.cy);
    gl.uniform1f(su.uScale, web.r);
    gl.uniform1f(su.uCos, Math.cos(web.angle));
    gl.uniform1f(su.uSin, Math.sin(web.angle));
    gl.uniform1f(su.uAlpha, web.alpha);

    gl.bindBuffer(gl.ARRAY_BUFFER, web.glBuf);
    const S = STRIDE * 4;
    gl.enableVertexAttribArray(aALoc);   gl.vertexAttribPointer(aALoc,    2, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(aBLoc);   gl.vertexAttribPointer(aBLoc,    2, gl.FLOAT, false, S, 8);
    gl.enableVertexAttribArray(aBALoc);  gl.vertexAttribPointer(aBALoc,   1, gl.FLOAT, false, S, 16);
    gl.enableVertexAttribArray(aSideLoc);gl.vertexAttribPointer(aSideLoc, 1, gl.FLOAT, false, S, 20);
    gl.enableVertexAttribArray(aTLoc);   gl.vertexAttribPointer(aTLoc,    1, gl.FLOAT, false, S, 24);
    gl.drawArrays(gl.TRIANGLES, 0, web.vertCount);
  }

  // ── Pointer / pinch interaction ──────────────────────────────────────────
  //
  // Faithfully ported from spiderweb-swarm.html lines 484-713:
  //   - Drag (pointerdown + pointermove): adds velocity impulse to webs within
  //     260 px of the pointer, proportional to the drag delta × influence
  //   - Hover (pointer moves without button): gently repels webs within 160 px
  //   - Pinch (two simultaneous touch pointers): pushes/pulls webs outward or
  //     inward from the pinch midpoint based on finger spread delta
  //   - Trackpad pinch (wheel + ctrlKey): same radial push/pull effect

  const listenerCleanups: (() => void)[] = [];

  if (opts.quality !== 'preview') {
    // Pointer position and drag state (canvas-relative pixel coords)
    const ptr = { down: false, x: -9999, y: -9999, dx: 0, dy: 0 };
    // Pinch state
    const pinch = { active: false, cx: 0, cy: 0, dist: 0, scale: 1, delta: 0 };
    // Active pointer map for two-finger pinch tracking
    const activePointers = new Map<number, { x: number; y: number }>();

    function pDown(x: number, y: number): void {
      ptr.down = true; ptr.x = x; ptr.y = y; ptr.dx = 0; ptr.dy = 0;
    }
    function pMove(x: number, y: number): void {
      if (ptr.down) { ptr.dx = x - ptr.x; ptr.dy = y - ptr.y; }
      ptr.x = x; ptr.y = y;
    }
    function pUp(): void {
      ptr.down = false; ptr.dx = 0; ptr.dy = 0;
    }

    function pointerCoords(e: PointerEvent): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / (rect.width || 1);
      const sy = canvas.height / (rect.height || 1);
      return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
    }

    function pinchDistMid(a: { x: number; y: number }, b: { x: number; y: number }): { dist: number; cx: number; cy: number } {
      const ddx = a.x - b.x, ddy = a.y - b.y;
      return {
        dist: Math.sqrt(ddx * ddx + ddy * ddy),
        cx: (a.x + b.x) * 0.5,
        cy: (a.y + b.y) * 0.5,
      };
    }

    const onPointerDown = (e: PointerEvent): void => {
      const { x, y } = pointerCoords(e);
      activePointers.set(e.pointerId, { x, y });
      if (activePointers.size === 1) {
        canvas.setPointerCapture(e.pointerId);
        pinch.active = false;
        pDown(x, y);
      } else if (activePointers.size === 2) {
        // Switch from drag to pinch
        pUp();
        pinch.active = true;
        const pts = [...activePointers.values()];
        const dm = pinchDistMid(pts[0], pts[1]);
        pinch.dist = dm.dist; pinch.cx = dm.cx; pinch.cy = dm.cy;
        pinch.scale = 1; pinch.delta = 0;
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      const { x, y } = pointerCoords(e);
      activePointers.set(e.pointerId, { x, y });
      if (activePointers.size === 1 && !pinch.active) {
        pMove(x, y);
      } else if (activePointers.size === 2 && pinch.active) {
        const pts = [...activePointers.values()];
        const dm = pinchDistMid(pts[0], pts[1]);
        const ratio = dm.dist / (pinch.dist || 1);
        pinch.delta = ratio - pinch.scale;
        pinch.scale = ratio;
        pinch.cx = dm.cx; pinch.cy = dm.cy;
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) { pinch.active = false; pinch.delta = 0; }
      if (activePointers.size === 0) pUp();
    };

    // Trackpad pinch: wheel events with ctrlKey generate scale changes
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / (rect.width || 1);
      const sy = canvas.height / (rect.height || 1);
      pinch.cx = (e.clientX - rect.left) * sx;
      pinch.cy = (e.clientY - rect.top) * sy;
      // Normalise deltaY: typical trackpad fires ~3–10 per gesture step
      pinch.delta = -e.deltaY * 0.003;
      pinch.active = true;
    };

    canvas.addEventListener('pointerdown',   onPointerDown);
    canvas.addEventListener('pointermove',   onPointerMove);
    canvas.addEventListener('pointerup',     onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel',         onWheel, { passive: false });

    listenerCleanups.push(
      () => canvas.removeEventListener('pointerdown',   onPointerDown),
      () => canvas.removeEventListener('pointermove',   onPointerMove),
      () => canvas.removeEventListener('pointerup',     onPointerUp),
      () => canvas.removeEventListener('pointercancel', onPointerUp),
      () => canvas.removeEventListener('wheel',         onWheel),
    );

    // ── Render loop ──────────────────────────────────────────────────────────

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const loop = createRafLoop((_dt, _t) => {
      // Apply pointer forces to web velocities (ported from original render())
      for (const web of webs) {
        const ddx = web.cx - ptr.x, ddy = web.cy - ptr.y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (ptr.down) {
          if (d < 260 && d > 0.1) {
            const inf = Math.pow(1 - d / 260, 1.4);
            web.vx += ptr.dx * inf * 0.06;
            web.vy += ptr.dy * inf * 0.06;
          }
        } else {
          if (d < 160 && d > 0.1) {
            const f = (160 - d) / 160 * 0.07;
            web.vx += ddx / d * f;
            web.vy += ddy / d * f;
          }
        }
      }
      // Reset drag deltas after consuming (re-computed next pointermove)
      ptr.dx = 0; ptr.dy = 0;

      // Apply pinch forces
      if (pinch.active && pinch.delta) {
        const pd = pinch.delta;
        for (const web of webs) {
          const ddx = web.cx - pinch.cx, ddy = web.cy - pinch.cy;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < 320 && d > 0.1) {
            const inf = Math.pow(1 - d / 320, 1.2);
            web.vx += ddx / d * pd * inf * 18;
            web.vy += ddy / d * pd * inf * 18;
          }
        }
        pinch.delta = 0;
        // Clear transient wheel-only pinch after consuming
        if (!pinch.active) { /* already cleared */ }
      }
      // Allow wheel pinch to decay naturally (reset active flag after one frame)
      // so hover repulsion resumes quickly
      if (!activePointers.size) pinch.active = false;

      // ── Update sharedState for audio tick ───────────────────────────────────
      {
        let sumSpeed = 0, sumAlpha = 0;
        for (const web of webs) {
          sumSpeed += Math.hypot(web.vx, web.vy);
          sumAlpha += web.alpha;
        }
        const meanSpeed = sumSpeed / Math.max(1, webs.length);
        const meanAlpha = sumAlpha / Math.max(1, webs.length);
        sharedState.speedEMA = sharedState.speedEMA * 0.875 + Math.min(meanSpeed * 8, 1) * 0.125;
        sharedState.alphaEMA = sharedState.alphaEMA * 0.967 + meanAlpha * 0.033;
        sharedState.pinchScale = pinch.active ? pinch.scale : 1;
      }

      // 1. Draw webs → fboSharp
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboSharp.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0.008, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(strandProg);
      gl.uniform2f(su.uRes, W, H);
      gl.uniform1f(su.uW, 1.3);
      for (const web of webs) { updateWeb(web); drawWeb(web); }

      // 2. Blur passes (3 rounds of V+H)
      gl.clearColor(0, 0, 0, 1);
      blurPass(blurHP, fboSharp.tex, fboPingA.fb);
      for (let p = 0; p < 3; p++) {
        blurPass(blurVP, fboPingA.tex, fboPingB.fb);
        blurPass(blurHP, fboPingB.tex, fboPingA.fb);
      }

      // 3. Composite to screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0.008, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      bindQuad(compP);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboSharp.tex);
      gl.uniform1i(gl.getUniformLocation(compP, 'uSharp'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fboPingA.tex);
      gl.uniform1i(gl.getUniformLocation(compP, 'uBlur'), 1);
      gl.uniform1f(gl.getUniformLocation(compP, 'uBloom'), 0.9);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }, ac.signal);

    if (!opts.startPaused) loop.start();

    return {
      teardown: (): void => {
        ac.abort();
        loop.stop();
        stopResize();
        for (const cleanup of listenerCleanups) cleanup();
        try { gl.deleteProgram(strandProg); } catch { /* idempotent */ }
        try { gl.deleteProgram(blurHP); } catch { /* idempotent */ }
        try { gl.deleteProgram(blurVP); } catch { /* idempotent */ }
        try { gl.deleteProgram(compP); } catch { /* idempotent */ }
      },
      pause: (): void => loop.stop(),
      resume: (): void => loop.start()
    };
  }

  // ── Preview mode: no pointer listeners, minimal render loop ─────────────

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const loop = createRafLoop((_dt, _t) => {
    // ── Update sharedState for audio tick (harmless in preview; audio is off) ─
    {
      let sumSpeed = 0, sumAlpha = 0;
      for (const web of webs) {
        sumSpeed += Math.hypot(web.vx, web.vy);
        sumAlpha += web.alpha;
      }
      const meanSpeed = sumSpeed / Math.max(1, webs.length);
      const meanAlpha = sumAlpha / Math.max(1, webs.length);
      sharedState.speedEMA = sharedState.speedEMA * 0.875 + Math.min(meanSpeed * 8, 1) * 0.125;
      sharedState.alphaEMA = sharedState.alphaEMA * 0.967 + meanAlpha * 0.033;
      sharedState.pinchScale = 1; // no pinch in preview
    }

    // 1. Draw webs → fboSharp
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboSharp.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0.008, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(strandProg);
    gl.uniform2f(su.uRes, W, H);
    gl.uniform1f(su.uW, 1.3);
    for (const web of webs) { updateWeb(web); drawWeb(web); }

    // 2. Blur passes (3 rounds of V+H)
    gl.clearColor(0, 0, 0, 1);
    blurPass(blurHP, fboSharp.tex, fboPingA.fb);
    for (let p = 0; p < 3; p++) {
      blurPass(blurVP, fboPingA.tex, fboPingB.fb);
      blurPass(blurHP, fboPingB.tex, fboPingA.fb);
    }

    // 3. Composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0.008, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    bindQuad(compP);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboSharp.tex);
    gl.uniform1i(gl.getUniformLocation(compP, 'uSharp'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fboPingA.tex);
    gl.uniform1i(gl.getUniformLocation(compP, 'uBlur'), 1);
    gl.uniform1f(gl.getUniformLocation(compP, 'uBloom'), 0.9);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, ac.signal);

  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      try { gl.deleteProgram(strandProg); } catch { /* idempotent */ }
      try { gl.deleteProgram(blurHP); } catch { /* idempotent */ }
      try { gl.deleteProgram(blurVP); } catch { /* idempotent */ }
      try { gl.deleteProgram(compP); } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
