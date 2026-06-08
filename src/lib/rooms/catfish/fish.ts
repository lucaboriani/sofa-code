// ─── Catfish geometry constants (catfish.html L245-260) ──────────────────────

export const SEGS = 50;
export const HALF_L = 280;
export const BASE = '#6a6a6a';
export const FISH_S = 0.055;
export const COLS = 9;
export const ROWS = 5;
export const COLL_R = FISH_S * HALF_L * 0.55;

export const WIDTHS: number[] = [];
for (let i = 0; i <= SEGS; i++) {
  const p = i / SEGS;
  WIDTHS[i] = 22 * Math.pow(Math.sin(Math.pow(p, 0.55) * Math.PI), 1.1) * (1 - 0.15 * p);
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number): number => Math.min(255, Math.max(0, v + amt));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export interface Fish {
  hx: number; hy: number; x: number; y: number;
  angle: number; phase: number; amp: number; speed: number;
  shockT: number | null; maxSpeed: number;
}
