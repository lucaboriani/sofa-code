import type { AudioFactory } from '@/lib/audio/bus';
import { sharedState } from './state';

// ─── Audio factory (catfish.html L57-228) ────────────────────────────────────
// The standalone file owned its own AudioContext + on/off button; here the bus
// owns the context and fade. The per-frame updateDrone() becomes tick(), and
// the one-shot shock/collision sounds are fired by draining sharedState
// counters. Formulas are verbatim.

export const createAudio: AudioFactory = (ctx) => {
  const out = ctx.createGain();
  out.gain.value = 1;

  // ── Ambient drone bed ──────────────────────────────────────────────────────
  const master = ctx.createGain();
  master.gain.value = 0.0;
  master.connect(out);

  const bed = ctx.createOscillator(); bed.type = 'sine'; bed.frequency.value = 48;
  const bedG = ctx.createGain(); bedG.gain.value = 0.06;
  bed.connect(bedG); bedG.connect(master); bed.start();

  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12;
  const lfoG = ctx.createGain(); lfoG.gain.value = 6;
  lfo.connect(lfoG); lfoG.connect(bed.frequency); lfo.start();

  // ── Ethereal shimmer layer ──────────────────────────────────────────────────
  const etherMaster = ctx.createGain(); etherMaster.gain.value = 0.0;
  etherMaster.connect(out);

  const dL = ctx.createDelay(2); dL.delayTime.value = 0.52;
  const dR = ctx.createDelay(2); dR.delayTime.value = 0.78;
  const fbL = ctx.createGain(); fbL.gain.value = 0.42;
  const fbR = ctx.createGain(); fbR.gain.value = 0.38;
  dL.connect(fbL); fbL.connect(dR);
  dR.connect(fbR); fbR.connect(dL);
  dL.connect(etherMaster); dR.connect(etherMaster);

  const etherFreqs = [523.25, 659.26, 783.99]; // C5, E5, G5
  const etherFilter = ctx.createBiquadFilter();
  etherFilter.type = 'lowpass'; etherFilter.frequency.value = 2000; etherFilter.Q.value = 1.2;
  etherFilter.connect(etherMaster);

  const etherOscs: { osc: OscillatorNode; gain: GainNode; base: number }[] = [];
  for (let i = 0; i < etherFreqs.length; i++) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.value = etherFreqs[i] + (Math.random() - 0.5) * 1.5;
    const g = ctx.createGain(); g.gain.value = 0;
    const trem = ctx.createOscillator(); trem.frequency.value = 0.07 + i * 0.04;
    const tremG = ctx.createGain(); tremG.gain.value = 0.018;
    trem.connect(tremG); tremG.connect(g.gain); trem.start();
    o.connect(g); g.connect(dL); g.connect(etherFilter);
    o.start();
    etherOscs.push({ osc: o, gain: g, base: etherFreqs[i] });
  }

  // ── Single bubble (catfish.html L157-170) ──────────────────────────────────
  function scheduleBubble(freq: number, vol: number, at: number): void {
    const now = at;
    const dur = 0.06 + Math.random() * 0.08;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, now);
    o.frequency.linearRampToValueAtTime(freq * (1.6 + Math.random()), now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(master);
    o.start(now); o.stop(now + dur + 0.01);
  }

  // ── One-shots (catfish.html L66-95) ────────────────────────────────────────
  function playShock(): void {
    const len = ctx.sampleRate * 0.18;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.8, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(); src.stop(ctx.currentTime + 0.18);
  }
  function playCollision(): void {
    const len2 = ctx.sampleRate * 0.04;
    const buf2 = ctx.createBuffer(1, len2, ctx.sampleRate);
    const d2 = buf2.getChannelData(0);
    for (let i = 0; i < len2; i++) d2[i] = Math.random() * 2 - 1;
    const src2 = ctx.createBufferSource(); src2.buffer = buf2;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.022, ctx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
    src2.connect(hp); hp.connect(g2); g2.connect(out);
    src2.start(); src2.stop(ctx.currentTime + 0.04);
  }

  let lastShocks = sharedState.shocks;
  let lastCollisions = sharedState.collisions;
  let nextBubble = 0; // seconds
  let rate = 1.2;

  return {
    node: out,
    tick(): void {
      const now = ctx.currentTime;

      // Drain one-shot triggers (cap to avoid runaway bursts after a stall).
      const pendingShock = sharedState.shocks - lastShocks;
      lastShocks = sharedState.shocks;
      for (let i = 0; i < Math.min(pendingShock, 4); i++) playShock();
      const pendingColl = sharedState.collisions - lastCollisions;
      lastCollisions = sharedState.collisions;
      for (let i = 0; i < Math.min(pendingColl, 4); i++) playCollision();

      // updateDrone(now_ts) — catfish.html L172-228, formulas verbatim
      const dispersion = sharedState.dispersion;
      const mx = sharedState.hasPointer ? sharedState.mx : 0.5;
      const my = sharedState.hasPointer ? sharedState.my : 0.5;

      master.gain.setTargetAtTime(0.05 + dispersion * 0.12, now, 0.8);

      const cutoff = 400 + (1 - my) * 3600;
      etherFilter.frequency.setTargetAtTime(cutoff, now, 0.4);
      const chorus = (mx - 0.5) * 6;
      etherOscs.forEach((e, i) => {
        const drift = 1 + dispersion * 0.015 * (i % 2 === 0 ? 1 : -1);
        const sign = i === 1 ? -1 : 1;
        e.osc.frequency.setTargetAtTime(e.base * drift + chorus * sign, now, 0.6);
        e.gain.gain.setTargetAtTime(0.05 + dispersion * 0.025, now, 2.0);
      });
      const etherVol = 0.004 + (1 - my) * 0.008 + dispersion * 0.004;
      etherMaster.gain.setTargetAtTime(etherVol, now, 2.0);

      const bubbleLo = 180 + mx * 220;
      const bubbleHi = 400 + mx * 700;
      rate = 0.5 + dispersion * 3.5;

      if (now > nextBubble) {
        const interval = 1 / rate; // seconds
        nextBubble = now + interval * (0.6 + Math.random() * 0.8);
        const freq = bubbleLo + Math.random() * (bubbleHi - bubbleLo);
        const vol = 0.03 + Math.random() * 0.05;
        scheduleBubble(freq, vol, now);
        if (Math.random() < 0.25) {
          const delay = 0.04 + Math.random() * 0.06;
          scheduleBubble(freq * (1 + Math.random() * 0.2), vol * 0.6, now + delay);
        }
      }
    }
  };
};
