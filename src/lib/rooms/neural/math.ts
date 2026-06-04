// ─── Math helpers (all in closure scope — no allocations in hot path) ─────────

export interface Vec3 { x: number; y: number; z: number; }

export function v3(x: number, y: number, z: number): Vec3 { return { x, y, z }; }
export function add(a: Vec3, b: Vec3): Vec3 { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
export function sub(a: Vec3, b: Vec3): Vec3 { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
export function scl(a: Vec3, s: number): Vec3 { return v3(a.x * s, a.y * s, a.z * s); }
export function vlen(a: Vec3): number { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
export function norm(a: Vec3): Vec3 { const l = vlen(a) || 1; return scl(a, 1 / l); }
export function rnd(lo: number, hi: number): number { return lo + Math.random() * (hi - lo); }
export function rndDir(): Vec3 {
  const th = rnd(0, Math.PI * 2), ph = Math.acos(rnd(-1, 1));
  return v3(Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph));
}
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

// ─── Mat4 ─────────────────────────────────────────────────────────────────────

export function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[r + k * 4] * b[k + c * 4];
    o[r + c * 4] = s;
  }
  return o;
}

export function perspective(fov: number, asp: number, n: number, f: number): Float32Array {
  const t = 1 / Math.tan(fov / 2), m = new Float32Array(16);
  m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f);
  m[14] = (2 * f * n) / (n - f); m[11] = -1;
  return m;
}

export function rotY(a: number): Float32Array {
  const m = new Float32Array(16), c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[8] = s; m[5] = 1; m[2] = -s; m[10] = c; m[15] = 1;
  return m;
}

export function rotX(a: number): Float32Array {
  const m = new Float32Array(16), c = Math.cos(a), s = Math.sin(a);
  m[0] = 1; m[5] = c; m[9] = -s; m[6] = s; m[10] = c; m[15] = 1;
  return m;
}

export function transl(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; m[13] = y; m[14] = z;
  return m;
}
