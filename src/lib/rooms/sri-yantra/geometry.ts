// Pure geometry, palette and timeline helpers ported verbatim from
// sri-yantra.html. No DOM, no canvas — unit-testable.

export type Pt = [number, number];

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const easeOut = (t: number): number => 1 - (1 - clamp(t, 0, 1)) * (1 - clamp(t, 0, 1));

export function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;
}

export type AlphaFn = (a: number) => string;
export interface Palette { bg: string; pri: AlphaFn; sec: AlphaFn; acc: AlphaFn; glow: AlphaFn; }

export const palettes = {
  golden:  { bg: '#0a0501', pri: (a: number) => hsl(50, 100, 82, a),  sec: (a: number) => hsl(30, 100, 70, a),  acc: (a: number) => hsl(15, 100, 72, a),  glow: (a: number) => hsl(55, 100, 90, a) },
  indigo:  { bg: '#05060f', pri: (a: number) => hsl(195, 100, 82, a), sec: (a: number) => hsl(265, 95, 80, a),  acc: (a: number) => hsl(175, 100, 82, a), glow: (a: number) => hsl(215, 100, 90, a) },
  crimson: { bg: '#0d0103', pri: (a: number) => hsl(345, 100, 78, a), sec: (a: number) => hsl(18, 100, 72, a),  acc: (a: number) => hsl(335, 100, 86, a), glow: (a: number) => hsl(5, 100, 82, a) },
  emerald: { bg: '#010d05', pri: (a: number) => hsl(145, 100, 72, a), sec: (a: number) => hsl(115, 90, 68, a),  acc: (a: number) => hsl(55, 100, 78, a),  glow: (a: number) => hsl(135, 100, 82, a) },
  dusk:    { bg: '#08030f', pri: (a: number) => hsl(300, 90, 82, a),  sec: (a: number) => hsl(265, 95, 78, a),  acc: (a: number) => hsl(45, 100, 82, a),  glow: (a: number) => hsl(290, 100, 90, a) },
  ivory:   { bg: '#100d06', pri: (a: number) => hsl(38, 60, 96, a),   sec: (a: number) => hsl(32, 40, 88, a),   acc: (a: number) => hsl(0, 0, 100, a),    glow: (a: number) => hsl(42, 100, 96, a) }
} satisfies Record<string, Palette>;

export type SchemeKey = keyof typeof palettes;

export function pickScheme(): SchemeKey {
  const keys = Object.keys(palettes) as SchemeKey[];
  return keys[randInt(0, keys.length - 1)];
}

export interface YantraLayer { pts: Pt[]; up: boolean; radius: number; }

export function buildYantra(R: number, v: number): YantraLayer[] {
  const up = (r: number, yo = 0): Pt[] => [[0, r + yo], [-r * 0.866, -r * 0.5 + yo], [r * 0.866, -r * 0.5 + yo]];
  const dn = (r: number, yo = 0): Pt[] => up(r, yo).map(([x, y]) => [x, -y + yo * 2] as Pt);
  return [
    { r: R * 0.97, yo: 0,             up: false },
    { r: R * 0.82, yo: R * 0.03 * v,  up: true  },
    { r: R * 0.78, yo: -R * 0.04 * v, up: false },
    { r: R * 0.66, yo: R * 0.04 * v,  up: true  },
    { r: R * 0.62, yo: -R * 0.04 * v, up: false },
    { r: R * 0.52, yo: R * 0.03 * v,  up: true  },
    { r: R * 0.48, yo: -R * 0.03 * v, up: false },
    { r: R * 0.37, yo: R * 0.03 * v,  up: true  },
    { r: R * 0.33, yo: -R * 0.02 * v, up: false }
  ].map(({ r, yo, up: u }) => ({ pts: u ? up(r, yo) : dn(r, yo), up: u, radius: r }));
}

// The original took an unused leading `R` arg (call sites passed 1); dropped here.
export function petalRing(n: number, inner: number, outer: number): Pt[][] {
  const all: Pt[][] = [];
  const steps = 60;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const seg: Pt[] = [];
    for (let s = 0; s <= steps; s++) {
      const tt = s / steps, a = lerp(a0, a1, tt), rr = lerp(inner, outer, Math.sin(tt * Math.PI));
      seg.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    for (let s = steps; s >= 0; s--) {
      const tt = s / steps, a = lerp(a0, a1, tt);
      seg.push([Math.cos(a) * inner, Math.sin(a) * inner]);
    }
    all.push(seg);
  }
  return all;
}

export interface Bhupura { outer: Pt[]; inner: Pt[]; gates: Pt[][]; }

export function bhupuraParts(R: number): Bhupura {
  const S = R * 1.12, S2 = R * 1.04, gw = S * 0.14;
  const sq = (s: number): Pt[] => [[-s, -s], [s, -s], [s, s], [-s, s], [-s, -s]];
  const gates: Pt[][] = [];
  for (const [ax, sg] of [['x', 1], ['x', -1], ['y', 1], ['y', -1]] as const) {
    if (ax === 'x') {
      const y = sg * S2;
      gates.push([[-S, y], [-gw / 2, y]]);
      gates.push([[gw / 2, y], [S, y]]);
      gates.push([[-gw / 2, y], [-gw / 2, y + sg * gw * 0.55], [gw / 2, y + sg * gw * 0.55], [gw / 2, y]]);
    } else {
      const x = sg * S2;
      gates.push([[x, -S], [x, -gw / 2]]);
      gates.push([[x, gw / 2], [x, S]]);
      gates.push([[x, -gw / 2], [x + sg * gw * 0.55, -gw / 2], [x + sg * gw * 0.55, gw / 2], [x, gw / 2]]);
    }
  }
  return { outer: sq(S), inner: sq(S2), gates };
}

// ── Timeline ─────────────────────────────────────────────────────────────────
export const APPEAR_DUR = 1.0;
export const STEP = 1.2;
export const N_LAYERS = 14;
export const NAMES = [
  'Bindu', 'Triangle 1', 'Triangle 2', 'Triangle 3', 'Triangle 4', 'Triangle 5',
  'Triangle 6', 'Triangle 7', 'Triangle 8', 'Triangle 9',
  '8-Petal Lotus', '16-Petal Lotus', 'Circles', 'Bhupura'
];
export function startOf(i: number): number { return i * STEP; }
export function prog(i: number, age: number): number { return clamp((age - startOf(i)) / APPEAR_DUR, 0, 1); }
