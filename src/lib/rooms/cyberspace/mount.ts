import type { RoomMount } from '@/lib/webgl/types';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import { mul4, perspective, rotX, rotY, transl } from '@/lib/webgl/math';
import { ICOSAHEDRON, OCTAHEDRON, BOX, TETRAHEDRON, type Wireframe } from '@/lib/webgl/polyhedra';
import { VS_LINE, FS_LINE, VS_PT, FS_PT } from './shaders';
import { buildStructures, buildParticles, buildCore, TUNNEL_LEN, HALF_W, HALF_H, type SolidType } from './geometry';
import { sharedState, resetState } from './state';
import { rayFromCamera, intersectSphere } from '@/lib/webgl/raycast';
import { worldToScreen } from '@/lib/webgl/project';
import { makeOverlay, type HudFields, type FloaterTarget } from './overlay';

const STRUCTURE_COUNT = { preview: 60, full: 240 } as const;
const PARTICLE_COUNT = { preview: 800, full: 2600 } as const;
const BASE_SPEED = 11;
const CAM_CHASE_RATE = 2.4;
const FOV_Y = (70 * Math.PI) / 180;
const NEAR = 0.1;
const FAR = 3000;
const FOG_DENSITY = 0.0075;
const FOG_COLOR: readonly [number, number, number] = [0, 0.012, 0.031];

const CYAN: readonly [number, number, number] = [0, 0.53, 0.64];
const ICE: readonly [number, number, number] = [0.64, 0.09, 0.25];
const GOLD: readonly [number, number, number] = [0.64, 0.51, 0.18];
const DUST: readonly [number, number, number] = [0.24, 0.43, 0.45];
const BOOST_SPEED = 30;
const LIT: readonly [number, number, number] = [1, 1, 1];

const SOLIDS: Record<SolidType, Wireframe> = { ico: ICOSAHEDRON, oct: OCTAHEDRON, box: BOX, tet: TETRAHEDRON };

function mkProg(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  return linkProgram(gl, compileShader(gl, gl.VERTEX_SHADER, vs), compileShader(gl, gl.FRAGMENT_SHADER, fs));
}

function setAttr(gl: WebGLRenderingContext, prog: WebGLProgram, name: string, buf: WebGLBuffer, size: number): void {
  const loc = gl.getAttribLocation(prog, name);
  if (loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

export const mount: RoomMount = (canvas, opts) => {
  const gl = createContext(canvas, { version: 1, antialias: true, alpha: false, depth: false }) as WebGLRenderingContext;
  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  resetState();

  const progLine = mkProg(gl, VS_LINE, FS_LINE);
  const progPt = mkProg(gl, VS_PT, FS_PT);
  const uLine = getUniforms(gl, progLine, ['uMVP', 'uFogColor', 'uFogDensity'] as const);
  const uPt = getUniforms(gl, progPt, ['uMVP', 'uColor', 'uFogColor', 'uFogDensity'] as const);

  // ── Scene geometry (built once; position/scale/spin are static per structure) ──
  const structureCount = STRUCTURE_COUNT[opts.quality];
  const particleCount = PARTICLE_COUNT[opts.quality];
  const structures = buildStructures(structureCount);
  const core = buildCore();

  // Per-structure local-geometry offsets into the shared vertex/edge buffers,
  // plus two extra shapes appended for the core (outer icosahedron, inner
  // octahedron).
  const vertOffset = new Int32Array(structureCount);
  const vertCount = new Int32Array(structureCount);
  let totalVerts = 0;
  let totalEdgeIdx = 0;
  for (let i = 0; i < structureCount; i++) {
    const wf = SOLIDS[structures[i].solid];
    vertOffset[i] = totalVerts;
    vertCount[i] = wf.positions.length / 3;
    totalVerts += vertCount[i];
    totalEdgeIdx += wf.edges.length;
  }
  const coreOuterOffset = totalVerts;
  totalVerts += ICOSAHEDRON.positions.length / 3;
  totalEdgeIdx += ICOSAHEDRON.edges.length;
  const coreInnerOffset = totalVerts;
  totalVerts += OCTAHEDRON.positions.length / 3;
  totalEdgeIdx += OCTAHEDRON.edges.length;

  const structPos = new Float32Array(totalVerts * 3);   // dynamic — rewritten every frame
  const structColor = new Float32Array(totalVerts * 3); // dynamic — rewritten every frame
  const structAlpha = new Float32Array(totalVerts);      // dynamic — rewritten every frame
  const structEdgeIdx = new Uint16Array(totalEdgeIdx);   // static — built once below

  {
    let idx = 0;
    for (let i = 0; i < structureCount; i++) {
      const wf = SOLIDS[structures[i].solid];
      for (let e = 0; e < wf.edges.length; e++) structEdgeIdx[idx++] = vertOffset[i] + wf.edges[e];
    }
    for (let e = 0; e < ICOSAHEDRON.edges.length; e++) structEdgeIdx[idx++] = coreOuterOffset + ICOSAHEDRON.edges[e];
    for (let e = 0; e < OCTAHEDRON.edges.length; e++) structEdgeIdx[idx++] = coreInnerOffset + OCTAHEDRON.edges[e];
  }

  const structPosB = gl.createBuffer()!;
  const structColorB = gl.createBuffer()!;
  const structAlphaB = gl.createBuffer()!;
  const structIdxB = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, structIdxB);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, structEdgeIdx, gl.STATIC_DRAW);

  // Per-structure live rotation angles (persist across frames; preallocated).
  const rotXAngle = new Float32Array(structureCount);
  const rotYAngle = new Float32Array(structureCount);
  let coreRotX = 0, coreRotY = 0;

  // ── Grid (static — never moves) ────────────────────────────────────────────
  const gridPosArr: number[] = [];
  const GRID_STEP = 6;
  for (let x = -HALF_W; x <= HALF_W; x += GRID_STEP) {
    gridPosArr.push(x, -HALF_H, 0, x, -HALF_H, -TUNNEL_LEN);
    gridPosArr.push(x, HALF_H, 0, x, HALF_H, -TUNNEL_LEN);
  }
  for (let z = 0; z >= -TUNNEL_LEN; z -= 22) {
    gridPosArr.push(-HALF_W, -HALF_H, z, HALF_W, -HALF_H, z);
    gridPosArr.push(-HALF_W, HALF_H, z, HALF_W, HALF_H, z);
  }
  const gridVertCount = gridPosArr.length / 3;
  const gridPosB = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, gridPosB);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridPosArr), gl.STATIC_DRAW);
  const gridColorArr = new Float32Array(gridVertCount * 3);
  for (let i = 0; i < gridVertCount; i++) { gridColorArr[i * 3] = CYAN[0]; gridColorArr[i * 3 + 1] = CYAN[1]; gridColorArr[i * 3 + 2] = CYAN[2]; }
  const gridColorB = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, gridColorB);
  gl.bufferData(gl.ARRAY_BUFFER, gridColorArr, gl.STATIC_DRAW);
  const gridAlphaB = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, gridAlphaB);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridVertCount).fill(0.22), gl.STATIC_DRAW);

  // ── Particle motes (static positions — the source never moves them) ────────
  const { positions: particlePos } = buildParticles(particleCount);
  const particlePosB = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, particlePosB);
  gl.bufferData(gl.ARRAY_BUFFER, particlePos, gl.STATIC_DRAW);
  const particleSizeB = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, particleSizeB);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(particleCount).fill(3), gl.STATIC_DRAW);
  const particleAlphaB = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, particleAlphaB);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(particleCount).fill(0.28), gl.STATIC_DRAW);

  // ── Glow blobs (cyan / ice / gold point-sprite halos) ──────────────────────
  // Position is static (structures never move); size pulses each frame with
  // the parent's ice/lock pulse, mirroring the source's sprite-as-child-of-
  // mesh scale inheritance.
  interface GlowGroup { posB: WebGLBuffer; sizeB: WebGLBuffer; alphaB: WebGLBuffer; size: Float32Array; count: number; ids: number[] }
  function buildGlowGroup(ids: number[], positions: readonly (readonly [number, number, number])[]): GlowGroup {
    const pos = new Float32Array(positions.length * 3);
    positions.forEach((p, k) => { pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2]; });
    const posB = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posB);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    const alphaB = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, alphaB);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions.length).fill(0.22), gl.STATIC_DRAW);
    return { posB, sizeB: gl.createBuffer()!, alphaB, size: new Float32Array(positions.length), count: positions.length, ids };
  }
  const cyanIds: number[] = [], iceIds: number[] = [];
  for (let i = 0; i < structureCount; i++) (structures[i].isIce ? iceIds : cyanIds).push(i);
  const cyanGlow = buildGlowGroup(cyanIds, cyanIds.map(i => structures[i].position));
  const iceGlow = buildGlowGroup(iceIds, iceIds.map(i => structures[i].position));
  const coreGlow = buildGlowGroup([], [core.position]);

  function drawGlow(group: GlowGroup, color: readonly [number, number, number]): void {
    if (group.count === 0) return;
    gl.uniform3f(uPt.uColor, color[0], color[1], color[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, group.sizeB);
    gl.bufferData(gl.ARRAY_BUFFER, group.size, gl.DYNAMIC_DRAW);
    setAttr(gl, progPt, 'aPos', group.posB, 3);
    setAttr(gl, progPt, 'aSize', group.sizeB, 1);
    setAttr(gl, progPt, 'aAlpha', group.alphaB, 1);
    gl.drawArrays(gl.POINTS, 0, group.count);
  }

  // ── Camera ──────────────────────────────────────────────────────────────────
  let camX = 0, camY = 0, camZ = 0;
  let yaw = 0, pitch = 0, targetYaw = 0, targetPitch = 0;
  let speed = BASE_SPEED, targetSpeed = BASE_SPEED;

  // ── Tap-to-lock (full quality only) ────────────────────────────────────────
  const CORE_ID = structureCount; // sentinel target id for the core
  const pointerLocks = new Map<number, number>(); // pointerId -> target id
  const touchCounts = new Map<number, number>();  // target id -> filament-touch refcount

  function uniqueLockedIds(): number[] {
    return [...new Set(pointerLocks.values())];
  }

  function pickAt(ndcX: number, ndcY: number): number | null {
    const ray = rayFromCamera([camX, camY, camZ], yaw, pitch, ndcX, ndcY, FOV_Y, RW / RH || 1);
    let bestT = Infinity, bestId: number | null = null;
    for (let i = 0; i < structureCount; i++) {
      const tHit = intersectSphere(ray.origin, ray.dir, structures[i].position, structures[i].scale * 1.3);
      if (tHit !== null && tHit < bestT) { bestT = tHit; bestId = i; }
    }
    const tCore = intersectSphere(ray.origin, ray.dir, core.position, core.outerScale * 1.3);
    if (tCore !== null && tCore < bestT) { bestT = tCore; bestId = CORE_ID; }
    return bestId;
  }

  function chase(cur: number, target: number, dt: number): number {
    return cur + (target - cur) * (1 - Math.exp(-CAM_CHASE_RATE * dt));
  }

  function writeCoreShape(wf: Wireframe, offset: number, scale: number, color: readonly [number, number, number]): void {
    const cxr = Math.cos(coreRotX), sxr = Math.sin(coreRotX);
    const cyr = Math.cos(coreRotY), syr = Math.sin(coreRotY);
    const base = wf.positions;
    const n = base.length / 3;
    for (let v = 0; v < n; v++) {
      const lx = base[v * 3], ly = base[v * 3 + 1], lz = base[v * 3 + 2];
      const ry = ly * cxr - lz * sxr, rz = ly * sxr + lz * cxr;
      const rx2 = lx * cyr + rz * syr, rz2 = -lx * syr + rz * cyr;
      const vi = (offset + v) * 3;
      structPos[vi] = rx2 * scale + core.position[0];
      structPos[vi + 1] = ry * scale + core.position[1];
      structPos[vi + 2] = rz2 * scale + core.position[2];
      structColor[vi] = color[0]; structColor[vi + 1] = color[1]; structColor[vi + 2] = color[2];
      structAlpha[offset + v] = 0.5;
    }
  }

  // ── Resize ──────────────────────────────────────────────────────────────────
  // RW/RH are device pixels (canvas.width/height, DPR-scaled) — used for the
  // GL viewport and the projection aspect ratio, where DPR cancels out. CW/CH
  // are CSS pixels (canvas.clientWidth/height) — worldToScreen must project
  // into this space since the floater elements are positioned with CSS
  // transforms, matching the source's use of window.innerWidth/innerHeight.
  let RW = 1, RH = 1, CW = 1, CH = 1;
  const stopResize = observeResize(canvas, (cssW, cssH) => {
    RW = canvas.width; RH = canvas.height;
    CW = cssW; CH = cssH;
    gl.viewport(0, 0, RW, RH);
  });
  RW = canvas.width || 1; RH = canvas.height || 1;
  CW = canvas.clientWidth || 1; CH = canvas.clientHeight || 1;

  // ── Filament pool (16 short polylines bridging/flickering from locked objects) ──
  const FILAMENT_COUNT = 16;
  const FIL_SEGS = 5;
  interface Filament {
    originId: number; targetId: number | null; bridge: boolean; linked: boolean;
    dirX: number; dirY: number; dirZ: number;
    perp1X: number; perp1Y: number; perp1Z: number;
    perp2X: number; perp2Y: number; perp2Z: number;
    reach: number; life: number; duration: number; seed: number;
    colorR: number; colorG: number; colorB: number;
  }
  const filaments: Filament[] = Array.from({ length: FILAMENT_COUNT }, () => ({
    originId: 0, targetId: null, bridge: false, linked: false,
    dirX: 0, dirY: 0, dirZ: 1, perp1X: 1, perp1Y: 0, perp1Z: 0, perp2X: 0, perp2Y: 1, perp2Z: 0,
    reach: 0, life: 0, duration: 0.6, seed: Math.random() * 100,
    colorR: 1, colorG: 1, colorB: 1
  }));
  const filPos = new Float32Array(FILAMENT_COUNT * (FIL_SEGS + 1) * 3);
  const filColor = new Float32Array(FILAMENT_COUNT * (FIL_SEGS + 1) * 3);
  const filAlpha = new Float32Array(FILAMENT_COUNT * (FIL_SEGS + 1));
  const filIdx = new Uint16Array(FILAMENT_COUNT * FIL_SEGS * 2);
  {
    let k = 0;
    for (let f = 0; f < FILAMENT_COUNT; f++) {
      const base = f * (FIL_SEGS + 1);
      for (let s = 0; s < FIL_SEGS; s++) { filIdx[k++] = base + s; filIdx[k++] = base + s + 1; }
    }
  }
  const filPosB = gl.createBuffer()!;
  const filColorB = gl.createBuffer()!;
  const filAlphaB = gl.createBuffer()!;
  const filIdxB = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, filIdxB);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, filIdx, gl.STATIC_DRAW);

  function targetPos(id: number): readonly [number, number, number] { return id === CORE_ID ? core.position : structures[id].position; }
  function targetBaseRadius(id: number): number { return id === CORE_ID ? core.outerScale * 0.7 : structures[id].scale * 1.3; }
  function targetColor(id: number): readonly [number, number, number] { return id === CORE_ID ? GOLD : (structures[id].isIce ? ICE : CYAN); }

  function touchTarget(id: number): void {
    if (uniqueLockedIds().includes(id)) return;
    touchCounts.set(id, (touchCounts.get(id) ?? 0) + 1);
  }
  function untouchTarget(id: number): void {
    const c = touchCounts.get(id);
    if (c === undefined) return;
    if (c <= 1) touchCounts.delete(id); else touchCounts.set(id, c - 1);
  }

  const neighborScratch = new Int32Array(structureCount); // reused by findNeighbor — no per-call allocation

  function findNeighbor(originPos: readonly [number, number, number], excludeId: number): number | null {
    const maxDist = 150;
    let count = 0;
    for (let i = 0; i < structureCount; i++) {
      if (i === excludeId) continue;
      const p = structures[i].position;
      const d = Math.hypot(originPos[0] - p[0], originPos[1] - p[1], originPos[2] - p[2]);
      if (d < maxDist && d > 5) neighborScratch[count++] = i;
    }
    if (count === 0) return null;
    return neighborScratch[Math.floor(Math.random() * count)];
  }

  function resetFilament(f: Filament): void {
    if (f.linked && f.targetId !== null) untouchTarget(f.targetId);
    const locked = uniqueLockedIds();
    if (locked.length === 0) { f.linked = false; f.bridge = false; f.targetId = null; return; }

    const originId = locked[Math.floor(Math.random() * locked.length)];
    f.originId = originId;
    const originPos = targetPos(originId);

    let bridgeTarget: number | null = null;
    if (locked.length >= 2 && Math.random() < 0.65) {
      const others = locked.filter(id => id !== originId);
      bridgeTarget = others[Math.floor(Math.random() * others.length)];
    }
    const neighbor = bridgeTarget === null && Math.random() < 0.35 ? findNeighbor(originPos, originId) : null;

    f.bridge = bridgeTarget !== null;
    f.linked = bridgeTarget !== null || neighbor !== null;
    f.targetId = bridgeTarget ?? neighbor;

    let dx: number, dy: number, dz: number;
    if (f.targetId !== null) {
      const tp = targetPos(f.targetId);
      dx = tp[0] - originPos[0]; dy = tp[1] - originPos[1]; dz = tp[2] - originPos[2];
      f.reach = Math.hypot(dx, dy, dz);
      f.duration = f.bridge ? 1.1 + Math.random() * 0.9 : 0.9 + Math.random() * 0.7;
    } else {
      dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; dz = Math.random() * 2 - 1;
      f.reach = 0;
      f.duration = 0.5 + Math.random() * 0.7;
    }
    const len = Math.hypot(dx, dy, dz) || 1;
    f.dirX = dx / len; f.dirY = dy / len; f.dirZ = dz / len;
    const upX = Math.abs(f.dirY) < 0.9 ? 0 : 1, upY = Math.abs(f.dirY) < 0.9 ? 1 : 0;
    f.perp1X = f.dirY * 0 - f.dirZ * upY; f.perp1Y = f.dirZ * upX - f.dirX * 0; f.perp1Z = f.dirX * upY - f.dirY * upX;
    const p1len = Math.hypot(f.perp1X, f.perp1Y, f.perp1Z) || 1;
    f.perp1X /= p1len; f.perp1Y /= p1len; f.perp1Z /= p1len;
    f.perp2X = f.dirY * f.perp1Z - f.dirZ * f.perp1Y;
    f.perp2Y = f.dirZ * f.perp1X - f.dirX * f.perp1Z;
    f.perp2Z = f.dirX * f.perp1Y - f.dirY * f.perp1X;

    f.life = 0;
    f.seed = Math.random() * 100;
    const oc = targetColor(originId);
    let cr = oc[0], cg = oc[1], cb = oc[2];
    if (f.bridge && f.targetId !== null) {
      const tc = targetColor(f.targetId);
      cr = (cr + tc[0]) / 2 * 0.3 + 0.7; cg = (cg + tc[1]) / 2 * 0.3 + 0.7; cb = (cb + tc[2]) / 2 * 0.3 + 0.7;
    } else if (f.linked) {
      cr = cr * 0.4 + 0.6; cg = cg * 0.4 + 0.6; cb = cb * 0.4 + 0.6;
    }
    f.colorR = cr; f.colorG = cg; f.colorB = cb;
    if (f.linked && f.targetId !== null) touchTarget(f.targetId);
  }

  function kickFilaments(): void {
    for (const f of filaments) { resetFilament(f); f.life = Math.random() * f.duration * 0.25; }
  }

  const pointerCleanups: Array<() => void> = [];
  if (opts.quality === 'full') {
    function ndcFromEvent(e: PointerEvent): [number, number] {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
    }
    // A fast double-tap is conventionally a zoom gesture (already suppressed
    // via touch-action:none on the canvas), not a deliberate pick — without
    // this, two taps close together in time and space each independently
    // raycast and can lock onto whatever's nearby, reading as an accidental
    // "double tap selects something" glitch. Mirrors the OS double-tap
    // window/tolerance so it only catches genuine double-taps, not two
    // separate deliberate taps.
    const DOUBLE_TAP_MS = 300;
    const DOUBLE_TAP_PX = 40;
    let lastTapTime = -Infinity, lastTapX = 0, lastTapY = 0;
    const onPointerDown = (e: PointerEvent): void => {
      const isDoubleTap = e.timeStamp - lastTapTime < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < DOUBLE_TAP_PX;
      lastTapTime = e.timeStamp; lastTapX = e.clientX; lastTapY = e.clientY;
      if (isDoubleTap) return;

      const [nx, ny] = ndcFromEvent(e);
      const hit = pickAt(nx, ny);
      if (hit !== null) {
        pointerLocks.set(e.pointerId, hit);
        targetSpeed = 0;
        kickFilaments();
      } else if (uniqueLockedIds().length === 0) {
        targetSpeed = BOOST_SPEED;
      }
      sharedState.lockLevel = Math.min(uniqueLockedIds().length, 2) as 0 | 1 | 2;
    };
    const onPointerUp = (e: PointerEvent): void => {
      pointerLocks.delete(e.pointerId);
      const locked = uniqueLockedIds();
      targetSpeed = locked.length ? 0 : BASE_SPEED;
      sharedState.lockLevel = Math.min(locked.length, 2) as 0 | 1 | 2;
    };
    const onPointerMove = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      targetYaw = -nx * 0.55;
      targetPitch = ny * 0.32;
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointermove', onPointerMove);
    pointerCleanups.push(
      () => canvas.removeEventListener('pointerdown', onPointerDown),
      () => canvas.removeEventListener('pointerup', onPointerUp),
      () => canvas.removeEventListener('pointercancel', onPointerUp),
      () => canvas.removeEventListener('pointermove', onPointerMove)
    );
  }

  // ── HUD overlay (full quality only) ────────────────────────────────────────
  const full = opts.quality === 'full';
  let overlay: ReturnType<typeof makeOverlay> | null = null;
  if (full) {
    overlay = makeOverlay();
    (canvas.parentElement ?? document.body).appendChild(overlay.root);
  }

  // Hoisted (not declared inside the RAF tick, matching writeCoreShape above)
  // so it can be called once synchronously right after mount — before the
  // first real animation frame — as well as every tick thereafter. A fresh
  // mount otherwise leaves the corner telemetry blank until the first paint,
  // which in this project's test harness (fake rAF resolves via a queued
  // microtask, not synchronously) would never happen inside a synchronous
  // assertion; painting it once immediately matches what a real browser's
  // first-frame content should look like anyway.
  // Second sanctioned per-frame-allocation exception: allocates HudFields + up to 2 FloaterTarget/ScreenPoint
  // objects per call, but only when quality === 'full' (never in preview).
  function updateOverlay(mvp: Float32Array, t: number, dt: number, lockedIds: number[]): void {
    if (!overlay) return;
    const depth = Math.max(0, Math.round(-camZ)).toString().padStart(4, '0');
    const throughput = (speed * 7.3).toFixed(1);
    const vector = `${yaw.toFixed(2)} / ${pitch.toFixed(2)}`;
    let nearestDist = Infinity, nearestName = '';
    for (let i = 0; i < structureCount; i++) {
      const p = structures[i].position;
      const d = Math.hypot(camX - p[0], camY - p[1], camZ - p[2]);
      if (d < nearestDist) { nearestDist = d; nearestName = structures[i].name; }
    }
    const iceStatus = lockedIds.length || speed > BASE_SPEED + 1 ? 'engaged' : 'passive';
    const status = lockedIds.length
      ? `LOCKED · ${lockedIds.map(id => id === CORE_ID ? 'CORE ARRAY' : structures[id].name).join(' ⇄ ')}`
      : 'nominal';
    const jackPoint = `CASE_${(10 + (Math.floor(t) % 89)).toString().padStart(2, '0')}`;
    const fields: HudFields = { jackPoint, depth, status, throughput, iceStatus, vector, nearest: `${nearestName} (${Math.round(nearestDist)}m)` };
    overlay.updateHud(fields);

    for (let g = 0; g < 2; g++) {
      const id = lockedIds[g];
      if (id === undefined) { overlay.updateFloater(g as 0 | 1, null, dt); continue; }
      const pos = targetPos(id);
      const name = id === CORE_ID ? 'CORE ARRAY' : structures[id].name;
      const sp = worldToScreen(mvp, pos, CW, CH);
      const target: FloaterTarget = { name, isCore: id === CORE_ID, x: sp.x, y: sp.y, visible: !sp.behindCamera };
      overlay.updateFloater(g as 0 | 1, target, dt);
    }
  }
  // Initial synchronous paint (see comment above) — mvp is unused on this
  // call since uniqueLockedIds() is always empty pre-mount, so a zeroed
  // placeholder is fine; the first real tick supplies the true matrix.
  if (full) updateOverlay(new Float32Array(16), 0, 0, uniqueLockedIds());

  // ── Render loop ─────────────────────────────────────────────────────────────
  const loop = createRafLoop((dtMs, tMs) => {
    const dt = Math.min(dtMs / 1000, 0.05);
    const t = tMs / 1000;

    yaw = chase(yaw, targetYaw, dt);
    pitch = chase(pitch, targetPitch, dt);
    speed = chase(speed, targetSpeed, dt);

    camZ -= speed * dt;
    camX += Math.sin(t * 0.15) * 1.2 * dt;
    camY += Math.cos(t * 0.12) * 0.9 * dt;
    if (camZ < -TUNNEL_LEN + 40) camZ = 0;

    sharedState.speed = speed;

    const lockedIds = uniqueLockedIds();
    const litSet = new Set<number>([...lockedIds, ...touchCounts.keys()]);

    const aspect = RW / RH || 1;
    const proj = perspective(FOV_Y, aspect, NEAR, FAR);
    const view = mul4(rotX(pitch), mul4(rotY(yaw), transl(-camX, -camY, -camZ)));
    const mvp = mul4(proj, view);

    gl.clearColor(FOG_COLOR[0], FOG_COLOR[1], FOG_COLOR[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // ── Update structure rotation/pulse + write dynamic buffers ──────────────
    for (let i = 0; i < structureCount; i++) {
      const s = structures[i];
      rotXAngle[i] += s.spin * dt;
      rotYAngle[i] += s.spin * 0.7 * dt;
      const cx = Math.cos(rotXAngle[i]), sx = Math.sin(rotXAngle[i]);
      const cy = Math.cos(rotYAngle[i]), sy = Math.sin(rotYAngle[i]);
      const pulse = s.isIce ? 1 + Math.sin(t * 3 + s.position[0]) * 0.08 : 1;
      const scale = s.scale * pulse;
      const base = SOLIDS[s.solid].positions;
      const off = vertOffset[i];
      const [pxw, pyw, pzw] = s.position;
      const [cr, cg, cb] = litSet.has(i) ? LIT : (s.isIce ? ICE : CYAN);
      for (let v = 0; v < vertCount[i]; v++) {
        const lx = base[v * 3], ly = base[v * 3 + 1], lz = base[v * 3 + 2];
        const ry = ly * cx - lz * sx, rz = ly * sx + lz * cx;       // rotate X
        const rx2 = lx * cy + rz * sy, rz2 = -lx * sy + rz * cy;    // rotate Y
        const vi = (off + v) * 3;
        structPos[vi] = rx2 * scale + pxw;
        structPos[vi + 1] = ry * scale + pyw;
        structPos[vi + 2] = rz2 * scale + pzw;
        structColor[vi] = cr; structColor[vi + 1] = cg; structColor[vi + 2] = cb;
        structAlpha[off + v] = 0.4;
      }
    }

    // ── Core (outer icosahedron + inner octahedron) ───────────────────────────
    coreRotY += dt * 0.15; coreRotX += dt * 0.05;
    const corePulse = 1 + Math.sin(t * 1.4) * 0.05;
    const coreColor = litSet.has(CORE_ID) ? LIT : GOLD;
    writeCoreShape(ICOSAHEDRON, coreOuterOffset, core.outerScale * corePulse, coreColor);
    writeCoreShape(OCTAHEDRON, coreInnerOffset, core.innerScale * corePulse, coreColor);

    gl.bindBuffer(gl.ARRAY_BUFFER, structPosB);
    gl.bufferData(gl.ARRAY_BUFFER, structPos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, structColorB);
    gl.bufferData(gl.ARRAY_BUFFER, structColor, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, structAlphaB);
    gl.bufferData(gl.ARRAY_BUFFER, structAlpha, gl.DYNAMIC_DRAW);

    // ── Draw grid + structures/core (normal alpha blend) ─────────────────────
    gl.useProgram(progLine);
    gl.uniformMatrix4fv(uLine.uMVP, false, mvp);
    gl.uniform3f(uLine.uFogColor, FOG_COLOR[0], FOG_COLOR[1], FOG_COLOR[2]);
    gl.uniform1f(uLine.uFogDensity, FOG_DENSITY);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    setAttr(gl, progLine, 'aPos', gridPosB, 3);
    setAttr(gl, progLine, 'aColor', gridColorB, 3);
    setAttr(gl, progLine, 'aAlpha', gridAlphaB, 1);
    gl.drawArrays(gl.LINES, 0, gridVertCount);

    setAttr(gl, progLine, 'aPos', structPosB, 3);
    setAttr(gl, progLine, 'aColor', structColorB, 3);
    setAttr(gl, progLine, 'aAlpha', structAlphaB, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, structIdxB);
    gl.drawElements(gl.LINES, totalEdgeIdx, gl.UNSIGNED_SHORT, 0);

    // ── Draw particle motes (normal blend) then glow blobs (additive) ────────
    gl.useProgram(progPt);
    gl.uniformMatrix4fv(uPt.uMVP, false, mvp);
    gl.uniform3f(uPt.uFogColor, FOG_COLOR[0], FOG_COLOR[1], FOG_COLOR[2]);
    gl.uniform1f(uPt.uFogDensity, FOG_DENSITY);
    gl.uniform3f(uPt.uColor, DUST[0], DUST[1], DUST[2]);
    setAttr(gl, progPt, 'aPos', particlePosB, 3);
    setAttr(gl, progPt, 'aSize', particleSizeB, 1);
    setAttr(gl, progPt, 'aAlpha', particleAlphaB, 1);
    gl.drawArrays(gl.POINTS, 0, particleCount);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    for (let k = 0; k < cyanIds.length; k++) {
      const si = cyanIds[k];
      cyanGlow.size[k] = structures[si].scale * 1.6;
    }
    for (let k = 0; k < iceIds.length; k++) {
      const si = iceIds[k];
      iceGlow.size[k] = structures[si].scale * 1.6 * (1 + Math.sin(t * 3 + structures[si].position[0]) * 0.08);
    }
    coreGlow.size[0] = 100 * corePulse;
    drawGlow(cyanGlow, CYAN);
    drawGlow(iceGlow, ICE);
    drawGlow(coreGlow, GOLD);

    // ── Filaments (additive blend, indexed LINES) ─────────────────────────────
    if (opts.quality === 'full') {
      if (lockedIds.length === 0) {
        filAlpha.fill(0);
        sharedState.bridgeActive = false;
      } else {
        for (const f of filaments) {
          f.life += dt;
          if (f.life > f.duration) resetFilament(f);
          const originPos = targetPos(f.originId);
          const baseRadius = targetBaseRadius(f.originId);
          const camDist = Math.hypot(camX - originPos[0], camY - originPos[1], camZ - originPos[2]);
          const effRadius = baseRadius + camDist * 0.09;
          const prog = f.life / f.duration;
          const grow = Math.min(prog * 2.2, 1);
          const fade = prog < 0.55 ? prog / 0.55 : Math.max(0, 1 - (prog - 0.55) / 0.45);
          const startOffset = f.linked ? baseRadius * 0.35 : effRadius * 0.5;
          const reachTotal = f.linked ? f.reach : effRadius * 2.4;
          const filBase = filaments.indexOf(f) * (FIL_SEGS + 1);
          for (let s = 0; s <= FIL_SEGS; s++) {
            const frac = (s / FIL_SEGS) * grow;
            const dist = startOffset + (reachTotal - startOffset) * frac;
            const wob = (1 - frac) * (f.linked ? baseRadius * 0.15 : effRadius * 0.3);
            const w1 = Math.sin(t * 5 + f.seed + s * 1.7) * wob;
            const w2 = Math.cos(t * 4.2 + f.seed * 1.3 + s * 1.1) * wob;
            const vi = (filBase + s) * 3;
            filPos[vi] = originPos[0] + f.dirX * dist + f.perp1X * w1 + f.perp2X * w2;
            filPos[vi + 1] = originPos[1] + f.dirY * dist + f.perp1Y * w1 + f.perp2Y * w2;
            filPos[vi + 2] = originPos[2] + f.dirZ * dist + f.perp1Z * w1 + f.perp2Z * w2;
            filColor[vi] = f.colorR; filColor[vi + 1] = f.colorG; filColor[vi + 2] = f.colorB;
            const peak = f.bridge ? 1.0 : (f.linked ? 0.9 : 0.65);
            filAlpha[filBase + s] = fade * peak;
          }
        }
        sharedState.bridgeActive = filaments.some(f => f.bridge && f.life / f.duration < 0.9);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, filPosB);
      gl.bufferData(gl.ARRAY_BUFFER, filPos, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, filColorB);
      gl.bufferData(gl.ARRAY_BUFFER, filColor, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, filAlphaB);
      gl.bufferData(gl.ARRAY_BUFFER, filAlpha, gl.DYNAMIC_DRAW);
      gl.useProgram(progLine);
      gl.uniformMatrix4fv(uLine.uMVP, false, mvp);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      setAttr(gl, progLine, 'aPos', filPosB, 3);
      setAttr(gl, progLine, 'aColor', filColorB, 3);
      setAttr(gl, progLine, 'aAlpha', filAlphaB, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, filIdxB);
      gl.drawElements(gl.LINES, filIdx.length, gl.UNSIGNED_SHORT, 0);
    }

    // ── HUD + floating labels (full quality only) ────────────────────────────
    if (full) updateOverlay(mvp, t, dt, lockedIds);
  }, ac.signal);

  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      for (const cleanup of pointerCleanups) cleanup();
      overlay?.root.remove();
      try { gl.deleteProgram(progLine); gl.deleteProgram(progPt); } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
