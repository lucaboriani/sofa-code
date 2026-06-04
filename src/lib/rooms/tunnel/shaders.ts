// ── Vertex shader (fullscreen triangle, no attributes) ────────────────────────
export const VS_SRC = `#version 300 es
void main() {
  vec2 v[3];
  v[0] = vec2(-1.0,-1.0);
  v[1] = vec2( 3.0,-1.0);
  v[2] = vec2(-1.0, 3.0);
  gl_Position = vec4(v[gl_VertexID], 0.0, 1.0);
}`;

// ── Fragment shader — raymarched corridor tunnel ───────────────────────────────
// MARCH_STEPS is injected at compile time via string template below.
export function buildFragSrc(marchSteps: number): string {
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
