import type { RoomAudio } from '@/lib/audio/bus';
import { sharedState } from './state';

// ─── Audio factory ────────────────────────────────────────────────────────────

export const createAudio = (ctx: AudioContext): RoomAudio => {
  // ── Mic analyser (drives sharedState.rms → spike rate in mount) ─────────────
  // Analysis only: the mic source connects to the analyser, never to destination.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  const bins = new Uint8Array(analyser.frequencyBinCount);

  let mediaStream: MediaStream | null = null;
  navigator.mediaDevices?.getUserMedia({ audio: true }).then(stream => {
    mediaStream = stream;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);
  }).catch(() => { /* permission denied — rms stays 0, drone still runs */ });

  // ── Master output ────────────────────────────────────────────────────────────
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.07;

  // ── Lowpass filter ───────────────────────────────────────────────────────────
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 30;
  droneFilter.Q.value = 6;
  droneFilter.connect(droneGain);

  // ── Collision accent gain ────────────────────────────────────────────────────
  const collisionGain = ctx.createGain();
  collisionGain.gain.value = 0;
  collisionGain.connect(droneGain);

  // ── Osc 1: deep sub sine ─────────────────────────────────────────────────────
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 8;
  osc1.connect(droneFilter);
  osc1.start();

  // ── Osc 3: sub octave sawtooth ───────────────────────────────────────────────
  const osc3 = ctx.createOscillator();
  osc3.type = 'sawtooth';
  osc3.frequency.value = 4;
  const g3 = ctx.createGain();
  g3.gain.value = 0.22;
  osc3.connect(g3);
  g3.connect(droneFilter);
  osc3.start();

  // ── Collision accent oscillator ──────────────────────────────────────────────
  const collOsc = ctx.createOscillator();
  collOsc.type = 'sine';
  collOsc.frequency.value = 18;
  collOsc.connect(collisionGain);
  collOsc.start();

  // ── LFO → filter cutoff ──────────────────────────────────────────────────────
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.03;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 6;
  lfo.connect(lfoGain);
  lfoGain.connect(droneFilter.frequency);
  lfo.start();

  // ── Noise → bandpass → master (silent below speed 0.45) ─────────────────────
  const sr = ctx.sampleRate;
  const nbuf = ctx.createBuffer(1, sr * 3, sr);
  const nd = nbuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const nsrc = ctx.createBufferSource();
  nsrc.buffer = nbuf;
  nsrc.loop = true;
  nsrc.start();
  const nbp = ctx.createBiquadFilter();
  nbp.type = 'bandpass';
  nbp.frequency.value = 400;
  nbp.Q.value = 0.6;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  nsrc.connect(nbp);
  nbp.connect(noiseGain);
  noiseGain.connect(droneGain);

  return {
    node: droneGain,
    tick() {
      // Mic level → sharedState.rms (read by mount each frame to boost spikes)
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i];
      sharedState.rms = Math.sqrt(sum / bins.length) / 255;

      // Drone modulation from simulation state
      const t = ctx.currentTime;
      const speed = sharedState.simSpeed;
      const targetFreq = 18 + speed * 40 + Math.abs(sharedState.rotX) * 35;
      droneFilter.frequency.setTargetAtTime(targetFreq, t, 2.5);
      lfo.frequency.setTargetAtTime(0.06 + speed * 0.12, t, 4.0);

      // Collisions → brief resonance accent
      const collN = sharedState.collisionCount;
      if (collN > 0) {
        const intensity = Math.min(collN * 0.015, 0.08);
        collisionGain.gain.cancelScheduledValues(t);
        collisionGain.gain.setValueAtTime(intensity, t);
        collisionGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        droneFilter.Q.cancelScheduledValues(t);
        droneFilter.Q.setValueAtTime(3.5 + collN * 1.2, t);
        droneFilter.Q.setTargetAtTime(3.5, t + 0.05, 0.15);
        sharedState.collisionCount = 0;
      }

      // Noise gate above speed 0.45
      if (speed <= 0.45) {
        noiseGain.gain.setTargetAtTime(0, t, 0.1);
      } else {
        noiseGain.gain.setTargetAtTime((speed - 0.45) / 0.05 * 0.15, t, 3.0);
      }

      // Master gain tracks speed subtly
      const targetGain = speed < 0.05 ? 0.005 : 0.06 + Math.min(speed, 3) * 0.012;
      droneGain.gain.setTargetAtTime(targetGain, t, 0.6);
    },
    dispose() {
      // Stop mic capture so the browser recording indicator turns off
      if (mediaStream) {
        for (const track of mediaStream.getTracks()) track.stop();
        mediaStream = null;
      }
      sharedState.rms = 0;
    }
  };
};
