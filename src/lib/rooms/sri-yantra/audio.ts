import type { AudioFactory } from '@/lib/audio/bus';
import { sharedState } from './state';

// ─── Audio factory (sri-yantra.html startAudio/updateDrone) ──────────────────
// The standalone file owned its own AudioContext + "Enable Sound" button; here
// the bus owns the context and the on/off fade, and the AudioPrompt is the
// user-gesture entry point. updateDrone() becomes tick(), which reads drag/idle/
// scheme state from sharedState. All AC.destination connects funnel into `out`.
// Formulas are verbatim.

const BASE_FREQ: Record<string, number> = { golden: 136.1, indigo: 141, crimson: 128, emerald: 144, dusk: 138.5, ivory: 130.8 };
const CUTOFF: Record<string, number> = { golden: 360, indigo: 420, crimson: 300, emerald: 440, dusk: 380, ivory: 260 };

function makeImpulse(ctx: AudioContext, dur = 2.5, decay = 3.2): AudioBuffer {
  const sr = ctx.sampleRate, len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export const createAudio: AudioFactory = (ctx) => {
  const out = ctx.createGain();
  out.gain.value = 1;

  // droneGain — the room's own slow swell (the bus crossfade sits on top).
  const droneGain = ctx.createGain();
  droneGain.gain.setValueAtTime(0, ctx.currentTime);
  droneGain.gain.linearRampToValueAtTime(0.11, ctx.currentTime + 10);
  droneGain.connect(out);

  const revNode = ctx.createConvolver();
  revNode.buffer = makeImpulse(ctx);
  const revGain = ctx.createGain(); revGain.gain.value = 0.28;
  revNode.connect(revGain); revGain.connect(out);

  const filterNode = ctx.createBiquadFilter();
  filterNode.type = 'lowpass'; filterNode.frequency.value = 320; filterNode.Q.value = 0.5;
  filterNode.connect(droneGain); filterNode.connect(revNode);

  let baseFreq = BASE_FREQ[sharedState.scheme] ?? 136.1;
  const f = baseFreq;

  let droneOsc: OscillatorNode | null = null;
  let droneOsc2: OscillatorNode | null = null;
  let droneOsc3: OscillatorNode | null = null;
  for (const [n, gv] of [[1, 0.55], [2, 0.18], [3, 0.09], [5, 0.04]] as const) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * n;
    const g = ctx.createGain(); g.gain.value = gv;
    o.connect(g); g.connect(filterNode); o.start();
    if (n === 1) droneOsc = o;
    if (n === 2) droneOsc2 = o;
    if (n === 3) droneOsc3 = o;
  }

  const shimmerOsc = ctx.createOscillator(); shimmerOsc.type = 'sine'; shimmerOsc.frequency.value = f * 9;
  const shimGain = ctx.createGain(); shimGain.gain.value = 0;
  shimmerOsc.connect(shimGain); shimGain.connect(revNode); shimmerOsc.start();
  const shimLfo = ctx.createOscillator(); shimLfo.type = 'sine'; shimLfo.frequency.value = 1 / 23;
  const shimDepth = ctx.createGain(); shimDepth.gain.value = 0.018;
  shimLfo.connect(shimDepth); shimDepth.connect(shimGain.gain); shimLfo.start();

  const breathLfo = ctx.createOscillator(); breathLfo.type = 'sine'; breathLfo.frequency.value = 0.07;
  const breathGain = ctx.createGain(); breathGain.gain.value = 0.022;
  breathLfo.connect(breathGain); breathGain.connect(droneGain.gain); breathLfo.start();

  const wobbleOsc = ctx.createOscillator(); wobbleOsc.type = 'sine'; wobbleOsc.frequency.value = 0.031;
  const wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = 0.28;
  wobbleOsc.connect(wobbleDepth);
  if (droneOsc) wobbleDepth.connect(droneOsc.frequency);
  if (droneOsc2) wobbleDepth.connect(droneOsc2.frequency);
  wobbleOsc.start();

  let lastScheme = sharedState.scheme;

  return {
    node: out,
    tick(): void {
      const now = ctx.currentTime;

      // Scheme change → glide drone + filter to the new tuning (updateDrone).
      if (sharedState.scheme !== lastScheme) {
        lastScheme = sharedState.scheme;
        baseFreq = BASE_FREQ[sharedState.scheme] ?? 136.1;
        const fc = CUTOFF[sharedState.scheme] ?? 320;
        droneOsc?.frequency.setTargetAtTime(baseFreq, now, 4);
        droneOsc2?.frequency.setTargetAtTime(baseFreq * 2, now, 4);
        droneOsc3?.frequency.setTargetAtTime(baseFreq * 3, now, 4);
        shimmerOsc.frequency.setTargetAtTime(baseFreq * 9, now, 4);
        filterNode.frequency.setTargetAtTime(fc, now, 4);
      }

      if (sharedState.dragging) {
        const spd = sharedState.dragSpeed; // 0..1
        filterNode.frequency.setTargetAtTime(320 + spd * 1200, now, 0.1);
        droneOsc?.frequency.setTargetAtTime(baseFreq + spd * 40, now, 0.08);
      } else {
        const act = sharedState.autoActivity;
        filterNode.frequency.setTargetAtTime(320 + act * 500, now, 1.2);
        droneOsc?.frequency.setTargetAtTime(baseFreq + act * 18, now, 1.5);
      }
    }
  };
};
