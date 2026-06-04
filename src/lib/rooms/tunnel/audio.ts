import type { AudioFactory, RoomAudio } from '@/lib/audio/bus';
import { sharedState } from './state';

// ── Audio factory — deep cinematic tunnel drone ───────────────────────────────
// Graph: 3 drone oscs → lowpass filter → tremolo → dry/reverb → masterGain
//        floor line oscs (sine beating) → masterGain
//        ceiling oscs (sine beating) + flanger → masterGain
//        white noise (bandpass) → masterGain
//        kick bus (impulses on tile crossings) → masterGain
// masterGain is returned as `node`; the AudioBus connects it to destination.
export const createAudio: AudioFactory = (ctx: AudioContext): RoomAudio => {
  // ── Master gain ─────────────────────────────────────────────────────────────
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  masterGain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 2.0);

  // ── Reverb IR (synthetic exponential decay) ──────────────────────────────────
  const irLen = Math.floor(ctx.sampleRate * 2.8);
  const irBuf = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = irBuf.getChannelData(ch);
    for (let i = 0; i < irLen; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.4);
    }
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = irBuf;
  convolver.connect(masterGain);

  // ── Lowpass filter ───────────────────────────────────────────────────────────
  const filterNode = ctx.createBiquadFilter();
  filterNode.type = 'lowpass';
  filterNode.frequency.value = 320;
  filterNode.Q.value = 2.8;

  // ── Tremolo ──────────────────────────────────────────────────────────────────
  const tremoloLFO = ctx.createOscillator();
  tremoloLFO.type = 'sine';
  tremoloLFO.frequency.value = 0.9;
  const tremoloGain = ctx.createGain();
  tremoloGain.gain.value = 0.08;
  tremoloLFO.connect(tremoloGain);
  const tremoloCarrier = ctx.createGain();
  tremoloCarrier.gain.value = 0.92;
  tremoloGain.connect(tremoloCarrier.gain);
  tremoloLFO.start();

  // ── Main sawtooth drone oscillators → filter → tremolo ───────────────────────
  const osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth'; osc1.frequency.value = 55;
  const osc2 = ctx.createOscillator();
  osc2.type = 'sawtooth'; osc2.frequency.value = 82.5; osc2.detune.value = 7;
  const osc3 = ctx.createOscillator();
  osc3.type = 'sine';     osc3.frequency.value = 27.5;
  const oscMix = ctx.createGain(); oscMix.gain.value = 0.38;
  osc1.connect(oscMix); osc2.connect(oscMix); osc3.connect(oscMix);
  oscMix.connect(filterNode);
  filterNode.connect(tremoloCarrier);

  const dryGain = ctx.createGain(); dryGain.gain.value = 0.72;
  const reverbGain = ctx.createGain(); reverbGain.gain.value = 0.28;
  tremoloCarrier.connect(dryGain);
  tremoloCarrier.connect(convolver);
  dryGain.connect(masterGain);
  reverbGain.connect(masterGain);
  // Note: convolver already connected to masterGain above; use reverbGain → convolver pattern
  // Actually let convolver feed reverbGain → masterGain for proper wet/dry:
  // Re-wire: convolver → reverbGain → masterGain (convolver already at masterGain, disconnect and rewire)
  convolver.disconnect();
  convolver.connect(reverbGain);
  reverbGain.connect(masterGain);

  osc1.start(); osc2.start(); osc3.start();

  // ── Kick bus (impulses on tile crossings) ────────────────────────────────────
  // kickOut compensates for the post-masterGain attenuation (~0.15 at steady
  // state) so the kick lands near the original loudness (which routed direct
  // to destination at gain 1.0). Routing through masterGain keeps the bus
  // crossfade working — kicks fade out cleanly on navigation.
  const kickOut = ctx.createGain(); kickOut.gain.value = 4.0;
  kickOut.connect(masterGain);

  const TILE_JS = 1.5;
  let lastTileIdx = 0;
  let kickCount = 0;

  function makeThump(when: number, startP: number, endP: number, pDecay: number, peak: number, tail: number): void {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(Math.max(startP, 1), when);
    o.frequency.exponentialRampToValueAtTime(Math.max(endP, 1), when + pDecay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(peak, when + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, when + tail);
    o.connect(env); env.connect(kickOut);
    o.start(when); o.stop(when + tail + 0.1);
  }

  function fireKick(spd: number): void {
    const now = ctx.currentTime + 0.02;
    const absSpd = Math.abs(spd);
    const rev = spd < 0;
    const slow = 1 - Math.min(absSpd / 12, 1);
    const sub = 52 + absSpd * 2;
    const pDec = 0.055 + slow * 0.03;
    const vel = 0.3 + Math.random() * 0.7;
    const peak = (0.62 + absSpd * 0.012) * vel;
    const tail = 0.22 + slow * 0.18;
    const startP = sub * (rev ? 2.2 : 2.8);
    const endP = rev ? sub * 1.35 : sub;
    makeThump(now, startP, endP, pDec, peak, tail * (rev ? 0.65 : 1.0));
  }

  // ── Floor line drone — two detuned sines + bandpass noise ────────────────────
  const lineOsc1 = ctx.createOscillator();
  lineOsc1.type = 'sine'; lineOsc1.frequency.value = 110;
  const lineOsc2 = ctx.createOscillator();
  lineOsc2.type = 'sine'; lineOsc2.frequency.value = 112;

  const noiseLen = ctx.sampleRate * 2;
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let ni = 0; ni < noiseLen; ni++) nd[ni] = Math.random() * 2 - 1;
  const noiseNode = ctx.createBufferSource();
  noiseNode.buffer = noiseBuf; noiseNode.loop = true;

  const noiseBP = ctx.createBiquadFilter();
  noiseBP.type = 'bandpass'; noiseBP.frequency.value = 300; noiseBP.Q.value = 1.8;
  noiseNode.connect(noiseBP);
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.65;
  noiseBP.connect(noiseGain);

  const lineMix = ctx.createGain(); lineMix.gain.value = 0.9;
  lineOsc1.connect(lineMix); lineOsc2.connect(lineMix); noiseGain.connect(lineMix);
  const lineGain = ctx.createGain(); lineGain.gain.value = 0.0;
  lineMix.connect(lineGain);
  lineGain.connect(masterGain);
  const lineRevGain = ctx.createGain(); lineRevGain.gain.value = 0.35;
  lineGain.connect(lineRevGain); lineRevGain.connect(convolver);

  lineOsc1.start(); lineOsc2.start(); noiseNode.start();

  // ── Ceiling drone — higher pitch + flanger ────────────────────────────────────
  const ceilOsc1 = ctx.createOscillator();
  ceilOsc1.type = 'sine'; ceilOsc1.frequency.value = 220;
  const ceilOsc2 = ctx.createOscillator();
  ceilOsc2.type = 'sine'; ceilOsc2.frequency.value = 222;

  const ceilNoiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const cnd = ceilNoiseBuf.getChannelData(0);
  for (let ci = 0; ci < noiseLen; ci++) cnd[ci] = Math.random() * 2 - 1;
  const ceilNoiseNode = ctx.createBufferSource();
  ceilNoiseNode.buffer = ceilNoiseBuf; ceilNoiseNode.loop = true;
  const ceilBP = ctx.createBiquadFilter();
  ceilBP.type = 'bandpass'; ceilBP.frequency.value = 440; ceilBP.Q.value = 1.4;
  ceilNoiseNode.connect(ceilBP);
  const ceilNoiseGain = ctx.createGain(); ceilNoiseGain.gain.value = 0.65;
  ceilBP.connect(ceilNoiseGain);

  const ceilMix = ctx.createGain(); ceilMix.gain.value = 0.9;
  ceilOsc1.connect(ceilMix); ceilOsc2.connect(ceilMix); ceilNoiseGain.connect(ceilMix);

  // Flanger: LFO-modulated delay mixed back with dry
  const flangerDelay = ctx.createDelay(0.02);
  flangerDelay.delayTime.value = 0.005;
  const flangerFeedback = ctx.createGain(); flangerFeedback.gain.value = 0.3;
  const flangerWet = ctx.createGain(); flangerWet.gain.value = 0.25;
  const flangerLFO = ctx.createOscillator();
  flangerLFO.type = 'sine'; flangerLFO.frequency.value = 0.25;
  const flangerDepth = ctx.createGain(); flangerDepth.gain.value = 0.0015;
  flangerLFO.connect(flangerDepth);
  flangerDepth.connect(flangerDelay.delayTime);
  ceilMix.connect(flangerDelay);
  flangerDelay.connect(flangerFeedback);
  flangerFeedback.connect(flangerDelay);
  flangerDelay.connect(flangerWet);
  flangerLFO.start();

  const ceilGain = ctx.createGain(); ceilGain.gain.value = 0.0;
  ceilMix.connect(ceilGain);
  flangerWet.connect(ceilGain);
  ceilGain.connect(masterGain);
  const ceilRevGain = ctx.createGain(); ceilRevGain.gain.value = 0.35;
  ceilGain.connect(ceilRevGain); ceilRevGain.connect(convolver);

  ceilOsc1.start(); ceilOsc2.start(); ceilNoiseNode.start();

  // ── LFO → filter cutoff for slow morph ──────────────────────────────────────
  const morphLFO = ctx.createOscillator();
  morphLFO.type = 'sine'; morphLFO.frequency.value = 0.07;
  const morphLFOGain = ctx.createGain(); morphLFOGain.gain.value = 60;
  morphLFO.connect(morphLFOGain);
  morphLFOGain.connect(filterNode.frequency);
  morphLFO.start();

  // ── Per-frame tick — modulate graph with sharedState ─────────────────────────
  const tick = (): void => {
    const now = ctx.currentTime;
    const tau = 0.12;
    const spd = sharedState.speed;
    const camT = sharedState.camTime;
    const absSpd = Math.abs(spd);

    // Filter cutoff sweeps with speed
    filterNode.frequency.setTargetAtTime(80 + absSpd * 46, now, tau);

    // Drone pitch-mod by speed
    const pm = 1.0 + spd * 0.008;
    osc1.frequency.setTargetAtTime(55   * pm, now, tau);
    osc2.frequency.setTargetAtTime(82.5 * pm, now, tau);
    osc3.frequency.setTargetAtTime(27.5 * pm, now, tau);

    // Tremolo rate varies with camera sway
    const swayAmt = Math.abs(Math.cos(camT * 0.089));
    tremoloLFO.frequency.setTargetAtTime(0.4 + swayAmt * 1.8, now, tau * 2);

    // Reverb wet/dry
    const wet = 0.18 + (1 - Math.min(absSpd / 12, 1)) * 0.38;
    reverbGain.gain.setTargetAtTime(wet, now, tau);
    dryGain.gain.setTargetAtTime(1.0 - wet * 0.5, now, tau);

    // Detune when reversing
    const det = spd < 0 ? spd * 8 : 0;
    osc1.detune.setTargetAtTime(det,       now, tau);
    osc3.detune.setTargetAtTime(det * 1.3, now, tau);

    // Floor line drone frequency wobble
    const freq = 110 + absSpd * 4 + Math.sin(camT * 0.19) * 8;
    lineOsc1.frequency.setTargetAtTime(freq,          now, 0.4);
    lineOsc2.frequency.setTargetAtTime(freq * 1.008,  now, 0.4);
    noiseBP.frequency.setTargetAtTime(freq * 0.9,     now, 0.5);

    // Ceiling drone frequency wobble
    const cFreq = 220 + absSpd * 5 + Math.cos(camT * 0.23) * 10;
    ceilOsc1.frequency.setTargetAtTime(cFreq,         now, 0.4);
    ceilOsc2.frequency.setTargetAtTime(cFreq * 1.007, now, 0.4);
    ceilBP.frequency.setTargetAtTime(cFreq * 0.85,    now, 0.5);

    // Kick on tile crossings
    const tileIdx = Math.floor(camT / TILE_JS);
    const delta = tileIdx - lastTileIdx;
    if (Math.abs(delta) >= 1) {
      lastTileIdx = tileIdx;
      kickCount++;
      if (kickCount % 2 === 0) fireKick(spd);
    }

    // Pixel-readback driven line drones — visual line density → audio gain
    lineGain.gain.setTargetAtTime(sharedState.floorBrightness * 0.9, now, 0.2);
    ceilGain.gain.setTargetAtTime(sharedState.ceilingBrightness * 0.7, now, 0.2);
  };

  return { node: masterGain, tick };
};
