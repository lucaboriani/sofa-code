// ─── Shared audio state (written by createAudio, read by mount each frame) ───

export const sharedState = {
  rms: 0,             // written by audio tick (mic analyser)
  simSpeed: 0.08,     // written by mount each frame
  collisionCount: 0,  // incremented by mount, reset by audio tick
  rotX: 0             // camera tilt, written by mount each frame
};
