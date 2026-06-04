import { type Vec3, v3, add, sub, scl, vlen, norm, rnd, rndDir } from './math';

// ─── Geometry builder ────────────────────────────────────────────────────────

export interface Edge {
  a: number;
  b: number;
  mainPts: Vec3[];
  laterals: Vec3[][];
}

/** A spike travelling along an edge path (main dendrite or lateral). */
export interface Impulse {
  pts: Vec3[];
  segStart: number | null;
  segCount: number | null;
  isLateral: boolean;
  t: number;
  speed: number;
  tail: number;
  bright: number;
}

export function buildPath(start: Vec3, end: Vec3, depth: number): Vec3[] {
  function subdivide(arr: Vec3[], d: number): Vec3[] {
    if (d === 0) return arr;
    const out: Vec3[] = [arr[0]];
    for (let i = 0; i < arr.length - 1; i++) {
      const mid = add(scl(add(arr[i], arr[i + 1]), 0.5), scl(rndDir(), 0.07 * d));
      out.push(mid, arr[i + 1]);
    }
    return subdivide(out, d - 1);
  }
  return subdivide([start, end], depth);
}

export function buildGeometry(neuronCount: number): {
  posArr: number[];
  segEdge: number[];
  edgeMainSegStart: number[];
  edgeMainSegCount: number[];
  edges: Edge[];
  nodes: Array<{ pos: Vec3 }>;
  somaPosF: Float32Array;
  somaSzF: Float32Array;
} {
  const N = Math.min(neuronCount, 18); // Cap soma count; edge density scales naturally
  const nodes: Array<{ pos: Vec3 }> = [];

  for (let i = 0; i < N; i++) {
    const th = rnd(0, Math.PI * 2), ph = Math.acos(rnd(-0.9, 0.9)), r = rnd(0.5, 1.1);
    nodes.push({
      pos: v3(
        r * Math.sin(ph) * Math.cos(th) * 1.8,
        r * Math.sin(ph) * Math.sin(th) * 1.2,
        r * Math.cos(ph) * 1.5
      )
    });
  }

  const edges: Edge[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const d = vlen(sub(nodes[j].pos, nodes[i].pos));
      if (d < 1.7 && Math.random() < 0.6) {
        const mainPts = buildPath(nodes[i].pos, nodes[j].pos, 3);
        const laterals: Vec3[][] = [];
        for (let k = 1; k < mainPts.length - 1; k++) {
          if (Math.random() < 0.22) {
            const dir = norm(add(rndDir(), scl(norm(sub(mainPts[k + 1], mainPts[k - 1])), -0.5)));
            const endPt = add(mainPts[k], scl(dir, rnd(0.1, 0.28)));
            laterals.push(buildPath(mainPts[k], endPt, 2));
          }
        }
        edges.push({ a: i, b: j, mainPts, laterals });
      }
    }
  }

  const posArr: number[] = [];
  const segEdge: number[] = [];
  const edgeMainSegStart: number[] = [];
  const edgeMainSegCount: number[] = [];

  function addPath(pts: Vec3[], edgeIdx: number): number {
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      posArr.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      segEdge.push(edgeIdx);
    }
    return pts.length - 1;
  }

  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    const start = segEdge.length;
    const cnt = addPath(e.mainPts, ei);
    edgeMainSegStart.push(start);
    edgeMainSegCount.push(cnt);
    for (const lp of e.laterals) addPath(lp, ei);
  }

  const somaPosF = new Float32Array(nodes.flatMap(n => [n.pos.x, n.pos.y, n.pos.z]));
  const somaSzF = new Float32Array(nodes.map(() => rnd(2, 4)));

  return { posArr, segEdge, edgeMainSegStart, edgeMainSegCount, edges, nodes, somaPosF, somaSzF };
}
