import type { RoomMount } from '@/lib/webgl/types';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import type { Pt, Ikebana, BranchGeom, Disturbance, ShootReg, Shoot, Petal } from './types';
import { sharedState, audioLink } from './state';
import { VS, FS } from './shaders';
import { rnd, easeOut5, easeOut3, buildSpline, splinePt } from './math';
import { genIkebana, computeIkebanaGeom } from './generator';
import { makeOverlay } from './overlay';

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
    audioLink.current?.playBloom(sharedState.geom?.rootFreq ?? 82.5);
    audioLink.current?.resetDroneGains();
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
              audioLink.current?.startTouchVoice(Math.atan2(py - H * 0.5, px - W * 0.5), geom);
            }
            audioLink.current?.retuneTouchVoice(newFund);
            if (now - lastDisturbTime <= 80) {
              audioLink.current?.surgeDrone(br.color[0]);
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
            audioLink.current?.playShimmer(reg.angle, reg.branchIdx);
            break;
          }
        }
      });
    }

    if (!hit && isOnBranch) audioLink.current?.stopTouchVoice();
    isOnBranch = hit;

    if (!pointer.down) audioLink.current?.stopTouchVoice();
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
          // Card previews must never touch the audio graph — audioLink may
          // still hold a previous room visit's factory closure.
          if (full) audioLink.current?.playShimmer(sh.angle, bi);
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
