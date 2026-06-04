// ── Geometry helpers (local unit coords) ─────────────────────────────────────

// Stride: aA(2)+aB(2)+aBaseAlpha(1)+aSide(1)+aT(1) = 7 floats
export const STRIDE = 7;
const SEG = 18; // bezier subdivisions

export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function rand(a: number, b: number): number { return a + Math.random() * (b - a); }

function pushSeg(buf: number[], ax: number, ay: number, bx: number, by: number, alA: number, alB: number): void {
  // 6 verts × 7 floats — expanded line quad. Each row: aA.xy aB.xy aBaseAlpha aSide aT
  buf.push(
    ax, ay, bx, by, alA, -1, 0,
    ax, ay, bx, by, alA, +1, 0,
    ax, ay, bx, by, alB, -1, 1,
    ax, ay, bx, by, alB, -1, 1,
    ax, ay, bx, by, alA, +1, 0,
    ax, ay, bx, by, alB, +1, 1,
  );
}

function pushBez(buf: number[], ax: number, ay: number, cx: number, cy: number, bx: number, by: number, alA: number, alB: number): void {
  let px = ax, py = ay, pal = alA;
  for (let i = 1; i <= SEG; i++) {
    const t = i / SEG, u = 1 - t;
    const qx = u * u * ax + 2 * u * t * cx + t * t * bx;
    const qy = u * u * ay + 2 * u * t * cy + t * t * by;
    const al = lerp(alA, alB, t);
    pushSeg(buf, px, py, qx, qy, pal, al);
    px = qx; py = qy; pal = al;
  }
}

function makeAngles(n: number, jitter: number): number[] {
  const base = (Math.PI * 2) / n;
  let acc = 0;
  const out: number[] = [];
  for (let s = 0; s < n; s++) { acc += base * rand(1 - jitter, 1 + jitter); out.push(acc); }
  const sc = (Math.PI * 2) / acc;
  for (let s = 0; s < n; s++) out[s] *= sc;
  return out;
}

// ── Web type bakers (return Float32Array in local unit coords) ────────────────

function bakeOrb(): Float32Array {
  const buf: number[] = [];
  const ns = Math.round(rand(10, 17));
  const nr = Math.round(rand(6, 11));
  const hubR = rand(0.04, 0.09);
  const angls = makeAngles(ns, 0.28);
  const spokeL: number[] = [];
  for (let s = 0; s < ns; s++) spokeL.push(rand(0.72, 1.18));
  const ringR: number[] = [];
  for (let i = 0; i < nr; i++) ringR.push(Math.pow((i + 1) / nr, 0.75) * rand(0.92, 1.08));
  const sag: number[][] = [];
  for (let i = 0; i < nr; i++) {
    const row: number[] = [];
    for (let s = 0; s < ns; s++) row.push(rand(0.06, 0.16));
    sag.push(row);
  }
  const tx: number[] = [], ty: number[] = [];
  for (let s = 0; s < ns; s++) {
    const l = spokeL[s];
    tx.push(Math.cos(angls[s]) * l);
    ty.push(Math.sin(angls[s]) * l);
  }
  // Hub ring
  for (let i = 0; i < 20; i++) {
    const a1 = (i / 20) * Math.PI * 2, a2 = ((i + 1) / 20) * Math.PI * 2;
    pushSeg(buf, Math.cos(a1) * hubR, Math.sin(a1) * hubR, Math.cos(a2) * hubR, Math.sin(a2) * hubR, 0.5, 0.5);
  }
  // Spokes hub → tip, then extend off-screen
  for (let s = 0; s < ns; s++) {
    const hx = Math.cos(angls[s]) * hubR, hy = Math.sin(angls[s]) * hubR;
    pushBez(buf, hx, hy, (hx + tx[s]) * 0.5, (hy + ty[s]) * 0.5, tx[s], ty[s], 0.3, 1.0);
    const ex = tx[s] * 2.2, ey = ty[s] * 2.2;
    pushBez(buf, tx[s], ty[s], (tx[s] + ex) * 0.5, (ty[s] + ey) * 0.5, ex, ey, 1.0, 0.0);
  }
  // Rings
  for (let ring = 0; ring < nr; ring++) {
    const t = ringR[ring];
    const ra = 0.65 + 0.35 * (1 - t * 0.35);
    for (let s = 0; s < ns; s++) {
      const sN = (s + 1) % ns;
      const ax = tx[s] * t, ay = ty[s] * t;
      const bx = tx[sN] * t, by = ty[sN] * t;
      const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
      const outLen = Math.sqrt(mx * mx + my * my) + 0.001;
      const clen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) + 0.001;
      const sd = clen * sag[ring][s];
      pushBez(buf, ax, ay, mx + (mx / outLen) * sd, my + (my / outLen) * sd, bx, by, ra, ra);
    }
  }
  // Frame ring
  const ot = ringR[nr - 1] * 1.03;
  for (let s = 0; s < ns; s++) {
    const sN = (s + 1) % ns;
    pushSeg(buf, tx[s] * ot, ty[s] * ot, tx[sN] * ot, ty[sN] * ot, 0.55, 0.55);
  }
  return new Float32Array(buf);
}

function bakeCob(): Float32Array {
  const buf: number[] = [];
  const n = Math.round(rand(14, 26));
  const ax: number[] = [], ay: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), d = rand(0.1, 1.0);
    ax.push(d * Math.cos(a)); ay.push(d * Math.sin(a));
  }
  for (let i = 0; i < n; i++) {
    const conns = Math.round(rand(1, 3));
    for (let c = 0; c < conns; c++) {
      const j = Math.floor(rand(0, n));
      if (j === i) continue;
      const dr = rand(0.04, 0.28);
      const mxC = (ax[i] + ax[j]) * 0.5, myC = (ay[i] + ay[j]) * 0.5;
      const clen = Math.sqrt((ax[j] - ax[i]) * (ax[j] - ax[i]) + (ay[j] - ay[i]) * (ay[j] - ay[i])) + 0.001;
      pushBez(buf, ax[i], ay[i], mxC, myC + clen * dr, ax[j], ay[j], 0.7, 0.7);
    }
  }
  const esc = Math.round(rand(3, 8));
  for (let k = 0; k < esc; k++) {
    const ang = rand(0, Math.PI * 2);
    const ox = Math.cos(ang) * rand(0.1, 0.5), oy = Math.sin(ang) * rand(0.1, 0.5);
    const ex = Math.cos(ang) * 2.2, ey = Math.sin(ang) * 2.2;
    pushBez(buf, ox, oy, (ox + ex) * 0.5, (oy + ey) * 0.5, ex, ey, 0.6, 0.0);
  }
  return new Float32Array(buf);
}

function bakeFunnel(): Float32Array {
  const buf: number[] = [];
  const rows = Math.round(rand(5, 9));
  const cols = Math.round(rand(6, 12));
  const fd = rand(0.3, 0.7);
  const rowSag: number[] = [];
  for (let r = 0; r <= rows; r++) rowSag.push(rand(0.04, 0.12));

  function pt(u: number, v: number): [number, number] {
    const spread = 1 - v * fd;
    const x = u * spread;
    const sag = 0.1 * v * (1 - v) * rowSag[Math.min(Math.floor(v * rows), rows - 1)];
    return [x, v + sag];
  }

  for (let c = 0; c <= cols; c++) {
    const u = lerp(-1, 1, c / cols);
    let prev = pt(u, 0);
    for (let seg = 1; seg <= 10; seg++) {
      const p = pt(u, seg / 10);
      pushSeg(buf, prev[0], prev[1], p[0], p[1], 0.5, 0.5);
      prev = p;
    }
    const tip = pt(u, 1);
    pushBez(buf, tip[0], tip[1], tip[0] * 1.2, tip[1] * 1.5, tip[0] * 2.2, tip[1] * 2.2, 0.4, 0.0);
  }
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    const pts: [number, number][] = [];
    for (let c = 0; c <= cols; c++) pts.push(pt(lerp(-1, 1, c / cols), v));
    for (let c = 0; c < cols; c++) {
      const [ax, ay] = pts[c], [bx, by] = pts[c + 1];
      const clen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) + 0.001;
      pushBez(buf, ax, ay, (ax + bx) * 0.5, (ay + by) * 0.5 + clen * 0.06, bx, by, 0.65, 0.65);
    }
    const lp = pt(-1, v), rp = pt(1, v);
    pushBez(buf, lp[0], lp[1], lp[0] - 0.5, lp[1], lp[0] - 2.2, lp[1], 0.5, 0.0);
    pushBez(buf, rp[0], rp[1], rp[0] + 0.5, rp[1], rp[0] + 2.2, rp[1], 0.5, 0.0);
  }
  return new Float32Array(buf);
}

function bakeSpiral(): Float32Array {
  const buf: number[] = [];
  const turns = rand(3, 6);
  const n = Math.round(rand(90, 160));
  const ns = Math.round(rand(8, 14));
  const angls = makeAngles(ns, 0.20);
  const spokeL: number[] = [];
  for (let s = 0; s < ns; s++) spokeL.push(rand(0.82, 1.12));
  const noise: number[] = [];
  for (let i = 0; i < n; i++) noise.push(rand(-0.04, 0.04));
  for (let i = 0; i < n - 1; i++) {
    const fA = i / (n - 1), fB = (i + 1) / (n - 1);
    const aA = fA * turns * Math.PI * 2, aB = fB * turns * Math.PI * 2;
    const rA = fA * (1 + noise[i]), rB = fB * (1 + noise[i + 1]);
    pushSeg(buf,
      Math.cos(aA) * rA, Math.sin(aA) * rA,
      Math.cos(aB) * rB, Math.sin(aB) * rB,
      lerp(0.25, 1.0, fA), lerp(0.25, 1.0, fB));
  }
  for (let s = 0; s < ns; s++) {
    const l = spokeL[s];
    const tx = Math.cos(angls[s]) * l, ty = Math.sin(angls[s]) * l;
    pushSeg(buf, 0, 0, tx, ty, 0.2, 0.5);
    pushBez(buf, tx, ty, tx * 1.5, ty * 1.5, tx * 2.2, ty * 2.2, 0.5, 0.0);
  }
  return new Float32Array(buf);
}

function bakeMesh(): Float32Array {
  const buf: number[] = [];
  const n = Math.round(rand(16, 30));
  const nx: number[] = [], ny: number[] = [];
  const scX = rand(0.6, 1.2), scY = rand(0.35, 0.75);
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), r = Math.sqrt(rand(0, 1));
    nx.push(r * Math.cos(a) * scX); ny.push(r * Math.sin(a) * scY);
  }
  const seen: Record<string, boolean> = {};
  for (let i = 0; i < n; i++) {
    const dists: { j: number; d: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = nx[i] - nx[j], dy = ny[i] - ny[j];
      dists.push({ j, d: dx * dx + dy * dy });
    }
    dists.sort((a, b) => a.d - b.d);
    const conns = Math.round(rand(2, 4));
    for (let k = 0; k < Math.min(conns, dists.length); k++) {
      const j = dists[k].j;
      const key = `${Math.min(i, j)},${Math.max(i, j)}`;
      if (seen[key]) continue; seen[key] = true;
      const ax = nx[i], ay = ny[i], bx = nx[j], by = ny[j];
      const clen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) + 0.001;
      const sag = rand(0.04, 0.18) * clen;
      pushBez(buf, ax, ay, (ax + bx) * 0.5, (ay + by) * 0.5 + sag, bx, by, 0.75, 0.75);
    }
  }
  const anch = Math.round(rand(4, 9));
  for (let k = 0; k < anch; k++) {
    const ang = rand(0, Math.PI * 2);
    const ni = Math.floor(rand(0, n));
    const ox = nx[ni], oy = ny[ni];
    const ex = ox + Math.cos(ang) * 2.2, ey = oy + Math.sin(ang) * 2.2;
    pushBez(buf, ox, oy, (ox + ex) * 0.5, (oy + ey) * 0.5, ex, ey, 0.55, 0.0);
  }
  return new Float32Array(buf);
}

export const BAKERS = [bakeOrb, bakeCob, bakeFunnel, bakeSpiral, bakeMesh] as const;

// ── Color helper ─────────────────────────────────────────────────────────────

export function webColor(hue: number): [number, number, number] {
  return [
    lerp(0.58, 0.80, Math.sin(hue * Math.PI)),
    lerp(0.65, 0.88, Math.cos(hue * Math.PI * 0.7)),
    lerp(0.80, 1.0, 1 - hue * 0.3),
  ];
}

// ── Web instance type ─────────────────────────────────────────────────────────

export interface WebInstance {
  glBuf: WebGLBuffer;
  cx: number; cy: number;
  r: number;
  angle: number; spin: number;
  alpha: number; targetAlpha: number;
  life: number; maxLife: number;
  vx: number; vy: number;
  hue: number;
  dying: boolean;
  geom: Float32Array;
  vertCount: number;
}
