// ── Shader sources ────────────────────────────────────────────────────────────

export const STRAND_VS = `
attribute vec2 aA;
attribute vec2 aB;
attribute float aBaseAlpha;
attribute float aSide;
attribute float aT;
uniform vec2  uTrans;
uniform float uScale;
uniform float uCos;
uniform float uSin;
uniform float uAlpha;
uniform vec2  uRes;
uniform float uW;
uniform vec3  uCol;
varying float vSide;
varying float vAl;
varying vec3  vCol;
void main(){
  vec2 rA=vec2(aA.x*uCos-aA.y*uSin, aA.x*uSin+aA.y*uCos)*uScale+uTrans;
  vec2 rB=vec2(aB.x*uCos-aB.y*uSin, aB.x*uSin+aB.y*uCos)*uScale+uTrans;
  vec2 d=rB-rA;
  float len=length(d);
  vec2 n=(len>0.001)?vec2(-d.y,d.x)/len:vec2(0.,1.);
  vec2 pos=mix(rA,rB,aT)+n*aSide*uW;
  vec2 clip=(pos/uRes)*2.-1.;
  gl_Position=vec4(clip.x,-clip.y,0.,1.);
  vSide=aSide;
  vAl=aBaseAlpha*uAlpha;
  vCol=uCol;
}`.trim();

export const STRAND_FS = `
precision mediump float;
varying float vSide;
varying float vAl;
varying vec3  vCol;
void main(){
  float a=smoothstep(1.,.1,abs(vSide))*vAl;
  gl_FragColor=vec4(vCol*a,a);
}`.trim();

export const QUAD_VS = `
attribute vec2 aPos; varying vec2 vUv;
void main(){vUv=aPos*.5+.5;gl_Position=vec4(aPos,0.,1.);}`.trim();

export function makeBlurFS(horiz: boolean): string {
  const d = horiz
    ? 'vec2(float(i-3)*px.x*2.,0.)'
    : 'vec2(0.,float(i-3)*px.y*2.)';
  return [
    'precision mediump float;',
    'uniform sampler2D uTex;uniform vec2 uRes;varying vec2 vUv;',
    'float w(int i){if(i==0||i==6)return 0.0625;if(i==1||i==5)return 0.109375;if(i==2||i==4)return 0.21875;return 0.25;}',
    `void main(){vec2 px=1./uRes;vec4 c=vec4(0.);for(int i=0;i<7;i++)c+=texture2D(uTex,vUv+${d})*w(i);gl_FragColor=c;}`
  ].join('\n');
}

export const COMP_FS = `
precision mediump float;
uniform sampler2D uSharp,uBlur;uniform float uBloom;varying vec2 vUv;
void main(){gl_FragColor=clamp(texture2D(uSharp,vUv)+texture2D(uBlur,vUv)*uBloom,0.,1.);}`.trim();
