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

  function chase(cur: number, target: number, dt: number): number {
    return cur + (target - cur) * (1 - Math.exp(-CAM_CHASE_RATE * dt));
  }

  // ── Resize ──────────────────────────────────────────────────────────────────
  let RW = 1, RH = 1;
  const stopResize = observeResize(canvas, () => {
    RW = canvas.width; RH = canvas.height;
    gl.viewport(0, 0, RW, RH);
  });
  RW = canvas.width || 1; RH = canvas.height || 1;

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
      const [cr, cg, cb] = s.isIce ? ICE : CYAN;
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
    writeCoreShape(ICOSAHEDRON, coreOuterOffset, core.outerScale * corePulse, GOLD);
    writeCoreShape(OCTAHEDRON, coreInnerOffset, core.innerScale * corePulse, GOLD);

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
    cyanIds.forEach((si, k) => { cyanGlow.size[k] = structures[si].scale * 1.6; });
    iceIds.forEach((si, k) => { iceGlow.size[k] = structures[si].scale * 1.6 * (1 + Math.sin(t * 3 + structures[si].position[0]) * 0.08); });
    coreGlow.size[0] = 100 * corePulse;
    drawGlow(cyanGlow, CYAN);
    drawGlow(iceGlow, ICE);
    drawGlow(coreGlow, GOLD);
  }, ac.signal);

  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      try { gl.deleteProgram(progLine); gl.deleteProgram(progPt); } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
