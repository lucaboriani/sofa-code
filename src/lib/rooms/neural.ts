import type { RoomMount } from '@/lib/webgl/types';
import type { RoomAudio } from '@/lib/audio/bus';
import { createContext } from '@/lib/webgl/context';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';

// ─── Quality parameters ───────────────────────────────────────────────────────

const NEURON_COUNT = { preview: 48, full: 220 } as const;
const SPIKE_RATE   = { preview: 0.2, full: 0.6 } as const;

// ─── Shared audio state (written by createAudio, read by mount each frame) ───

const sharedState = {
  rms: 0,             // written by audio tick (mic analyser)
  simSpeed: 0.08,     // written by mount each frame
  collisionCount: 0,  // incremented by mount, reset by audio tick
  rotX: 0             // camera tilt, written by mount each frame
};

// ─── Audio factory ────────────────────────────────────────────────────────────

export const createAudio = (ctx: AudioContext): RoomAudio => {
  // ── Master output ────────────────────────────────────────────────────────────
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.07;

  // ── Lowpass filter ───────────────────────────────────────────────────────────
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 30;
  droneFilter.Q.value = 6;
  droneFilter.connect(droneGain);

  // ── Collision accent gain ────────────────────────────────────────────────────
  const collisionGain = ctx.createGain();
  collisionGain.gain.value = 0;
  collisionGain.connect(droneGain);

  // ── Osc 1: deep sub sine ─────────────────────────────────────────────────────
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 8;
  osc1.connect(droneFilter);
  osc1.start();

  // ── Osc 3: sub octave sawtooth ───────────────────────────────────────────────
  const osc3 = ctx.createOscillator();
  osc3.type = 'sawtooth';
  osc3.frequency.value = 4;
  const g3 = ctx.createGain();
  g3.gain.value = 0.22;
  osc3.connect(g3);
  g3.connect(droneFilter);
  osc3.start();

  // ── Collision accent oscillator ──────────────────────────────────────────────
  const collOsc = ctx.createOscillator();
  collOsc.type = 'sine';
  collOsc.frequency.value = 18;
  collOsc.connect(collisionGain);
  collOsc.start();

  // ── LFO → filter cutoff ──────────────────────────────────────────────────────
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.03;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 6;
  lfo.connect(lfoGain);
  lfoGain.connect(droneFilter.frequency);
  lfo.start();

  // ── Noise → bandpass → master (silent below speed 0.45) ─────────────────────
  const sr = ctx.sampleRate;
  const nbuf = ctx.createBuffer(1, sr * 3, sr);
  const nd = nbuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const nsrc = ctx.createBufferSource();
  nsrc.buffer = nbuf;
  nsrc.loop = true;
  nsrc.start();
  const nbp = ctx.createBiquadFilter();
  nbp.type = 'bandpass';
  nbp.frequency.value = 400;
  nbp.Q.value = 0.6;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  nsrc.connect(nbp);
  nbp.connect(noiseGain);
  noiseGain.connect(droneGain);

  // ── Mic analyser (visual reactivity only — not connected to destination) ─────
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  const bins = new Uint8Array(analyser.frequencyBinCount);

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);
  }).catch(() => { /* permission denied — RMS stays 0, demo still runs */ });

  return {
    node: droneGain,
    tick() {
      // Mic → rms (visual reactivity)
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i];
      sharedState.rms = Math.sqrt(sum / bins.length) / 255;

      // Drone modulation from simulation state
      const t = ctx.currentTime;
      const speed = sharedState.simSpeed;
      const targetFreq = 18 + speed * 40 + Math.abs(sharedState.rotX) * 35;
      droneFilter.frequency.setTargetAtTime(targetFreq, t, 2.5);
      lfo.frequency.setTargetAtTime(0.06 + speed * 0.12, t, 4.0);

      // Collisions → brief resonance accent
      const collN = sharedState.collisionCount;
      if (collN > 0) {
        const intensity = Math.min(collN * 0.015, 0.08);
        collisionGain.gain.cancelScheduledValues(t);
        collisionGain.gain.setValueAtTime(intensity, t);
        collisionGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        droneFilter.Q.cancelScheduledValues(t);
        droneFilter.Q.setValueAtTime(3.5 + collN * 1.2, t);
        droneFilter.Q.setTargetAtTime(3.5, t + 0.05, 0.15);
        sharedState.collisionCount = 0;
      }

      // Noise gate above speed 0.45
      if (speed <= 0.45) {
        noiseGain.gain.setTargetAtTime(0, t, 0.1);
      } else {
        noiseGain.gain.setTargetAtTime((speed - 0.45) / 0.05 * 0.15, t, 3.0);
      }

      // Master gain tracks speed subtly
      const targetGain = speed < 0.05 ? 0.005 : 0.06 + Math.min(speed, 3) * 0.012;
      droneGain.gain.setTargetAtTime(targetGain, t, 0.6);
    }
  };
};

// ─── Shaders ──────────────────────────────────────────────────────────────────

const VS_LINE = `
  attribute vec3 aPos;
  attribute float aBright;
  uniform mat4 uMVP;
  varying float vBright;
  void main(){
    gl_Position = uMVP * vec4(aPos, 1.0);
    vBright = aBright;
  }
`;

const FS_LINE = `
  precision mediump float;
  uniform vec3 uBaseColor;
  uniform vec3 uGlowColor;
  varying float vBright;
  void main(){
    vec3 col = mix(uBaseColor, uGlowColor, vBright);
    float a   = mix(0.55, 1.0, vBright);
    gl_FragColor = vec4(col * a, a);
  }
`;

const VS_PT = `
  attribute vec3 aPos;
  attribute float aSize;
  attribute float aAlpha;
  uniform mat4 uMVP;
  varying float vAlpha;
  void main(){
    gl_Position   = uMVP * vec4(aPos, 1.0);
    gl_PointSize  = aSize;
    vAlpha = aAlpha;
  }
`;

const FS_PT = `
  precision mediump float;
  uniform vec3 uColor;
  varying float vAlpha;
  void main(){
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.3, 1.0, d)) * vAlpha;
    gl_FragColor = vec4(uColor, a);
  }
`;

// ─── Math helpers (all in closure scope — no allocations in hot path) ─────────

interface Vec3 { x: number; y: number; z: number; }

function v3(x: number, y: number, z: number): Vec3 { return { x, y, z }; }
function add(a: Vec3, b: Vec3): Vec3 { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
function sub(a: Vec3, b: Vec3): Vec3 { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
function scl(a: Vec3, s: number): Vec3 { return v3(a.x * s, a.y * s, a.z * s); }
function vlen(a: Vec3): number { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
function norm(a: Vec3): Vec3 { const l = vlen(a) || 1; return scl(a, 1 / l); }
function rnd(lo: number, hi: number): number { return lo + Math.random() * (hi - lo); }
function rndDir(): Vec3 {
  const th = rnd(0, Math.PI * 2), ph = Math.acos(rnd(-1, 1));
  return v3(Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph));
}
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

// ─── Mat4 ─────────────────────────────────────────────────────────────────────

function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[r + k * 4] * b[k + c * 4];
    o[r + c * 4] = s;
  }
  return o;
}

function perspective(fov: number, asp: number, n: number, f: number): Float32Array {
  const t = 1 / Math.tan(fov / 2), m = new Float32Array(16);
  m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f);
  m[14] = (2 * f * n) / (n - f); m[11] = -1;
  return m;
}

function rotY(a: number): Float32Array {
  const m = new Float32Array(16), c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[8] = s; m[5] = 1; m[2] = -s; m[10] = c; m[15] = 1;
  return m;
}

function rotX(a: number): Float32Array {
  const m = new Float32Array(16), c = Math.cos(a), s = Math.sin(a);
  m[0] = 1; m[5] = c; m[9] = -s; m[6] = s; m[10] = c; m[15] = 1;
  return m;
}

function transl(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; m[13] = y; m[14] = z;
  return m;
}

// ─── Geometry builder ────────────────────────────────────────────────────────

interface Edge {
  a: number;
  b: number;
  mainPts: Vec3[];
  laterals: Vec3[][];
}

function buildPath(start: Vec3, end: Vec3, depth: number): Vec3[] {
  function subdivide(arr: Vec3[], d: number): Vec3[] {
    if (d === 0) return arr;
    const out: Vec3[] = [arr[0]];
    for (let i = 0; i < arr.length - 1; i++) {
      const mid = add(scl(add(arr[i], arr[i + 1]), 0.5), scl(rndDir(), 0.07 * d));
      out.push(mid, arr[i + 1]);
    }
    return subdivide(out, d - 1);
  }
  return subdivide([start, end], depth);
}

function buildGeometry(neuronCount: number): {
  posArr: number[];
  segEdge: number[];
  edgeMainSegStart: number[];
  edgeMainSegCount: number[];
  edges: Edge[];
  nodes: Array<{ pos: Vec3 }>;
  somaPosF: Float32Array;
  somaSzF: Float32Array;
} {
  const N = Math.min(neuronCount, 18); // Cap soma count; edge density scales naturally
  const nodes: Array<{ pos: Vec3 }> = [];

  for (let i = 0; i < N; i++) {
    const th = rnd(0, Math.PI * 2), ph = Math.acos(rnd(-0.9, 0.9)), r = rnd(0.5, 1.1);
    nodes.push({
      pos: v3(
        r * Math.sin(ph) * Math.cos(th) * 1.8,
        r * Math.sin(ph) * Math.sin(th) * 1.2,
        r * Math.cos(ph) * 1.5
      )
    });
  }

  const edges: Edge[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const d = vlen(sub(nodes[j].pos, nodes[i].pos));
      if (d < 1.7 && Math.random() < 0.6) {
        const mainPts = buildPath(nodes[i].pos, nodes[j].pos, 3);
        const laterals: Vec3[][] = [];
        for (let k = 1; k < mainPts.length - 1; k++) {
          if (Math.random() < 0.22) {
            const dir = norm(add(rndDir(), scl(norm(sub(mainPts[k + 1], mainPts[k - 1])), -0.5)));
            const endPt = add(mainPts[k], scl(dir, rnd(0.1, 0.28)));
            laterals.push(buildPath(mainPts[k], endPt, 2));
          }
        }
        edges.push({ a: i, b: j, mainPts, laterals });
      }
    }
  }

  const posArr: number[] = [];
  const segEdge: number[] = [];
  const edgeMainSegStart: number[] = [];
  const edgeMainSegCount: number[] = [];

  function addPath(pts: Vec3[], edgeIdx: number): number {
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      posArr.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      segEdge.push(edgeIdx);
    }
    return pts.length - 1;
  }

  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    const start = segEdge.length;
    const cnt = addPath(e.mainPts, ei);
    edgeMainSegStart.push(start);
    edgeMainSegCount.push(cnt);
    for (const lp of e.laterals) addPath(lp, ei);
  }

  const somaPosF = new Float32Array(nodes.flatMap(n => [n.pos.x, n.pos.y, n.pos.z]));
  const somaSzF = new Float32Array(nodes.map(() => rnd(2, 4)));

  return { posArr, segEdge, edgeMainSegStart, edgeMainSegCount, edges, nodes, somaPosF, somaSzF };
}

// ─── GL helpers ───────────────────────────────────────────────────────────────

function mkShader(gl: WebGLRenderingContext, src: string, type: number): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader returned null');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

function mkProg(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram returned null');
  gl.attachShader(p, mkShader(gl, vs, gl.VERTEX_SHADER));
  gl.attachShader(p, mkShader(gl, fs, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  return p;
}

function setAttr(
  gl: WebGLRenderingContext,
  prog: WebGLProgram,
  name: string,
  buf: WebGLBuffer,
  size: number
): void {
  const loc = gl.getAttribLocation(prog, name);
  if (loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

function uLoc(
  gl: WebGLRenderingContext,
  prog: WebGLProgram,
  name: string
): WebGLUniformLocation | null {
  return gl.getUniformLocation(prog, name);
}

// ─── Mount ────────────────────────────────────────────────────────────────────

export const mount: RoomMount = (canvas, opts) => {
  const gl = createContext(canvas, { version: 1, antialias: true, alpha: false }) as WebGLRenderingContext;
  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  const neuronCount = NEURON_COUNT[opts.quality];
  const spikeRate   = SPIKE_RATE[opts.quality];

  // ── Programs ──
  const progLine = mkProg(gl, VS_LINE, FS_LINE);
  const progPt   = mkProg(gl, VS_PT,   FS_PT);

  // ── Geometry ──
  const geo = buildGeometry(neuronCount);
  const { edges, nodes, somaPosF, somaSzF, edgeMainSegStart, edgeMainSegCount } = geo;
  const posF32 = new Float32Array(geo.posArr);
  const NSEG = geo.segEdge.length;

  // ── Preallocated buffers (no allocs in tick) ──
  const brightArr    = new Float32Array(NSEG * 2);
  const brightSmooth = new Float32Array(NSEG * 2);
  const somaAlDyn    = new Float32Array(nodes.length);
  const MAX_IMP = 200;
  const impPosF  = new Float32Array(MAX_IMP * 3);
  const impSzF   = new Float32Array(MAX_IMP);
  const impAlF   = new Float32Array(MAX_IMP);
  const MAX_BURST = 256;
  const burstPosF = new Float32Array(MAX_BURST * 3);
  const burstSzF  = new Float32Array(MAX_BURST);
  const burstAlF  = new Float32Array(MAX_BURST);

  // ── GL Buffers ──
  const posB    = gl.createBuffer()!;
  const brightB = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, posB);
  gl.bufferData(gl.ARRAY_BUFFER, posF32, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, brightB);
  gl.bufferData(gl.ARRAY_BUFFER, brightArr, gl.DYNAMIC_DRAW);

  const somaPosB = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, somaPosB);
  gl.bufferData(gl.ARRAY_BUFFER, somaPosF, gl.STATIC_DRAW);

  const somaSzB = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, somaSzB);
  gl.bufferData(gl.ARRAY_BUFFER, somaSzF, gl.STATIC_DRAW);

  const somaAlB  = gl.createBuffer()!;
  const impPosB  = gl.createBuffer()!;
  const impSzB   = gl.createBuffer()!;
  const impAlB   = gl.createBuffer()!;
  const burstPosB = gl.createBuffer()!;
  const burstSzB  = gl.createBuffer()!;
  const burstAlB  = gl.createBuffer()!;

  // Reusable scratch buffer for glow size arrays (avoid per-frame allocation)
  const somaGlowSz = new Float32Array(nodes.length);
  const tmpSzB = gl.createBuffer()!;

  // ── Impulse state ──
  interface Impulse {
    pts: Vec3[];
    segStart: number | null;
    segCount: number | null;
    isLateral: boolean;
    t: number;
    speed: number;
    tail: number;
    bright: number;
  }

  const impulses: Impulse[] = [];

  function spawnImpulse(): void {
    if (impulses.length >= MAX_IMP || edges.length === 0) return;
    const ei  = Math.floor(Math.random() * edges.length);
    const e   = edges[ei];
    const rev = Math.random() < 0.5;
    const useLateral = e.laterals.length > 0 && Math.random() < 0.25;
    const srcPts = useLateral
      ? e.laterals[Math.floor(Math.random() * e.laterals.length)]
      : e.mainPts;
    const pts = rev ? [...srcPts].reverse() : srcPts;
    const segStart = useLateral ? null : edgeMainSegStart[ei];
    const segCount = useLateral ? null : edgeMainSegCount[ei];

    impulses.push({
      pts,
      segStart,
      segCount,
      isLateral: useLateral,
      t: 0,
      speed: rnd(0.003, 0.009),
      tail: rnd(0.08, 0.22),
      bright: rnd(0.7, 1.0),
    });
  }

  // ── Burst state ──
  interface Burst { x: number; y: number; z: number; life: number; }
  const bursts: Burst[] = [];
  const COLL_DIST2 = 0.08 * 0.08;

  // Seed initial impulses
  const initCount = Math.min(120, MAX_IMP);
  for (let i = 0; i < initCount; i++) spawnImpulse();

  // ── Sim state (mouse / rotation) ──
  let angle = 0;
  let mx = 0, my = 0;
  let simSpeed = 0.08;

  // ── Pointer interaction (full quality only — preview is a card, drag conflicts) ──
  const pointerCleanups: Array<() => void> = [];

  if (opts.quality === 'full') {
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let dragStartMx = 0, dragStartMy = 0;
    let simSpeedBase = simSpeed;

    // Track active pointers for two-finger pinch
    const activePointers = new Map<number, { x: number; y: number }>();

    function onDragStart(cx: number, cy: number): void {
      isDragging = true;
      dragStartX = cx;
      dragStartY = cy;
      dragStartMx = mx;
      dragStartMy = my;
      simSpeedBase = simSpeed;
    }

    function onDragMove(cx: number, cy: number): void {
      if (!isDragging) return;
      const dx = (cx - dragStartX) / canvas.clientWidth;
      const dy = (dragStartY - cy) / canvas.clientHeight;
      mx = Math.max(-1, Math.min(1, dragStartMx + dx * 2.2));
      my = Math.max(-1, Math.min(1, dragStartMy - (cy - dragStartY) / canvas.clientHeight * 2.2));
      simSpeed = Math.max(0.02, Math.min(0.5, simSpeedBase + dy * 0.48));
    }

    function onPointerDown(e: PointerEvent): void {
      canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Only start single-pointer drag when there's exactly one pointer
      if (activePointers.size === 1) {
        onDragStart(e.clientX, e.clientY);
      } else {
        // Second finger arrived — cancel single-finger drag
        isDragging = false;
      }
    }

    function onPointerMove(e: PointerEvent): void {
      if (!activePointers.has(e.pointerId)) return;

      if (activePointers.size === 2) {
        // Two-finger pinch: adjust simSpeed by change in distance
        const prev = activePointers.get(e.pointerId)!;
        const ids = [...activePointers.keys()];
        const otherId = ids.find(id => id !== e.pointerId)!;
        const other = activePointers.get(otherId)!;

        const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
        const newDist  = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        const delta = (newDist - prevDist) / canvas.clientHeight;
        simSpeed = Math.max(0.02, Math.min(0.5, simSpeed + delta * 0.48));
      } else if (activePointers.size === 1) {
        onDragMove(e.clientX, e.clientY);
      }

      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    function onPointerUp(e: PointerEvent): void {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) {
        isDragging = false;
      }
    }

    function onPointerCancel(e: PointerEvent): void {
      activePointers.delete(e.pointerId);
      isDragging = false;
    }

    // Trackpad pinch (desktop) — ctrlKey is set by the browser for pinch gestures
    function onWheel(e: WheelEvent): void {
      if (e.ctrlKey) {
        // Trackpad pinch: deltaY is negative when pinching out (zoom in)
        e.preventDefault();
        const delta = -e.deltaY / canvas.clientHeight;
        simSpeed = Math.max(0.02, Math.min(0.5, simSpeed + delta * 0.48));
      }
    }

    canvas.addEventListener('pointerdown',  onPointerDown);
    canvas.addEventListener('pointermove',  onPointerMove);
    canvas.addEventListener('pointerup',    onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('wheel',        onWheel, { passive: false });

    pointerCleanups.push(
      () => canvas.removeEventListener('pointerdown',  onPointerDown),
      () => canvas.removeEventListener('pointermove',  onPointerMove),
      () => canvas.removeEventListener('pointerup',    onPointerUp),
      () => canvas.removeEventListener('pointercancel', onPointerCancel),
      () => canvas.removeEventListener('wheel',        onWheel),
    );
  }

  // ── Resize ──
  const stopResize = observeResize(canvas, () => {
    gl.viewport(0, 0, canvas.width, canvas.height);
  });

  // ── RAF loop ──
  const loop = createRafLoop((_dtMs, tMs) => {
    const rawDt = Math.min(_dtMs / 1000, 0.05);
    const time = tMs / 1000;

    // Audio reactivity: boost spike rate and speed with RMS
    const rms = sharedState.rms;
    const audioBoost = 1 + rms * 2;
    const effectiveSpeed = simSpeed * audioBoost;
    const effectiveSpikeRate = spikeRate * audioBoost;
    const dt = rawDt * effectiveSpeed;

    angle += rawDt * 0.10 * Math.min(effectiveSpeed, 1.5);

    // ── MVP ──
    const rx   = my * 0.4;
    const ry   = angle + mx * 0.6;

    // Write simulation state for audio drone tick
    sharedState.simSpeed = simSpeed;
    sharedState.rotX = rx;
    const proj = perspective(Math.PI / 3.6, (canvas.width || 1) / (canvas.height || 1), 0.1, 20);
    const view = transl(0, 0, -4.5);
    const rot  = mul4(rotY(ry), rotX(rx));
    const mvp  = mul4(proj, mul4(view, rot));

    gl.clearColor(0.01, 0.0, 0.02, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // ── Impulse spawning based on quality + audio ──
    if (Math.random() < effectiveSpikeRate) spawnImpulse();

    // ── Update impulses, build brightness map ──
    brightArr.fill(0);

    for (let ii = impulses.length - 1; ii >= 0; ii--) {
      const imp = impulses[ii];
      imp.t += imp.speed * dt * 60;
      if (imp.t > 1.0) {
        impulses.splice(ii, 1);
        spawnImpulse();
        spawnImpulse();
        continue;
      }
      if (!imp.pts || imp.pts.length < 2) continue;

      if (!imp.isLateral && imp.segStart !== null && imp.segCount !== null) {
        const nSegs  = imp.segCount;
        const head   = imp.t * nSegs;
        const tailLen = imp.tail * nSegs;

        for (let s = 0; s < nSegs; s++) {
          const dist = head - s;
          let bright = 0;
          if (dist >= 0 && dist <= tailLen) {
            bright = imp.bright * Math.pow(1 - dist / tailLen, 1.5);
          } else if (dist > tailLen && dist < tailLen + 1) {
            bright = imp.bright * 0.05 * (1 - (dist - tailLen));
          }
          if (bright < 0.001) continue;
          const vi = (imp.segStart + s) * 2;
          brightArr[vi]     = Math.min(1, brightArr[vi]     + bright);
          brightArr[vi + 1] = Math.min(1, brightArr[vi + 1] + bright);
        }
      }
    }

    // ── Temporal smoothing ──
    const smooth = 1.0 - Math.pow(0.12, dt);
    for (let i = 0; i < brightSmooth.length; i++) {
      brightSmooth[i] += (brightArr[i] - brightSmooth[i]) * smooth;
    }

    // ── Upload brightness ──
    gl.bindBuffer(gl.ARRAY_BUFFER, brightB);
    gl.bufferData(gl.ARRAY_BUFFER, brightSmooth, gl.DYNAMIC_DRAW);

    // ── Draw dendrites ──
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(progLine);
    gl.uniformMatrix4fv(uLoc(gl, progLine, 'uMVP'), false, mvp);
    gl.uniform3f(uLoc(gl, progLine, 'uBaseColor'), 0.22, 0.05, 0.38);
    gl.uniform3f(uLoc(gl, progLine, 'uGlowColor'), 0.90, 0.35, 1.0);
    setAttr(gl, progLine, 'aPos',    posB,    3);
    setAttr(gl, progLine, 'aBright', brightB, 1);
    gl.drawArrays(gl.LINES, 0, NSEG * 2);

    // ── Draw somas ──
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(progPt);
    gl.uniformMatrix4fv(uLoc(gl, progPt, 'uMVP'), false, mvp);

    // Outer glow
    gl.uniform3f(uLoc(gl, progPt, 'uColor'), 0.55, 0.1, 0.9);
    for (let i = 0; i < nodes.length; i++) {
      somaAlDyn[i]  = 0.22 + 0.06 * Math.sin(time * 0.6 + i * 2.1);
      somaGlowSz[i] = somaSzF[i] * 1.4;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, somaAlB);
    gl.bufferData(gl.ARRAY_BUFFER, somaAlDyn, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, tmpSzB);
    gl.bufferData(gl.ARRAY_BUFFER, somaGlowSz, gl.DYNAMIC_DRAW);
    setAttr(gl, progPt, 'aPos',   somaPosB, 3);
    setAttr(gl, progPt, 'aSize',  tmpSzB,   1);
    setAttr(gl, progPt, 'aAlpha', somaAlB,  1);
    gl.drawArrays(gl.POINTS, 0, nodes.length);

    // Core dot
    gl.uniform3f(uLoc(gl, progPt, 'uColor'), 0.95, 0.75, 1.0);
    for (let i = 0; i < nodes.length; i++) {
      somaAlDyn[i] = 0.80 + 0.08 * Math.sin(time * 0.9 + i * 1.7);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, somaAlB);
    gl.bufferData(gl.ARRAY_BUFFER, somaAlDyn, gl.DYNAMIC_DRAW);
    setAttr(gl, progPt, 'aSize',  somaSzB, 1);
    setAttr(gl, progPt, 'aAlpha', somaAlB, 1);
    gl.drawArrays(gl.POINTS, 0, nodes.length);

    // ── Build impulse dot arrays ──
    let icount = 0;
    for (const imp of impulses) {
      const pts = imp.pts;
      if (!pts || pts.length < 2) continue;
      const T  = imp.t * (pts.length - 1);
      const si = Math.min(Math.floor(T), pts.length - 2);
      const fr = T - si;
      const p0 = pts[si], p1 = pts[si + 1];
      if (!p0 || !p1) continue;
      impPosF[icount * 3]     = lerp(p0.x, p1.x, fr);
      impPosF[icount * 3 + 1] = lerp(p0.y, p1.y, fr);
      impPosF[icount * 3 + 2] = lerp(p0.z, p1.z, fr);
      const edge = Math.sin(imp.t * Math.PI);
      impSzF[icount] = 2 * edge + 1;
      impAlF[icount] = 0.90 * edge + 0.05;
      icount++;
    }

    if (icount > 0) {
      // Bright core
      gl.uniform3f(uLoc(gl, progPt, 'uColor'), 1.0, 0.85, 1.0);
      gl.bindBuffer(gl.ARRAY_BUFFER, impPosB);
      gl.bufferData(gl.ARRAY_BUFFER, impPosF.subarray(0, icount * 3), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, impSzB);
      gl.bufferData(gl.ARRAY_BUFFER, impSzF.subarray(0, icount), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, impAlB);
      gl.bufferData(gl.ARRAY_BUFFER, impAlF.subarray(0, icount), gl.DYNAMIC_DRAW);
      setAttr(gl, progPt, 'aPos',   impPosB, 3);
      setAttr(gl, progPt, 'aSize',  impSzB,  1);
      setAttr(gl, progPt, 'aAlpha', impAlB,  1);
      gl.drawArrays(gl.POINTS, 0, icount);

      // Outer halo — reuse impSzF/impAlF scratch (they're preallocated, just scale in-place)
      gl.uniform3f(uLoc(gl, progPt, 'uColor'), 0.65, 0.1, 1.0);
      for (let i = 0; i < icount; i++) {
        impSzF[i] *= 1.8;
        impAlF[i] *= 0.35;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, impSzB);
      gl.bufferData(gl.ARRAY_BUFFER, impSzF.subarray(0, icount), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, impAlB);
      gl.bufferData(gl.ARRAY_BUFFER, impAlF.subarray(0, icount), gl.DYNAMIC_DRAW);
      setAttr(gl, progPt, 'aSize',  impSzB, 1);
      setAttr(gl, progPt, 'aAlpha', impAlB, 1);
      gl.drawArrays(gl.POINTS, 0, icount);
    }

    // ── Collision detection ──
    let frameCollisions = 0;
    for (let a = 0; a < icount - 1; a++) {
      const ax = impPosF[a * 3], ay = impPosF[a * 3 + 1], az = impPosF[a * 3 + 2];
      for (let b = a + 1; b < icount; b++) {
        const dx = ax - impPosF[b * 3], dy = ay - impPosF[b * 3 + 1], dz = az - impPosF[b * 3 + 2];
        if (dx * dx + dy * dy + dz * dz < COLL_DIST2) {
          const bx = (ax + impPosF[b * 3]) * 0.5;
          const by = (ay + impPosF[b * 3 + 1]) * 0.5;
          const bz = (az + impPosF[b * 3 + 2]) * 0.5;
          if (bursts.length < 80) bursts.push({ x: bx, y: by, z: bz, life: 1.0 });
          frameCollisions++;
        }
      }
    }
    sharedState.collisionCount += frameCollisions;

    // ── Update & draw bursts ──
    let bcount = 0;
    for (let i = bursts.length - 1; i >= 0; i--) {
      bursts[i].life -= dt * 3.5;
      if (bursts[i].life <= 0) { bursts.splice(i, 1); continue; }
      const b = bursts[i];
      burstPosF[bcount * 3]     = b.x;
      burstPosF[bcount * 3 + 1] = b.y;
      burstPosF[bcount * 3 + 2] = b.z;
      burstSzF[bcount] = 5;
      burstAlF[bcount] = b.life * 0.95;
      bcount++;
    }

    if (bcount > 0) {
      // Bright flash
      gl.uniform3f(uLoc(gl, progPt, 'uColor'), 1.0, 0.95, 0.7);
      gl.bindBuffer(gl.ARRAY_BUFFER, burstPosB);
      gl.bufferData(gl.ARRAY_BUFFER, burstPosF.subarray(0, bcount * 3), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, burstSzB);
      gl.bufferData(gl.ARRAY_BUFFER, burstSzF.subarray(0, bcount), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, burstAlB);
      gl.bufferData(gl.ARRAY_BUFFER, burstAlF.subarray(0, bcount), gl.DYNAMIC_DRAW);
      setAttr(gl, progPt, 'aPos',   burstPosB, 3);
      setAttr(gl, progPt, 'aSize',  burstSzB,  1);
      setAttr(gl, progPt, 'aAlpha', burstAlB,  1);
      gl.drawArrays(gl.POINTS, 0, bcount);

      // Violet halo
      gl.uniform3f(uLoc(gl, progPt, 'uColor'), 0.8, 0.2, 1.0);
      for (let i = 0; i < bcount; i++) {
        burstSzF[i] = 9;
        burstAlF[i] *= 0.35;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, burstSzB);
      gl.bufferData(gl.ARRAY_BUFFER, burstSzF.subarray(0, bcount), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, burstAlB);
      gl.bufferData(gl.ARRAY_BUFFER, burstAlF.subarray(0, bcount), gl.DYNAMIC_DRAW);
      setAttr(gl, progPt, 'aSize',  burstSzB, 1);
      setAttr(gl, progPt, 'aAlpha', burstAlB, 1);
      gl.drawArrays(gl.POINTS, 0, bcount);
    }
  }, ac.signal);

  if (!opts.startPaused) loop.start();

  // ─── Teardown ──────────────────────────────────────────────────────────────
  return {
    teardown: (): void => {
      for (const cleanup of pointerCleanups) cleanup();
      ac.abort();
      loop.stop();
      stopResize();
      try { gl.deleteProgram(progLine); } catch { /* idempotent */ }
      try { gl.deleteProgram(progPt);   } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
