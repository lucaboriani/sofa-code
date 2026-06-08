// Ported from line-of-beauty.html — Hogarth's S-curve as a morphing WebGL
// ribbon with a 2D construction-grid overlay and a golden-ratio harp.
// Adaptations: the AudioBus owns the AudioContext/fade; the construction grid
// overlay is added in full mode only (it is full-screen); string hits reach the
// audio tick through sharedState queues.

export { mount } from './mount';
export { createAudio } from './audio';
