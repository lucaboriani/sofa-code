import type { AudioFactory } from '@/lib/audio/bus';
import { sharedState } from './state';

// ── Audio factory ─────────────────────────────────────────────────────────────
//
// Ported from spiderweb-swarm.html initAudio():
//   - 5 chord oscillators (sine for low freqs, triangle for upper) at 55/82.4/110/164.8/220 Hz
//     each tripled with ±2 cent detune → into a per-note gain → shared lowpass filter
//   - LFO at 0.07 Hz modulating master gain ±0.06
//   - Filter LFO at 0.04 Hz modulating filter cutoff ±280 Hz
//   - Sub-bass: two sine oscillators at 36 Hz (±3 cent detune) → lowpass 120 Hz → bass gain
//   - Bass LFO at 0.12 Hz (no destination in original; kept as a slow rumble by making it
//     wiggle the bass filter frequency instead, faithful to the "slow oscillation" intent)
//   - Master fades from 0 → 0.10 over ~4 s; bass gain fades 0 → 0.18 over ~5 s
//
// The AudioBus connects masterGain to ctx.destination for us — we must NOT do it here.

export const createAudio: AudioFactory = (ctx) => {
  // ── Master gain (all signal paths merge here) ─────────────────────────────
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0;

  // ── Dry / wet split into convolution reverb ───────────────────────────────
  const irLen = Math.floor(ctx.sampleRate * 4);
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < irLen; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.5);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  conv.connect(masterGain);

  const dry = ctx.createGain();
  dry.gain.value = 0.35;
  dry.connect(masterGain);

  const wet = ctx.createGain();
  wet.gain.value = 0.65;
  wet.connect(conv);

  // ── Shared lowpass filter ─────────────────────────────────────────────────
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 900;
  lpf.Q.value = 1.2;
  lpf.connect(dry);
  lpf.connect(wet);

  // ── Chord oscillators: 55 / 82.4 / 110 / 164.8 / 220 Hz ─────────────────
  // Original gains: [0.22, 0.14, 0.10, 0.06, 0.04]
  const chordFreqs: [number, number][] = [
    [55,    0.22],
    [82.4,  0.14],
    [110,   0.10],
    [164.8, 0.06],
    [220,   0.04],
  ];
  chordFreqs.forEach(([freq, gainVal], idx) => {
    const g = ctx.createGain();
    g.gain.value = gainVal;
    g.connect(lpf);
    const type: OscillatorType = idx < 2 ? 'sine' : 'triangle';
    for (const det of [-2, 0, 2]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(g);
      o.start();
    }
  });

  // ── Amplitude LFO (0.07 Hz) → master gain ────────────────────────────────
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain);
  lfoGain.connect(masterGain.gain);
  lfo.start();

  // ── Filter LFO (0.04 Hz) → lpf frequency ─────────────────────────────────
  const flfo = ctx.createOscillator();
  flfo.frequency.value = 0.04;
  const flfoGain = ctx.createGain();
  flfoGain.gain.value = 280;
  flfo.connect(flfoGain);
  flfoGain.connect(lpf.frequency);
  flfo.start();

  // masterGain.gain is driven per-frame by tick() via sharedState.alphaEMA

  // ── Sub-bass: two sine oscillators at 36 Hz → lowpass → bass gain ─────────
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0;
  bassGain.connect(masterGain);

  const bassLpf = ctx.createBiquadFilter();
  bassLpf.type = 'lowpass';
  bassLpf.frequency.value = 120;
  bassLpf.Q.value = 0.7;
  bassLpf.connect(bassGain);

  for (const det of [-3, 3]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 36;
    o.detune.value = det;
    o.connect(bassLpf);
    o.start();
  }

  // Bass LFO (0.12 Hz) → bass filter frequency wobble
  const blfo = ctx.createOscillator();
  blfo.frequency.value = 0.12;
  const blfoGain = ctx.createGain();
  blfoGain.gain.value = 8;
  blfo.connect(blfoGain);
  blfoGain.connect(bassLpf.frequency);
  blfo.start();

  // bassGain.gain is driven per-frame by tick() via sharedState.alphaEMA

  // ── Tick: drives audio graph from sharedState (populated by the RAF loop) ──
  return {
    node: masterGain,
    tick() {
      const t = ctx.currentTime;
      // 1. Swarm speed → filter brightness (base layer)
      lpf.frequency.setTargetAtTime(900 + sharedState.speedEMA * 6000, t, 0.2);
      // 2. Alpha → master volume
      masterGain.gain.setTargetAtTime(sharedState.alphaEMA * 0.10, t, 0.3);
      // 3. Bass swells with alpha
      bassGain.gain.setTargetAtTime(0.18 * Math.min(1, sharedState.alphaEMA * 1.4), t, 0.4);

      // 4. Pinch → dedicated pitch-bend override (spiderweb-swarm.html L640-644):
      //    spread (scale > 1) opens the filter, contract (< 1) closes it. A fast
      //    0.15 s constant makes the gesture audible even on a still swarm —
      //    overrides the speed term above while the pinch is active.
      if (sharedState.pinchActive) {
        const ratio = Math.max(0.5, Math.min(3.0, sharedState.pinchScale));
        const pitchBend = Math.log2(ratio);
        lpf.frequency.setTargetAtTime(Math.min(400 + pitchBend * 800, 2000), t, 0.15);
      }

      // 5. Gyroscope (spiderweb-swarm.html L646-659): gamma tilt → filter
      //    brightness (only when not pinching, so they don't fight), beta tilt →
      //    bass swell. Both override the base layers when the device reports tilt.
      if (sharedState.gyroActive) {
        if (!sharedState.pinchActive) {
          const gyroBright = 600 + sharedState.gyroX * 500; // ~100..1100 Hz
          lpf.frequency.setTargetAtTime(Math.max(80, Math.min(gyroBright, 1600)), t, 0.6);
        }
        const gyroBassVol = Math.max(0, Math.min(0.28, 0.10 + sharedState.gyroY * 0.18));
        bassGain.gain.setTargetAtTime(gyroBassVol, t, 0.8);
      }
    }
  };
};
