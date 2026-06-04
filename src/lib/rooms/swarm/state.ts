// ── Shared state: bridges the RAF loop (visual) → audio tick ─────────────────
export const sharedState = {
  speedEMA: 0,      // EMA of mean |velocity| across webs, normalised [0..1]
  alphaEMA: 0,      // EMA of mean web alpha [0..1]
  pinchScale: 1,    // current pinch scale from interaction (1 = no pinch)
  pinchActive: false, // true while a two-finger pinch is in progress
  gyroActive: false,  // true once the device has reported orientation
  gyroX: 0,         // smoothed gamma (left/right tilt), normalised [-1..1]
  gyroY: 0          // smoothed beta (front/back tilt), normalised [-1..1]
};
