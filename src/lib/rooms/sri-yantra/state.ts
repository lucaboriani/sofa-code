// ─── Shared visual → audio state ─────────────────────────────────────────────
// The visual loop publishes the active palette scheme (drives the drone's base
// frequency + filter cutoff), the normalised drag speed, the idle "nudge"
// energy, and whether a ring is currently being dragged. The audio tick() reads
// these — mirroring the standalone file's direct node pokes from its drag
// handler, now routed through the bus.

import type { SchemeKey } from './geometry';

export const sharedState: {
  scheme: SchemeKey;
  dragSpeed: number;   // |drag velocity| clamped/normalised to 0..1
  autoActivity: number; // idle nudge energy, 0..1
  dragging: boolean;
} = {
  scheme: 'golden',
  dragSpeed: 0,
  autoActivity: 0,
  dragging: false
};

export function resetState(): void {
  sharedState.scheme = 'golden';
  sharedState.dragSpeed = 0;
  sharedState.autoActivity = 0;
  sharedState.dragging = false;
}
