// Ported from catfish.html — geometry/animation verbatim. Adaptations: the
// AudioBus owns the AudioContext and the on/off fade; the audio button is
// replaced by the app's AudioPrompt; one-shot shocks/collisions are surfaced to
// the audio tick through sharedState counters.

export { mount } from './mount';
export { createAudio } from './audio';
