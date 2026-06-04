// Ported from ikebana.html — every constant, range and formula is verbatim.
// Adaptations: AudioBus owns the AudioContext (no ensureAC); transient sounds
// go through `audioLink`, continuous coupling through `sharedState`.

export { mount } from './mount';
export { createAudio } from './audio';
