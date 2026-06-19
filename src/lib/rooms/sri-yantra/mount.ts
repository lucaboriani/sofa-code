import type { RoomMount } from '@/lib/webgl/types';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import {
  buildYantra, petalRing, bhupuraParts, palettes, pickScheme,
  NAMES, N_LAYERS, startOf, prog, rand, lerp, easeOut,
  type Pt, type Palette, type SchemeKey, type YantraLayer
} from './geometry';
import { sharedState, resetState } from './state';
import { makeOverlay } from './overlay';

// Ported from sri-yantra.html — a 2D-canvas mandala that assembles on a timeline
// and can be spun by dragging. Geometry/timeline/drag physics are verbatim; the
// standalone file's inline rAF + resize become the shared engine primitives, the
// "Enable Sound" button becomes the app's AudioPrompt (audio lives in ./audio,
// driven through sharedState), and DPR is pinned to 1 as the original ran.

const CHASE_SPEED = 6;
const IDLE_AFTER = 2.0;
const PREVIEW_AGE = 60; // seconds — jump the timeline so all layers are assembled
const CIRCLES: readonly (readonly [number, number])[] = [[1.02, 0.9], [1.06, 0.7], [1.11, 0.5]];

interface PendingDelta { delta: number; t: number; dist: number; }

export const mount: RoomMount = (canvas, opts) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  const full = opts.quality === 'full';
  resetState();

  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  // ── Per-layer rotation state (preallocated; verbatim) ──────────────────────
  const layerRot = new Float64Array(N_LAYERS);
  const layerTarget = new Float64Array(N_LAYERS);
  const layerUnwound = new Uint8Array(N_LAYERS);
  const layerRadii = new Float64Array(N_LAYERS);
  const nextNudge = new Float64Array(N_LAYERS);
  const pendingDeltas: PendingDelta[][] = Array.from({ length: N_LAYERS }, () => []);

  // Static geometry (rotation-applied per frame via project()); never reallocated.
  const petals8 = petalRing(8, 0.72, 0.89);
  const petals16 = petalRing(16, 0.89, 1.0);
  const bhupura = bhupuraParts(1);

  let palette: Palette = palettes.golden;
  let yantra: YantraLayer[] = buildYantra(1, 1);
  let params: { rotSpeed: number; pulse: number } = { rotSpeed: 0, pulse: 0.01 };
  let birthTime = 0;
  let lastInteraction = 0;

  // Live screen transform, recomputed each frame; drag handlers read cx/cy.
  let cx = 0, cy = 0;
  const scratch = new Float64Array(2);

  // Overlay label (full mode); updated each frame.
  let labelEl: HTMLElement | null = null;
  let lastLabel = '';
  function setLabel(name: string): void {
    lastLabel = name;
    if (labelEl) labelEl.textContent = name;
  }

  function resetNudges(): void { for (let i = 0; i < N_LAYERS; i++) nextNudge[i] = 0; }

  function generateScene(): void {
    const scheme: SchemeKey = pickScheme();
    palette = palettes[scheme];
    sharedState.scheme = scheme;

    const v = rand(0.75, 1.25);
    params = { rotSpeed: rand(-0.0012, 0.0012) * Math.PI * 2, pulse: rand(0.006, 0.015) };
    yantra = buildYantra(1, v);

    layerRadii[0] = 0;
    for (let i = 0; i < 9; i++) layerRadii[i + 1] = yantra[i].radius;
    layerRadii[10] = 0.80; layerRadii[11] = 0.94; layerRadii[12] = 1.06; layerRadii[13] = 1.08;

    for (let i = 0; i < N_LAYERS; i++) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const off = dir * (Math.PI * 0.6 + rand(0, Math.PI * 0.3));
      layerRot[i] = off; layerTarget[i] = off;
      layerUnwound[i] = 0; pendingDeltas[i] = [];
    }
    resetNudges();
    sharedState.autoActivity = 0;

    const nowS = performance.now() / 1000;
    if (full) {
      birthTime = nowS;
      lastInteraction = nowS + 20; // suppress idle nudges until the assembly plays
      setLabel('ॐ');
    } else {
      birthTime = nowS - PREVIEW_AGE; // fully assembled
      lastInteraction = nowS - 100;   // idle immediately → gentle nudge rotation
    }
  }

  function scheduleNudges(now: number): void {
    let activity = sharedState.autoActivity;
    for (let i = 0; i < N_LAYERS; i++) {
      if (!layerUnwound[i]) continue;
      if (nextNudge[i] === 0) nextNudge[i] = now + rand(0, 3);
      if (now >= nextNudge[i]) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        layerTarget[i] += dir * (Math.PI * 0.15 + rand(0, Math.PI * 0.35));
        nextNudge[i] = now + rand(3, 9);
        activity = Math.min(activity + 0.35, 1.0);
      }
    }
    sharedState.autoActivity = activity;
  }

  function flushPending(now: number): void {
    for (let i = 0; i < N_LAYERS; i++) {
      const list = pendingDeltas[i];
      if (list.length === 0) continue;
      const keep: PendingDelta[] = [];
      for (const ev of list) {
        if (now - ev.t >= ev.dist * 0.18) layerTarget[i] += ev.delta;
        else keep.push(ev);
      }
      pendingDeltas[i] = keep;
    }
  }

  // ── Screen projection (allocation-free; writes scratch) ────────────────────
  function project(i: number, x: number, y: number, S: number): void {
    const r = layerRot[i];
    const c = Math.cos(r), s = Math.sin(r);
    const rx = x * c - y * s, ry = x * s + y * c;
    scratch[0] = cx + rx * S;
    scratch[1] = cy - ry * S;
  }

  function strokePolyline(layerIdx: number, pts: readonly Pt[], S: number): void {
    project(layerIdx, pts[0][0], pts[0][1], S); ctx!.moveTo(scratch[0], scratch[1]);
    for (let k = 1; k < pts.length; k++) { project(layerIdx, pts[k][0], pts[k][1], S); ctx!.lineTo(scratch[0], scratch[1]); }
  }

  // ── Drag (full mode) — verbatim physics ────────────────────────────────────
  let dragging = false, dragPrevAngle = 0, touchedLayerIdx = 0, dragVelocity = 0, lastDragTime = 0;

  function pointerAngle(px: number, py: number): number { return Math.atan2(-(py - cy), px - cx); }
  // The original divided by scale (=1, a no-op) and compared a pixel distance to
  // normalised layer radii — kept verbatim so the drag picks the same ring.
  function pointerDist(px: number, py: number): number { return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2); }
  function closestLayer(px: number, py: number): number {
    const r = pointerDist(px, py);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < N_LAYERS; i++) {
      const d = Math.abs(r - layerRadii[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function localX(clientX: number): number { return clientX - canvas.getBoundingClientRect().left; }
  function localY(clientY: number): number { return clientY - canvas.getBoundingClientRect().top; }

  function startDrag(clientX: number, clientY: number): void {
    const px = localX(clientX), py = localY(clientY);
    dragging = true; sharedState.dragging = true;
    dragPrevAngle = pointerAngle(px, py);
    touchedLayerIdx = closestLayer(px, py);
    lastInteraction = performance.now() / 1000;
    resetNudges();
  }

  function moveDrag(clientX: number, clientY: number): void {
    if (!dragging) return;
    const px = localX(clientX), py = localY(clientY);
    const now = performance.now() / 1000;
    const angle = pointerAngle(px, py);
    let delta = angle - dragPrevAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    dragPrevAngle = angle;
    const dt = Math.max(now - lastDragTime, 0.001);
    dragVelocity = delta / dt; lastDragTime = now;
    layerTarget[touchedLayerIdx] += delta;
    for (let i = 0; i < N_LAYERS; i++) {
      if (i === touchedLayerIdx) continue;
      pendingDeltas[i].push({ delta, t: now, dist: Math.abs(i - touchedLayerIdx) });
    }
    sharedState.dragSpeed = Math.min(Math.abs(dragVelocity), 10) / 10;
  }

  function endDrag(): void {
    dragging = false; sharedState.dragging = false;
    dragVelocity = 0; sharedState.dragSpeed = 0;
    lastInteraction = performance.now() / 1000;
  }

  // ── Render (verbatim draw order) ───────────────────────────────────────────
  function render(tMs: number): void {
    const t = tMs / 1000;
    const age = t - birthTime;
    const now = t;
    const { rotSpeed, pulse } = params;

    cx = canvas.width / 2; cy = canvas.height / 2;
    const minDim = Math.min(canvas.width, canvas.height);
    const S = minDim * 0.40;

    flushPending(now);

    let allCreated = true;
    for (let i = 0; i < N_LAYERS; i++) if (layerUnwound[i] !== 1) { allCreated = false; break; }
    if (!dragging && allCreated && (now - lastInteraction) > IDLE_AFTER) scheduleNudges(now);

    sharedState.autoActivity *= 0.993;

    const dt = 0.016;
    for (let i = 0; i < N_LAYERS; i++) {
      if (!layerUnwound[i] && prog(i, age) > 0) { layerTarget[i] = 0; layerUnwound[i] = 1; }
      if (layerUnwound[i]) layerTarget[i] += rotSpeed * dt;
      layerRot[i] = lerp(layerRot[i], layerTarget[i], 1 - Math.exp(-CHASE_SPEED * dt));
    }

    let curIdx = -1;
    for (let i = 0; i < NAMES.length; i++) if (age >= startOf(i)) curIdx = i;
    const curName = curIdx >= 0 ? NAMES[curIdx] : 'ॐ';
    if (curName !== lastLabel) setLabel(curName);

    ctx!.fillStyle = palette.bg;
    ctx!.fillRect(0, 0, canvas.width, canvas.height);

    const breath = 0.82 + 0.18 * Math.sin(t * pulse * Math.PI * 2);
    const LW = 1.5;

    ctx!.save();
    ctx!.lineCap = 'round';
    ctx!.lineJoin = 'round';

    // triangle fills
    for (let i = 0; i < 9; i++) {
      const p = easeOut(prog(i + 1, age)); if (p <= 0) continue;
      const tri = yantra[i];
      ctx!.beginPath();
      project(i + 1, tri.pts[0][0], tri.pts[0][1], S); ctx!.moveTo(scratch[0], scratch[1]);
      project(i + 1, tri.pts[1][0], tri.pts[1][1], S); ctx!.lineTo(scratch[0], scratch[1]);
      project(i + 1, tri.pts[2][0], tri.pts[2][1], S); ctx!.lineTo(scratch[0], scratch[1]);
      ctx!.closePath();
      ctx!.fillStyle = tri.up ? palette.pri(p * 0.18 * breath) : palette.sec(p * 0.18 * breath);
      ctx!.fill();
    }
    // triangle outlines
    for (let i = 0; i < 9; i++) {
      const p = easeOut(prog(i + 1, age)); if (p <= 0) continue;
      const tri = yantra[i];
      ctx!.beginPath();
      project(i + 1, tri.pts[0][0], tri.pts[0][1], S); ctx!.moveTo(scratch[0], scratch[1]);
      project(i + 1, tri.pts[1][0], tri.pts[1][1], S); ctx!.lineTo(scratch[0], scratch[1]);
      project(i + 1, tri.pts[2][0], tri.pts[2][1], S); ctx!.lineTo(scratch[0], scratch[1]);
      ctx!.closePath();
      ctx!.strokeStyle = tri.up ? palette.pri(p * breath) : palette.sec(p * breath);
      ctx!.lineWidth = LW; ctx!.stroke();
    }
    // 8-petal lotus
    const p10 = easeOut(prog(10, age));
    if (p10 > 0) {
      ctx!.strokeStyle = palette.acc(p10 * 0.9 * breath); ctx!.lineWidth = LW;
      for (const seg of petals8) { ctx!.beginPath(); strokePolyline(10, seg, S); ctx!.stroke(); }
    }
    // 16-petal lotus
    const p11 = easeOut(prog(11, age));
    if (p11 > 0) {
      ctx!.strokeStyle = palette.sec(p11 * 0.8 * breath); ctx!.lineWidth = LW;
      for (const seg of petals16) { ctx!.beginPath(); strokePolyline(11, seg, S); ctx!.stroke(); }
    }
    // 3 circles (rotation-invariant)
    const p12 = easeOut(prog(12, age));
    if (p12 > 0) {
      for (const [rf, al] of CIRCLES) {
        ctx!.beginPath(); ctx!.arc(cx, cy, rf * S, 0, Math.PI * 2);
        ctx!.strokeStyle = palette.pri(p12 * al * breath); ctx!.lineWidth = LW; ctx!.stroke();
      }
    }
    // bhupura
    const p13 = easeOut(prog(13, age));
    if (p13 > 0) {
      ctx!.lineWidth = LW;
      ctx!.strokeStyle = palette.acc(p13 * breath); ctx!.beginPath(); strokePolyline(13, bhupura.outer, S); ctx!.stroke();
      ctx!.strokeStyle = palette.pri(p13 * 0.8 * breath); ctx!.beginPath(); strokePolyline(13, bhupura.inner, S); ctx!.stroke();
      ctx!.strokeStyle = palette.acc(p13 * 0.9 * breath);
      for (const g of bhupura.gates) { ctx!.beginPath(); strokePolyline(13, g, S); ctx!.stroke(); }
    }
    // bindu
    const p0 = easeOut(prog(0, age));
    if (p0 > 0) {
      const gr = 0.065 * (0.75 + 0.25 * Math.sin(t * 1.6));
      const grd = ctx!.createRadialGradient(cx, cy, 0, cx, cy, gr * S);
      grd.addColorStop(0, palette.glow(p0 * breath * 0.9));
      grd.addColorStop(1, palette.glow(0));
      ctx!.beginPath(); ctx!.arc(cx, cy, gr * S, 0, Math.PI * 2); ctx!.fillStyle = grd; ctx!.fill();
      const br = 0.024 * (0.9 + 0.1 * Math.sin(t * 4.0));
      ctx!.beginPath(); ctx!.arc(cx, cy, br * S, 0, Math.PI * 2); ctx!.fillStyle = palette.acc(p0); ctx!.fill();
    }

    ctx!.restore();
  }

  // ── Input + overlay (full mode only) ───────────────────────────────────────
  const listenerCleanups: (() => void)[] = [];
  let overlayRoot: HTMLElement | null = null;

  if (full) {
    const ov = makeOverlay(() => generateScene());
    overlayRoot = ov.root; labelEl = ov.label;
    (canvas.parentElement ?? document.body).appendChild(overlayRoot);

    const md = (e: MouseEvent): void => startDrag(e.clientX, e.clientY);
    const mm = (e: MouseEvent): void => { if (dragging) moveDrag(e.clientX, e.clientY); };
    const mu = (): void => endDrag();
    const ts = (e: TouchEvent): void => { e.preventDefault(); startDrag(e.touches[0].clientX, e.touches[0].clientY); };
    const tm = (e: TouchEvent): void => { e.preventDefault(); moveDrag(e.touches[0].clientX, e.touches[0].clientY); };
    const te = (): void => endDrag();

    canvas.addEventListener('mousedown', md);
    canvas.addEventListener('mousemove', mm);
    canvas.addEventListener('mouseup', mu);
    canvas.addEventListener('touchstart', ts, { passive: false });
    canvas.addEventListener('touchmove', tm, { passive: false });
    canvas.addEventListener('touchend', te);
    listenerCleanups.push(
      () => canvas.removeEventListener('mousedown', md),
      () => canvas.removeEventListener('mousemove', mm),
      () => canvas.removeEventListener('mouseup', mu),
      () => canvas.removeEventListener('touchstart', ts),
      () => canvas.removeEventListener('touchmove', tm),
      () => canvas.removeEventListener('touchend', te)
    );
  }

  const stopResize = observeResize(canvas, undefined, 1);
  generateScene();

  const loop = createRafLoop((_dt, tMs) => render(tMs), ac.signal);
  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      for (const c of listenerCleanups) c();
      overlayRoot?.remove();
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
