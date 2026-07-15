// Ported from neuromancer-cyberspace.html — Three.js scene rewritten against
// the shared raw-WebGL engine. The bus owns the AudioContext + fade; the
// source's own title/hint/audio-button chrome is dropped in favor of the
// room page header and the shared AudioPrompt.
export { mount } from './mount';
export { createAudio } from './audio';
