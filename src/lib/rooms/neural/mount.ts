import type { RoomMount } from '@/lib/webgl/types';
import { createContext } from '@/lib/webgl/context';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import { sharedState } from './state';
import { VS_LINE, FS_LINE, VS_PT, FS_PT } from './shaders';
import { type Vec3, rnd, lerp, mul4, perspective, rotY, rotX, transl } from './math';
import { buildGeometry } from './geometry';

// ─── Quality parameters ───────────────────────────────────────────────────────

const NEURON_COUNT = { preview: 48, full: 220 } as const;
const SPIKE_RATE   = { preview: 0.2, full: 0.6 } as const;

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

  // ── Geometry (rebindable: double tap regenerates the map) ──
  let geo = buildGeometry(neuronCount);
  let { edges, nodes, somaPosF, somaSzF, edgeMainSegStart, edgeMainSegCount } = geo;
  let posF32 = new Float32Array(geo.posArr);
  let NSEG = geo.segEdge.length;

  // ── Preallocated buffers (no allocs in tick; reallocated only on regen) ──
  let brightArr    = new Float32Array(NSEG * 2);
  let brightSmooth = new Float32Array(NSEG * 2);
  let somaAlDyn    = new Float32Array(nodes.length);
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
  const somaPosB = gl.createBuffer()!;
  const somaSzB = gl.createBuffer()!;

  function uploadStaticGeometry(): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, posB);
    gl.bufferData(gl.ARRAY_BUFFER, posF32, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, somaPosB);
    gl.bufferData(gl.ARRAY_BUFFER, somaPosF, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, somaSzB);
    gl.bufferData(gl.ARRAY_BUFFER, somaSzF, gl.STATIC_DRAW);
  }
  uploadStaticGeometry();
  gl.bindBuffer(gl.ARRAY_BUFFER, brightB);
  gl.bufferData(gl.ARRAY_BUFFER, brightArr, gl.DYNAMIC_DRAW);

  const somaAlB  = gl.createBuffer()!;
  const impPosB  = gl.createBuffer()!;
  const impSzB   = gl.createBuffer()!;
  const impAlB   = gl.createBuffer()!;
  const burstPosB = gl.createBuffer()!;
  const burstSzB  = gl.createBuffer()!;
  const burstAlB  = gl.createBuffer()!;

  // Reusable scratch buffer for glow size arrays (avoid per-frame allocation)
  let somaGlowSz = new Float32Array(nodes.length);
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

  // ── Regeneration (double tap/click → new map, brief crossfade) ──
  const FADE_RATE = 4; // full fade in 250ms
  let fade = 1;
  let regenPending = false;

  function regenerate(): void {
    geo = buildGeometry(neuronCount);
    ({ edges, nodes, somaPosF, somaSzF, edgeMainSegStart, edgeMainSegCount } = geo);
    posF32 = new Float32Array(geo.posArr);
    NSEG = geo.segEdge.length;
    brightArr    = new Float32Array(NSEG * 2);
    brightSmooth = new Float32Array(NSEG * 2);
    somaAlDyn    = new Float32Array(nodes.length);
    somaGlowSz   = new Float32Array(nodes.length);
    impulses.length = 0;
    bursts.length = 0;
    uploadStaticGeometry();
    for (let i = 0; i < initCount; i++) spawnImpulse();
  }

  // ── Sim state (mouse / rotation) ──
  let angle = 0;
  let mx = 0, my = 0;
  let simSpeed = 0.08;

  // Desktop (hover-capable, fine pointer): orbit follows the cursor, smoothed each frame
  const hoverOrbit = opts.quality === 'full'
    && typeof matchMedia === 'function'
    && matchMedia('(hover: hover) and (pointer: fine)').matches;
  let hoverMx = 0, hoverMy = 0;

  // ── Audio-reactive state (rms written by createAudio tick) ──
  // Envelope follower over normalized mic level: fast attack, slow release.
  let audioLevel = 0;

  // ── Pointer interaction (full quality only — preview is a card, drag conflicts) ──
  const pointerCleanups: Array<() => void> = [];

  if (opts.quality === 'full') {
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let dragStartMx = 0, dragStartMy = 0;
    let simSpeedBase = simSpeed;

    // Track active pointers for two-finger pinch
    const activePointers = new Map<number, { x: number; y: number }>();

    // Double tap/click → regenerate the map
    let lastTapT = 0, lastTapX = 0, lastTapY = 0;
    const TAP_MS = 300, TAP_DIST = 30;

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
      const dy = (dragStartY - cy) / canvas.clientHeight;
      if (!hoverOrbit) {
        // Touch: drag orbits and adjusts speed
        const dx = (cx - dragStartX) / canvas.clientWidth;
        mx = Math.max(-1, Math.min(1, dragStartMx + dx * 2.2));
        my = Math.max(-1, Math.min(1, dragStartMy - (cy - dragStartY) / canvas.clientHeight * 2.2));
      }
      // Desktop: orbit follows the cursor, drag only adjusts speed
      simSpeed = Math.max(0.02, Math.min(0.5, simSpeedBase + dy * 0.48));
    }

    function onPointerDown(e: PointerEvent): void {
      canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Only start single-pointer drag when there's exactly one pointer
      if (activePointers.size === 1) {
        const now = performance.now();
        if (now - lastTapT < TAP_MS && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < TAP_DIST) {
          lastTapT = 0;
          regenPending = true;
        } else {
          lastTapT = now;
          lastTapX = e.clientX;
          lastTapY = e.clientY;
        }
        onDragStart(e.clientX, e.clientY);
      } else {
        // Second finger arrived — cancel single-finger drag and pending tap
        isDragging = false;
        lastTapT = 0;
      }
    }

    function onPointerMove(e: PointerEvent): void {
      // Desktop hover: no pointer down → cursor position drives the orbit
      if (hoverOrbit && activePointers.size === 0) {
        const r = canvas.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          hoverMx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
          hoverMy = Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1)));
        }
        return;
      }
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

    // Crossfade state machine: fade out → rebuild map → fade in
    if (regenPending) {
      fade = Math.max(0, fade - rawDt * FADE_RATE);
      if (fade === 0) {
        regenerate();
        regenPending = false;
      }
    } else if (fade < 1) {
      fade = Math.min(1, fade + rawDt * FADE_RATE);
    }

    // Desktop: ease the camera toward the cursor position
    if (hoverOrbit) {
      const ease = Math.min(1, rawDt * 4);
      mx += (hoverMx - mx) * ease;
      my += (hoverMy - my) * ease;
    }

    // Audio reactivity: mic level drives glow + speed; level jumps fire surges.
    // Speech rms sits around 0.1–0.3, so normalize ×4 toward [0,1].
    const micTarget = Math.min(1, sharedState.rms * 4);
    const onset = micTarget - audioLevel > 0.25;
    const envRate = micTarget > audioLevel ? 10 : 2.5;
    audioLevel += (micTarget - audioLevel) * Math.min(1, rawDt * envRate);
    const audioBoost = 1 + audioLevel * 2.5;
    const effectiveSpeed = simSpeed * audioBoost;
    const effectiveSpikeRate = spikeRate * audioBoost;
    const dt = rawDt * effectiveSpeed;

    // Onset → retire oldest impulses and fire a fresh surge (pool is usually
    // saturated at MAX_IMP, so plain spawn boosts would be silently dropped)
    if (onset) {
      for (let k = 0; k < 8; k++) {
        if (impulses.length >= MAX_IMP) impulses.shift();
        spawnImpulse();
      }
    }

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
    gl.uniform1f(uLoc(gl, progLine, 'uAudio'), audioLevel);
    gl.uniform1f(uLoc(gl, progLine, 'uFade'), fade);
    setAttr(gl, progLine, 'aPos',    posB,    3);
    setAttr(gl, progLine, 'aBright', brightB, 1);
    gl.drawArrays(gl.LINES, 0, NSEG * 2);

    // ── Draw somas ──
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(progPt);
    gl.uniformMatrix4fv(uLoc(gl, progPt, 'uMVP'), false, mvp);
    gl.uniform1f(uLoc(gl, progPt, 'uFade'), fade);

    // Outer glow
    gl.uniform3f(uLoc(gl, progPt, 'uColor'), 0.55, 0.1, 0.9);
    for (let i = 0; i < nodes.length; i++) {
      somaAlDyn[i]  = 0.22 + 0.06 * Math.sin(time * 0.6 + i * 2.1) + audioLevel * 0.4;
      somaGlowSz[i] = somaSzF[i] * (1.4 + audioLevel * 2.5);
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
