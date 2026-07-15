// Pure scene layout ported from neuromancer-cyberspace.html. No DOM, no
// canvas, no GL — unit-testable. Solid *shapes* live in
// @/lib/webgl/polyhedra; this module only decides where structures sit,
// which solid type each uses, and how big it is.

export const TUNNEL_LEN = 4200;
export const HALF_W = 55;
export const HALF_H = 32;

export const ARRAY_NAMES = [
  'SENSE/NET', 'MAAS-NEO', 'HOSAKA', 'ZAIBATSU-7',
  'ORBITAL/T-A', 'FISSION/RIM', 'BANK-AX', 'PANTHER/MDN'
] as const;

export type SolidType = 'ico' | 'oct' | 'box' | 'tet';
const SOLIDS: readonly SolidType[] = ['ico', 'oct', 'box', 'tet'];

export interface Structure {
  position: [number, number, number];
  scale: number;
  solid: SolidType;
  isIce: boolean;
  name: string;
  spin: number;
}

export function buildStructures(count: number): Structure[] {
  const out: Structure[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      position: [
        (Math.random() * 2 - 1) * (HALF_W - 6),
        (Math.random() * 2 - 1) * (HALF_H - 4),
        -100 - Math.random() * (TUNNEL_LEN - 260)
      ],
      scale: 2 + Math.random() * 8,
      solid: SOLIDS[Math.floor(Math.random() * SOLIDS.length)],
      isIce: Math.random() < 0.18,
      name: ARRAY_NAMES[Math.floor(Math.random() * ARRAY_NAMES.length)],
      spin: Math.random() * 0.6 - 0.3
    });
  }
  return out;
}

export interface ParticleField { positions: Float32Array; }

export function buildParticles(count: number): ParticleField {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() * 2 - 1) * HALF_W;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * HALF_H;
    positions[i * 3 + 2] = -Math.random() * TUNNEL_LEN;
  }
  return { positions };
}

export interface Core { position: [number, number, number]; outerScale: number; innerScale: number; }

export function buildCore(): Core {
  return { position: [0, 0, -TUNNEL_LEN + 140], outerScale: 58, innerScale: 30 };
}
