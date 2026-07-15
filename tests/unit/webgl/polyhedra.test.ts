import { describe, it, expect } from 'vitest';
import { TETRAHEDRON, OCTAHEDRON, BOX, ICOSAHEDRON, type Wireframe } from '@/lib/webgl/polyhedra';

function vertexCount(wf: Wireframe): number { return wf.positions.length / 3; }
function edgeCount(wf: Wireframe): number { return wf.edges.length / 2; }

function assertUnitRadius(wf: Wireframe): void {
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
