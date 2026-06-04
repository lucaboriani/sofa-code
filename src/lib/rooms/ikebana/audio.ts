import type { AudioFactory } from '@/lib/audio/bus';
import type { BranchGeom } from './types';
import { sharedState, audioLink } from './state';

// ─── Audio factory (ikebana.html L239-401, 570-723) ─────────────────────────

export const createAudio: AudioFactory = (ctx) => {
  // out is the single node handed to the AudioBus — everything that connected
  // to AC.destination in the original connects here instead.
  const out = ctx.createGain();
  out.gain.value = 1;

  // Reverb impulse (3 s)
  const conv = ctx.createConvolver();
  const irN = Math.floor(ctx.sampleRate * 3.0);
  const irBuf = ctx.createBuffer(2, irN, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = irBuf.getChannelData(ch);
    for (let i = 0; i < irN; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irN, 1.9);
  }
  conv.buffer = irBuf;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.001, ctx.currentTime);
  masterGain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.05);
  const revSend = ctx.createGain();
  revSend.gain.value = 0.42;
  conv.connect(out);

  // Drag filter: masterGain → droneFilter → out (+ reverb send from filter)
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 800;
  droneFilter.Q.value = 1.8;
  masterGain.connect(droneFilter);
  droneFilter.connect(out);
  droneFilter.connect(revSend);
  revSend.connect(conv);

  // 7-oscillator drone
  const defs: { f: number; t: OscillatorType; g: number }[] = [
    { f: 55,    t: 'sine',     g: 0.40 },
    { f: 55.3,  t: 'sine',     g: 0.24 },
    { f: 82.4,  t: 'sine',     g: 0.18 },
    { f: 110,   t: 'triangle', g: 0.12 },
    { f: 110.5, t: 'sine',     g: 0.07 },
    { f: 165,   t: 'triangle', g: 0.05 },
    { f: 220,   t: 'sine',     g: 0.03 }
  ];
  const droneOscs = defs.map(def => {
    const osc = ctx.createOscillator();
    osc.type = def.t;
    osc.frequency.value = def.f;
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.02 + Math.random() * 0.06;
    lfoG.gain.value = def.f * 0.0018;
    lfo.connect(lfoG); lfoG.connect(osc.frequency); lfo.start();
    const gNode = ctx.createGain();
    gNode.gain.value = def.g;
    osc.connect(gNode); gNode.connect(masterGain); osc.start();
    return { osc, gNode, lfo, lfoG, baseFreq: def.f, baseGain: def.g };
  });

  // Breath LFO
  const breathOsc = ctx.createOscillator();
  breathOsc.frequency.value = 0.055;
  const breathG = ctx.createGain();
  breathG.gain.value = 0.12;
  breathOsc.connect(breathG); breathG.connect(masterGain.gain); breathOsc.start();

  // ── Per-branch shimmer (ikebana.html L325-382) ─────────────────────────────
  const SHIMMER_REGISTERS = [90, 115, 140, 170, 110];
  const SHIMMER_CHARS = [
    { wave: 'triangle' as OscillatorType, lpFMult: 2.0, lpQ: 0.6, gain: 0.028, atk: 0.08, dec: 0.50, rel: 0.90 },
    { wave: 'sine' as OscillatorType,     lpFMult: 3.0, lpQ: 1.2, gain: 0.024, atk: 0.05, dec: 0.35, rel: 0.70 },
    { wave: 'triangle' as OscillatorType, lpFMult: 1.4, lpQ: 3.5, gain: 0.030, atk: 0.03, dec: 0.25, rel: 0.55 },
    { wave: 'sawtooth' as OscillatorType, lpFMult: 1.8, lpQ: 2.8, gain: 0.020, atk: 0.02, dec: 0.20, rel: 0.45 },
    { wave: 'sine' as OscillatorType,     lpFMult: 2.5, lpQ: 0.5, gain: 0.016, atk: 0.10, dec: 0.55, rel: 1.00 }
  ];
  const SHIMMER_NOISE_AMTS = [0.008, 0.005, 0.012, 0.006, 0.020];

  function playShimmer(angle: number, branchIdx: number): void {
    const idx = branchIdx || 0;
    const delay = Math.random() * 0.06;
    const t = ctx.currentTime + delay;

    const freq = (SHIMMER_REGISTERS[idx] ?? 120) * (1 + ((angle + Math.PI) / (Math.PI * 2)) * 0.8);
    const C = SHIMMER_CHARS[idx] ?? SHIMMER_CHARS[0];

    const osc = ctx.createOscillator();
    osc.type = C.wave;
    osc.frequency.value = freq;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = freq * C.lpFMult;
    lp.Q.value = C.lpQ;

    const nLen = Math.floor(ctx.sampleRate * C.rel);
    const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = nBuf;
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = 'bandpass'; nFilt.frequency.value = freq * 1.3; nFilt.Q.value = 3;
    const nG = ctx.createGain();
    nG.gain.value = SHIMMER_NOISE_AMTS[idx] ?? 0.008;
    nSrc.connect(nFilt); nFilt.connect(nG);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(C.gain, t + C.atk);
    env.gain.linearRampToValueAtTime(C.gain * 0.35, t + C.dec);
    env.gain.linearRampToValueAtTime(0.0001, t + C.rel);

    osc.connect(lp); lp.connect(env);
    nG.connect(env);
    env.connect(out);
    osc.start(t); osc.stop(t + C.rel + 0.05);
    nSrc.start(t); nSrc.stop(t + C.rel + 0.05);
  }

  // ── Harmonic bloom (ikebana.html L385-401) ─────────────────────────────────
  function playBloom(rootFreq: number): void {
    const t = ctx.currentTime + 0.02;
    [1, 1.5, 2, 2.5].forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i < 2 ? 'sine' : 'triangle';
      osc.frequency.value = rootFreq * ratio;
      const onset = t + i * 0.18;
      g.gain.setValueAtTime(0.001, onset);
      g.gain.linearRampToValueAtTime(0.07 / (i * 0.5 + 1), onset + 0.45);
      g.gain.linearRampToValueAtTime(0.03 / (i * 0.5 + 1), onset + 2.0);
      g.gain.linearRampToValueAtTime(0.0001, onset + 4.0);
      osc.connect(g); g.connect(out);
      osc.start(onset); osc.stop(onset + 4.5);
    });
  }

  // ── Looped touch voice (ikebana.html L570-723) ─────────────────────────────
  interface TouchVoice {
    oscs: OscillatorNode[];
    subOsc: OscillatorNode | null;
    env: GainNode;
    wingOsc: OscillatorNode;
    wobOsc: OscillatorNode;
    noiseSrc: AudioBufferSourceNode;
    noiseBP: BiquadFilterNode;
  }
  let touchVoice: TouchVoice | null = null;

  const PERSONALITIES = [
    { waves: ['sawtooth', 'sawtooth', 'sawtooth'] as OscillatorType[], detunes: [0, +6, -7], bpFreqMult: 2.2, bpQ: 1.8, lpFreq: 600, wobRate: 5, wobDepth: 0.18, wingDepth: 0.55, noiseQ: 3, noiseMult: 1.0, noiseAmt: 0.035, mixGain: 0.28 },
    { waves: ['square', 'triangle', 'square'] as OscillatorType[],     detunes: [0, +3, -3], bpFreqMult: 2.8, bpQ: 2.5, lpFreq: 750, wobRate: 7, wobDepth: 0.14, wingDepth: 0.40, noiseQ: 5, noiseMult: 1.2, noiseAmt: 0.028, mixGain: 0.26 },
    { waves: ['triangle', 'triangle', 'triangle'] as OscillatorType[], detunes: [0, +2, -2], bpFreqMult: 2.0, bpQ: 4.5, lpFreq: 500, wobRate: 4, wobDepth: 0.22, wingDepth: 0.35, noiseQ: 6, noiseMult: 0.8, noiseAmt: 0.020, mixGain: 0.34 },
    { waves: ['sawtooth', 'sawtooth', 'triangle'] as OscillatorType[], detunes: [0, +5, -4], bpFreqMult: 3.5, bpQ: 3.0, lpFreq: 900, wobRate: 9, wobDepth: 0.12, wingDepth: 0.45, noiseQ: 4, noiseMult: 1.4, noiseAmt: 0.032, mixGain: 0.30 },
    { waves: ['sine', 'sine', 'triangle'] as OscillatorType[],         detunes: [0, +1, -1], bpFreqMult: 1.8, bpQ: 1.2, lpFreq: 400, wobRate: 3, wobDepth: 0.25, wingDepth: 0.20, noiseQ: 2, noiseMult: 0.9, noiseAmt: 0.065, mixGain: 0.22 }
  ];
  const TOUCH_REGISTERS = [90, 115, 140, 170, 110];

  function stopTouchVoice(): void {
    if (!touchVoice) return;
    const t = ctx.currentTime;
    const { oscs, subOsc, env, wingOsc, wobOsc, noiseSrc } = touchVoice;
    env.gain.cancelScheduledValues(t);
    env.gain.setValueAtTime(env.gain.value, t);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.22);
    const stopT = t + 0.30;
    oscs.forEach(o => o.stop(stopT));
    if (subOsc) subOsc.stop(stopT);
    wingOsc.stop(stopT);
    wobOsc.stop(stopT);
    noiseSrc.stop(stopT);
    touchVoice = null;
  }

  function startTouchVoice(angle: number, branchGeom: BranchGeom): void {
    stopTouchVoice();
    const t = ctx.currentTime;
    const idx = branchGeom.idx;

    const fund = (TOUCH_REGISTERS[idx] ?? 120) + ((angle + Math.PI) / (Math.PI * 2)) * 30;
    const P = PERSONALITIES[idx] ?? PERSONALITIES[0];

    const curve = branchGeom.curvature;
    const blen = branchGeom.length;
    const spread = branchGeom.angleSpread;

    const shapedBpQ = P.bpQ * (1 + curve * 1.4);
    const shapedLpFreq = P.lpFreq * (1 + spread * 0.5);
    const shapedWobRate = P.wobRate * (1 - blen * 0.4);
    const shapedWobD = P.wobDepth * (1 + blen * 0.6);
    const shapedDetune = P.detunes.map(d => d * (1 + spread));

    const oscs: OscillatorNode[] = [];
    P.waves.forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = fund * (1 + shapedDetune[i] * 0.0006);
      oscs.push(o);
    });

    let subOsc: OscillatorNode | null = null;
    if (idx === 3) {
      subOsc = ctx.createOscillator();
      subOsc.type = 'square';
      subOsc.frequency.value = fund * 0.5;
    }

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fund * P.bpFreqMult;
    bp.Q.value = shapedBpQ;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = shapedLpFreq;
    lp.Q.value = 0.7;

    const wingOsc = ctx.createOscillator();
    wingOsc.frequency.value = fund * 0.98;
    const wingGain = ctx.createGain();
    wingGain.gain.value = P.wingDepth;

    const wobOsc = ctx.createOscillator();
    wobOsc.frequency.value = shapedWobRate + Math.random() * 2;
    const wobGain = ctx.createGain();
    wobGain.gain.value = shapedWobD;

    const noiseLen = Math.floor(ctx.sampleRate * 2);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;
    const noiseBP = ctx.createBiquadFilter();
    noiseBP.type = 'bandpass';
    noiseBP.frequency.value = fund * P.noiseMult;
    noiseBP.Q.value = P.noiseQ;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = P.noiseAmt * (1 + curve * 0.5);
    noiseSrc.connect(noiseBP); noiseBP.connect(noiseGain);

    const mixer = ctx.createGain();
    mixer.gain.value = P.mixGain;
    oscs.forEach(o => o.connect(mixer));
    if (subOsc) {
      const sg = ctx.createGain();
      sg.gain.value = 0.4;
      subOsc.connect(sg); sg.connect(mixer);
    }
    mixer.connect(bp); bp.connect(lp);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.08, t + 0.14);
    wingOsc.connect(wingGain); wingGain.connect(env.gain);
    wobOsc.connect(wobGain); wobGain.connect(env.gain);
    lp.connect(env);
    noiseGain.connect(env);
    env.connect(out);

    oscs.forEach(o => o.start(t));
    wingOsc.start(t); wobOsc.start(t); noiseSrc.start(t);
    if (subOsc) subOsc.start(t);

    touchVoice = { oscs, subOsc, env, wingOsc, wobOsc, noiseSrc, noiseBP };
  }

  function retuneTouchVoice(newFund: number): void {
    if (!touchVoice) return;
    const t = ctx.currentTime;
    const { oscs, wingOsc, noiseBP } = touchVoice;
    const detunes = [0, +4, -5];
    oscs.forEach((o, i) => {
      const f = newFund * (1 + detunes[i] * 0.0006);
      o.frequency.setTargetAtTime(f, t, 0.04);
    });
    wingOsc.frequency.setTargetAtTime(newFund * 0.98, t, 0.04);
    noiseBP.frequency.setTargetAtTime(newFund * 1.1, t, 0.04);
  }

  // ── Drone surge on branch hit (ikebana.html L789-799) ──────────────────────
  function surgeDrone(colorR: number): void {
    const g = sharedState.geom;
    const lfoRateBase = g?.lfoRateBase ?? 0.06;
    const lfoDepthMult = g?.lfoDepthMult ?? 1;
    const t = ctx.currentTime;
    const surgeRate = lfoRateBase * 6;
    const surgeDepth = colorR * 0.08;
    droneOscs.forEach((d, di) => {
      d.lfo.frequency.setTargetAtTime(surgeRate * (0.8 + di * 0.1), t, 0.05);
      d.lfo.frequency.setTargetAtTime(lfoRateBase * (0.7 + di * 0.12), t + 0.8, 0.4);
      d.lfoG.gain.setTargetAtTime(d.baseFreq * 0.018 * surgeDepth * (0.6 + di * 0.1), t, 0.04);
      d.lfoG.gain.setTargetAtTime(d.baseFreq * 0.0018 * lfoDepthMult * (0.6 + di * 0.1), t + 1.0, 0.5);
    });
  }

  // ── morphDrone equivalent (ikebana.html L312-321) ──────────────────────────
  function resetDroneGains(): void {
    const t = ctx.currentTime;
    droneOscs.forEach(d => {
      d.gNode.gain.cancelScheduledValues(t);
      d.gNode.gain.setValueAtTime(0.0001, t);
    });
  }

  audioLink.current = { playShimmer, playBloom, startTouchVoice, retuneTouchVoice, stopTouchVoice, surgeDrone, resetDroneGains };

  // ── tick: continuous coupling (ikebana.html L416-461, 520-526, 540-543, 860-889) ──
  let appliedGeomVersion = -1;
  let prevPointerDown = false;

  return {
    node: out,
    tick(): void {
      const t = ctx.currentTime;
      const g = sharedState.geom;

      // New ikebana → apply staggered LFO rates/depths (launchIkebana L452-460)
      if (g && g.version !== appliedGeomVersion) {
        appliedGeomVersion = g.version;
        droneOscs.forEach((d, i) => {
          const rate = g.lfoRateBase * (0.7 + i * 0.12);
          const depth = d.baseFreq * 0.0018 * g.lfoDepthMult * (0.6 + i * 0.1);
          d.lfo.frequency.setTargetAtTime(rate, t, 1.5);
          d.lfoG.gain.setTargetAtTime(depth, t, 1.5);
        });
      }

      // Live drone morphing tied to draw progress (renderIkebana L860-889)
      droneOscs.forEach((d, i) => {
        const partialProg = Math.min(1, Math.max(0, (sharedState.avgProg - i * 0.04) / 0.85));
        const targetGain = d.baseGain * partialProg * (g ? g.gainScale[i] : 1.0);
        d.gNode.gain.setTargetAtTime(Math.max(0.0001, targetGain), t, 0.08);

        const finalFreq = Math.max(20, d.baseFreq * (g ? g.freqScale[i] : 1.0));
        const startFreq = finalFreq * 1.4;
        d.osc.frequency.setTargetAtTime(startFreq + (finalFreq - startFreq) * sharedState.avgProg, t, 0.3);
      });

      // Drag → filter cutoff/Q (pointerMove L520-526, pointerUp L540-543)
      if (sharedState.pointerDown) {
        const targetCutoff = 300 + Math.min(sharedState.dragVelocity * 4000, 1800);
        droneFilter.frequency.setTargetAtTime(targetCutoff, t, 0.08);
        droneFilter.Q.setTargetAtTime(1.4 + sharedState.dragVelocity * 6, t, 0.1);
      } else if (prevPointerDown) {
        droneFilter.frequency.setTargetAtTime(800, t, 0.5);
        droneFilter.Q.setTargetAtTime(1.8, t, 0.5);
      }
      prevPointerDown = sharedState.pointerDown;
    }
  };
};
