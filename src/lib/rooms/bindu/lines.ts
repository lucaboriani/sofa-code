// ─── Line templates (bindu.html L158-175) ────────────────────────────────────

export const SEGS = 80;
export const VPL = SEGS + 1;
export const FLOATS = 7;

export interface Line {
  ta: number; ra: number; sa: number;
  dx: number; dy: number; dz: number;
  maxLen: number;
  cr: number; cg: number; cb: number;
  baseA: number;
  t: number;
  life: number;
}

export function makeTemplate(): Omit<Line, 't' | 'life'> {
  let ta = Math.random(), ra = Math.random(), sa = Math.random();
  const tot = ta + ra + sa;
  ta /= tot; ra /= tot; sa /= tot;
  const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
  return {
    ta, ra, sa,
    dx: Math.sin(ph) * Math.cos(th), dy: Math.sin(ph) * Math.sin(th), dz: Math.cos(ph),
    maxLen: 0.5 + Math.random() * Math.random() * 4.2,
    cr: Math.min(1, ta * 0.06 + ra * 0.88 + sa * 1.0),
    cg: Math.min(1, ta * 0.02 + ra * 0.13 + sa * 1.0),
    cb: Math.min(1, ta * 0.10 + ra * 0.10 + sa * 1.0),
    baseA: 0.12 + sa * 0.46 + ra * 0.24
  };
}

export function resetLine(ln: Line): void {
  Object.assign(ln, makeTemplate());
  ln.t = 0;
  ln.life = 3 + Math.random() * 7;
}
