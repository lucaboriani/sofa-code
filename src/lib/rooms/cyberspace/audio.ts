import type { AudioFactory } from '@/lib/audio/bus';
import { sharedState } from './state';

// Ported from neuromancer-cyberspace.html's buildAudioGraph()/setInterference().
// The source called setInterference(level) directly from pointer handlers;
// here tick() polls sharedState.lockLevel/bridgeActive each frame and applies
// the same three-tier setTargetAtTime ramps.

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 44100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * Math.PI / 180) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

export const createAudio: AudioFactory = (ctx) => {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 1.2);

  // ── Delay/feedback send bus ──────────────────────────────────────────────
  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = 0.85;
  const feedback = ctx.createGain(); feedback.gain.value = 0.35;
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = 'lowpass'; delayFilter.frequency.value = 1400;
  delay.connect(delayFilter); delayFilter.connect(feedback); feedback.connect(delay);
  delay.connect(master);

  // ── Low detuned drone trio ────────────────────────────────────────────────
  const droneSpecs: readonly [number, OscillatorType, number][] = [
    [55, 'sawtooth', 0.09], [55.6, 'sawtooth', 0.09], [110.2, 'triangle', 0.05]
  ];
  droneSpecs.forEach(([f, type, gv], i) => {
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = gv;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 420;
    osc.connect(filt); filt.connect(g); g.connect(master); g.connect(delay);
    osc.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + i * 0.011;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 180 + i * 40;
    lfo.connect(lfoGain); lfoGain.connect(filt.frequency); lfo.start();
  });

  // ── Filtered noise bed — the "static / signal" texture ───────────────────
  const bufferSize = ctx.sampleRate * 2;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) noiseData[i] = (Math.random() * 2 - 1) * 0.6;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer; noise.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 900; noiseFilter.Q.value = 0.7;
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.025;
  noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(master);
  const noiseLfo = ctx.createOscillator(); noiseLfo.frequency.value = 0.05;
  const noiseLfoGain = ctx.createGain(); noiseLfoGain.gain.value = 500;
  noiseLfo.connect(noiseLfoGain); noiseLfoGain.connect(noiseFilter.frequency); noiseLfo.start();
  noise.start();

  // ── Distortion/"interference" layer — silent until a lock is engaged ─────
  const distortion = ctx.createWaveShaper();
  distortion.curve = distortionCurve(55);
  distortion.oversample = '4x';
  const distHP = ctx.createBiquadFilter();
  distHP.type = 'highpass'; distHP.frequency.value = 700;
  const distGain = ctx.createGain(); distGain.gain.value = 0;
  noise.connect(distortion); distortion.connect(distHP); distHP.connect(distGain);
  distGain.connect(master); distGain.connect(delay);

  // ── Dual-lock resonance — a beat that emerges when a bridge is active ────
  const resonanceGain = ctx.createGain(); resonanceGain.gain.value = 0;
  const resFilter = ctx.createBiquadFilter();
  resFilter.type = 'bandpass'; resFilter.frequency.value = 440; resFilter.Q.value = 5;
  const r1 = ctx.createOscillator(); r1.type = 'sine'; r1.frequency.value = 440;
  const r2 = ctx.createOscillator(); r2.type = 'sine'; r2.frequency.value = 445.5;
  r1.connect(resFilter); r2.connect(resFilter);
  resFilter.connect(resonanceGain); resonanceGain.connect(master); resonanceGain.connect(delay);
  r1.start(); r2.start();

  // ── Sparse evolving pings — data-signal accents ──────────────────────────
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  function schedulePing(): void {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = Math.random() < 0.6 ? 'sine' : 'triangle';
    const base = 320 + Math.random() * 700;
    const dur = 1.6 + Math.random() * 2.2;
    osc.frequency.setValueAtTime(base, t0);
    const sweep = Math.random();
    if (sweep < 0.4) osc.frequency.exponentialRampToValueAtTime(base * (0.75 + Math.random() * 0.15), t0 + dur * 0.8);
    else if (sweep < 0.7) osc.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.2), t0 + dur * 0.8);

    const vibrato = ctx.createOscillator(); vibrato.frequency.value = 1.2 + Math.random() * 1.5;
    const vibratoGain = ctx.createGain(); vibratoGain.gain.value = 2 + Math.random() * 3;
    vibrato.connect(vibratoGain); vibratoGain.connect(osc.frequency);
    vibrato.start(t0); vibrato.stop(t0 + dur + 0.5);

    const softener = ctx.createBiquadFilter();
    softener.type = 'lowpass'; softener.frequency.value = 900 + Math.random() * 600; softener.Q.value = 0.4;

    const g = ctx.createGain();
    const peak = 0.025 + Math.random() * 0.03;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.35 + Math.random() * 0.25);
    g.gain.setTargetAtTime(0, t0 + dur * 0.5, dur * 0.4);

    osc.connect(softener); softener.connect(g); g.connect(delay);
    osc.start(t0); osc.stop(t0 + dur + 0.6);

    pingTimer = setTimeout(schedulePing, 4200 + Math.random() * 7000);
  }
  pingTimer = setTimeout(schedulePing, 3000);

  return {
    node: master,
    tick(): void {
      const now = ctx.currentTime;
      const tc = 0.4;
      const level = sharedState.lockLevel;
      if (level >= 2) {
        noiseGain.gain.setTargetAtTime(0.24, now, tc);
        noiseFilter.frequency.setTargetAtTime(4200, now, tc);
        noiseFilter.Q.setTargetAtTime(4, now, tc);
        distGain.gain.setTargetAtTime(0.16, now, tc);
        resonanceGain.gain.setTargetAtTime(sharedState.bridgeActive ? 0.055 : 0, now, tc);
      } else if (level === 1) {
        noiseGain.gain.setTargetAtTime(0.16, now, tc);
        noiseFilter.frequency.setTargetAtTime(3200, now, tc);
        noiseFilter.Q.setTargetAtTime(3, now, tc);
        distGain.gain.setTargetAtTime(0.1, now, tc);
        resonanceGain.gain.setTargetAtTime(0, now, tc);
      } else {
        noiseGain.gain.setTargetAtTime(0.025, now, tc);
        noiseFilter.frequency.setTargetAtTime(900, now, tc);
        noiseFilter.Q.setTargetAtTime(0.7, now, tc);
        distGain.gain.setTargetAtTime(0, now, tc);
        resonanceGain.gain.setTargetAtTime(0, now, tc);
      }
    },
    dispose(): void {
      if (pingTimer !== null) clearTimeout(pingTimer);
    }
  };
};
