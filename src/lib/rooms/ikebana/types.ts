// ─── Types ────────────────────────────────────────────────────────────────────

export type Pt = [number, number];

export interface Shoot { t: number; angle: number; len: number; delay: number; }

export interface Branch {
  color: [number, number, number];
  alpha: number;
  width: number;
  delay: number;
  duration: number;
  cps: Pt[];
  shoots: Shoot[];
  budR: number;
  budDelay: number;
}

export interface Ikebana {
  branches: Branch[];
  ox: number;
  oy: number;
  startTime: number | null;
  dying: boolean;
  dead: boolean;
  deathTime: number;
}

export interface BranchGeom { idx: number; curvature: number; length: number; angleSpread: number; }

export interface IkebanaGeom {
  version: number;
  freqScale: number[];   // 7 per-partial frequency multipliers
  gainScale: number[];   // 7 per-partial gain multipliers
  lfoRateBase: number;
  lfoDepthMult: number;
  rootFreq: number;
}

export interface Disturbance { created: number; branchIdx: number; splineT: number; amp: number; ikRef: Ikebana; }
export interface ShootReg { sh: Shoot; pts: Pt[]; angle: number; lastHit: number; branchIdx: number; }
export interface Petal { x: number; y: number; vy: number; vx: number; phase: number; r: number; alpha: number; }
