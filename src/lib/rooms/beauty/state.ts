// ─── Shared visual → audio state ─────────────────────────────────────────────
// The visual loop publishes the curve's rotation, the live drag velocity and
// whether a drag is in progress (these drive the filter sweep). String hits are
// surfaced as small event queues that the audio tick drains and sounds.

export interface StringHit { axis: number; prox: number; }

export const sharedState = {
  angle: 0,
  dragVel: 0,
  isDragging: false,
  pluck: [] as StringHit[],
  hover: [] as StringHit[]
};

const MAX_QUEUE = 16; // bound the queue if audio is not yet enabled to drain it

export function pushPluck(hit: StringHit): void {
  sharedState.pluck.push(hit);
  if (sharedState.pluck.length > MAX_QUEUE) sharedState.pluck.shift();
}
export function pushHover(hit: StringHit): void {
  sharedState.hover.push(hit);
  if (sharedState.hover.length > MAX_QUEUE) sharedState.hover.shift();
}

export function resetState(): void {
  sharedState.angle = 0;
  sharedState.dragVel = 0;
  sharedState.isDragging = false;
  sharedState.pluck.length = 0;
  sharedState.hover.length = 0;
}
