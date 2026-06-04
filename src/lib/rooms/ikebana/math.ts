import type { Pt } from './types';

// ─── Math (ikebana.html L109-130) ────────────────────────────────────────────

export const rnd = (a: number, b: number): number => a + (b - a) * Math.random();
export const easeOut5 = (t: number): number => 1 - Math.pow(1 - Math.min(t, 1), 5);
export const easeOut3 = (t: number): number => 1 - Math.pow(1 - Math.min(t, 1), 3);

export function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t * t + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t * t * t),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t * t + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t * t * t)
  ];
}

export function buildSpline(cps: Pt[], steps = 140): Pt[] {
  const pts: Pt[] = [];
  const n = cps.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = cps[Math.max(i - 1, 0)], p1 = cps[i], p2 = cps[i + 1], p3 = cps[Math.min(i + 2, n - 1)];
    for (let j = 0; j <= steps; j++) pts.push(catmull(p0, p1, p2, p3, j / steps));
  }
  return pts;
}

export function splinePt(full: Pt[], t: number): Pt {
  return full[Math.min(Math.floor(t * (full.length - 1)), full.length - 1)];
}
