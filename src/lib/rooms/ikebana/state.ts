import type { BranchGeom, IkebanaGeom } from './types';

// ─── Shared visual → audio state ─────────────────────────────────────────────

export const sharedState = {
  dragVelocity: 0,   // smoothed px/ms (device px)
  pointerDown: false,
  avgProg: 0,        // average branch draw progress of the active ikebana
  geom: null as IkebanaGeom | null
};

export interface AudioLink {
  playShimmer(angle: number, branchIdx: number): void;
  playBloom(rootFreq: number): void;
  startTouchVoice(angle: number, geom: BranchGeom): void;
  retuneTouchVoice(fund: number): void;
  stopTouchVoice(): void;
  surgeDrone(colorR: number): void;
  resetDroneGains(): void;
}

// Holder object instead of a bare `let` so audio.ts can assign it and mount.ts
// can read it across module boundaries (imported bindings are read-only).
export const audioLink: { current: AudioLink | null } = { current: null };
