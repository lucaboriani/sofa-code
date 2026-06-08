import type { AudioFactory } from '@/lib/audio/bus';
import { sharedState } from './state';

// ─── Audio factory (line-of-beauty.html L336-582) ────────────────────────────
// A golden-ratio drone whose band-pass filter is swept by the curve's rotation
// and drag velocity; the six construction axes are a harp tuned to PHI
// intervals. The bus owns the context/fade. String hits arrive through
// sharedState queues; the per-frame filter sweep runs from tick(). Verbatim.

const PHI = 1.6180339887;

const axisPitches = [
  110 * Math.pow(PHI, 0),
  110 * Math.pow(PHI, 1 / PHI),
  110 * Math.pow(PHI, -1 / PHI),
  110 * Math.pow(PHI, 1),
  110 * Math.pow(PHI, -1),
  110 * Math.pow(PHI, PHI)
];

export const createAudio: AudioFactory = (ctx) => {
  const master = ctx.createGain();
  master.gain.value = 0.0;
  master.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 4);

  const filterNode = ctx.createBiquadFilter();
  filterNode.type = 'bandpass';
  filterNode.frequency.value = 200;
  filterNode.Q.value = 1.2;
  filterNode.connect(master);

  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = 0.38;
  const delGain = ctx.createGain();
  delGain.gain.value = 0.3;
  delay.connect(delGain);
  delGain.connect(delay);
  delGain.connect(master);

  const bases = [
    55.0,
    55.0 * PHI,
    55.0 / PHI,
    55.0 * PHI * PHI,
    55.0 / (PHI * PHI),
    55.0 * Math.sqrt(5)
  ];

  bases.forEach((bf, fi) => {
    [-2, -1, 0, 1, 2].forEach((n, ni) => {
      const freq = bf * Math.pow(PHI, n);
      if (freq < 25 || freq > 900) return;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = (n === 0 ? 0.04 : 0.02) / bases.length;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.03 + fi * 0.007 * PHI + ni * 0.003;
      const lg = ctx.createGain();
      lg.gain.value = g.gain.value * 0.2;
      lfo.connect(lg);
      lg.connect(g.gain);
      lfo.start();
      osc.connect(g);
      g.connect(filterNode);
      g.connect(delay);
      osc.start();
    });
  });

  let struckOsc: OscillatorNode | null = null;

  function hoverSound(axis: number, prox: number): void {
    const now = ctx.currentTime;
    const freq = axisPitches[axis];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gTone = ctx.createGain();
    gTone.gain.setValueAtTime(0.008 + prox * 0.008, now);
    gTone.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc.connect(gTone); gTone.connect(master);
    osc.start(now); osc.stop(now + 0.6);

    const bufLen = Math.floor(ctx.sampleRate * 0.04);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass'; nbp.frequency.value = freq * 1.5; nbp.Q.value = 2;
    const gNoise = ctx.createGain();
    gNoise.gain.setValueAtTime(0.01 + prox * 0.008, now);
    gNoise.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    noise.connect(nbp); nbp.connect(gNoise); gNoise.connect(master);
    noise.start(now); noise.stop(now + 0.04);
  }

  function pluckSound(axis: number, prox: number): void {
    const now = ctx.currentTime;
    if (struckOsc) { try { struckOsc.stop(); } catch { /* already stopped */ } struckOsc = null; }
    const freq = axisPitches[axis];

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.frequency.setTargetAtTime(freq * 0.92, now, 0.6);
    const gTone = ctx.createGain();
    gTone.gain.setValueAtTime(0.04 + prox * 0.06, now);
    gTone.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    osc.connect(gTone); gTone.connect(master);
    osc.start(now); osc.stop(now + 1.8);
    struckOsc = osc;

    const bufLen = ctx.sampleRate * 0.12;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass'; nbp.frequency.value = freq * 1.5; nbp.Q.value = 1.8;
    const gNoise = ctx.createGain();
    gNoise.gain.setValueAtTime(0.06 + prox * 0.05, now);
    gNoise.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    noise.connect(nbp); nbp.connect(gNoise); gNoise.connect(master);
    noise.start(now); noise.stop(now + 0.12);

    filterNode.frequency.setTargetAtTime(freq * 1.5, now, 0.04);
    filterNode.Q.setTargetAtTime(3, now, 0.04);
    filterNode.frequency.setTargetAtTime(200, now + 0.4, 0.35);
    filterNode.Q.setTargetAtTime(1.2, now + 0.4, 0.35);
  }

  function updateFilter(angle: number, vel: number, dragging: boolean): void {
    const now = ctx.currentTime;
    if (dragging && Math.abs(vel) > 0.5) {
      const speed = Math.max(-1, Math.min(1, vel / 30));
      const norm = (speed + 1) / 2;
      const minF = 60, maxF = 3200;
      const cutoff = minF * Math.pow(maxF / minF, norm);
      filterNode.frequency.setTargetAtTime(cutoff, now, 0.03);
      filterNode.Q.setTargetAtTime(1.0 + 8.0 * Math.abs(speed), now, 0.03);
      master.gain.setTargetAtTime(0.85, now, 0.05);
    } else {
      const norm = (Math.sin(angle) + 1) / 2;
      const minF = 80, maxF = 900;
      const cutoff = minF * Math.pow(maxF / minF, norm);
      filterNode.frequency.setTargetAtTime(cutoff, now, 0.4);
      filterNode.Q.setTargetAtTime(1.0 + 1.5 * Math.abs(Math.cos(angle)), now, 0.4);
      master.gain.setTargetAtTime(0.7, now, 0.3);
    }
  }

  return {
    node: master,
    tick(): void {
      let hit = sharedState.pluck.shift();
      while (hit) {
        if (hit.axis >= 0 && hit.axis < axisPitches.length) pluckSound(hit.axis, hit.prox);
        hit = sharedState.pluck.shift();
      }
      let h = sharedState.hover.shift();
      while (h) {
        if (h.axis >= 0 && h.axis < axisPitches.length) hoverSound(h.axis, h.prox);
        h = sharedState.hover.shift();
      }
      updateFilter(sharedState.angle, sharedState.dragVel, sharedState.isDragging);
    }
  };
};
