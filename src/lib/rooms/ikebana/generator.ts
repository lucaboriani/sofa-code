import type { Branch, Ikebana, IkebanaGeom, Shoot } from './types';
import { rnd } from './math';

// ─── Procedural generator (ikebana.html L132-236) ───────────────────────────

export function genIkebana(): Ikebana {
  const ox = rnd(0.07, 0.20);
  const oy = rnd(0.87, 0.96);

  const palette: [number, number, number][] = [
    [rnd(0.82, 0.92), rnd(0.72, 0.82), rnd(0.50, 0.62)],
    [rnd(0.65, 0.75), rnd(0.55, 0.65), rnd(0.36, 0.48)],
    [rnd(0.50, 0.62), rnd(0.42, 0.54), rnd(0.28, 0.38)],
    [rnd(0.38, 0.50), rnd(0.32, 0.42), rnd(0.20, 0.30)],
    [rnd(0.28, 0.38), rnd(0.22, 0.32), rnd(0.12, 0.22)]
  ];

  function mkBranch(
    color: [number, number, number], alpha: number, width: number,
    ex: number, ey: number, curlX: number,
    shoots: Shoot[], budR: number, budDelay: number
  ): Branch {
    return {
      color, alpha, width,
      delay: 0,
      duration: rnd(2.8, 3.4),
      cps: [
        [ox, oy],
        [ox + (ex - ox) * 0.25 + rnd(-0.04, 0.04), oy - (oy - ey) * 0.25 + rnd(-0.05, 0.05)],
        [ox + (ex - ox) * 0.55 + curlX + rnd(-0.04, 0.04), oy - (oy - ey) * 0.55 + rnd(-0.05, 0.06)],
        [ox + (ex - ox) * 0.80 + rnd(-0.02, 0.02), oy - (oy - ey) * 0.80 + rnd(-0.03, 0.04)],
        [ex, ey]
      ],
      shoots, budR, budDelay
    };
  }

  // SHIN — steep, to upper-right
  const shin = mkBranch(
    palette[0], rnd(0.82, 0.92), rnd(1.8, 2.6),
    rnd(0.62, 0.82), rnd(0.03, 0.12),
    rnd(-0.06, 0.06),
    [
      { t: rnd(0.88, 0.96), angle: rnd(-1.1, -0.5), len: rnd(0.09, 0.14), delay: rnd(3.0, 3.3) },
      { t: rnd(0.60, 0.75), angle: rnd(0.7, 1.4),   len: rnd(0.07, 0.12), delay: rnd(3.1, 3.4) },
      { t: rnd(0.35, 0.52), angle: rnd(1.3, 1.9),   len: rnd(0.05, 0.09), delay: rnd(3.2, 3.5) }
    ],
    rnd(2.8, 4.2), 3.2
  );

  // SOE — medium diagonal
  const soe = mkBranch(
    palette[1], rnd(0.70, 0.82), rnd(1.2, 1.9),
    rnd(0.76, 0.94), rnd(0.10, 0.22),
    rnd(-0.05, 0.07),
    [
      { t: rnd(0.82, 0.94), angle: rnd(-0.6, 0.0),  len: rnd(0.08, 0.13), delay: rnd(3.0, 3.3) },
      { t: rnd(0.48, 0.65), angle: rnd(-1.2, -0.5), len: rnd(0.06, 0.10), delay: rnd(3.2, 3.5) }
    ],
    rnd(2.0, 3.2), 3.5
  );

  // TAI — near-horizontal sweep (earth line)
  const tai = mkBranch(
    palette[2], rnd(0.60, 0.72), rnd(1.0, 1.6),
    rnd(0.84, 0.97), rnd(0.50, 0.66),
    rnd(-0.04, 0.06),
    [
      { t: rnd(0.75, 0.88), angle: rnd(1.4, 2.0),   len: rnd(0.07, 0.11), delay: rnd(3.0, 3.3) },
      { t: rnd(0.42, 0.60), angle: rnd(-1.4, -0.7), len: rnd(0.05, 0.09), delay: rnd(3.2, 3.5) }
    ],
    rnd(1.6, 2.6), 3.8
  );

  // ACCENT — near-vertical, delicate
  const accent = mkBranch(
    palette[3], rnd(0.42, 0.54), rnd(0.7, 1.1),
    rnd(0.38, 0.60), rnd(0.01, 0.09),
    rnd(-0.06, 0.06),
    [
      { t: rnd(0.82, 0.93), angle: rnd(-1.1, -0.5), len: rnd(0.06, 0.10), delay: rnd(3.2, 3.5) },
      { t: rnd(0.52, 0.68), angle: rnd(0.6, 1.2),   len: rnd(0.05, 0.08), delay: rnd(3.3, 3.6) }
    ],
    0, 99
  );

  // WHISPER — ghost, low angle
  const whisper = mkBranch(
    palette[4], rnd(0.22, 0.34), rnd(0.5, 0.85),
    rnd(0.88, 0.98), rnd(0.56, 0.72),
    rnd(-0.03, 0.05),
    [
      { t: rnd(0.70, 0.85), angle: rnd(-1.0, -0.4), len: rnd(0.05, 0.08), delay: rnd(3.4, 3.7) }
    ],
    0, 99
  );

  return {
    branches: [shin, soe, tai, accent, whisper],
    ox, oy,
    startTime: null,
    dying: false, dead: false, deathTime: 0
  };
}

// ─── Geometry → drone parameters (ikebana.html L407-463) ────────────────────

export function computeIkebanaGeom(ik: Ikebana, version: number): IkebanaGeom {
  const shin = ik.branches[0], tai = ik.branches[2], accent = ik.branches[3];
  const shinEndY = shin.cps[shin.cps.length - 1][1];
  const taiEndX = tai.cps[tai.cps.length - 1][0];
  const accentEndY = accent.cps[accent.cps.length - 1][1];
  const rootFreq = 55 + (1 - shinEndY) * 55;

  const allShoots = ik.branches.flatMap(br => br.shoots);
  const nShoots = allShoots.length || 1;
  const meanAngle = allShoots.reduce((s, sh) => s + Math.abs(sh.angle), 0) / nShoots;
  const angleVar = allShoots.reduce((s, sh) => s + Math.pow(Math.abs(sh.angle) - meanAngle, 2), 0) / nShoots;
  const angleSpread = Math.sqrt(angleVar);
  const meanLen = allShoots.reduce((s, sh) => s + sh.len, 0) / nShoots;

  const lfoRateBase = 0.03 + (meanAngle / Math.PI) * 0.12 + angleSpread * 0.08;
  const lfoDepthMult = 0.5 + meanLen * 10.0;

  const rootMult = 0.75 + (1 - shinEndY) * 0.80;
  const spreadMult = 0.6 + taiEndX * 0.8;
  const brightMult = 0.4 + (1 - accentEndY) * 1.2;
  const freqScale: number[] = [];
  const gainScale: number[] = [];
  for (let i = 0; i < 7; i++) {
    freqScale.push(i < 2 ? rootMult : i < 4 ? rootMult * spreadMult : rootMult * brightMult);
    gainScale.push(i < 2 ? 1.0 : i < 4 ? spreadMult : brightMult);
  }
  return { version, freqScale, gainScale, lfoRateBase, lfoDepthMult, rootFreq };
}
