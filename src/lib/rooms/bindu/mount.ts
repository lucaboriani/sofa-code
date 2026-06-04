import type { RoomMount } from '@/lib/webgl/types';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import { perspective, lookAt, mul4 } from '@/lib/webgl/math';
import { sharedState } from './state';
import { VS, FS } from './shaders';
import { SEGS, VPL, FLOATS, makeTemplate, resetLine, type Line } from './lines';
import { makeOverlay } from './overlay';

const NUM_LINES = { preview: 300, full: 1200 } as const;

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
    const mvp = mul4(perspective(Math.PI / 3.5, W / H, 0.05, 120), lookAt(ex, ey, ez));
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
