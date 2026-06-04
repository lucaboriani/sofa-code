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
