// ─── Shared visual → audio state ─────────────────────────────────────────────
// The visual loop writes the shoal's dispersion and the (normalised) pointer
// position every frame; one-shot shocks and collisions are surfaced as
// monotonic counters that the audio tick drains.

export const sharedState = {
  mx: 0.5,        // pointer X, 0..1 across the canvas
  my: 0.5,        // pointer Y, 0..1 down the canvas
  hasPointer: false,
  dispersion: 0,  // mean distance of fish from home, 0..1
  fishCount: 0,
  shocks: 0,      // monotonic: a fish was shocked
  collisions: 0   // monotonic: two fish bumped
};

export function resetState(): void {
  sharedState.mx = 0.5;
  sharedState.my = 0.5;
  sharedState.hasPointer = false;
  sharedState.dispersion = 0;
  sharedState.fishCount = 0;
  sharedState.shocks = 0;
  sharedState.collisions = 0;
}
