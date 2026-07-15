// ─── Shared visual → audio state ─────────────────────────────────────────────
// mount.ts publishes camera speed and lock state each frame; audio.ts's
// tick() reads them — replacing the source's direct setInterference(level)
// calls (made from pointer handlers) with a polled read.

export const sharedState: {
  speed: number;
  lockLevel: 0 | 1 | 2;
  bridgeActive: boolean;
} = {
  speed: 11,
  lockLevel: 0,
  bridgeActive: false
};

export function resetState(): void {
  sharedState.speed = 11;
  sharedState.lockLevel = 0;
  sharedState.bridgeActive = false;
}
