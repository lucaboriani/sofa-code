import type { AudioFactory } from '@/lib/audio/bus';
import { sharedState } from './state';

// ─── Audio factory (bindu.html L235-431) ─────────────────────────────────────

export const createAudio: AudioFactory = (ctx) => {
  // master is the node handed to the AudioBus (original connected it to destination)
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 5);

  // Long cave reverb (6 s)
  const conv = ctx.createConvolver();
  const irLen = Math.floor(ctx.sampleRate * 6);
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 1.35);
  }
  conv.buffer = ir;
  const convG = ctx.createGain();
  convG.gain.value = 0.65;
  conv.connect(convG); convG.connect(master);

  // Dry
  const dry = ctx.createGain();
  dry.gain.value = 0.35;
  dry.connect(master);

  // Low-pass — drag horizontal controls cutoff
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = 380; lpf.Q.value = 0.5;
  lpf.connect(dry); lpf.connect(conv);

  // Global pitch detune — drag vertical
  const det = ctx.createConstantSource();
  det.offset.value = 0;
  det.start();

  const ROOT = 55;

  const voices = [
    { d: 0, a: 0.30 }, { d: -4, a: 0.22 }, { d: 5, a: 0.20 }, { d: -8, a: 0.17 },
    { d: 13, a: 0.14 }, { d: -15, a: 0.11 }, { d: 20, a: 0.09 }, { d: -23, a: 0.08 }
  ];
  const harmonics = [
    { r: 1, g: 0.58 }, { r: 2, g: 0.30 }, { r: 3, g: 0.20 }, { r: 4, g: 0.09 },
    { r: 5, g: 0.14 }, { r: 6, g: 0.06 }, { r: 8, g: 0.04 }
  ];

  voices.forEach(({ d, a }) => {
    const vg = ctx.createGain();
    vg.gain.value = a;
    vg.connect(lpf);
    harmonics.forEach(({ r, g }) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = ROOT * r;
      osc.detune.value = d;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13 + Math.random() * 0.09;
      const lg = ctx.createGain();
      lg.gain.value = 0.8 + Math.random() * 0.6;
      lfo.connect(lg); lg.connect(osc.detune); lfo.start();
      det.connect(osc.detune);
      const hg = ctx.createGain();
      hg.gain.value = g;
      osc.connect(hg); hg.connect(vg); osc.start();
    });
  });

  // Sub: 27.5 Hz
  const sub = ctx.createOscillator();
  sub.type = 'sine'; sub.frequency.value = ROOT * 0.5;
  const subG = ctx.createGain();
  subG.gain.value = 0.12;
  det.connect(sub.detune);
  sub.connect(subG); subG.connect(master); sub.start();

  // Slow breath swell ~8s
  const sw = ctx.createOscillator();
  sw.frequency.value = 0.12;
  const swG = ctx.createGain();
  swG.gain.value = 0.05;
  sw.connect(swG); swG.connect(master.gain); sw.start();

  // Vowel bandpass, parallel with lpf
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass'; bpf.frequency.value = 220; bpf.Q.value = 4.5;
  lpf.connect(bpf);
  const bpG = ctx.createGain();
  bpG.gain.value = 0.12;
  bpf.connect(bpG); bpG.connect(dry); bpG.connect(conv);

  // Random walkers (original setInterval(50ms) → tick-driven accumulator)
  interface Walker { cur: number; target: number; min: number; max: number; nextAt: number; onTick(v: number): void; }
  const walkers: Walker[] = [
    {
      cur: 380, target: 380, min: 120, max: 700, nextAt: 0,
      onTick: v => { lpf.frequency.setTargetAtTime(v, ctx.currentTime, 1.2); }
    },
    {
      cur: 0.22, target: 0.22, min: 0.16, max: 0.26, nextAt: 0,
      onTick: v => { master.gain.setTargetAtTime(v, ctx.currentTime, 2.5); }
    },
    {
      cur: 220, target: 220, min: 90, max: 480, nextAt: 0,
      onTick: v => { bpf.frequency.setTargetAtTime(v, ctx.currentTime, 1.8); }
    }
  ];
  function scheduleWalker(w: Walker): void {
    w.target = w.min + Math.random() * (w.max - w.min);
    w.nextAt = ctx.currentTime + 4 + Math.random() * 10;
  }
  walkers.forEach(scheduleWalker);
  let lastWalk = ctx.currentTime;

  // Zoom-reactive white noise
  const noiseLen = Math.floor(ctx.sampleRate * 2);
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
  const noiseNode = ctx.createBufferSource();
  noiseNode.buffer = noiseBuf;
  noiseNode.loop = true;
  noiseNode.start();

  const nhpf = ctx.createBiquadFilter();
  nhpf.type = 'highpass'; nhpf.frequency.value = 800; nhpf.Q.value = 0.7;
  noiseNode.connect(nhpf);

  const nbpf = ctx.createBiquadFilter();
  nbpf.type = 'bandpass'; nbpf.frequency.value = 3000; nbpf.Q.value = 1.2;
  nhpf.connect(nbpf);

  const ng = ctx.createGain();
  ng.gain.value = 0;
  nbpf.connect(ng);
  ng.connect(master);

  return {
    node: master,
    tick(): void {
      const now = ctx.currentTime;

      // walkers at the original 50ms cadence (bindu.html L343-352)
      if (now - lastWalk >= 0.05) {
        lastWalk = now;
        for (const w of walkers) {
          w.cur += (w.target - w.cur) * 0.08;
          w.onTick(w.cur);
          if (now >= w.nextAt) scheduleWalker(w);
        }
      }

      // updateAudio(vx, vy, zoom) — bindu.html L389-431, formulas verbatim
      const vx = sharedState.dragX, vy = sharedState.dragY, zoom = sharedState.dist;

      const nt = Math.max(0, (9 - zoom) / (9 - 0.3));
      const noiseAmt = Math.min(0.025, 0.025 * Math.pow(nt, 4));
      ng.gain.setTargetAtTime(noiseAmt, now, 0.6);
      const hpTarget = Math.max(200, Math.min(4000, 800 + vx * 60));
      nhpf.frequency.setTargetAtTime(hpTarget, now, 0.15);
      const bpTarget = Math.max(800, Math.min(8000, 3000 - vy * 80));
      nbpf.frequency.setTargetAtTime(bpTarget, now, 0.15);

      const baseF = walkers[0].cur;
      const targetF = Math.max(40, Math.min(1800, baseF + vx * 55));
      lpf.frequency.setTargetAtTime(targetF, now, 0.12);

      const targetD = Math.max(-200, Math.min(200, -vy * 11));
      det.offset.setTargetAtTime(targetD, now, 0.18);

      const baseB = walkers[2].cur;
      const targetB = Math.max(60, Math.min(900, baseB + vx * 30));
      bpf.frequency.setTargetAtTime(targetB, now, 0.18);

      const baseG = walkers[1].cur;
      const targetG = Math.max(0.06, Math.min(0.40, baseG - vy * 0.008));
      walkers[1].cur = targetG;
    }
  };
};
