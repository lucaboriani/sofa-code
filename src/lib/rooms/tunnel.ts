import type { RoomMount } from '@/lib/webgl/types';
import type { AudioFactory, RoomAudio } from '@/lib/audio/bus';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';

const MARCH_STEPS = { preview: 24, full: 48 } as const;

// ── Shared state (written by mount each frame, read by audio tick) ────────────
const sharedState = { speed: 3.5, camTime: 0 };

// ── Vertex shader (fullscreen triangle, no attributes) ────────────────────────
const VS_SRC = `#version 300 es
void main() {
  vec2 v[3];
  v[0] = vec2(-1.0,-1.0);
  v[1] = vec2( 3.0,-1.0);
  v[2] = vec2(-1.0, 3.0);
  gl_Position = vec4(v[gl_VertexID], 0.0, 1.0);
}`;

// ── Fragment shader — raymarched corridor tunnel ───────────────────────────────
// MARCH_STEPS is injected at compile time via string template below.
function buildFragSrc(marchSteps: number): string {
  return `#version 300 es
precision highp float;
#define MARCH_STEPS ${marchSteps}
uniform vec2  uRes;
uniform float uTime;
out vec4 fragColor;

const float HALF_FOV = 0.6283;
const float CORRIDOR = 1.0;
const float TILE     = 1.5;
const float FAR      = 36.0;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i=floor(p), f=fract(p), u=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),u.x),
             mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),u.x),u.y);
}

float fbm(vec2 p) {
  float v=0.0,a=0.5;
  for(int i=0;i<3;i++){v+=a*vnoise(p);p*=2.1;a*=0.5;}
  return v;
}

float fade(float d){float f=clamp(1.0-d/FAR,0.0,1.0);return f*f;}

float surface(float u,float v,bool dark){
  float tu=fract(u/TILE),tv=fract(v/TILE);
  bool lU=tu<0.04||tu>0.96;
  bool lV=tv<0.04||tv>0.96;
  float cu=floor(u/TILE),cv=floor(v/TILE);
  bool alt=mod(cu+cv,2.0)>0.5;
  float noise=fbm(vec2(tu,tv)*6.0+vec2(cu,cv)*31.7);
  float base=(lU||lV)?mix(0.5,0.65,noise*0.4)
                      :mix(alt?0.14:0.05,(alt?0.14:0.05)+0.12,noise*0.35);
  if(dark)base*=0.55;
  return base;
}

float postFX(vec2 fc,vec2 res){
  float scan=(mod(fc.y,2.0)<1.0)?0.82:1.0;
  vec2 d=fc/res-0.5;
  float vig=clamp(1.0-dot(d,d)*2.2,0.0,1.0);
  return scan*vig;
}

void main(){
  float camZ= uTime;
  float camX= sin(uTime*0.089)*0.38;
  float camY= cos(uTime*0.066)*0.28;
  float yaw = sin(uTime*0.054)*0.18;
  float pit = cos(uTime*0.077)*0.07;
  vec2 ndc=(gl_FragCoord.xy/uRes)*2.0-1.0;
  float asp=uRes.x/uRes.y;
  float px=ndc.x*asp*tan(HALF_FOV);
  float py=ndc.y*tan(HALF_FOV);
  float rdx=px*cos(yaw)-sin(yaw);
  float rdz=px*sin(yaw)+cos(yaw);
  float rdy=py+pit;
  rdx/=rdz; rdy/=rdz;
  float tL=(abs(rdx)>1e-5)?(-CORRIDOR-camX)/rdx:FAR; if(tL<=0.0)tL=FAR;
  float tR=(abs(rdx)>1e-5)?( CORRIDOR-camX)/rdx:FAR; if(tR<=0.0)tR=FAR;
  float tT=(abs(rdy)>1e-5)?( CORRIDOR-camY)/rdy:FAR; if(tT<=0.0)tT=FAR;
  float tB=(abs(rdy)>1e-5)?(-CORRIDOR-camY)/rdy:FAR; if(tB<=0.0)tB=FAR;
  float tSide=min(tL,tR),tTB=min(tT,tB);
  float t=min(tSide,tTB);
  bool isSide=tSide<tTB;
  float hitZ=camZ+t;
  float halfH=1.0/(t+1e-5);
  float pitNDC=pit*1.4;
  float wTop=pitNDC+halfH;
  float wBot=pitNDC-halfH;
  float grey;
  if(ndc.y<=wTop&&ndc.y>=wBot){
    float v=(ndc.y-wBot)/(wTop-wBot);
    grey=surface(hitZ,v*TILE*2.0,!isSide)*fade(t);
  } else {
    float rowOff=abs(ndc.y-pitNDC);
    float rowDist=clamp(rowOff>1e-4?1.0/rowOff:FAR,0.0,FAR);
    float wx=camX+rdx*rowDist;
    float wz=camZ+rowDist;
    grey=surface(wx*2.0,wz,false)*fade(rowDist)*0.45;
  }
  grey*=postFX(gl_FragCoord.xy,uRes);
  fragColor=vec4(vec3(grey),1.0);
}`;
}

// Max pixel buffer size — allocated once at mount to avoid per-frame allocation.
// Sized for 6 rows at max likely width (4096px).
const MAX_PIXEL_BUF_BYTES = 4096 * 6 * 4;

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
  masterGain.gain.value = 0.15;

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
  const kickOut = ctx.createGain(); kickOut.gain.value = 0.5;
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
  const lineGain = ctx.createGain(); lineGain.gain.value = 0.4;
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

  const ceilGain = ctx.createGain(); ceilGain.gain.value = 0.3;
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
  };

  return { node: masterGain, tick };
};

export const mount: RoomMount = (canvas, opts) => {
  // ── WebGL2 context ──────────────────────────────────────────────────────────
  const gl = createContext(canvas, {
    version: 2,
    antialias: false,
    alpha: false,
    depth: false,
  }) as WebGL2RenderingContext;

  // Verify we actually got WebGL2 — createContext may fall back to WebGL1.
  // Guard with typeof check so test environments without WebGL2RenderingContext
  // global (e.g. jsdom) can still exercise mount/teardown paths.
  if (typeof WebGL2RenderingContext !== 'undefined' && !(gl instanceof WebGL2RenderingContext)) {
    throw new Error('WebGL2 required for tunnel');
  }

  // ── AbortController for shared teardown ────────────────────────────────────
  const ac = new AbortController();
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => ac.abort(), { once: true });
  }

  // ── Compile shaders ─────────────────────────────────────────────────────────
  const marchSteps = MARCH_STEPS[opts.quality];
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, buildFragSrc(marchSteps));
  const program = linkProgram(gl, vs, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  gl.useProgram(program);

  const uniforms = getUniforms(gl, program, ['uRes', 'uTime'] as const);

  // ── Pixel readback buffer — allocated once ─────────────────────────────────
  // 6 rows (3 floor + 3 ceiling): used by audio subsystem to sample bright pixels.
  // We allocate enough for any reasonable canvas width; actual width capped by MAX.
  const pixelBuf = new Uint8Array(MAX_PIXEL_BUF_BYTES);

  // ── Resolution tracking ────────────────────────────────────────────────────
  let RW = 1;
  let RH = 1;

  const stopResize = observeResize(canvas, () => {
    RW = canvas.width;
    RH = canvas.height;
    gl.viewport(0, 0, RW, RH);
  });

  // Initial dimensions from observeResize call.
  RW = canvas.width || 1;
  RH = canvas.height || 1;

  // ── Drag-to-speed pointer state ────────────────────────────────────────────
  let speed = 3.5;
  let dragActive = false;
  let dragY0 = 0;

  const onDown = (e: PointerEvent): void => {
    dragActive = true;
    dragY0 = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent): void => {
    if (!dragActive) return;
    speed -= (e.clientY - dragY0) * 0.03;
    speed = Math.max(-12, Math.min(18, speed));
    dragY0 = e.clientY;
  };

  const onUp = (_e: PointerEvent): void => {
    dragActive = false;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  // ── Camera time accumulator ────────────────────────────────────────────────
  let camTime = 0;

  // ── Render loop ────────────────────────────────────────────────────────────
  const loop = createRafLoop((dtMs: number) => {
    const dt = dtMs * 0.001;
    camTime += speed * dt;

    // ── Update shared audio state (read by createAudio tick) ─────────────────
    sharedState.speed   = speed;
    sharedState.camTime = camTime;

    // Re-bind the program every tick — defensive against any caller that
    // changes the GL state between frames (e.g. another room mounting on
    // the same context during view transitions).
    gl.useProgram(program);
    gl.uniform2f(uniforms.uRes, RW, RH);
    gl.uniform1f(uniforms.uTime, camTime);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── Pixel readback for audio-reactive line drone ───────────────────────
    // Read 3 floor rows + 3 ceiling rows into the pre-allocated buffer.
    // Each row is RW pixels × 4 bytes. Buffer is sized for MAX_PIXEL_BUF_BYTES.
    const rowBytes = RW * 4;
    if (rowBytes * 6 <= MAX_PIXEL_BUF_BYTES) {
      const y0 = Math.floor(RH * 0.05);
      const y1 = Math.floor(RH * 0.10);
      const y2 = Math.floor(RH * 0.16);
      gl.readPixels(0, y0, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, 0);
      gl.readPixels(0, y1, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, rowBytes);
      gl.readPixels(0, y2, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, rowBytes * 2);

      const c0 = Math.floor(RH * 0.84);
      const c1 = Math.floor(RH * 0.90);
      const c2 = Math.floor(RH * 0.95);
      gl.readPixels(0, c0, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, rowBytes * 3);
      gl.readPixels(0, c1, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, rowBytes * 4);
      gl.readPixels(0, c2, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, rowBytes * 5);
    }
  }, ac.signal);

  if (!opts.startPaused) loop.start();

  // ── Teardown ───────────────────────────────────────────────────────────────
  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      try { gl.deleteProgram(program); } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
