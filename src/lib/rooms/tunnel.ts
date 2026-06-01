import type { RoomMount } from '@/lib/webgl/types';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';

const MARCH_STEPS = { preview: 24, full: 48 } as const;

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
uniform float uSpeed;
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
  // uSpeed is available for future use (currently drives audio only)
  fragColor=vec4(vec3(grey),1.0);
}`;
}

// Max pixel buffer size — allocated once at mount to avoid per-frame allocation.
// Sized for 6 rows at max likely width (4096px).
const MAX_PIXEL_BUF_BYTES = 4096 * 6 * 4;

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

  const uniforms = getUniforms(gl, program, ['uRes', 'uTime', 'uSpeed'] as const);

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

    gl.uniform2f(uniforms.uRes, RW, RH);
    gl.uniform1f(uniforms.uTime, camTime);
    gl.uniform1f(uniforms.uSpeed, speed);
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

  loop.start();

  // ── Teardown ───────────────────────────────────────────────────────────────
  return () => {
    ac.abort();
    loop.stop();
    stopResize();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    try { gl.deleteProgram(program); } catch { /* idempotent */ }
  };
};
