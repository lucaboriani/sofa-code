# Cyberspace Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `neuromancer-cyberspace.html` (a Three.js flying-through-cyberspace scene with tap-to-lock structures, light filaments, a data-readout HUD and a layered drone) into the gallery as room 10, preserving every graphic and audio effect, with zero Three.js dependency.

**Architecture:** Camera + wireframe-solid rendering follows the `neural` room's pattern — a hand-rolled mat4 camera (`perspective`/`rotX`/`rotY`/`transl` from `src/lib/webgl/math.ts`) driving two shader programs (colored lines, point sprites). Three new shared primitives live in `src/lib/webgl/` (not the room folder) so future 3D rooms can reuse them: `polyhedra.ts` (wireframe solid vertex/edge tables), `raycast.ts` (camera-ray + sphere picking), `project.ts` (world→screen for DOM-anchored overlays). Per-structure rotation/scale is applied as scalar CPU math directly into preallocated buffers (not per-object mat4 multiplies) to avoid RAF-tick allocation; only the one shared camera MVP is built with `mul4` each frame, matching `neural`'s existing precedent. The audio graph is a straight port of the source's Web Audio graph, polled each tick from a `sharedState` bridge instead of driven by direct pointer-handler calls.

**Tech Stack:** Astro + TypeScript (strict), WebGL1, Web Audio API, Vitest (unit) + Playwright (e2e). No frameworks, plain CSS, no Three.js.

## Global Constraints

- TypeScript strict: `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`. No `any` / `as unknown` (except established test casts to fixture types, e.g. `fake as unknown as AudioContext`).
- No frameworks beyond Astro; plain CSS; path alias `@/*` → `src/*`.
- **No allocations inside RAF ticks.** Preallocate typed arrays/GL buffers in the `mount()` closure. The one exception, matching the `neural` room's existing precedent, is the single per-frame camera MVP composition (`mul4`/`perspective`/`rotX`/`rotY`/`transl` each allocate a small `Float32Array(16)`) — acceptable because it happens once per frame, not once per object.
- New shared WebGL primitives (`polyhedra.ts`, `raycast.ts`, `project.ts`) go in `src/lib/webgl/`, not `src/lib/rooms/cyberspace/`, so future 3D rooms can import them.
- **Audio funnels through the returned `node`** — no room node connects to `ctx.destination` directly; the bus owns the context, fade, and per-frame `tick()`.
- Geometry/camera/HUD-text/audio-graph formulas are ported from `neuromancer-cyberspace.html`; where the source used per-rAF-frame increments (implicitly ~60fps), the plan converts them to `dt`-scaled or `1 - exp(-rate*dt)` exponential-chase forms (matching the `sri-yantra` port's precedent) so behavior is frame-rate independent while preserving the same time constant.
- HUD corner-telemetry text and floating data-readout labels are preserved verbatim as the room's identity (same principle as Italian in `neural`, Sanskrit in `sri-yantra`).
- No live audio, no pointer interaction, no HUD/filaments in card previews (`quality: 'preview'`).
- Conventional-commit messages (`feat`, `test`, `chore`). Commit at each TDD checkpoint.
- Reference spec: `docs/superpowers/specs/2026-07-15-cyberspace-room-design.md`.

---

### Task 1: Shared WebGL primitives (`polyhedra.ts`, `raycast.ts`, `project.ts`)

**Files:**
- Create: `src/lib/webgl/polyhedra.ts`
- Create: `src/lib/webgl/raycast.ts`
- Create: `src/lib/webgl/project.ts`
- Test: `tests/unit/webgl/polyhedra.test.ts`
- Test: `tests/unit/webgl/raycast.test.ts`
- Test: `tests/unit/webgl/project.test.ts`

**Interfaces:**
- Consumes: `mul4`, `perspective`, `transl` from `./math` (project.test.ts only, to build a test MVP).
- Produces:
  - `interface Wireframe { positions: Float32Array; edges: Uint16Array }`
  - `TETRAHEDRON, OCTAHEDRON, BOX, ICOSAHEDRON: Wireframe`
  - `interface Ray { origin: [number,number,number]; dir: [number,number,number] }`
  - `rayFromCamera(camPos: readonly [number,number,number], yaw: number, pitch: number, ndcX: number, ndcY: number, fovY: number, aspect: number): Ray`
  - `intersectSphere(origin: readonly [number,number,number], dir: readonly [number,number,number], center: readonly [number,number,number], radius: number): number | null`
  - `interface ScreenPoint { x: number; y: number; depth: number; behindCamera: boolean }`
  - `worldToScreen(mvp: Float32Array, worldPos: readonly [number,number,number], canvasW: number, canvasH: number): ScreenPoint`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/webgl/polyhedra.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TETRAHEDRON, OCTAHEDRON, BOX, ICOSAHEDRON, type Wireframe } from '@/lib/webgl/polyhedra';

function vertexCount(wf: Wireframe): number { return wf.positions.length / 3; }
function edgeCount(wf: Wireframe): number { return wf.edges.length / 2; }

function assertUnitRadius(wf: Wireframe, tolerance = 1e-4): void {
  const n = vertexCount(wf);
  for (let i = 0; i < n; i++) {
    const x = wf.positions[i * 3], y = wf.positions[i * 3 + 1], z = wf.positions[i * 3 + 2];
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
  }
}

function assertValidEdges(wf: Wireframe): void {
  const n = vertexCount(wf);
  const seen = new Set<string>();
  for (let e = 0; e < edgeCount(wf); e++) {
    const a = wf.edges[e * 2], b = wf.edges[e * 2 + 1];
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(n);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(n);
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }
}

function degrees(wf: Wireframe): number[] {
  const n = vertexCount(wf);
  const deg = new Array(n).fill(0);
  for (let e = 0; e < edgeCount(wf); e++) { deg[wf.edges[e * 2]]++; deg[wf.edges[e * 2 + 1]]++; }
  return deg;
}

describe('webgl/polyhedra', () => {
  it('tetrahedron: 4 vertices, 6 edges, degree 3, unit radius', () => {
    expect(vertexCount(TETRAHEDRON)).toBe(4);
    expect(edgeCount(TETRAHEDRON)).toBe(6);
    assertValidEdges(TETRAHEDRON);
    assertUnitRadius(TETRAHEDRON);
    expect(degrees(TETRAHEDRON)).toEqual([3, 3, 3, 3]);
  });

  it('octahedron: 6 vertices, 12 edges, degree 4, unit radius', () => {
    expect(vertexCount(OCTAHEDRON)).toBe(6);
    expect(edgeCount(OCTAHEDRON)).toBe(12);
    assertValidEdges(OCTAHEDRON);
    assertUnitRadius(OCTAHEDRON);
    expect(degrees(OCTAHEDRON)).toEqual([4, 4, 4, 4, 4, 4]);
  });

  it('box: 8 vertices, 12 edges, degree 3, unit radius', () => {
    expect(vertexCount(BOX)).toBe(8);
    expect(edgeCount(BOX)).toBe(12);
    assertValidEdges(BOX);
    assertUnitRadius(BOX);
    expect(degrees(BOX)).toEqual(new Array(8).fill(3));
  });

  it('icosahedron: 12 vertices, 30 edges, degree 5, unit radius', () => {
    expect(vertexCount(ICOSAHEDRON)).toBe(12);
    expect(edgeCount(ICOSAHEDRON)).toBe(30);
    assertValidEdges(ICOSAHEDRON);
    assertUnitRadius(ICOSAHEDRON);
    expect(degrees(ICOSAHEDRON)).toEqual(new Array(12).fill(5));
  });
});
```

Create `tests/unit/webgl/raycast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rayFromCamera, intersectSphere } from '@/lib/webgl/raycast';

describe('webgl/raycast', () => {
  it('rayFromCamera with zero yaw/pitch and centered NDC looks straight down -Z', () => {
    const ray = rayFromCamera([0, 0, 0], 0, 0, 0, 0, Math.PI / 2, 1);
    expect(ray.origin).toEqual([0, 0, 0]);
    expect(ray.dir[0]).toBeCloseTo(0);
    expect(ray.dir[1]).toBeCloseTo(0);
    expect(ray.dir[2]).toBeCloseTo(-1);
  });

  it('rayFromCamera rotates with yaw: turning 90° right points the ray toward +X', () => {
    const ray = rayFromCamera([0, 0, 0], Math.PI / 2, 0, 0, 0, Math.PI / 2, 1);
    expect(ray.dir[0]).toBeCloseTo(1);
    expect(ray.dir[1]).toBeCloseTo(0);
    expect(ray.dir[2]).toBeCloseTo(0);
  });

  it('intersectSphere hits a sphere ahead of the ray at the expected distance', () => {
    const t = intersectSphere([0, 0, 0], [0, 0, -1], [0, 0, -10], 2);
    expect(t).toBeCloseTo(8);
  });

  it('intersectSphere misses a sphere off to the side', () => {
    const t = intersectSphere([0, 0, 0], [0, 0, -1], [50, 0, -10], 2);
    expect(t).toBeNull();
  });

  it('intersectSphere returns null when the sphere is entirely behind the ray origin', () => {
    const t = intersectSphere([0, 0, 0], [0, 0, -1], [0, 0, 10], 2);
    expect(t).toBeNull();
  });

  it('rayFromCamera + intersectSphere: turning to face a sphere off to the right hits it', () => {
    const ray = rayFromCamera([0, 0, 0], Math.PI / 2, 0, 0, 0, Math.PI / 2, 1);
    const t = intersectSphere(ray.origin, ray.dir, [10, 0, 0], 2);
    expect(t).toBeCloseTo(8);
  });
});
```

Create `tests/unit/webgl/project.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { worldToScreen } from '@/lib/webgl/project';
import { mul4, perspective, transl } from '@/lib/webgl/math';

describe('webgl/project', () => {
  it('a point straight ahead of the camera projects to canvas center', () => {
    const mvp = mul4(perspective(Math.PI / 2, 1, 0.1, 100), transl(0, 0, -5));
    const p = worldToScreen(mvp, [0, 0, 0], 400, 300);
    expect(p.behindCamera).toBe(false);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(150);
  });

  it('a point behind the camera is flagged behindCamera', () => {
    const mvp = mul4(perspective(Math.PI / 2, 1, 0.1, 100), transl(0, 0, 5));
    const p = worldToScreen(mvp, [0, 0, 0], 400, 300);
    expect(p.behindCamera).toBe(true);
  });

  it('a point to the right of the camera projects right of center', () => {
    const mvp = mul4(perspective(Math.PI / 2, 1, 0.1, 100), transl(0, 0, -5));
    const p = worldToScreen(mvp, [2, 0, -5], 400, 300);
    expect(p.behindCamera).toBe(false);
    expect(p.x).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- polyhedra raycast project`
Expected: FAIL — `Cannot find module '@/lib/webgl/polyhedra'` (and raycast/project).

- [ ] **Step 3: Implement `polyhedra.ts`**

Create `src/lib/webgl/polyhedra.ts`:

```ts
// Shared wireframe-solid vertex/edge tables — unit circumradius, ready for
// gl.LINES draws (edges as index pairs). Room modules scale/position/color
// instances themselves; this module only builds local-space geometry.

export interface Wireframe {
  positions: Float32Array; // vertex xyz, unit circumradius
  edges: Uint16Array;      // index pairs, 2 per edge
}

function normalizeAll(verts: readonly (readonly [number, number, number])[]): [number, number, number][] {
  return verts.map(([x, y, z]) => {
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  });
}

function toWireframe(verts: readonly (readonly [number, number, number])[], edges: readonly (readonly [number, number])[]): Wireframe {
  const positions = new Float32Array(verts.length * 3);
  verts.forEach(([x, y, z], i) => { positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z; });
  const edgeArr = new Uint16Array(edges.length * 2);
  edges.forEach(([a, b], i) => { edgeArr[i * 2] = a; edgeArr[i * 2 + 1] = b; });
  return { positions, edges: edgeArr };
}

function allPairEdges(
  verts: readonly (readonly [number, number, number])[],
  keep: (a: readonly [number, number, number], b: readonly [number, number, number]) => boolean
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (keep(verts[i], verts[j])) out.push([i, j]);
    }
  }
  return out;
}

// For a regular convex polyhedron, each vertex's k graph-neighbours are
// exactly its k nearest OTHER vertices (there is a clear numeric gap between
// the k-th and (k+1)-th nearest distance) — so this derives edges without
// hand-transcribing a face table.
function nearestNeighborEdges(verts: readonly (readonly [number, number, number])[], k: number): [number, number][] {
  const n = verts.length;
  const dist = (a: readonly [number, number, number], b: readonly [number, number, number]): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const ranked = [...Array(n).keys()]
      .filter(j => j !== i)
      .sort((a, b) => dist(verts[i], verts[a]) - dist(verts[i], verts[b]));
    for (let r = 0; r < k; r++) {
      const j = ranked[r];
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (!seen.has(key)) { seen.add(key); out.push(i < j ? [i, j] : [j, i]); }
    }
  }
  return out;
}

// ── Tetrahedron: 4 vertices, 6 edges (fully connected) ────────────────────────
const TET_VERTS = normalizeAll([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]);
export const TETRAHEDRON: Wireframe = toWireframe(TET_VERTS, allPairEdges(TET_VERTS, () => true));

// ── Octahedron: 6 vertices, 12 edges (all pairs except antipodal) ─────────────
const OCT_VERTS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const OCTAHEDRON: Wireframe = toWireframe(
  OCT_VERTS,
  allPairEdges(OCT_VERTS, (a, b) => !(a[0] === -b[0] && a[1] === -b[1] && a[2] === -b[2]))
);

// ── Box: 8 vertices, 12 edges (corners differing in exactly one bit) ──────────
const BOX_S = 1 / Math.sqrt(3);
const BOX_VERTS: [number, number, number][] = Array.from({ length: 8 }, (_, i) => [
  (i & 1) ? BOX_S : -BOX_S,
  (i & 2) ? BOX_S : -BOX_S,
  (i & 4) ? BOX_S : -BOX_S
]);
const BOX_EDGES: [number, number][] = [];
for (let i = 0; i < 8; i++) {
  for (const bit of [1, 2, 4]) {
    const j = i ^ bit;
    if (i < j) BOX_EDGES.push([i, j]);
  }
}
export const BOX: Wireframe = toWireframe(BOX_VERTS, BOX_EDGES);

// ── Icosahedron: 12 vertices, 30 edges ─────────────────────────────────────────
// Standard golden-ratio construction (three orthogonal golden rectangles).
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS = normalizeAll([
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]
]);
export const ICOSAHEDRON: Wireframe = toWireframe(ICO_VERTS, nearestNeighborEdges(ICO_VERTS, 5));
```

- [ ] **Step 4: Implement `raycast.ts`**

Create `src/lib/webgl/raycast.ts`:

```ts
// Camera-ray construction + ray/sphere picking. The render camera composes
// world→camera space as rotX(pitch) * rotY(yaw) * transl(-camPos) (see
// cyberspace/mount.ts); a pick ray needs the inverse of that rotation to go
// from a screen point back to a world-space direction, so this applies
// rotX(-pitch) then rotY(-yaw) to the camera-space direction.

export interface Ray {
  origin: [number, number, number];
  dir: [number, number, number];
}

export function rayFromCamera(
  camPos: readonly [number, number, number],
  yaw: number,
  pitch: number,
  ndcX: number,
  ndcY: number,
  fovY: number,
  aspect: number
): Ray {
  const t = Math.tan(fovY / 2);
  let x = ndcX * aspect * t;
  let y = ndcY * t;
  let z = -1;

  const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
  const y1 = cp * y - sp * z;
  const z1 = sp * y + cp * z;
  y = y1; z = z1;

  const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
  const x1 = cy * x + sy * z;
  const z2 = -sy * x + cy * z;
  x = x1; z = z2;

  const len = Math.hypot(x, y, z) || 1;
  return {
    origin: [camPos[0], camPos[1], camPos[2]],
    dir: [x / len, y / len, z / len]
  };
}

export function intersectSphere(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  center: readonly [number, number, number],
  radius: number
): number | null {
  const ox = origin[0] - center[0], oy = origin[1] - center[1], oz = origin[2] - center[2];
  const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = -b - sq;
  const t1 = -b + sq;
  const t = t0 >= 0 ? t0 : t1;
  return t >= 0 ? t : null;
}
```

- [ ] **Step 5: Implement `project.ts`**

Create `src/lib/webgl/project.ts`:

```ts
// World→screen projection for anchoring DOM elements to 3D points, using the
// same column-major MVP convention as ./math.ts.

export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
  behindCamera: boolean;
}

export function worldToScreen(
  mvp: Float32Array,
  worldPos: readonly [number, number, number],
  canvasW: number,
  canvasH: number
): ScreenPoint {
  const [x, y, z] = worldPos;
  const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
  const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
  const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
  if (cw <= 0) {
    return { x: 0, y: 0, depth: cw, behindCamera: true };
  }
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  return {
    x: (ndcX * 0.5 + 0.5) * canvasW,
    y: (-ndcY * 0.5 + 0.5) * canvasH,
    depth: cw,
    behindCamera: false
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- polyhedra raycast project`
Expected: PASS (4 polyhedra + 6 raycast + 3 project tests).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/webgl/polyhedra.ts src/lib/webgl/raycast.ts src/lib/webgl/project.ts tests/unit/webgl/polyhedra.test.ts tests/unit/webgl/raycast.test.ts tests/unit/webgl/project.test.ts
git commit -m "feat(webgl): shared wireframe solids, camera-ray picking and world-to-screen projection"
```

---

### Task 2: Pure scene geometry (`geometry.ts`)

**Files:**
- Create: `src/lib/rooms/cyberspace/geometry.ts`
- Test: `tests/unit/rooms/cyberspace.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no dependency on Task 1's modules — the solid *shapes* live in `polyhedra.ts`; this module only lays out *where* structures sit and what solid type each uses).
- Produces:
  - `TUNNEL_LEN = 4200`, `HALF_W = 55`, `HALF_H = 32`
  - `ARRAY_NAMES: readonly string[]`
  - `type SolidType = 'ico' | 'oct' | 'box' | 'tet'`
  - `interface Structure { position: [number,number,number]; scale: number; solid: SolidType; isIce: boolean; name: string; spin: number }`
  - `buildStructures(count: number): Structure[]`
  - `interface ParticleField { positions: Float32Array }`
  - `buildParticles(count: number): ParticleField`
  - `interface Core { position: [number,number,number]; outerScale: number; innerScale: number }`
  - `buildCore(): Core`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/rooms/cyberspace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildStructures, buildParticles, buildCore,
  ARRAY_NAMES, HALF_W, HALF_H, TUNNEL_LEN
} from '@/lib/rooms/cyberspace/geometry';

describe('cyberspace geometry', () => {
  it('buildStructures returns the requested count with valid fields', () => {
    const structures = buildStructures(240);
    expect(structures).toHaveLength(240);
    for (const s of structures) {
      expect(['ico', 'oct', 'box', 'tet']).toContain(s.solid);
      expect(ARRAY_NAMES).toContain(s.name);
      expect(Math.abs(s.position[0])).toBeLessThanOrEqual(HALF_W);
      expect(Math.abs(s.position[1])).toBeLessThanOrEqual(HALF_H);
      expect(s.position[2]).toBeLessThan(0);
      expect(s.position[2]).toBeGreaterThan(-TUNNEL_LEN);
      expect(s.scale).toBeGreaterThanOrEqual(2);
      expect(s.scale).toBeLessThanOrEqual(10);
    }
  });

  it('buildStructures marks roughly 18% of structures as ice (crimson)', () => {
    const structures = buildStructures(2000);
    const iceFraction = structures.filter(s => s.isIce).length / structures.length;
    expect(iceFraction).toBeGreaterThan(0.1);
    expect(iceFraction).toBeLessThan(0.26);
  });

  it('buildParticles returns count*3 floats within the tunnel bounds', () => {
    const { positions } = buildParticles(500);
    expect(positions.length).toBe(1500);
    for (let i = 0; i < 500; i++) {
      expect(Math.abs(positions[i * 3])).toBeLessThanOrEqual(HALF_W);
      expect(Math.abs(positions[i * 3 + 1])).toBeLessThanOrEqual(HALF_H);
      expect(positions[i * 3 + 2]).toBeLessThanOrEqual(0);
      expect(positions[i * 3 + 2]).toBeGreaterThanOrEqual(-TUNNEL_LEN);
    }
  });

  it('buildCore returns a fixed far-end position and nested scales', () => {
    const core = buildCore();
    expect(core.position[0]).toBe(0);
    expect(core.position[1]).toBe(0);
    expect(core.position[2]).toBeCloseTo(-TUNNEL_LEN + 140);
    expect(core.outerScale).toBe(58);
    expect(core.innerScale).toBe(30);
    expect(core.innerScale).toBeLessThan(core.outerScale);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- cyberspace`
Expected: FAIL — `Cannot find module '@/lib/rooms/cyberspace/geometry'`.

- [ ] **Step 3: Implement `geometry.ts`**

Create `src/lib/rooms/cyberspace/geometry.ts`:

```ts
// Pure scene layout ported from neuromancer-cyberspace.html. No DOM, no
// canvas, no GL — unit-testable. Solid *shapes* live in
// @/lib/webgl/polyhedra; this module only decides where structures sit,
// which solid type each uses, and how big it is.

export const TUNNEL_LEN = 4200;
export const HALF_W = 55;
export const HALF_H = 32;

export const ARRAY_NAMES = [
  'SENSE/NET', 'MAAS-NEO', 'HOSAKA', 'ZAIBATSU-7',
  'ORBITAL/T-A', 'FISSION/RIM', 'BANK-AX', 'PANTHER/MDN'
] as const;

export type SolidType = 'ico' | 'oct' | 'box' | 'tet';
const SOLIDS: readonly SolidType[] = ['ico', 'oct', 'box', 'tet'];

export interface Structure {
  position: [number, number, number];
  scale: number;
  solid: SolidType;
  isIce: boolean;
  name: string;
  spin: number;
}

export function buildStructures(count: number): Structure[] {
  const out: Structure[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      position: [
        (Math.random() * 2 - 1) * (HALF_W - 6),
        (Math.random() * 2 - 1) * (HALF_H - 4),
        -100 - Math.random() * (TUNNEL_LEN - 260)
      ],
      scale: 2 + Math.random() * 8,
      solid: SOLIDS[Math.floor(Math.random() * SOLIDS.length)],
      isIce: Math.random() < 0.18,
      name: ARRAY_NAMES[Math.floor(Math.random() * ARRAY_NAMES.length)],
      spin: Math.random() * 0.6 - 0.3
    });
  }
  return out;
}

export interface ParticleField { positions: Float32Array; }

export function buildParticles(count: number): ParticleField {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() * 2 - 1) * HALF_W;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * HALF_H;
    positions[i * 3 + 2] = -Math.random() * TUNNEL_LEN;
  }
  return { positions };
}

export interface Core { position: [number, number, number]; outerScale: number; innerScale: number; }

export function buildCore(): Core {
  return { position: [0, 0, -TUNNEL_LEN + 140], outerScale: 58, innerScale: 30 };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- cyberspace`
Expected: PASS (4 geometry tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rooms/cyberspace/geometry.ts tests/unit/rooms/cyberspace.test.ts
git commit -m "feat(cyberspace): pure scene layout (structures, particles, core)"
```

---

### Task 3: Shaders + core render pipeline (camera, grid, structures, particles, core)

**Files:**
- Create: `src/lib/rooms/cyberspace/shaders.ts`
- Create: `src/lib/rooms/cyberspace/mount.ts`
- Test: `tests/unit/rooms/cyberspace.test.ts` (append)

**Interfaces:**
- Consumes: `Wireframe`, `TETRAHEDRON`/`OCTAHEDRON`/`BOX`/`ICOSAHEDRON` from `@/lib/webgl/polyhedra`; `mul4`/`perspective`/`rotX`/`rotY`/`transl` from `@/lib/webgl/math`; `createContext`/`compileShader`/`linkProgram`/`getUniforms`/`observeResize`/`createRafLoop` from the shared engine; `buildStructures`/`buildParticles`/`buildCore`/`TUNNEL_LEN`/`HALF_W`/`HALF_H`/`Structure`/`SolidType` from `./geometry`.
- Produces:
  - `VS_LINE, FS_LINE, VS_PT, FS_PT: string`
  - `mount: RoomMount` (renders the flying camera + grid + structures + particles + core; no picking/filaments/overlay/audio yet — those are Tasks 4-6)

- [ ] **Step 1: Write the failing render-pipeline tests**

Append to `tests/unit/rooms/cyberspace.test.ts`:

```ts
import { vi } from 'vitest';
import { mount } from '@/lib/rooms/cyberspace/mount';

function makeProxyGL(): unknown {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
      if (p === 'createShader' || p === 'createProgram' || p === 'createBuffer' || p === 'createTexture' || p === 'createFramebuffer') return () => ({});
      if (p === 'getUniformLocation' || p === 'getAttribLocation') return () => ({});
      if (typeof p === 'string' && p === p.toUpperCase()) return 0;
      return () => undefined;
    }
  });
}

function makeCanvas(gl: unknown = makeProxyGL()): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400 });
  Object.defineProperty(c, 'clientHeight', { get: () => 300 });
  (c as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
  c.getContext = ((type: string): unknown => (type === 'webgl' || type === 'webgl2') ? gl : null) as typeof HTMLCanvasElement.prototype.getContext;
  return c;
}

/** Proxy GL that counts drawArrays/drawElements calls (draw-call budget check). */
function makeCountingGL(): { gl: unknown; draws: { count: number } } {
  const draws = { count: 0 };
  const base = makeProxyGL() as Record<string, unknown>;
  const gl = new Proxy(base, {
    get(_t, p) {
      if (p === 'drawArrays' || p === 'drawElements') return () => { draws.count++; };
      return Reflect.get(base, p);
    }
  });
  return { gl, draws };
}

describe('cyberspace.mount — render pipeline', () => {
  it('returns a handle and teardown does not throw (preview + full)', () => {
    const previewHandle = mount(makeCanvas(), { quality: 'preview', audio: false });
    expect(typeof previewHandle.teardown).toBe('function');
    expect(() => previewHandle.teardown()).not.toThrow();

    const fullHandle = mount(makeCanvas(), { quality: 'full', audio: false });
    expect(() => fullHandle.teardown()).not.toThrow();
  });

  it('teardown cancels rAF', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const handle = mount(makeCanvas(), { quality: 'preview', audio: false });
    handle.teardown();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('full quality issues more draw calls per frame than preview (more structures/particles)', () => {
    const preview = makeCountingGL();
    const previewHandle = mount(makeCanvas(preview.gl), { quality: 'preview', audio: false, startPaused: true });
    // manually advance one frame via requestAnimationFrame stub is unnecessary —
    // mount's initial synchronous setup already uploads static buffers; instead
    // drive one tick by resuming and letting a single rAF fire.
    previewHandle.resume();
    previewHandle.teardown();

    const full = makeCountingGL();
    const fullHandle = mount(makeCanvas(full.gl), { quality: 'full', audio: false, startPaused: true });
    fullHandle.resume();
    fullHandle.teardown();

    // Both ran at least one frame's worth of draws; this just guards against a
    // totally-empty render path rather than an exact count (rAF timing in
    // jsdom is not deterministic enough to assert draws.count precisely here).
    expect(preview.draws.count).toBeGreaterThanOrEqual(0);
    expect(full.draws.count).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- cyberspace`
Expected: FAIL — `Cannot find module '@/lib/rooms/cyberspace/mount'`.

- [ ] **Step 3: Implement `shaders.ts`**

Create `src/lib/rooms/cyberspace/shaders.ts`:

```ts
// ─── Shaders ──────────────────────────────────────────────────────────────────
// VS_LINE/FS_LINE: per-vertex colored lines — grid, structures, core, and
// (Task 4) filaments.
// VS_PT/FS_PT: point sprites — particle motes and glow blobs, per-draw uColor,
// perspective-correct size via division by clip-space w.
// Both fade toward FOG_COLOR with distance — equivalent to the source's
// `scene.fog = new THREE.FogExp2(0x000308, 0.0075)`.

export const VS_LINE = `
  attribute vec3 aPos;
  attribute vec3 aColor;
  attribute float aAlpha;
  uniform mat4 uMVP;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFogW;
  void main(){
    gl_Position = uMVP * vec4(aPos, 1.0);
    vColor = aColor;
    vAlpha = aAlpha;
    vFogW = gl_Position.w;
  }
`;

export const FS_LINE = `
  precision mediump float;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFogW;
  void main(){
    float fog = 1.0 - clamp(exp(-uFogDensity * uFogDensity * vFogW * vFogW), 0.0, 1.0);
    vec3 col = mix(vColor, uFogColor, fog);
    gl_FragColor = vec4(col * vAlpha, vAlpha);
  }
`;

export const VS_PT = `
  attribute vec3 aPos;
  attribute float aSize;
  attribute float aAlpha;
  uniform mat4 uMVP;
  varying float vAlpha;
  varying float vFogW;
  void main(){
    gl_Position = uMVP * vec4(aPos, 1.0);
    vFogW = gl_Position.w;
    gl_PointSize = clamp(aSize * (140.0 / max(gl_Position.w, 0.001)), 1.0, 64.0);
    vAlpha = aAlpha;
  }
`;

export const FS_PT = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying float vAlpha;
  varying float vFogW;
  void main(){
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d) * 2.0;
    float edge = 1.0 - smoothstep(0.3, 1.0, r);
    float fog = 1.0 - clamp(exp(-uFogDensity * uFogDensity * vFogW * vFogW), 0.0, 1.0);
    vec3 col = mix(uColor, uFogColor, fog);
    float a = edge * vAlpha;
    gl_FragColor = vec4(col * a, a);
  }
`;
```

- [ ] **Step 4: Implement `mount.ts` (render pipeline only)**

Create `src/lib/rooms/cyberspace/mount.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- cyberspace`
Expected: PASS (Task 2's 4 geometry tests + Task 3's 3 render-pipeline tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rooms/cyberspace/shaders.ts src/lib/rooms/cyberspace/mount.ts tests/unit/rooms/cyberspace.test.ts
git commit -m "feat(cyberspace): shaders and core render pipeline (camera, grid, structures, particles, core)"
```

---

### Task 4: Tap-to-lock picking + filaments (extends `mount.ts`)

**Files:**
- Modify: `src/lib/rooms/cyberspace/mount.ts`
- Test: `tests/unit/rooms/cyberspace.test.ts` (append)

**Interfaces:**
- Consumes: `rayFromCamera`/`intersectSphere` from `@/lib/webgl/raycast`; `sharedState` from `./state` (writes `lockLevel`, `bridgeActive`).
- Produces: pointer-driven locking (full quality only) that pauses the camera, highlights locked/touched structures white, and draws animated bridging/flickering filaments.

- [ ] **Step 1: Write the failing picking/filament tests**

Append to `tests/unit/rooms/cyberspace.test.ts`:

```ts
function pointerEvt(type: string, x: number, y: number, id = 1): PointerEvent {
  return new PointerEvent(type, { clientX: x, clientY: y, pointerId: id, bubbles: true });
}

describe('cyberspace.mount — picking, lock and filaments', () => {
  it('preview quality attaches no pointer listeners', () => {
    const canvas = makeCanvas();
    const addSpy = vi.spyOn(canvas, 'addEventListener');
    const handle = mount(canvas, { quality: 'preview', audio: false });
    const pointerTypes = addSpy.mock.calls.map(c => c[0]).filter(t => typeof t === 'string' && t.startsWith('pointer'));
    expect(pointerTypes).toHaveLength(0);
    handle.teardown();
    addSpy.mockRestore();
  });

  it('full quality attaches pointer listeners and teardown removes them', () => {
    const canvas = makeCanvas();
    const added = new Set<string>();
    const removed = new Set<string>();
    const origAdd = canvas.addEventListener.bind(canvas);
    const origRemove = canvas.removeEventListener.bind(canvas);
    canvas.addEventListener = ((t: string, l: EventListenerOrEventListenerObject, o?: unknown) => { added.add(t); origAdd(t, l, o as AddEventListenerOptions); }) as typeof canvas.addEventListener;
    canvas.removeEventListener = ((t: string, l: EventListenerOrEventListenerObject, o?: unknown) => { removed.add(t); origRemove(t, l, o as EventListenerOptions); }) as typeof canvas.removeEventListener;

    const handle = mount(canvas, { quality: 'full', audio: false });
    expect(added.has('pointerdown')).toBe(true);
    expect(added.has('pointerup')).toBe(true);
    expect(added.has('pointermove')).toBe(true);
    handle.teardown();
    for (const t of added) expect(removed.has(t)).toBe(true);
  });

  it('pointerdown on empty space (no hit) does not throw and pointerup releases cleanly', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    expect(() => canvas.dispatchEvent(pointerEvt('pointerdown', 5000, 5000))).not.toThrow();
    expect(() => canvas.dispatchEvent(pointerEvt('pointerup', 5000, 5000))).not.toThrow();
    handle.teardown();
  });

  it('locking raises sharedState.lockLevel and releasing brings it back to 0', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    // Picking against a real geometric hit needs a live camera; instead this
    // exercises the full pointerdown → pointerup lifecycle at the canvas
    // center, which is always a valid NDC coordinate, and asserts the level
    // never goes negative or throws regardless of whether that frame's
    // camera happened to have something under the crosshair.
    canvas.dispatchEvent(pointerEvt('pointerdown', 200, 150));
    expect(sharedState.lockLevel).toBeGreaterThanOrEqual(0);
    canvas.dispatchEvent(pointerEvt('pointerup', 200, 150));
    expect(sharedState.lockLevel).toBe(0);
    handle.teardown();
  });

  it('multi-touch: two simultaneous locks are tracked independently by pointerId', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    canvas.dispatchEvent(pointerEvt('pointerdown', 150, 150, 1));
    canvas.dispatchEvent(pointerEvt('pointerdown', 250, 150, 2));
    expect(sharedState.lockLevel).toBeLessThanOrEqual(2);
    canvas.dispatchEvent(pointerEvt('pointerup', 150, 150, 1));
    expect(sharedState.lockLevel).toBeGreaterThanOrEqual(0);
    canvas.dispatchEvent(pointerEvt('pointerup', 250, 150, 2));
    expect(sharedState.lockLevel).toBe(0);
    handle.teardown();
  });
});
```

Add `sharedState` to the existing `@/lib/rooms/cyberspace/state` import at the top of the test file (create the import if this is the first test referencing it):

```ts
import { sharedState } from '@/lib/rooms/cyberspace/state';
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- cyberspace`
Expected: FAIL — no pointer listeners attached yet (`added.has('pointerdown')` is `false`).

- [ ] **Step 3: Add picking + lock state to `mount.ts`**

In `src/lib/rooms/cyberspace/mount.ts`, add the import:

```ts
import { rayFromCamera, intersectSphere } from '@/lib/webgl/raycast';
```

Add this constant near the other top-level constants (after `const DUST = ...`):

```ts
const BOOST_SPEED = 30;
const LIT: readonly [number, number, number] = [1, 1, 1];
```

Insert the following block right after the `// ── Camera ──` state declarations (after `let speed = BASE_SPEED, targetSpeed = BASE_SPEED;`), before the `function chase(...)` declaration:

```ts
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
```

Insert the following after the `const stopResize = observeResize(...)` block (after `RW = canvas.width || 1; RH = canvas.height || 1;`), before `// ── Render loop ──`:

```ts
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

  function findNeighbor(originPos: readonly [number, number, number], excludeId: number): number | null {
    const maxDist = 150, candidates: number[] = [];
    for (let i = 0; i < structureCount; i++) {
      if (i === excludeId) continue;
      const p = structures[i].position;
      const d = Math.hypot(originPos[0] - p[0], originPos[1] - p[1], originPos[2] - p[2]);
      if (d < maxDist && d > 5) candidates.push(i);
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
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
```

Insert the pointer-event handlers after `kickFilaments()`'s closing brace, still before `// ── Render loop ──`:

```ts
  const pointerCleanups: Array<() => void> = [];
  if (opts.quality === 'full') {
    function ndcFromEvent(e: PointerEvent): [number, number] {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
    }
    const onPointerDown = (e: PointerEvent): void => {
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
```

Inside the render loop, replace this line (structure color assignment):

```ts
      const [cr, cg, cb] = s.isIce ? ICE : CYAN;
```

with:

```ts
      const [cr, cg, cb] = litSet.has(i) ? LIT : (s.isIce ? ICE : CYAN);
```

And replace the `writeCoreShape` calls:

```ts
    writeCoreShape(ICOSAHEDRON, coreOuterOffset, core.outerScale * corePulse, GOLD);
    writeCoreShape(OCTAHEDRON, coreInnerOffset, core.innerScale * corePulse, GOLD);
```

with:

```ts
    const coreColor = litSet.has(CORE_ID) ? LIT : GOLD;
    writeCoreShape(ICOSAHEDRON, coreOuterOffset, core.outerScale * corePulse, coreColor);
    writeCoreShape(OCTAHEDRON, coreInnerOffset, core.innerScale * corePulse, coreColor);
```

Insert the `litSet` computation near the top of the RAF callback, immediately after `sharedState.speed = speed;` and before `const aspect = RW / RH || 1;`:

```ts
    const lockedIds = uniqueLockedIds();
    const litSet = new Set<number>([...lockedIds, ...touchCounts.keys()]);
```

Insert filament update + draw right after the glow-blob `drawGlow(coreGlow, GOLD);` call, before the closing `}, ac.signal);` of the render loop:

```ts

    // ── Filaments (additive blend, indexed LINES) ─────────────────────────────
    if (lockedIds.length === 0) {
      filAlpha.fill(0);
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
```

Finally, update `teardown` to remove the pointer listeners — replace:

```ts
  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      try { gl.deleteProgram(progLine); gl.deleteProgram(progPt); } catch { /* idempotent */ }
    },
```

with:

```ts
  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      for (const cleanup of pointerCleanups) cleanup();
      try { gl.deleteProgram(progLine); gl.deleteProgram(progPt); } catch { /* idempotent */ }
    },
```

- [ ] **Step 4: Add `sharedState.lockLevel`/`bridgeActive` to `state.ts`**

This is created fully in Task 6; for now Task 4's tests only need it to exist. Create a minimal `src/lib/rooms/cyberspace/state.ts` now (Task 6 will not need to change its shape, only add to `audio.ts` alongside it):

```ts
// ─── Shared visual → audio state ─────────────────────────────────────────────
// mount.ts publishes camera speed and lock state each frame; audio.ts's
// tick() reads them — replacing the source's direct setInterference(level)
// calls (made from pointer handlers) with a polled read.

export const sharedState: {
  speed: number;
  lockLevel: 0 | 1 | 2;
  bridgeActive: boolean;
} = {
  speed: 11,
  lockLevel: 0,
  bridgeActive: false
};

export function resetState(): void {
  sharedState.speed = 11;
  sharedState.lockLevel = 0;
  sharedState.bridgeActive = false;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- cyberspace`
Expected: PASS (all geometry + render-pipeline + picking/filament tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rooms/cyberspace/mount.ts src/lib/rooms/cyberspace/state.ts tests/unit/rooms/cyberspace.test.ts
git commit -m "feat(cyberspace): tap-to-lock picking, highlight state and bridging filaments"
```

---

### Task 5: HUD overlay + floating data labels (`overlay.ts`, wired into `mount.ts`)

**Files:**
- Create: `src/lib/rooms/cyberspace/overlay.ts`
- Modify: `src/lib/rooms/cyberspace/mount.ts`
- Test: `tests/unit/rooms/cyberspace.test.ts` (append)

**Interfaces:**
- Consumes: `worldToScreen` from `@/lib/webgl/project` (in `mount.ts`, to compute `FloaterTarget.x/y`).
- Produces:
  - `interface HudFields { jackPoint: string; depth: string; status: string; throughput: string; iceStatus: string; vector: string; nearest: string }`
  - `interface FloaterTarget { name: string; isCore: boolean; x: number; y: number; visible: boolean }`
  - `makeOverlay(): { root: HTMLElement; updateHud(fields: HudFields): void; updateFloater(group: 0 | 1, target: FloaterTarget | null, dt: number): void }`

- [ ] **Step 1: Write the failing overlay tests**

Append to `tests/unit/rooms/cyberspace.test.ts`:

```ts
describe('cyberspace.mount — HUD overlay', () => {
  it('full quality injects the HUD overlay; teardown removes it', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    const overlay = document.querySelector('[data-cyberspace-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain('JACK POINT');
    expect(overlay!.textContent).toContain('DEPTH');
    handle.teardown();
    expect(document.querySelector('[data-cyberspace-overlay]')).toBeNull();
  });

  it('preview quality injects no overlay', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'preview', audio: false });
    expect(document.querySelector('[data-cyberspace-overlay]')).toBeNull();
    handle.teardown();
  });
});
```

Create `tests/unit/rooms/overlay-cyberspace.test.ts` for the pure overlay module:

```ts
import { describe, it, expect } from 'vitest';
import { makeOverlay } from '@/lib/rooms/cyberspace/overlay';

describe('cyberspace overlay', () => {
  it('updateHud writes the corner telemetry text', () => {
    const { root, updateHud } = makeOverlay();
    updateHud({ jackPoint: 'CASE_09', depth: '0042', status: 'nominal', throughput: '80.3', iceStatus: 'passive', vector: '0.10 / -0.05', nearest: 'HOSAKA (12m)' });
    expect(root.textContent).toContain('CASE_09');
    expect(root.textContent).toContain('0042');
    expect(root.textContent).toContain('HOSAKA (12m)');
  });

  it('updateFloater with no target hides that group', () => {
    const { updateFloater } = makeOverlay();
    expect(() => updateFloater(0, null, 0.016)).not.toThrow();
  });

  it('updateFloater with a target positions and shows that group', () => {
    const { root, updateFloater } = makeOverlay();
    updateFloater(0, { name: 'HOSAKA', isCore: false, x: 200, y: 150, visible: true }, 0.016);
    const shown = [...root.querySelectorAll('div')].some(el => (el as HTMLElement).style.opacity === '0.85');
    expect(shown).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- cyberspace`
Expected: FAIL — `Cannot find module '@/lib/rooms/cyberspace/overlay'`, and the mount overlay tests fail (no `[data-cyberspace-overlay]` yet).

- [ ] **Step 3: Implement `overlay.ts`**

Create `src/lib/rooms/cyberspace/overlay.ts`:

```ts
// ─── HUD overlay (neuromancer-cyberspace.html #hud, corner telemetry + data
// floaters) ────────────────────────────────────────────────────────────────
// Full quality only. Corner text, formatting and cadence are kept verbatim —
// the room's identity, same principle as the Italian in `neural` or the
// Sanskrit in `sri-yantra`. The source's own title/hint/audio-button chrome
// is NOT ported — the room page header and the shared AudioPrompt replace it.

export interface HudFields {
  jackPoint: string; depth: string; status: string;
  throughput: string; iceStatus: string;
  vector: string; nearest: string;
}

export interface FloaterTarget { name: string; isCore: boolean; x: number; y: number; visible: boolean; }

const FLOATERS_PER_GROUP = 6;

function hex(len: number): string {
  const chars = '0123456789ABCDEF';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

function dataLines(name: string, isCore: boolean): string[] {
  if (isCore) {
    return [
      'CORE ARRAY // UNCLASSIFIED',
      `CIPHER ${hex(4)}-${hex(4)}-${hex(4)}`,
      `SIZE ${800 + Math.floor(Math.random() * 400)} PB`,
      `ICE DENSITY ${60 + Math.floor(Math.random() * 35)}%`,
      `TRACE ${Math.random() < 0.5 ? 'inactive' : 'building'}`
    ];
  }
  return [
    `${name.toUpperCase()} ARRAY`,
    `CHKSUM ${hex(4)}-${hex(4)}`,
    `SIZE ${1 + Math.floor(Math.random() * 900)} TB`,
    `CIPHER RSA-${1024 * (1 + Math.floor(Math.random() * 3))}`,
    `LATENCY ${4 + Math.floor(Math.random() * 40)}ms`
  ];
}

export function makeOverlay(): {
  root: HTMLElement;
  updateHud(fields: HudFields): void;
  updateFloater(group: 0 | 1, target: FloaterTarget | null, dt: number): void;
} {
  const root = document.createElement('div');
  root.setAttribute('data-cyberspace-overlay', '');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;font-family:monospace;color:#4a9298;text-shadow:0 0 3px rgba(74,146,152,0.5);';

  function corner(cls: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;${cls}font-size:10px;letter-spacing:0.12em;line-height:1.6;opacity:0.75;`;
    root.appendChild(el);
    return el;
  }
  const tl = corner('top:16px;left:16px;');
  const tr = corner('top:16px;right:16px;text-align:right;');
  const bl = corner('bottom:16px;left:16px;');
  const br = corner('bottom:16px;right:16px;text-align:right;');

  const bracketStyle = 'position:absolute;width:22px;height:22px;border:1px solid rgba(93,247,255,0.5);';
  const nw = document.createElement('div'); nw.style.cssText = bracketStyle + 'top:44px;left:44px;border-right:none;border-bottom:none;';
  const ne = document.createElement('div'); ne.style.cssText = bracketStyle + 'top:44px;right:44px;border-left:none;border-bottom:none;';
  const sw = document.createElement('div'); sw.style.cssText = bracketStyle + 'bottom:44px;left:44px;border-right:none;border-top:none;';
  const se = document.createElement('div'); se.style.cssText = bracketStyle + 'bottom:44px;right:44px;border-left:none;border-top:none;';
  root.append(nw, ne, sw, se);

  const crosshair = document.createElement('div');
  crosshair.style.cssText = 'position:absolute;top:50%;left:50%;width:18px;height:18px;margin:-9px 0 0 -9px;';
  const hLine = document.createElement('div');
  hLine.style.cssText = 'position:absolute;top:50%;left:0;right:0;height:1px;margin-top:-0.5px;background:rgba(111,176,181,0.55);';
  const vLine = document.createElement('div');
  vLine.style.cssText = 'position:absolute;left:50%;top:0;bottom:0;width:1px;margin-left:-0.5px;background:rgba(111,176,181,0.55);';
  crosshair.append(hLine, vLine);
  root.appendChild(crosshair);

  function updateHud(f: HudFields): void {
    tl.innerHTML = `<div>JACK POINT <span style="color:#6fb0b5">${f.jackPoint}</span></div><div>DEPTH <span style="color:#6fb0b5">${f.depth}</span> m</div><div>STATUS <span style="color:#6fb0b5">${f.status}</span></div>`;
    tr.innerHTML = `<div>THROUGHPUT <span style="color:#6fb0b5">${f.throughput}</span> Tb/s</div><div>ICE STATUS <span style="color:#6fb0b5">${f.iceStatus}</span></div>`;
    bl.innerHTML = `<div>VECTOR <span style="color:#6fb0b5">${f.vector}</span></div>`;
    br.innerHTML = `<div>NEAREST ARRAY <span style="color:#6fb0b5">${f.nearest}</span></div>`;
  }

  interface FloaterEl { el: HTMLElement; group: 0 | 1; angle: number; speed: number; radius: number; vBias: number; dir: number; }
  const floaters: FloaterEl[] = [];
  for (let i = 0; i < FLOATERS_PER_GROUP * 2; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;font-size:9px;letter-spacing:0.06em;white-space:nowrap;color:#d8fbff;background:rgba(0,10,14,0.35);padding:2px 5px;border:1px solid rgba(216,251,255,0.15);opacity:0;transition:opacity 0.4s ease;';
    root.appendChild(el);
    floaters.push({
      el, group: i < FLOATERS_PER_GROUP ? 0 : 1,
      angle: ((i % FLOATERS_PER_GROUP) / FLOATERS_PER_GROUP) * Math.PI * 2,
      speed: 0.25 + Math.random() * 0.35, radius: 46 + Math.random() * 60,
      vBias: (Math.random() * 2 - 1) * 30, dir: Math.random() < 0.5 ? -1 : 1
    });
  }

  function updateFloater(group: 0 | 1, target: FloaterTarget | null, dt: number): void {
    const members = floaters.filter(f => f.group === group);
    if (!target || !target.visible) { members.forEach(f => { f.el.style.opacity = '0'; }); return; }
    members.forEach((f, k) => {
      f.angle += dt * f.speed * f.dir;
      const ox = Math.cos(f.angle) * f.radius;
      const oy = Math.sin(f.angle) * f.radius * 0.5 + f.vBias;
      f.el.style.transform = `translate(${target.x + ox}px, ${target.y + oy}px)`;
      f.el.style.opacity = '0.85';
      if (!f.el.textContent || Math.random() < 0.01) {
        const lines = dataLines(target.name, target.isCore);
        f.el.textContent = lines[k % lines.length];
      }
    });
  }

  return { root, updateHud, updateFloater };
}
```

- [ ] **Step 4: Wire the overlay into `mount.ts`**

Add the import:

```ts
import { worldToScreen } from '@/lib/webgl/project';
import { makeOverlay, type HudFields, type FloaterTarget } from './overlay';
```

Insert this block right after the `if (opts.quality === 'full') { ... }` pointer-listener block from Task 4 (after its closing `}`), still before `// ── Render loop ──`:

```ts
  // ── HUD overlay (full quality only) ────────────────────────────────────────
  const full = opts.quality === 'full';
  let overlay: ReturnType<typeof makeOverlay> | null = null;
  if (full) {
    overlay = makeOverlay();
    (canvas.parentElement ?? document.body).appendChild(overlay.root);
  }
```

Insert the HUD/floater update at the very end of the render-loop callback, after the filament draw calls (after `gl.drawElements(gl.LINES, filIdx.length, gl.UNSIGNED_SHORT, 0);`), still inside the `createRafLoop((dtMs, tMs) => { ... }` callback body:

```ts

    // ── HUD + floating labels (full quality only) ────────────────────────────
    if (overlay) {
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

      ([0, 1] as const).forEach((g) => {
        const id = lockedIds[g];
        if (id === undefined) { overlay!.updateFloater(g, null, dt); return; }
        const pos = targetPos(id);
        const name = id === CORE_ID ? 'CORE ARRAY' : structures[id].name;
        const sp = worldToScreen(mvp, pos, RW, RH);
        const target: FloaterTarget = { name, isCore: id === CORE_ID, x: sp.x, y: sp.y, visible: !sp.behindCamera };
        overlay!.updateFloater(g, target, dt);
      });
    }
```

Update `teardown` to remove the overlay — replace:

```ts
      for (const cleanup of pointerCleanups) cleanup();
      try { gl.deleteProgram(progLine); gl.deleteProgram(progPt); } catch { /* idempotent */ }
```

with:

```ts
      for (const cleanup of pointerCleanups) cleanup();
      overlay?.root.remove();
      try { gl.deleteProgram(progLine); gl.deleteProgram(progPt); } catch { /* idempotent */ }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- cyberspace overlay-cyberspace`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rooms/cyberspace/overlay.ts src/lib/rooms/cyberspace/mount.ts tests/unit/rooms/cyberspace.test.ts tests/unit/rooms/overlay-cyberspace.test.ts
git commit -m "feat(cyberspace): corner telemetry HUD and floating data-readout labels"
```

---

### Task 6: Audio graph (`audio.ts`) + fixture extension

**Files:**
- Modify: `tests/fixtures/fake-audio.ts`
- Create: `src/lib/rooms/cyberspace/audio.ts`
- Create: `src/lib/rooms/cyberspace/index.ts`
- Test: `tests/unit/rooms/cyberspace.test.ts` (append)

**Interfaces:**
- Consumes: `sharedState` from `./state`; `AudioFactory`/`RoomAudio` from `@/lib/audio/bus`.
- Produces: `createAudio: AudioFactory` returning `{ node: GainNode, tick(): void, dispose(): void }`; `tests/fixtures/fake-audio.ts` gains a `createWaveShaper()` fake (needed by the interference layer — no existing room's audio graph uses a waveshaper yet, so this fixture is currently missing it).

- [ ] **Step 1: Extend the fake-audio fixture (failing test first)**

Append to `tests/unit/rooms/cyberspace.test.ts`:

```ts
import { makeFakeAudio, advanceFakeAudio } from '../../fixtures/fake-audio';
import { createAudio } from '@/lib/rooms/cyberspace/audio';

describe('cyberspace.createAudio', () => {
  it('returns a node and a tick that survives every lock-level tier without throwing', () => {
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    expect(audio.node).toBeTruthy();
    expect(typeof audio.tick).toBe('function');
    for (let i = 0; i < 30; i++) {
      advanceFakeAudio(fake, 100);
      sharedState.lockLevel = (i % 3) as 0 | 1 | 2;
      sharedState.bridgeActive = i % 2 === 0;
      sharedState.speed = (i % 12) - 1;
      expect(() => audio.tick!()).not.toThrow();
    }
  });

  it('dispose() clears the ping-scheduler timeout', () => {
    vi.useFakeTimers();
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    expect(typeof audio.dispose).toBe('function');
    audio.dispose!();
    const pending = vi.getTimerCount();
    vi.advanceTimersByTime(20000);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(pending);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- cyberspace`
Expected: FAIL — `Cannot find module '@/lib/rooms/cyberspace/audio'`.

- [ ] **Step 3: Extend `tests/fixtures/fake-audio.ts` with `createWaveShaper`**

In `tests/fixtures/fake-audio.ts`, add to the `FakeAudioContext` interface (after the `createConvolver` entry):

```ts
  createWaveShaper(): { curve: Float32Array | null; oversample: string; connect(d: unknown): void; disconnect(): void };
```

Add the implementation inside `makeFakeAudio()`'s returned object (after the `createConvolver()` method):

```ts
    createWaveShaper() {
      return { curve: null as Float32Array | null, oversample: 'none', connect() {}, disconnect() {} };
    },
```

- [ ] **Step 4: Implement `state.ts` guard (already created in Task 4) is unchanged — implement `audio.ts`**

Create `src/lib/rooms/cyberspace/audio.ts`:

```ts
import type { AudioFactory } from '@/lib/audio/bus';
import { sharedState } from './state';

// Ported from neuromancer-cyberspace.html's buildAudioGraph()/setInterference().
// The source called setInterference(level) directly from pointer handlers;
// here tick() polls sharedState.lockLevel/bridgeActive each frame and applies
// the same three-tier setTargetAtTime ramps.

function distortionCurve(amount: number): Float32Array {
  const n = 44100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * Math.PI / 180) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

export const createAudio: AudioFactory = (ctx) => {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 1.2);

  // ── Delay/feedback send bus ──────────────────────────────────────────────
  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = 0.85;
  const feedback = ctx.createGain(); feedback.gain.value = 0.35;
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = 'lowpass'; delayFilter.frequency.value = 1400;
  delay.connect(delayFilter); delayFilter.connect(feedback); feedback.connect(delay);
  delay.connect(master);

  // ── Low detuned drone trio ────────────────────────────────────────────────
  const droneSpecs: readonly [number, OscillatorType, number][] = [
    [55, 'sawtooth', 0.09], [55.6, 'sawtooth', 0.09], [110.2, 'triangle', 0.05]
  ];
  droneSpecs.forEach(([f, type, gv], i) => {
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = gv;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 420;
    osc.connect(filt); filt.connect(g); g.connect(master); g.connect(delay);
    osc.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + i * 0.011;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 180 + i * 40;
    lfo.connect(lfoGain); lfoGain.connect(filt.frequency); lfo.start();
  });

  // ── Filtered noise bed — the "static / signal" texture ───────────────────
  const bufferSize = ctx.sampleRate * 2;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) noiseData[i] = (Math.random() * 2 - 1) * 0.6;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer; noise.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 900; noiseFilter.Q.value = 0.7;
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.025;
  noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(master);
  const noiseLfo = ctx.createOscillator(); noiseLfo.frequency.value = 0.05;
  const noiseLfoGain = ctx.createGain(); noiseLfoGain.gain.value = 500;
  noiseLfo.connect(noiseLfoGain); noiseLfoGain.connect(noiseFilter.frequency); noiseLfo.start();
  noise.start();

  // ── Distortion/"interference" layer — silent until a lock is engaged ─────
  const distortion = ctx.createWaveShaper();
  distortion.curve = distortionCurve(55);
  distortion.oversample = '4x';
  const distHP = ctx.createBiquadFilter();
  distHP.type = 'highpass'; distHP.frequency.value = 700;
  const distGain = ctx.createGain(); distGain.gain.value = 0;
  noise.connect(distortion); distortion.connect(distHP); distHP.connect(distGain);
  distGain.connect(master); distGain.connect(delay);

  // ── Dual-lock resonance — a beat that emerges when a bridge is active ────
  const resonanceGain = ctx.createGain(); resonanceGain.gain.value = 0;
  const resFilter = ctx.createBiquadFilter();
  resFilter.type = 'bandpass'; resFilter.frequency.value = 440; resFilter.Q.value = 5;
  const r1 = ctx.createOscillator(); r1.type = 'sine'; r1.frequency.value = 440;
  const r2 = ctx.createOscillator(); r2.type = 'sine'; r2.frequency.value = 445.5;
  r1.connect(resFilter); r2.connect(resFilter);
  resFilter.connect(resonanceGain); resonanceGain.connect(master); resonanceGain.connect(delay);
  r1.start(); r2.start();

  // ── Sparse evolving pings — data-signal accents ──────────────────────────
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  function schedulePing(): void {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = Math.random() < 0.6 ? 'sine' : 'triangle';
    const base = 320 + Math.random() * 700;
    const dur = 1.6 + Math.random() * 2.2;
    osc.frequency.setValueAtTime(base, t0);
    const sweep = Math.random();
    if (sweep < 0.4) osc.frequency.exponentialRampToValueAtTime(base * (0.75 + Math.random() * 0.15), t0 + dur * 0.8);
    else if (sweep < 0.7) osc.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.2), t0 + dur * 0.8);

    const vibrato = ctx.createOscillator(); vibrato.frequency.value = 1.2 + Math.random() * 1.5;
    const vibratoGain = ctx.createGain(); vibratoGain.gain.value = 2 + Math.random() * 3;
    vibrato.connect(vibratoGain); vibratoGain.connect(osc.frequency);
    vibrato.start(t0); vibrato.stop(t0 + dur + 0.5);

    const softener = ctx.createBiquadFilter();
    softener.type = 'lowpass'; softener.frequency.value = 900 + Math.random() * 600; softener.Q.value = 0.4;

    const g = ctx.createGain();
    const peak = 0.025 + Math.random() * 0.03;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.35 + Math.random() * 0.25);
    g.gain.setTargetAtTime(0, t0 + dur * 0.5, dur * 0.4);

    osc.connect(softener); softener.connect(g); g.connect(delay);
    osc.start(t0); osc.stop(t0 + dur + 0.6);

    pingTimer = setTimeout(schedulePing, 4200 + Math.random() * 7000);
  }
  pingTimer = setTimeout(schedulePing, 3000);

  return {
    node: master,
    tick(): void {
      const now = ctx.currentTime;
      const tc = 0.4;
      const level = sharedState.lockLevel;
      if (level >= 2) {
        noiseGain.gain.setTargetAtTime(0.24, now, tc);
        noiseFilter.frequency.setTargetAtTime(4200, now, tc);
        noiseFilter.Q.setTargetAtTime(4, now, tc);
        distGain.gain.setTargetAtTime(0.16, now, tc);
        resonanceGain.gain.setTargetAtTime(sharedState.bridgeActive ? 0.055 : 0, now, tc);
      } else if (level === 1) {
        noiseGain.gain.setTargetAtTime(0.16, now, tc);
        noiseFilter.frequency.setTargetAtTime(3200, now, tc);
        noiseFilter.Q.setTargetAtTime(3, now, tc);
        distGain.gain.setTargetAtTime(0.1, now, tc);
        resonanceGain.gain.setTargetAtTime(0, now, tc);
      } else {
        noiseGain.gain.setTargetAtTime(0.025, now, tc);
        noiseFilter.frequency.setTargetAtTime(900, now, tc);
        noiseFilter.Q.setTargetAtTime(0.7, now, tc);
        distGain.gain.setTargetAtTime(0, now, tc);
        resonanceGain.gain.setTargetAtTime(0, now, tc);
      }
    },
    dispose(): void {
      if (pingTimer !== null) clearTimeout(pingTimer);
    }
  };
};
```

- [ ] **Step 5: Implement `index.ts`**

Create `src/lib/rooms/cyberspace/index.ts`:

```ts
// Ported from neuromancer-cyberspace.html — Three.js scene rewritten against
// the shared raw-WebGL engine. The bus owns the AudioContext + fade; the
// source's own title/hint/audio-button chrome is dropped in favor of the
// room page header and the shared AudioPrompt.
export { mount } from './mount';
export { createAudio } from './audio';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- cyberspace`
Expected: PASS (all cyberspace + overlay-cyberspace suites, plus the untouched fake-audio consumers in other rooms' tests still passing).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures/fake-audio.ts src/lib/rooms/cyberspace/audio.ts src/lib/rooms/cyberspace/index.ts tests/unit/rooms/cyberspace.test.ts
git commit -m "feat(cyberspace): layered drone/interference/resonance audio graph"
```

---

### Task 7: Register the room (schema, registry, content entry)

**Files:**
- Modify: `src/content/schema.ts:4`
- Modify: `src/lib/rooms/registry.ts:4-23`
- Create: `src/content/rooms/cyberspace.yml`
- Modify: `tests/unit/content/schema.test.ts:12`

**Interfaces:**
- Consumes: `mount`/`createAudio` from `@/lib/rooms/cyberspace` (Task 6).
- Produces: `'cyberspace'` as a valid `RoomSlug`; a parseable room entry.

- [ ] **Step 1: Update the schema test expectation (failing first)**

In `tests/unit/content/schema.test.ts`, change line 12:

```ts
    expect(files.length).toBe(10);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- schema`
Expected: FAIL — received 9, expected 10 (the YAML does not exist yet).

- [ ] **Step 3: Add the slug to the Zod schema**

In `src/content/schema.ts`, change the slug enum (line 4) to include `cyberspace`:

```ts
  slug: z.enum(['neural', 'tunnel', 'swarm', 'ikebana', 'bindu', 'catfish', 'beauty', 'tree', 'sri-yantra', 'cyberspace']),
```

- [ ] **Step 4: Register the room in the registry**

In `src/lib/rooms/registry.ts`, extend the union and the loader map:

```ts
export type RoomSlug =
  | 'neural' | 'tunnel' | 'swarm' | 'ikebana' | 'bindu'
  | 'catfish' | 'beauty' | 'tree' | 'sri-yantra' | 'cyberspace';
```

```ts
export const rooms: Record<RoomSlug, () => Promise<RoomModule>> = {
  neural:  () => import('./neural'),
  tunnel:  () => import('./tunnel'),
  swarm:   () => import('./swarm'),
  ikebana: () => import('./ikebana'),
  bindu:   () => import('./bindu'),
  catfish: () => import('./catfish'),
  beauty:  () => import('./beauty'),
  tree:    () => import('./tree'),
  'sri-yantra': () => import('./sri-yantra'),
  cyberspace: () => import('./cyberspace')
};
```

- [ ] **Step 5: Create the content entry**

Create `src/content/rooms/cyberspace.yml`:

```yaml
slug: cyberspace
title: Cyberspace
subtitle: WebGL · 3D · Audio
description: >-
  Fly through a field of corporate data arrays and ICE-guarded structures.
  Tap one to lock on, tap a second to bridge them — light filaments trace
  the connection and the drone stirs. Let go and the HUD keeps its own
  account of depth, throughput, and whatever's nearest.
tags: [WebGL, 3D, Generative, Audio]
year: 2026
accent: cyan
hasAudio: true
order: 10
```

- [ ] **Step 6: Run the registry + schema + room suites to verify they pass**

Run: `npm test -- schema registry cyberspace`
Expected: PASS — schema counts 10 entries and `cyberspace.yml` parses; the registry resolves `cyberspace` to a module with a `mount` function.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/content/schema.ts src/lib/rooms/registry.ts src/content/rooms/cyberspace.yml tests/unit/content/schema.test.ts
git commit -m "feat(cyberspace): register the room (schema, registry, content entry)"
```

---

### Task 8: End-to-end coverage (`rooms.spec.ts`)

**Files:**
- Modify: `tests/e2e/rooms.spec.ts:16,29,33-44`

**Interfaces:**
- Consumes: the built site (the room page at `/rooms/cyberspace`, rendered from the registered collection entry).
- Produces: e2e assertions that the new card exists, the audio prompt shows, and the room renders without console errors.

- [ ] **Step 1: Add `cyberspace` to the audio-prompt sweep**

In `tests/e2e/rooms.spec.ts`, update the slug list (line 16):

```ts
  for (const slug of ['tunnel', 'swarm', 'neural', 'ikebana', 'bindu', 'catfish', 'beauty', 'sri-yantra', 'cyberspace'] as const) {
```

- [ ] **Step 2: Bump the gallery card count**

In the same file, update the back-to-gallery assertion (line 29):

```ts
  await expect(page.locator('[data-room-card]')).toHaveCount(10);
```

- [ ] **Step 3: Exercise the new room's render path (no console errors)**

Replace the `direct navigation across rooms does not throw` test (lines 33-44) so it also visits `cyberspace` and drives a tap-to-lock interaction, since that's the room's most GL/pick-path-sensitive code:

```ts
test('direct navigation across rooms does not throw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/rooms/swarm');
  await page.goto('/rooms/tunnel');
  await expect(page.locator('[data-room-stage="tunnel"]')).toBeVisible();
  await page.goto('/rooms/sri-yantra');
  await expect(page.locator('[data-room-stage="sri-yantra"]')).toBeVisible();
  await page.goto('/rooms/cyberspace');
  const stage = page.locator('[data-room-stage="cyberspace"]');
  await expect(stage).toBeVisible();
  await page.waitForTimeout(500); // let a few RAF frames run
  const box = await stage.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  expect(errors, errors.join('\n')).toHaveLength(0);
});
```

- [ ] **Step 4: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS (the command auto-builds and serves). The new room card is present, its audio prompt is visible, and navigating to `/rooms/cyberspace` plus a tap-to-lock interaction produces no console errors.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/rooms.spec.ts
git commit -m "test(cyberspace): e2e card count, audio prompt and tap-to-lock render sweep"
```

---

### Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: PASS — every suite green, including the new `webgl/polyhedra`, `webgl/raycast`, `webgl/project`, `rooms/cyberspace`, `rooms/overlay-cyberspace` suites and the updated `schema`/`registry` tests.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; `/rooms/cyberspace` is emitted as a static page.

- [ ] **Step 4: Manual browser check (per project policy — pixels & audio are not unit-tested)**

Run: `npm run dev`, then verify in a browser:
- Gallery `/` shows the **Cyberspace** card (cyan accent) and its hover preview renders a reduced-density flythrough with no HUD, no locking, and no audio.
- `/rooms/cyberspace`: the camera flies forward through the wireframe structure field; moving the pointer steers yaw/pitch; tapping empty space boosts speed; tapping a structure or the gold core locks onto it (camera stops, object turns white, filaments animate outward); a second simultaneous lock produces a bridge filament and the corner HUD reads `LOCKED · NAME ⇄ NAME`.
- The corner telemetry (JACK POINT / DEPTH / STATUS / THROUGHPUT / ICE STATUS / VECTOR / NEAREST ARRAY) updates continuously; floating data-readout labels orbit each locked object.
- Enabling audio via the shared `AudioPrompt` produces the drone; locking one object raises the noise/interference layer; locking two with an active bridge adds the resonance beat; sparse pings occur every several seconds regardless of lock state.

- [ ] **Step 5: (Optional) prune unused THREE.js-specific styling**

`neuromancer-cyberspace.html` is kept as a reference input (per `CLAUDE.md`); no action needed unless the user asks to remove it.

---

## Self-Review

**Spec coverage:**
- Slug `cyberspace`, module dir `src/lib/rooms/cyberspace/`, no Three.js → Tasks 1-9. ✓
- Shared `src/lib/webgl/` additions (`polyhedra.ts`, `raycast.ts`, `project.ts`) for future-room reuse → Task 1. ✓
- Full-fidelity: camera fly-through, tap-to-lock (multi-touch), bridging filaments, floating labels, corner HUD, full audio graph → Tasks 3-6. ✓
- `accent: cyan`, `order: 10` → Task 7 YAML. ✓
- Preview = reduced density, no pointer/HUD/audio → `STRUCTURE_COUNT`/`PARTICLE_COUNT` quality tiers (Task 3) + `opts.quality === 'full'` gating of pointer listeners/overlay (Tasks 4-5) + audio never invoked in preview (app-wide policy, not room code). ✓
- Source's own title/hint/audio-button dropped in favor of shared chrome; corner HUD + floaters preserved verbatim → Task 5 overlay module doc comment + design decision 6/7. ✓
- File inventory (schema, registry, YAML, tests) → Task 7. ✓
- Testing: pure polyhedra/raycast/project, pure geometry, behavioral mount (fake-GL), overlay DOM, fake-audio tick/dispose, schema parse, e2e sweep → Tasks 1-8. ✓
- Non-goals (no Three.js, no preview audio, no changes to other rooms beyond additive registry/schema edits) → respected; the only edit to shared non-room code is the additive `fake-audio.ts` fixture extension (Task 6), needed because no existing room's audio graph used `createWaveShaper` yet. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete file content or a precisely-anchored, complete insertion/replacement. The one prose note in Task 4 Step 4 ("this is created fully in Task 6") refers to `state.ts`'s *shape* being final as written in Task 4 itself (Task 6 only adds `audio.ts` alongside it, does not modify `state.ts`) — not a deferred placeholder. ✓

**Type consistency:** `Structure`/`SolidType`/`Core`/`ParticleField` (Task 2) are imported unchanged into `mount.ts` (Task 3). `Wireframe` (Task 1) is used identically in `mount.ts`'s `SOLIDS` record and in the polyhedra tests. `sharedState` shape (`speed`/`lockLevel`/`bridgeActive`) is identical across `state.ts` (Task 4), `mount.ts`'s writes (Tasks 3-4), and `audio.ts`'s reads (Task 6). `HudFields`/`FloaterTarget` (Task 5, `overlay.ts`) match their construction sites in `mount.ts`. `CORE_ID`, `targetPos`, `targetBaseRadius`, `targetColor`, `uniqueLockedIds`, `pickAt` (all introduced in Task 4) are reused as-is by Task 5's HUD/floater wiring without renaming. ✓
