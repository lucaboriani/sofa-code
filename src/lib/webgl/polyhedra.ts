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
