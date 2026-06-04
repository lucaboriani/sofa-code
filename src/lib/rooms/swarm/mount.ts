import type { RoomMount } from '@/lib/webgl/types';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import { sharedState } from './state';
import { STRAND_VS, STRAND_FS, QUAD_VS, makeBlurFS, COMP_FS } from './shaders';
import { STRIDE, lerp, rand, BAKERS, webColor, type WebInstance } from './webs';

const WEB_COUNT = { preview: 40, full: 260 } as const;

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
    // Gyroscope (mobile tilt) state — smoothed, normalised to [-1..1]
    const gyro = { x: 0, y: 0, active: false };

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

    // ── Gyroscope (spiderweb-swarm.html L498-526) ───────────────────────────
    // gamma = left/right tilt (-90..90), beta = front/back tilt. Smoothed and
    // normalised; feeds both audio (tick) and a gentle per-frame web nudge.
    const onDeviceOrientation = (e: DeviceOrientationEvent): void => {
      if (e.gamma === null || e.beta === null) return;
      gyro.active = true;
      gyro.x = gyro.x * 0.85 + (e.gamma / 90) * 0.15;
      gyro.y = gyro.y * 0.85 + (e.beta / 90) * 0.15;
    };
    // iOS 13+ gates the sensor behind a permission prompt that must be triggered
    // from a user gesture; Android exposes it immediately.
    type OrientationPerm = { requestPermission?: () => Promise<'granted' | 'denied'> };
    const requestGyro = (): void => {
      if (typeof DeviceOrientationEvent === 'undefined') return;
      const DOE = DeviceOrientationEvent as unknown as OrientationPerm;
      if (typeof DOE.requestPermission === 'function') {
        DOE.requestPermission()
          .then((state) => {
            if (state === 'granted') window.addEventListener('deviceorientation', onDeviceOrientation);
          })
          .catch(() => { /* permission denied or dismissed — silently no-op */ });
      } else {
        window.addEventListener('deviceorientation', onDeviceOrientation);
      }
    };
    // Try immediately (Android), then again on the first pointer (iOS gesture).
    requestGyro();
    const onFirstPointer = (): void => requestGyro();
    canvas.addEventListener('pointerdown', onFirstPointer, { once: true });

    listenerCleanups.push(
      () => canvas.removeEventListener('pointerdown',   onPointerDown),
      () => canvas.removeEventListener('pointermove',   onPointerMove),
      () => canvas.removeEventListener('pointerup',     onPointerUp),
      () => canvas.removeEventListener('pointercancel', onPointerUp),
      () => canvas.removeEventListener('wheel',         onWheel),
      () => canvas.removeEventListener('pointerdown',   onFirstPointer),
      () => window.removeEventListener('deviceorientation', onDeviceOrientation),
    );

    // ── Render loop ──────────────────────────────────────────────────────────

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const loop = createRafLoop((_dt, _t) => {
      // Gyroscope tilt — nudges every web gently in the tilt direction
      // (spiderweb-swarm.html L672-685).
      if (gyro.active) {
        const gx = gyro.x * 0.012, gy = gyro.y * 0.010;
        for (const web of webs) { web.vx += gx; web.vy += gy; }
      }

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
        sharedState.pinchActive = pinch.active;
        sharedState.gyroActive = gyro.active;
        sharedState.gyroX = gyro.x;
        sharedState.gyroY = gyro.y;
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
      sharedState.pinchActive = false;
      sharedState.gyroActive = false; // no gyro/tilt input in preview
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
