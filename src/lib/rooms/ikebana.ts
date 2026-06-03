import type { RoomMount } from '@/lib/webgl/types';
import type { RoomAudio } from '@/lib/audio/bus';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';

// Ported from ikebana.html — every constant, range and formula is verbatim.
// Adaptations: AudioBus owns the AudioContext (no ensureAC); transient sounds
// go through `audioLink`, continuous coupling through `sharedState`.

// ─── Types ────────────────────────────────────────────────────────────────────

type Pt = [number, number];

interface Shoot { t: number; angle: number; len: number; delay: number; }

interface Branch {
  color: [number, number, number];
  alpha: number;
  width: number;
  delay: number;
  duration: number;
  cps: Pt[];
  shoots: Shoot[];
  budR: number;
  budDelay: number;
}

interface Ikebana {
  branches: Branch[];
  ox: number;
  oy: number;
  startTime: number | null;
  dying: boolean;
  dead: boolean;
  deathTime: number;
}

interface BranchGeom { idx: number; curvature: number; length: number; angleSpread: number; }

interface IkebanaGeom {
  version: number;
  freqScale: number[];   // 7 per-partial frequency multipliers
  gainScale: number[];   // 7 per-partial gain multipliers
  lfoRateBase: number;
  lfoDepthMult: number;
  rootFreq: number;
}

interface Disturbance { created: number; branchIdx: number; splineT: number; amp: number; ikRef: Ikebana; }
interface ShootReg { sh: Shoot; pts: Pt[]; angle: number; lastHit: number; branchIdx: number; }
interface Petal { x: number; y: number; vy: number; vx: number; phase: number; r: number; alpha: number; }

// ─── Shared visual → audio state ─────────────────────────────────────────────

const sharedState = {
  dragVelocity: 0,   // smoothed px/ms (device px)
  pointerDown: false,
  avgProg: 0,        // average branch draw progress of the active ikebana
  geom: null as IkebanaGeom | null
};

interface AudioLink {
  playShimmer(angle: number, branchIdx: number): void;
  playBloom(rootFreq: number): void;
  startTouchVoice(angle: number, geom: BranchGeom): void;
  retuneTouchVoice(fund: number): void;
  stopTouchVoice(): void;
  surgeDrone(colorR: number): void;
  resetDroneGains(): void;
}
let audioLink: AudioLink | null = null;

// ─── Shaders (ikebana.html L48-59) ───────────────────────────────────────────

const VS = `
attribute vec2 a_pos;
uniform vec2 u_res;
void main() {
  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
}`.trim();

const FS = `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }`.trim();

// ─── Math (ikebana.html L109-130) ────────────────────────────────────────────

const rnd = (a: number, b: number): number => a + (b - a) * Math.random();
const easeOut5 = (t: number): number => 1 - Math.pow(1 - Math.min(t, 1), 5);
const easeOut3 = (t: number): number => 1 - Math.pow(1 - Math.min(t, 1), 3);

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t * t + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t * t * t),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t * t + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t * t * t)
  ];
}

function buildSpline(cps: Pt[], steps = 140): Pt[] {
  const pts: Pt[] = [];
  const n = cps.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = cps[Math.max(i - 1, 0)], p1 = cps[i], p2 = cps[i + 1], p3 = cps[Math.min(i + 2, n - 1)];
    for (let j = 0; j <= steps; j++) pts.push(catmull(p0, p1, p2, p3, j / steps));
  }
  return pts;
}

function splinePt(full: Pt[], t: number): Pt {
  return full[Math.min(Math.floor(t * (full.length - 1)), full.length - 1)];
}

// ─── Procedural generator (ikebana.html L132-236) ───────────────────────────

function genIkebana(): Ikebana {
  const ox = rnd(0.07, 0.20);
  const oy = rnd(0.87, 0.96);

  const palette: [number, number, number][] = [
    [rnd(0.82, 0.92), rnd(0.72, 0.82), rnd(0.50, 0.62)],
    [rnd(0.65, 0.75), rnd(0.55, 0.65), rnd(0.36, 0.48)],
    [rnd(0.50, 0.62), rnd(0.42, 0.54), rnd(0.28, 0.38)],
    [rnd(0.38, 0.50), rnd(0.32, 0.42), rnd(0.20, 0.30)],
    [rnd(0.28, 0.38), rnd(0.22, 0.32), rnd(0.12, 0.22)]
  ];

  function mkBranch(
    color: [number, number, number], alpha: number, width: number,
    ex: number, ey: number, curlX: number,
    shoots: Shoot[], budR: number, budDelay: number
  ): Branch {
    return {
      color, alpha, width,
      delay: 0,
      duration: rnd(2.8, 3.4),
      cps: [
        [ox, oy],
        [ox + (ex - ox) * 0.25 + rnd(-0.04, 0.04), oy - (oy - ey) * 0.25 + rnd(-0.05, 0.05)],
        [ox + (ex - ox) * 0.55 + curlX + rnd(-0.04, 0.04), oy - (oy - ey) * 0.55 + rnd(-0.05, 0.06)],
        [ox + (ex - ox) * 0.80 + rnd(-0.02, 0.02), oy - (oy - ey) * 0.80 + rnd(-0.03, 0.04)],
        [ex, ey]
      ],
      shoots, budR, budDelay
    };
  }

  // SHIN — steep, to upper-right
  const shin = mkBranch(
    palette[0], rnd(0.82, 0.92), rnd(1.8, 2.6),
    rnd(0.62, 0.82), rnd(0.03, 0.12),
    rnd(-0.06, 0.06),
    [
      { t: rnd(0.88, 0.96), angle: rnd(-1.1, -0.5), len: rnd(0.09, 0.14), delay: rnd(3.0, 3.3) },
      { t: rnd(0.60, 0.75), angle: rnd(0.7, 1.4),   len: rnd(0.07, 0.12), delay: rnd(3.1, 3.4) },
      { t: rnd(0.35, 0.52), angle: rnd(1.3, 1.9),   len: rnd(0.05, 0.09), delay: rnd(3.2, 3.5) }
    ],
    rnd(2.8, 4.2), 3.2
  );

  // SOE — medium diagonal
  const soe = mkBranch(
    palette[1], rnd(0.70, 0.82), rnd(1.2, 1.9),
    rnd(0.76, 0.94), rnd(0.10, 0.22),
    rnd(-0.05, 0.07),
    [
      { t: rnd(0.82, 0.94), angle: rnd(-0.6, 0.0),  len: rnd(0.08, 0.13), delay: rnd(3.0, 3.3) },
      { t: rnd(0.48, 0.65), angle: rnd(-1.2, -0.5), len: rnd(0.06, 0.10), delay: rnd(3.2, 3.5) }
    ],
    rnd(2.0, 3.2), 3.5
  );

  // TAI — near-horizontal sweep (earth line)
  const tai = mkBranch(
    palette[2], rnd(0.60, 0.72), rnd(1.0, 1.6),
    rnd(0.84, 0.97), rnd(0.50, 0.66),
    rnd(-0.04, 0.06),
    [
      { t: rnd(0.75, 0.88), angle: rnd(1.4, 2.0),   len: rnd(0.07, 0.11), delay: rnd(3.0, 3.3) },
      { t: rnd(0.42, 0.60), angle: rnd(-1.4, -0.7), len: rnd(0.05, 0.09), delay: rnd(3.2, 3.5) }
    ],
    rnd(1.6, 2.6), 3.8
  );

  // ACCENT — near-vertical, delicate
  const accent = mkBranch(
    palette[3], rnd(0.42, 0.54), rnd(0.7, 1.1),
    rnd(0.38, 0.60), rnd(0.01, 0.09),
    rnd(-0.06, 0.06),
    [
      { t: rnd(0.82, 0.93), angle: rnd(-1.1, -0.5), len: rnd(0.06, 0.10), delay: rnd(3.2, 3.5) },
      { t: rnd(0.52, 0.68), angle: rnd(0.6, 1.2),   len: rnd(0.05, 0.08), delay: rnd(3.3, 3.6) }
    ],
    0, 99
  );

  // WHISPER — ghost, low angle
  const whisper = mkBranch(
    palette[4], rnd(0.22, 0.34), rnd(0.5, 0.85),
    rnd(0.88, 0.98), rnd(0.56, 0.72),
    rnd(-0.03, 0.05),
    [
      { t: rnd(0.70, 0.85), angle: rnd(-1.0, -0.4), len: rnd(0.05, 0.08), delay: rnd(3.4, 3.7) }
    ],
    0, 99
  );

  return {
    branches: [shin, soe, tai, accent, whisper],
    ox, oy,
    startTime: null,
    dying: false, dead: false, deathTime: 0
  };
}

// ─── Geometry → drone parameters (ikebana.html L407-463) ────────────────────

function computeIkebanaGeom(ik: Ikebana, version: number): IkebanaGeom {
  const shin = ik.branches[0], tai = ik.branches[2], accent = ik.branches[3];
  const shinEndY = shin.cps[shin.cps.length - 1][1];
  const taiEndX = tai.cps[tai.cps.length - 1][0];
  const accentEndY = accent.cps[accent.cps.length - 1][1];
  const rootFreq = 55 + (1 - shinEndY) * 55;

  const allShoots = ik.branches.flatMap(br => br.shoots);
  const nShoots = allShoots.length || 1;
  const meanAngle = allShoots.reduce((s, sh) => s + Math.abs(sh.angle), 0) / nShoots;
  const angleVar = allShoots.reduce((s, sh) => s + Math.pow(Math.abs(sh.angle) - meanAngle, 2), 0) / nShoots;
  const angleSpread = Math.sqrt(angleVar);
  const meanLen = allShoots.reduce((s, sh) => s + sh.len, 0) / nShoots;

  const lfoRateBase = 0.03 + (meanAngle / Math.PI) * 0.12 + angleSpread * 0.08;
  const lfoDepthMult = 0.5 + meanLen * 10.0;

  const rootMult = 0.75 + (1 - shinEndY) * 0.80;
  const spreadMult = 0.6 + taiEndX * 0.8;
  const brightMult = 0.4 + (1 - accentEndY) * 1.2;
  const freqScale: number[] = [];
  const gainScale: number[] = [];
  for (let i = 0; i < 7; i++) {
    freqScale.push(i < 2 ? rootMult : i < 4 ? rootMult * spreadMult : rootMult * brightMult);
    gainScale.push(i < 2 ? 1.0 : i < 4 ? spreadMult : brightMult);
  }
  return { version, freqScale, gainScale, lfoRateBase, lfoDepthMult, rootFreq };
}

// ─── Audio factory (ikebana.html L239-401, 570-723) ─────────────────────────

export const createAudio = (ctx: AudioContext): RoomAudio => {
  // out is the single node handed to the AudioBus — everything that connected
  // to AC.destination in the original connects here instead.
  const out = ctx.createGain();
  out.gain.value = 1;

  // Reverb impulse (3 s)
  const conv = ctx.createConvolver();
  const irN = Math.floor(ctx.sampleRate * 3.0);
  const irBuf = ctx.createBuffer(2, irN, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = irBuf.getChannelData(ch);
    for (let i = 0; i < irN; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irN, 1.9);
  }
  conv.buffer = irBuf;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.001, ctx.currentTime);
  masterGain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.05);
  const revSend = ctx.createGain();
  revSend.gain.value = 0.42;
  conv.connect(out);

  // Drag filter: masterGain → droneFilter → out (+ reverb send from filter)
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 800;
  droneFilter.Q.value = 1.8;
  masterGain.connect(droneFilter);
  droneFilter.connect(out);
  droneFilter.connect(revSend);
  revSend.connect(conv);

  // 7-oscillator drone
  const defs: { f: number; t: OscillatorType; g: number }[] = [
    { f: 55,    t: 'sine',     g: 0.40 },
    { f: 55.3,  t: 'sine',     g: 0.24 },
    { f: 82.4,  t: 'sine',     g: 0.18 },
    { f: 110,   t: 'triangle', g: 0.12 },
    { f: 110.5, t: 'sine',     g: 0.07 },
    { f: 165,   t: 'triangle', g: 0.05 },
    { f: 220,   t: 'sine',     g: 0.03 }
  ];
  const droneOscs = defs.map(def => {
    const osc = ctx.createOscillator();
    osc.type = def.t;
    osc.frequency.value = def.f;
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.02 + Math.random() * 0.06;
    lfoG.gain.value = def.f * 0.0018;
    lfo.connect(lfoG); lfoG.connect(osc.frequency); lfo.start();
    const gNode = ctx.createGain();
    gNode.gain.value = def.g;
    osc.connect(gNode); gNode.connect(masterGain); osc.start();
    return { osc, gNode, lfo, lfoG, baseFreq: def.f, baseGain: def.g };
  });

  // Breath LFO
  const breathOsc = ctx.createOscillator();
  breathOsc.frequency.value = 0.055;
  const breathG = ctx.createGain();
  breathG.gain.value = 0.12;
  breathOsc.connect(breathG); breathG.connect(masterGain.gain); breathOsc.start();

  // ── Per-branch shimmer (ikebana.html L325-382) ─────────────────────────────
  const SHIMMER_REGISTERS = [90, 115, 140, 170, 110];
  const SHIMMER_CHARS = [
    { wave: 'triangle' as OscillatorType, lpFMult: 2.0, lpQ: 0.6, gain: 0.028, atk: 0.08, dec: 0.50, rel: 0.90 },
    { wave: 'sine' as OscillatorType,     lpFMult: 3.0, lpQ: 1.2, gain: 0.024, atk: 0.05, dec: 0.35, rel: 0.70 },
    { wave: 'triangle' as OscillatorType, lpFMult: 1.4, lpQ: 3.5, gain: 0.030, atk: 0.03, dec: 0.25, rel: 0.55 },
    { wave: 'sawtooth' as OscillatorType, lpFMult: 1.8, lpQ: 2.8, gain: 0.020, atk: 0.02, dec: 0.20, rel: 0.45 },
    { wave: 'sine' as OscillatorType,     lpFMult: 2.5, lpQ: 0.5, gain: 0.016, atk: 0.10, dec: 0.55, rel: 1.00 }
  ];
  const SHIMMER_NOISE_AMTS = [0.008, 0.005, 0.012, 0.006, 0.020];

  function playShimmer(angle: number, branchIdx: number): void {
    const idx = branchIdx || 0;
    const delay = Math.random() * 0.06;
    const t = ctx.currentTime + delay;

    const freq = (SHIMMER_REGISTERS[idx] ?? 120) * (1 + ((angle + Math.PI) / (Math.PI * 2)) * 0.8);
    const C = SHIMMER_CHARS[idx] ?? SHIMMER_CHARS[0];

    const osc = ctx.createOscillator();
    osc.type = C.wave;
    osc.frequency.value = freq;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = freq * C.lpFMult;
    lp.Q.value = C.lpQ;

    const nLen = Math.floor(ctx.sampleRate * C.rel);
    const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = nBuf;
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = 'bandpass'; nFilt.frequency.value = freq * 1.3; nFilt.Q.value = 3;
    const nG = ctx.createGain();
    nG.gain.value = SHIMMER_NOISE_AMTS[idx] ?? 0.008;
    nSrc.connect(nFilt); nFilt.connect(nG);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(C.gain, t + C.atk);
    env.gain.linearRampToValueAtTime(C.gain * 0.35, t + C.dec);
    env.gain.linearRampToValueAtTime(0.0001, t + C.rel);

    osc.connect(lp); lp.connect(env);
    nG.connect(env);
    env.connect(out);
    osc.start(t); osc.stop(t + C.rel + 0.05);
    nSrc.start(t); nSrc.stop(t + C.rel + 0.05);
  }

  // ── Harmonic bloom (ikebana.html L385-401) ─────────────────────────────────
  function playBloom(rootFreq: number): void {
    const t = ctx.currentTime + 0.02;
    [1, 1.5, 2, 2.5].forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i < 2 ? 'sine' : 'triangle';
      osc.frequency.value = rootFreq * ratio;
      const onset = t + i * 0.18;
      g.gain.setValueAtTime(0.001, onset);
      g.gain.linearRampToValueAtTime(0.07 / (i * 0.5 + 1), onset + 0.45);
      g.gain.linearRampToValueAtTime(0.03 / (i * 0.5 + 1), onset + 2.0);
      g.gain.linearRampToValueAtTime(0.0001, onset + 4.0);
      osc.connect(g); g.connect(out);
      osc.start(onset); osc.stop(onset + 4.5);
    });
  }

  // ── Looped touch voice (ikebana.html L570-723) ─────────────────────────────
  interface TouchVoice {
    oscs: OscillatorNode[];
    subOsc: OscillatorNode | null;
    env: GainNode;
    wingOsc: OscillatorNode;
    wobOsc: OscillatorNode;
    noiseSrc: AudioBufferSourceNode;
    noiseBP: BiquadFilterNode;
  }
  let touchVoice: TouchVoice | null = null;

  const PERSONALITIES = [
    { waves: ['sawtooth', 'sawtooth', 'sawtooth'] as OscillatorType[], detunes: [0, +6, -7], bpFreqMult: 2.2, bpQ: 1.8, lpFreq: 600, wobRate: 5, wobDepth: 0.18, wingDepth: 0.55, noiseQ: 3, noiseMult: 1.0, noiseAmt: 0.035, mixGain: 0.28 },
    { waves: ['square', 'triangle', 'square'] as OscillatorType[],     detunes: [0, +3, -3], bpFreqMult: 2.8, bpQ: 2.5, lpFreq: 750, wobRate: 7, wobDepth: 0.14, wingDepth: 0.40, noiseQ: 5, noiseMult: 1.2, noiseAmt: 0.028, mixGain: 0.26 },
    { waves: ['triangle', 'triangle', 'triangle'] as OscillatorType[], detunes: [0, +2, -2], bpFreqMult: 2.0, bpQ: 4.5, lpFreq: 500, wobRate: 4, wobDepth: 0.22, wingDepth: 0.35, noiseQ: 6, noiseMult: 0.8, noiseAmt: 0.020, mixGain: 0.34 },
    { waves: ['sawtooth', 'sawtooth', 'triangle'] as OscillatorType[], detunes: [0, +5, -4], bpFreqMult: 3.5, bpQ: 3.0, lpFreq: 900, wobRate: 9, wobDepth: 0.12, wingDepth: 0.45, noiseQ: 4, noiseMult: 1.4, noiseAmt: 0.032, mixGain: 0.30 },
    { waves: ['sine', 'sine', 'triangle'] as OscillatorType[],         detunes: [0, +1, -1], bpFreqMult: 1.8, bpQ: 1.2, lpFreq: 400, wobRate: 3, wobDepth: 0.25, wingDepth: 0.20, noiseQ: 2, noiseMult: 0.9, noiseAmt: 0.065, mixGain: 0.22 }
  ];
  const TOUCH_REGISTERS = [90, 115, 140, 170, 110];

  function stopTouchVoice(): void {
    if (!touchVoice) return;
    const t = ctx.currentTime;
    const { oscs, subOsc, env, wingOsc, wobOsc, noiseSrc } = touchVoice;
    env.gain.cancelScheduledValues(t);
    env.gain.setValueAtTime(env.gain.value, t);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.22);
    const stopT = t + 0.30;
    oscs.forEach(o => o.stop(stopT));
    if (subOsc) subOsc.stop(stopT);
    wingOsc.stop(stopT);
    wobOsc.stop(stopT);
    noiseSrc.stop(stopT);
    touchVoice = null;
  }

  function startTouchVoice(angle: number, branchGeom: BranchGeom): void {
    stopTouchVoice();
    const t = ctx.currentTime;
    const idx = branchGeom.idx;

    const fund = (TOUCH_REGISTERS[idx] ?? 120) + ((angle + Math.PI) / (Math.PI * 2)) * 30;
    const P = PERSONALITIES[idx] ?? PERSONALITIES[0];

    const curve = branchGeom.curvature;
    const blen = branchGeom.length;
    const spread = branchGeom.angleSpread;

    const shapedBpQ = P.bpQ * (1 + curve * 1.4);
    const shapedLpFreq = P.lpFreq * (1 + spread * 0.5);
    const shapedWobRate = P.wobRate * (1 - blen * 0.4);
    const shapedWobD = P.wobDepth * (1 + blen * 0.6);
    const shapedDetune = P.detunes.map(d => d * (1 + spread));

    const oscs: OscillatorNode[] = [];
    P.waves.forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = fund * (1 + shapedDetune[i] * 0.0006);
      oscs.push(o);
    });

    let subOsc: OscillatorNode | null = null;
    if (idx === 3) {
      subOsc = ctx.createOscillator();
      subOsc.type = 'square';
      subOsc.frequency.value = fund * 0.5;
    }

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fund * P.bpFreqMult;
    bp.Q.value = shapedBpQ;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = shapedLpFreq;
    lp.Q.value = 0.7;

    const wingOsc = ctx.createOscillator();
    wingOsc.frequency.value = fund * 0.98;
    const wingGain = ctx.createGain();
    wingGain.gain.value = P.wingDepth;

    const wobOsc = ctx.createOscillator();
    wobOsc.frequency.value = shapedWobRate + Math.random() * 2;
    const wobGain = ctx.createGain();
    wobGain.gain.value = shapedWobD;

    const noiseLen = Math.floor(ctx.sampleRate * 2);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;
    const noiseBP = ctx.createBiquadFilter();
    noiseBP.type = 'bandpass';
    noiseBP.frequency.value = fund * P.noiseMult;
    noiseBP.Q.value = P.noiseQ;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = P.noiseAmt * (1 + curve * 0.5);
    noiseSrc.connect(noiseBP); noiseBP.connect(noiseGain);

    const mixer = ctx.createGain();
    mixer.gain.value = P.mixGain;
    oscs.forEach(o => o.connect(mixer));
    if (subOsc) {
      const sg = ctx.createGain();
      sg.gain.value = 0.4;
      subOsc.connect(sg); sg.connect(mixer);
    }
    mixer.connect(bp); bp.connect(lp);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.08, t + 0.14);
    wingOsc.connect(wingGain); wingGain.connect(env.gain);
    wobOsc.connect(wobGain); wobGain.connect(env.gain);
    lp.connect(env);
    noiseGain.connect(env);
    env.connect(out);

    oscs.forEach(o => o.start(t));
    wingOsc.start(t); wobOsc.start(t); noiseSrc.start(t);
    if (subOsc) subOsc.start(t);

    touchVoice = { oscs, subOsc, env, wingOsc, wobOsc, noiseSrc, noiseBP };
  }

  function retuneTouchVoice(newFund: number): void {
    if (!touchVoice) return;
    const t = ctx.currentTime;
    const { oscs, wingOsc, noiseBP } = touchVoice;
    const detunes = [0, +4, -5];
    oscs.forEach((o, i) => {
      const f = newFund * (1 + detunes[i] * 0.0006);
      o.frequency.setTargetAtTime(f, t, 0.04);
    });
    wingOsc.frequency.setTargetAtTime(newFund * 0.98, t, 0.04);
    noiseBP.frequency.setTargetAtTime(newFund * 1.1, t, 0.04);
  }

  // ── Drone surge on branch hit (ikebana.html L789-799) ──────────────────────
  function surgeDrone(colorR: number): void {
    const g = sharedState.geom;
    const lfoRateBase = g?.lfoRateBase ?? 0.06;
    const lfoDepthMult = g?.lfoDepthMult ?? 1;
    const t = ctx.currentTime;
    const surgeRate = lfoRateBase * 6;
    const surgeDepth = colorR * 0.08;
    droneOscs.forEach((d, di) => {
      d.lfo.frequency.setTargetAtTime(surgeRate * (0.8 + di * 0.1), t, 0.05);
      d.lfo.frequency.setTargetAtTime(lfoRateBase * (0.7 + di * 0.12), t + 0.8, 0.4);
      d.lfoG.gain.setTargetAtTime(d.baseFreq * 0.018 * surgeDepth * (0.6 + di * 0.1), t, 0.04);
      d.lfoG.gain.setTargetAtTime(d.baseFreq * 0.0018 * lfoDepthMult * (0.6 + di * 0.1), t + 1.0, 0.5);
    });
  }

  // ── morphDrone equivalent (ikebana.html L312-321) ──────────────────────────
  function resetDroneGains(): void {
    const t = ctx.currentTime;
    droneOscs.forEach(d => {
      d.gNode.gain.cancelScheduledValues(t);
      d.gNode.gain.setValueAtTime(0.0001, t);
    });
  }

  audioLink = { playShimmer, playBloom, startTouchVoice, retuneTouchVoice, stopTouchVoice, surgeDrone, resetDroneGains };

  // ── tick: continuous coupling (ikebana.html L416-461, 520-526, 540-543, 860-889) ──
  let appliedGeomVersion = -1;
  let prevPointerDown = false;

  return {
    node: out,
    tick(): void {
      const t = ctx.currentTime;
      const g = sharedState.geom;

      // New ikebana → apply staggered LFO rates/depths (launchIkebana L452-460)
      if (g && g.version !== appliedGeomVersion) {
        appliedGeomVersion = g.version;
        droneOscs.forEach((d, i) => {
          const rate = g.lfoRateBase * (0.7 + i * 0.12);
          const depth = d.baseFreq * 0.0018 * g.lfoDepthMult * (0.6 + i * 0.1);
          d.lfo.frequency.setTargetAtTime(rate, t, 1.5);
          d.lfoG.gain.setTargetAtTime(depth, t, 1.5);
        });
      }

      // Live drone morphing tied to draw progress (renderIkebana L860-889)
      droneOscs.forEach((d, i) => {
        const partialProg = Math.min(1, Math.max(0, (sharedState.avgProg - i * 0.04) / 0.85));
        const targetGain = d.baseGain * partialProg * (g ? g.gainScale[i] : 1.0);
        d.gNode.gain.setTargetAtTime(Math.max(0.0001, targetGain), t, 0.08);

        const finalFreq = Math.max(20, d.baseFreq * (g ? g.freqScale[i] : 1.0));
        const startFreq = finalFreq * 1.4;
        d.osc.frequency.setTargetAtTime(startFreq + (finalFreq - startFreq) * sharedState.avgProg, t, 0.3);
      });

      // Drag → filter cutoff/Q (pointerMove L520-526, pointerUp L540-543)
      if (sharedState.pointerDown) {
        const targetCutoff = 300 + Math.min(sharedState.dragVelocity * 4000, 1800);
        droneFilter.frequency.setTargetAtTime(targetCutoff, t, 0.08);
        droneFilter.Q.setTargetAtTime(1.4 + sharedState.dragVelocity * 6, t, 0.1);
      } else if (prevPointerDown) {
        droneFilter.frequency.setTargetAtTime(800, t, 0.5);
        droneFilter.Q.setTargetAtTime(1.8, t, 0.5);
      }
      prevPointerDown = sharedState.pointerDown;
    }
  };
};

// ─── Overlay (ikebana.html L11-27, 32-33) ───────────────────────────────────

function makeOverlay(): { root: HTMLElement; hint: HTMLElement } {
  const root = document.createElement('div');
  root.setAttribute('data-ikebana-overlay', '');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';

  const kanji = document.createElement('div');
  kanji.textContent = '天　人　地';
  // top moved 36px → 96px to clear the app's back button; rest verbatim
  kanji.style.cssText =
    "position:absolute;top:96px;left:44px;" +
    "font-family:'Hiragino Mincho ProN','Yu Mincho','MS Mincho',serif;" +
    'font-size:12px;letter-spacing:0.35em;color:rgba(210,185,140,0.28);' +
    'writing-mode:vertical-rl;text-orientation:upright;user-select:none;';

  const hint = document.createElement('div');
  hint.textContent = 'doppio tap — nuovo ikebana';
  hint.style.cssText =
    'position:absolute;bottom:28px;left:50%;transform:translateX(-50%);' +
    "font-family:'Hiragino Mincho ProN','Yu Mincho',Georgia,serif;" +
    'font-size:10px;letter-spacing:0.45em;color:rgba(210,185,140,0.18);' +
    'user-select:none;transition:opacity 2s;white-space:nowrap;';

  root.appendChild(kanji);
  root.appendChild(hint);
  return { root, hint };
}

// ─── Mount ───────────────────────────────────────────────────────────────────

export const mount: RoomMount = (canvas, opts) => {
  const gl = createContext(canvas, { version: 1, antialias: true, alpha: false }) as WebGLRenderingContext;
  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  const full = opts.quality === 'full';

  // ── GL setup (ikebana.html L61-78) ─────────────────────────────────────────
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS);
  const prog = linkProgram(gl, vs, fs);
  gl.useProgram(prog);

  const u = getUniforms(gl, prog, ['u_res', 'u_color'] as const);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  const vbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let W = 1, H = 1;
  const stopResize = observeResize(canvas, () => {
    W = canvas.width;
    H = canvas.height;
    gl.viewport(0, 0, W, H);
  });

  function setColor(r: number, g: number, b: number, a: number): void {
    gl.uniform4f(u.u_color, r, g, b, a);
  }

  // ── Drawing primitives (ikebana.html L82-107) ──────────────────────────────
  function thickPolyline(pts: Pt[], w: number): void {
    if (pts.length < 2) return;
    const verts: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(i - 1, 0)];
      const next = pts[Math.min(i + 1, pts.length - 1)];
      const dx = next[0] - prev[0], dy = next[1] - prev[1];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len * w * 0.5;
      const ny = dx / len * w * 0.5;
      verts.push(pts[i][0] + nx, pts[i][1] + ny,
                 pts[i][0] - nx, pts[i][1] - ny);
    }
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, pts.length * 2);
  }

  function drawCirclePts(cx: number, cy: number, r: number, steps = 32): void {
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    thickPolyline(pts, 0.8);
  }

  // ── State (ikebana.html L403-473, 562-568, 982-991) ───────────────────────
  let geomVersion = 0;

  function launchIkebana(ik: Ikebana): Ikebana {
    if (full) {
      geomVersion++;
      sharedState.geom = computeIkebanaGeom(ik, geomVersion);
    }
    return ik;
  }

  let ikebanas: Ikebana[] = [launchIkebana(genIkebana())];
  const disturbances: Disturbance[] = [];
  const shootRegistry: ShootReg[] = [];
  const shimmeredShoots = new WeakSet<Shoot>();
  let ripplePhase = 0;

  const petals: Petal[] = Array.from({ length: 11 }, () => ({
    x: 0.12 + Math.random() * 0.76,
    y: -0.05 - Math.random() * 0.45,
    vy: 0.00013 + Math.random() * 0.00010,
    vx: (Math.random() - 0.5) * 0.00006,
    phase: Math.random() * Math.PI * 2,
    r: 1.1 + Math.random() * 1.4,
    alpha: 0.09 + Math.random() * 0.14
  }));

  // ── Overlay (full mode only) ───────────────────────────────────────────────
  let overlayRoot: HTMLElement | null = null;
  let hint: HTMLElement | null = null;
  if (full) {
    const ov = makeOverlay();
    overlayRoot = ov.root;
    hint = ov.hint;
    (canvas.parentElement ?? document.body).appendChild(overlayRoot);
  }

  function resetIkebana(): void {
    ikebanas.forEach(ik => { ik.dying = true; ik.deathTime = performance.now(); });
    const ik = launchIkebana(genIkebana());
    ikebanas.push(ik);
    audioLink?.playBloom(sharedState.geom?.rootFreq ?? 82.5);
    audioLink?.resetDroneGains();
    if (hint) hint.style.opacity = '0';
  }

  // ── Pointer tracking (ikebana.html L475-561) ──────────────────────────────
  const pointer = { x: -9999, y: -9999, down: false, moved: false };
  let lastPointerX = 0, lastPointerY = 0, lastPointerTime = 0;
  let dragVelocity = 0;
  let lastTap = 0, lastTouchX = 0, lastTouchY = 0;
  let isOnBranch = false;
  let lastDisturbTime = 0;
  const listenerCleanups: (() => void)[] = [];

  function canvasScale(): { sx: number; sy: number; left: number; top: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      sx: canvas.width / (rect.width || 1),
      sy: canvas.height / (rect.height || 1),
      left: rect.left,
      top: rect.top
    };
  }

  function pointerMove(cx: number, cy: number): void {
    const now = performance.now();
    const { sx, sy, left, top } = canvasScale();
    const nx = (cx - left) * sx;
    const ny = (cy - top) * sy;
    const dt = Math.max(1, now - lastPointerTime);
    const dx = nx - lastPointerX, dy = ny - lastPointerY;
    const speed = Math.sqrt(dx * dx + dy * dy) / dt;
    dragVelocity = dragVelocity * 0.7 + speed * 0.3;
    sharedState.dragVelocity = dragVelocity;

    pointer.x = nx; pointer.y = ny;
    pointer.moved = true;
    lastPointerX = nx; lastPointerY = ny; lastPointerTime = now;
  }
  function pointerDown(cx: number, cy: number): void {
    pointer.down = true;
    sharedState.pointerDown = true;
    pointerMove(cx, cy);
  }
  function pointerUp(): void {
    pointer.down = false;
    sharedState.pointerDown = false;
    pointer.moved = true;
    dragVelocity = 0;
    sharedState.dragVelocity = 0;
  }

  if (full) {
    const onTapStart = (e: TouchEvent): void => {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    };
    const onTapEnd = (e: TouchEvent): void => {
      const dx = e.changedTouches[0].clientX - lastTouchX;
      const dy = e.changedTouches[0].clientY - lastTouchY;
      if (Math.sqrt(dx * dx + dy * dy) > 14) return;
      const now = Date.now();
      if (now - lastTap < 320) resetIkebana();
      lastTap = now;
    };
    const onDblClick = (): void => resetIkebana();
    const onMouseMove = (e: MouseEvent): void => pointerMove(e.clientX, e.clientY);
    const onMouseDown = (e: MouseEvent): void => pointerDown(e.clientX, e.clientY);
    const onMouseUp = (): void => pointerUp();
    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length === 1) {
        pointer.down = true;
        sharedState.pointerDown = true;
        pointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length === 1) {
        pointerDown(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchEnd = (): void => pointerUp();

    canvas.addEventListener('touchstart', onTapStart, { passive: true });
    canvas.addEventListener('touchend', onTapEnd, { passive: true });
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown, { capture: true });
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });

    listenerCleanups.push(
      () => canvas.removeEventListener('touchstart', onTapStart),
      () => canvas.removeEventListener('touchend', onTapEnd),
      () => canvas.removeEventListener('dblclick', onDblClick),
      () => canvas.removeEventListener('mousemove', onMouseMove),
      () => canvas.removeEventListener('mousedown', onMouseDown, { capture: true } as EventListenerOptions),
      () => canvas.removeEventListener('mouseup', onMouseUp),
      () => canvas.removeEventListener('touchmove', onTouchMove),
      () => canvas.removeEventListener('touchstart', onTouchStart, { capture: true } as EventListenerOptions),
      () => canvas.removeEventListener('touchend', onTouchEnd)
    );
  }

  // ── Hit detection (ikebana.html L729-829) ─────────────────────────────────
  function checkLineHit(): void {
    if (!pointer.down && !pointer.moved) return;
    pointer.moved = false;
    const now = performance.now();
    const px = pointer.x, py = pointer.y;
    const hitRadius = Math.min(W, H) * 0.055;

    let hit = false;

    ikebanas.forEach(ik => {
      if (!ik.startTime || hit) return;
      const elapsed = (now - ik.startTime) / 1000;
      ik.branches.forEach((br, bi) => {
        if (hit) return;
        const prog = easeOut5(Math.min(Math.max((elapsed - br.delay) / br.duration, 0), 1));
        if (prog < 0.05) return;
        const full2 = buildSpline(br.cps.map(([x, y]) => [x * W, y * H] as Pt), 140);
        const n = Math.floor(full2.length * prog);
        for (let i = 0; i < n; i += 8) {
          const dx = full2[i][0] - px, dy = full2[i][1] - py;
          if (dx * dx + dy * dy < hitRadius * hitRadius) {
            hit = true;
            if (now - lastDisturbTime > 60) {
              const splineT0 = i / (full2.length - 1);
              disturbances.push({ created: now, branchIdx: bi, splineT: splineT0, amp: hitRadius * 0.55, ikRef: ik });
              lastDisturbTime = now;
            }
            const splineT = i / (full2.length - 1);
            const basePitch = 100 + br.color[0] * 80;
            const newFund = basePitch * (1 + splineT * 1.5);

            if (!isOnBranch) {
              const cps = br.cps;
              const straight = Math.sqrt(Math.pow(cps[cps.length - 1][0] - cps[0][0], 2) + Math.pow(cps[cps.length - 1][1] - cps[0][1], 2));
              let maxDev = 0;
              cps.forEach(p => {
                const t2 = (p[0] - cps[0][0]) / (cps[cps.length - 1][0] - cps[0][0] + 0.001);
                const lx = cps[0][0] + (cps[cps.length - 1][0] - cps[0][0]) * t2;
                const ly = cps[0][1] + (cps[cps.length - 1][1] - cps[0][1]) * t2;
                maxDev = Math.max(maxDev, Math.sqrt(Math.pow(p[0] - lx, 2) + Math.pow(p[1] - ly, 2)));
              });
              const curvature = Math.min(1, maxDev / (straight * 0.5 + 0.001));
              const brLen = Math.min(1, straight / Math.min(W, H));
              const angleSpread = br.shoots.length > 0
                ? Math.min(1, br.shoots.reduce((s, sh) => s + Math.abs(sh.angle), 0) / br.shoots.length / Math.PI)
                : 0.3;
              const geom: BranchGeom = { idx: bi, curvature, length: brLen, angleSpread };
              audioLink?.startTouchVoice(Math.atan2(py - H * 0.5, px - W * 0.5), geom);
            }
            audioLink?.retuneTouchVoice(newFund);
            if (now - lastDisturbTime <= 80) {
              audioLink?.surgeDrone(br.color[0]);
            }
            break;
          }
        }
      });
    });

    if (pointer.down) {
      const shootRadius = Math.min(W, H) * 0.04;
      shootRegistry.forEach(reg => {
        const now2 = performance.now();
        if (now2 - reg.lastHit < 300) return;
        if (!reg.pts || reg.pts.length === 0) return;
        for (let i = 0; i < reg.pts.length; i += 4) {
          const dx = reg.pts[i][0] - px, dy = reg.pts[i][1] - py;
          if (dx * dx + dy * dy < shootRadius * shootRadius) {
            reg.lastHit = now2;
            audioLink?.playShimmer(reg.angle, reg.branchIdx);
            break;
          }
        }
      });
    }

    if (!hit && isOnBranch) audioLink?.stopTouchVoice();
    isOnBranch = hit;

    if (!pointer.down) audioLink?.stopTouchVoice();
  }

  // ── Ripples (ikebana.html L831-846) ────────────────────────────────────────
  function drawRipples(cx: number, cy: number, phase: number, gAlpha: number): void {
    for (let i = 0; i < 4; i++) {
      const rp = (phase * 0.25 + i / 4) % 1;
      const r = rp * W * 0.10;
      const a = (1 - rp) * 0.06 * gAlpha;
      if (a < 0.004) continue;
      setColor(0.65, 0.55, 0.35, a);
      const pts: Pt[] = [];
      for (let j = 0; j <= 40; j++) {
        const ang = (j / 40) * Math.PI * 2;
        pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.14]);
      }
      thickPolyline(pts, 0.6);
    }
  }

  // ── Render one ikebana (ikebana.html L848-980) ────────────────────────────
  const dprW = (): number => Math.min(window.devicePixelRatio || 1, 2);

  function renderIkebana(ik: Ikebana, now: number): void {
    if (!ik.startTime) ik.startTime = now;
    const elapsed = (now - ik.startTime) / 1000;
    const fadeIn = Math.min(1, elapsed / 0.7);
    let gAlpha = fadeIn;
    if (ik.dying) {
      const d = (now - ik.deathTime) / 1000;
      gAlpha = Math.max(0, 1 - d / 1.2);
      if (gAlpha <= 0) { ik.dead = true; return; }
    }

    // Average draw progress feeds the drone morph (full mode only)
    if (!ik.dying && full) {
      sharedState.avgProg = ik.branches.reduce((sum, br) => {
        return sum + easeOut5(Math.min(Math.max((elapsed - br.delay) / br.duration, 0), 1));
      }, 0) / ik.branches.length;
    }

    gl.uniform2f(u.u_res, W, H);

    drawRipples(ik.ox * W, ik.oy * H, ripplePhase, gAlpha);

    ik.branches.forEach((br, bi) => {
      const prog = easeOut5(Math.min(Math.max((elapsed - br.delay) / br.duration, 0), 1));
      if (prog <= 0) return;

      const fullSpline = buildSpline(br.cps.map(([x, y]) => [x * W, y * H] as Pt), 140);
      const n = Math.max(2, Math.floor(fullSpline.length * prog));
      const sub = fullSpline.slice(0, n);
      const [r, g, b] = br.color;
      const a = br.alpha * gAlpha;

      const drawPts: Pt[] = sub.map((pt, pi) => {
        let ox2 = 0, oy2 = 0;
        const tNorm = pi / (sub.length - 1 || 1);
        disturbances.forEach(dis => {
          if (dis.ikRef !== ik || dis.branchIdx !== bi) return;
          const age = (now - dis.created) / 1000;
          const decay = Math.max(0, 1 - age / 1.2);
          if (decay <= 0) return;
          const wave = Math.sin((tNorm - dis.splineT) * 18 - age * 8) * decay;
          const dist = Math.abs(tNorm - dis.splineT);
          const env = Math.exp(-dist * 12) * decay;
          const prev2 = sub[Math.max(pi - 1, 0)];
          const next2 = sub[Math.min(pi + 1, sub.length - 1)];
          const dxs = next2[0] - prev2[0], dys = next2[1] - prev2[1];
          const dlen = Math.sqrt(dxs * dxs + dys * dys) || 1;
          ox2 += (-dys / dlen) * wave * env * dis.amp;
          oy2 += (dxs / dlen) * wave * env * dis.amp;
        });
        return [pt[0] + ox2, pt[1] + oy2];
      });

      // core line
      setColor(r, g, b, a);
      thickPolyline(drawPts, br.width * dprW());

      // glow
      setColor(r, g, b, a * 0.15);
      thickPolyline(drawPts, br.width * dprW() * 4);

      // shoots
      br.shoots.forEach(sh => {
        const shProg = easeOut3(Math.min(Math.max((elapsed - sh.delay) / 0.9, 0), 1));
        if (shProg <= 0) return;
        if (shProg > 0.02 && !shimmeredShoots.has(sh)) {
          shimmeredShoots.add(sh);
          audioLink?.playShimmer(sh.angle, bi);
        }
        const base = splinePt(fullSpline, sh.t);
        const ex = base[0] + Math.cos(sh.angle) * sh.len * W * shProg;
        const ey = base[1] + Math.sin(sh.angle) * sh.len * H * shProg;
        const mid: Pt = [
          base[0] + (ex - base[0]) * 0.5 + rnd(-4, 4),
          base[1] + (ey - base[1]) * 0.5 + rnd(-4, 4)
        ];
        const spts = buildSpline([base, mid, [ex, ey]], 40);
        setColor(r, g, b, a * 0.65);
        thickPolyline(spts, Math.max(0.6, br.width * 0.55 * dprW()));

        let reg = shootRegistry.find(r2 => r2.sh === sh);
        if (!reg) {
          reg = { sh, pts: [], angle: sh.angle, lastHit: 0, branchIdx: bi };
          shootRegistry.push(reg);
        }
        reg.pts = spts;
      });

      // bud
      if (br.budR > 0) {
        const budProg = easeOut3(Math.min(Math.max((elapsed - br.budDelay) / 0.5, 0), 1));
        if (budProg > 0) {
          const tip = splinePt(fullSpline, 1.0);
          const [br2, bg2, bb2] = br.color.map(v => Math.min(1, v + 0.1));
          setColor(br2, bg2, bb2, 0.75 * budProg * gAlpha);
          drawCirclePts(tip[0], tip[1], br.budR * budProg * dprW());
          setColor(br2, bg2, bb2, 0.95 * budProg * gAlpha);
          drawCirclePts(tip[0], tip[1], br.budR * 0.28 * budProg * dprW());
        }
      }
    });
  }

  // ── Main loop (ikebana.html L993-1031) ─────────────────────────────────────
  const loop = createRafLoop((_dt, ts) => {
    gl.uniform2f(u.u_res, W, H);
    gl.clearColor(0.024, 0.019, 0.012, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    ripplePhase = ts / 1000;

    // bg verticals
    for (let i = 0; i < 7; i++) {
      const x = W * (0.08 + i * 0.13);
      setColor(0.50, 0.43, 0.26, 0.007 + 0.004 * Math.sin(ts * 0.0002 + i));
      thickPolyline([[x, 0], [x, H]], 0.5);
    }

    // prune disturbances
    const dNow = performance.now();
    for (let i = disturbances.length - 1; i >= 0; i--) {
      if (dNow - disturbances[i].created > 1300) disturbances.splice(i, 1);
    }
    shootRegistry.length = 0;
    if (full) checkLineHit();

    ikebanas.forEach(ik => renderIkebana(ik, ts));
    if (ikebanas.length > 1) ikebanas = ikebanas.filter(ik => !ik.dead);

    petals.forEach(p => {
      p.x += p.vx + Math.sin(ts * 0.0008 + p.phase) * 0.00002;
      p.y += p.vy;
      if (p.y > 1.08) { p.y = -0.04; p.x = 0.10 + Math.random() * 0.80; }
      setColor(0.80, 0.72, 0.52, p.alpha);
      drawCirclePts(p.x * W, p.y * H, p.r * dprW());
    });
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
      try { gl.deleteBuffer(vbuf); } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
