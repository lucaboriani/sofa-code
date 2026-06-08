import type { RoomMount } from '@/lib/webgl/types';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import { sharedState, resetState } from './state';
import { SEGS, HALF_L, BASE, FISH_S, COLS, ROWS, COLL_R, WIDTHS, shade, type Fish } from './fish';

// Ported from catfish.html — a 2D-canvas shoal that herds toward the pointer.
// Geometry/animation is verbatim; the standalone file's inline AudioContext is
// replaced by the AudioBus factory in ./audio (driven through sharedState), and
// the DPR is pinned to 1 as the original ran.

export const mount: RoomMount = (canvas, opts) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  const full = opts.quality === 'full';
  resetState();

  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  let fishes: Fish[] = [];
  const mouse: { x: number | null; y: number | null; down: boolean } = { x: null, y: null, down: false };

  function buildGrid(): void {
    const gapX = 72, gapY = 58;
    const ox = canvas.width / 2 - (COLS - 1) * gapX / 2, oy = canvas.height / 2 - (ROWS - 1) * gapY / 2;
    const prev = fishes.slice(); fishes = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const hx = ox + c * gapX, hy = oy + r * gapY, old = prev[r * COLS + c];
        fishes.push({
          hx, hy, x: old ? old.x : hx, y: old ? old.y : hy,
          angle: -Math.PI / 2, phase: Math.random() * Math.PI * 2,
          amp: 0.022, speed: 0, shockT: null,
          maxSpeed: 55 + Math.random() * 75
        });
      }
    }
  }

  const stopResize = observeResize(canvas, () => buildGrid(), 1);

  // ── Input (full mode only) ─────────────────────────────────────────────────
  const listenerCleanups: (() => void)[] = [];
  function setPos(clientX: number, clientY: number): void {
    const rect = canvas.getBoundingClientRect();
    mouse.x = clientX - rect.left; mouse.y = clientY - rect.top;
  }
  function shockNearest(clientX: number, clientY: number): void {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    let best: Fish | null = null, bestD = Infinity;
    const hr = FISH_S * HALF_L * 0.7;
    for (const f of fishes) {
      const d = Math.hypot(f.x - px, f.y - py);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (best && bestD < hr) { best.shockT = performance.now(); sharedState.shocks++; }
  }

  if (full) {
    const mm = (e: MouseEvent): void => setPos(e.clientX, e.clientY);
    const mdn = (e: MouseEvent): void => { mouse.down = true; setPos(e.clientX, e.clientY); };
    const mup = (): void => { mouse.down = false; };
    const mlv = (): void => { mouse.down = false; };
    const ts = (e: TouchEvent): void => { mouse.down = true; setPos(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); };
    const tm = (e: TouchEvent): void => { mouse.down = true; setPos(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); };
    const te = (e: TouchEvent): void => {
      mouse.down = false;
      if (e.changedTouches.length) shockNearest(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    };
    const clk = (e: MouseEvent): void => shockNearest(e.clientX, e.clientY);

    canvas.addEventListener('mousemove', mm);
    canvas.addEventListener('mousedown', mdn);
    canvas.addEventListener('mouseup', mup);
    canvas.addEventListener('mouseleave', mlv);
    canvas.addEventListener('touchstart', ts, { passive: false });
    canvas.addEventListener('touchmove', tm, { passive: false });
    canvas.addEventListener('touchend', te);
    canvas.addEventListener('click', clk);
    listenerCleanups.push(
      () => canvas.removeEventListener('mousemove', mm),
      () => canvas.removeEventListener('mousedown', mdn),
      () => canvas.removeEventListener('mouseup', mup),
      () => canvas.removeEventListener('mouseleave', mlv),
      () => canvas.removeEventListener('touchstart', ts),
      () => canvas.removeEventListener('touchmove', tm),
      () => canvas.removeEventListener('touchend', te),
      () => canvas.removeEventListener('click', clk)
    );
  }

  // ── Draw (catfish.html L261-428) ───────────────────────────────────────────
  function smoothPath(pts: { x: number; y: number }[]): void {
    ctx!.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++)
      ctx!.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    ctx!.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }

  function drawFish(f: Fish, now: number): void {
    ctx!.save();
    ctx!.translate(f.x, f.y);
    ctx!.rotate(f.angle);
    ctx!.scale(FISH_S, FISH_S);

    const spine: { x: number; y: number }[] = [], normals: { nx: number; ny: number }[] = [];
    for (let i = 0; i <= SEGS; i++) {
      const p = i / SEGS;
      spine[i] = { x: HALF_L - p * 2 * HALF_L, y: f.amp * Math.pow(p, 1.6) * Math.sin(f.phase - p * 1.8 * Math.PI) * HALF_L };
    }
    for (let i = 0; i <= SEGS; i++) {
      const pv = spine[Math.max(i - 1, 0)], nx2 = spine[Math.min(i + 1, SEGS)];
      const tx = nx2.x - pv.x, ty = nx2.y - pv.y, tl = Math.sqrt(tx * tx + ty * ty) || 1;
      normals[i] = { nx: -ty / tl, ny: tx / tl };
    }
    const upper = spine.map((s, i) => ({ x: s.x + normals[i].nx * WIDTHS[i], y: s.y + normals[i].ny * WIDTHS[i] }));
    const lower = spine.map((s, i) => ({ x: s.x - normals[i].nx * WIDTHS[i], y: s.y - normals[i].ny * WIDTHS[i] }));

    function bodyPath(): void {
      ctx!.beginPath(); smoothPath(upper);
      ctx!.lineTo(spine[SEGS].x, spine[SEGS].y);
      smoothPath([...lower].reverse()); ctx!.closePath();
    }

    // pectorals
    const pi2 = Math.round(0.18 * SEGS), sh = spine[pi2], sn = normals[pi2];
    for (const s of [-1, 1]) {
      const bx = sh.x + s * sn.nx * WIDTHS[pi2], by = sh.y + s * sn.ny * WIDTHS[pi2];
      ctx!.beginPath(); ctx!.moveTo(bx, by);
      ctx!.bezierCurveTo(bx + s * sn.nx * 24, by + s * sn.ny * 24, bx + s * sn.nx * 52, by + s * sn.ny * 52, bx + s * sn.nx * 48, by + s * sn.ny * 48);
      ctx!.bezierCurveTo(bx + s * sn.nx * 36, by + s * sn.ny * 36, bx + s * sn.nx * 14, by + s * sn.ny * 14, bx, by);
      ctx!.fillStyle = shade(BASE, -18); ctx!.fill();
    }
    // body
    bodyPath(); ctx!.fillStyle = BASE; ctx!.fill();
    // dorsal
    {
      const ds = Math.round(0.10 * SEGS), de = Math.round(0.52 * SEGS);
      ctx!.beginPath();
      for (let i = ds; i <= de; i++) { const b = Math.sin((i - ds) / (de - ds) * Math.PI) * 7; i === ds ? ctx!.moveTo(spine[i].x + normals[i].nx * b, spine[i].y + normals[i].ny * b) : ctx!.lineTo(spine[i].x + normals[i].nx * b, spine[i].y + normals[i].ny * b); }
      for (let i = de; i >= ds; i--) { const b = Math.sin((i - ds) / (de - ds) * Math.PI) * 1.5; ctx!.lineTo(spine[i].x + normals[i].nx * b, spine[i].y + normals[i].ny * b); }
      ctx!.closePath(); ctx!.fillStyle = shade(BASE, -20); ctx!.fill();
    }
    // adipose
    {
      const ai = Math.round(0.62 * SEGS);
      ctx!.beginPath(); ctx!.ellipse(spine[ai].x + normals[ai].nx * 5, spine[ai].y + normals[ai].ny * 5, 9, 3.5, 0, 0, Math.PI * 2);
      ctx!.fillStyle = shade(BASE, -20); ctx!.fill();
    }
    // tail
    {
      const t = spine[SEGS], n = normals[SEGS], pv = spine[SEGS - 1];
      const tdx = t.x - pv.x, tdy = t.y - pv.y, tl = Math.sqrt(tdx * tdx + tdy * tdy) || 1, dx = tdx / tl, dy = tdy / tl;
      for (const s of [-1, 1]) {
        ctx!.beginPath(); ctx!.moveTo(t.x, t.y);
        ctx!.bezierCurveTo(t.x + dx * 18 + s * n.nx * 10, t.y + dy * 18 + s * n.ny * 10, t.x + dx * 38 + s * n.nx * 34, t.y + dy * 38 + s * n.ny * 34, t.x + dx * 30 + s * n.nx * 48, t.y + dy * 30 + s * n.ny * 48);
        ctx!.bezierCurveTo(t.x + dx * 20 + s * n.nx * 36, t.y + dy * 20 + s * n.ny * 36, t.x + dx * 10 + s * n.nx * 14, t.y + dy * 10 + s * n.ny * 14, t.x, t.y);
        ctx!.fillStyle = shade(BASE, -22); ctx!.fill();
      }
    }
    // eyes
    {
      const ei = Math.round(0.06 * SEGS);
      for (const s of [-1, 1]) {
        const ex = spine[ei].x + s * normals[ei].nx * 12, ey = spine[ei].y + s * normals[ei].ny * 12;
        ctx!.beginPath(); ctx!.ellipse(ex, ey, 5, 4, 0, 0, Math.PI * 2); ctx!.fillStyle = shade(BASE, -42); ctx!.fill();
        ctx!.beginPath(); ctx!.ellipse(ex, ey, 2.5, 2.5, 0, 0, Math.PI * 2); ctx!.fillStyle = shade(BASE, -75); ctx!.fill();
      }
    }
    // barbels
    {
      const hn = normals[0];
      const fdx = spine[1].x - spine[0].x, fdy = spine[1].y - spine[0].y, fl = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
      const fwdX = fdx / fl, fwdY = fdy / fl, tipX = upper[0].x, tipY = upper[0].y;
      const dr = Math.sin(f.phase * 0.85) * 5, dr2 = Math.sin(f.phase * 0.65 + 0.8) * 3.5;
      const bb: number[][] = [
        [-8, 0, -20, 18, -40, 50, -34 + dr, 82, .65], [8, 0, 20, 18, 40, 50, 34 - dr, 82, .65],
        [-4, 0, -10, 18, -20, 46, -14 + dr2, 66, .50], [4, 0, 10, 18, 20, 46, 14 - dr2, 66, .50],
        [-12, 0, -24, 6, -36, 12, -38 + dr * .5, 18, .45], [12, 0, 24, 6, 36, 12, 38 - dr * .5, 18, .45],
        [-6, 0, -13, 5, -20, 10, -22 + dr * .3, 15, .40], [6, 0, 13, 5, 20, 10, 22 - dr * .3, 15, .40]
      ];
      ctx!.lineCap = 'round';
      for (const [pO, fO, c1P, c1F, c2P, c2F, tP, tF, lw] of bb) {
        ctx!.beginPath();
        ctx!.moveTo(tipX + hn.nx * pO + fwdX * fO, tipY + hn.ny * pO + fwdY * fO);
        ctx!.bezierCurveTo(
          tipX + hn.nx * c1P + fwdX * c1F, tipY + hn.ny * c1P + fwdY * c1F,
          tipX + hn.nx * c2P + fwdX * c2F, tipY + hn.ny * c2P + fwdY * c2F,
          tipX + hn.nx * tP + fwdX * tF, tipY + hn.ny * tP + fwdY * tF
        );
        ctx!.strokeStyle = shade(BASE, -10); ctx!.lineWidth = lw; ctx!.stroke();
      }
    }

    // ── shock ────────────────────────────────────────────────────────────────
    if (f.shockT) {
      const shock = Math.max(0, Math.exp(-((now - f.shockT) / 1000) * 6));
      if (shock > 0.01) {
        bodyPath();
        ctx!.globalAlpha = shock * 0.5; ctx!.fillStyle = '#aaeeff'; ctx!.fill(); ctx!.globalAlpha = 1;
        const seed = Math.floor(now / 40);
        const rng = (a: number, b: number): number => Math.abs(Math.sin(a * 127.3 + b * 311.7 + seed * 73.1));
        for (let stroke = 0; stroke < 3; stroke++) {
          ctx!.beginPath(); ctx!.moveTo(spine[0].x, spine[0].y);
          for (let i = 1; i <= SEGS; i++) {
            const j = (rng(i, stroke) * 2 - 1) * WIDTHS[i] * shock * 1.2;
            const px = spine[i].x + normals[i].nx * j, py = spine[i].y + normals[i].ny * j;
            rng(i + 50, stroke) > 0.18 ? ctx!.lineTo(px, py) : ctx!.moveTo(px, py);
          }
          ctx!.globalAlpha = shock * (stroke === 0 ? 0.95 : 0.45);
          ctx!.strokeStyle = stroke === 0 ? '#ddf8ff' : '#66ccff';
          ctx!.lineWidth = stroke === 0 ? 2 : 0.8; ctx!.lineCap = 'round'; ctx!.stroke();
        }
        for (let k = 0; k < Math.floor(shock * 14); k++) {
          const t2 = rng(k, seed + 1), si2 = Math.floor(t2 * SEGS);
          const side = (rng(k + 200, seed) * 2 - 1) * WIDTHS[si2] * 0.85;
          const gx = spine[si2].x + normals[si2].nx * side, gy = spine[si2].y + normals[si2].ny * side;
          const gr = ctx!.createRadialGradient(gx, gy, 0, gx, gy, 7);
          gr.addColorStop(0, 'rgba(255,255,255,0.98)');
          gr.addColorStop(0.3, 'rgba(180,230,255,0.7)');
          gr.addColorStop(1, 'rgba(80,180,255,0)');
          ctx!.beginPath(); ctx!.arc(gx, gy, 7, 0, Math.PI * 2);
          ctx!.globalAlpha = shock; ctx!.fillStyle = gr; ctx!.fill();
        }
        ctx!.globalAlpha = 1;
      } else {
        f.shockT = null;
      }
    }

    ctx!.restore();
  }

  // ── Update (catfish.html L431-466) ─────────────────────────────────────────
  function updateFish(f: Fish, dt: number): void {
    const targetX = (mouse.down && mouse.x !== null) ? mouse.x : f.hx;
    const targetY = (mouse.down && mouse.y !== null) ? mouse.y : f.hy;
    const dx = targetX - f.x, dy = targetY - f.y, dist = Math.hypot(dx, dy);

    if (mouse.down && dist > 1) {
      let delta = Math.atan2(dy, dx) - f.angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      f.angle += delta * Math.min(dt * 4.5, 1);
    } else if (!mouse.down) {
      if (dist > 3) {
        let delta = Math.atan2(dy, dx) - f.angle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        f.angle += delta * Math.min(dt * 3.5, 1);
      } else {
        let delta = -Math.PI / 2 - f.angle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        f.angle += delta * dt * 2.0;
      }
    }

    const targetSpd = dist > 2 ? Math.min(dist * 2, mouse.down ? f.maxSpeed : f.maxSpeed * 0.72) : 0;
    f.speed += (targetSpd - f.speed) * dt * 2.5;
    const step = Math.min(f.speed * dt, dist);
    if (step > 0) { f.x += Math.cos(f.angle) * step; f.y += Math.sin(f.angle) * step; }

    const sr = Math.min(f.speed / f.maxSpeed, 1);
    f.amp = 0.12 + sr * 0.18;
    f.phase += dt * (1.4 + sr * 2.8);
  }

  // ── Collision (catfish.html L468-489) ──────────────────────────────────────
  const lastColl = new Map<string, number>();
  function checkCollisions(): void {
    for (let i = 0; i < fishes.length; i++) {
      for (let j = i + 1; j < fishes.length; j++) {
        const a = fishes[i], b = fishes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < COLL_R * 1.4) {
          const key = `${i}-${j}`, last = lastColl.get(key) || 0;
          if (performance.now() - last > 600) {
            lastColl.set(key, performance.now());
            sharedState.collisions++;
            a.shockT = performance.now();
            b.shockT = performance.now();
            const nx = (a.x - b.x) / d || 1, ny = (a.y - b.y) / d || 1;
            a.x += nx * 3; a.y += ny * 3; b.x -= nx * 3; b.y -= ny * 3;
          }
        }
      }
    }
  }

  function publishState(): void {
    let totalDist = 0;
    for (const f of fishes) totalDist += Math.hypot(f.x - f.hx, f.y - f.hy);
    sharedState.dispersion = fishes.length ? Math.min(totalDist / fishes.length / 180, 1) : 0;
    sharedState.fishCount = fishes.length;
    sharedState.hasPointer = mouse.x !== null;
    sharedState.mx = mouse.x !== null ? mouse.x / canvas.width : 0.5;
    sharedState.my = mouse.y !== null ? mouse.y / canvas.height : 0.5;
  }

  const loop = createRafLoop((dtMs, tMs) => {
    const dt = Math.min(dtMs / 1000, 0.05);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const f of fishes) { updateFish(f, dt); drawFish(f, tMs); }
    checkCollisions();
    if (full) publishState();
  }, ac.signal);

  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      for (const c of listenerCleanups) c();
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
