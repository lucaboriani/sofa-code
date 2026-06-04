// ─── Shaders ──────────────────────────────────────────────────────────────────

export const VS_LINE = `
  attribute vec3 aPos;
  attribute float aBright;
  uniform mat4 uMVP;
  varying float vBright;
  void main(){
    gl_Position = uMVP * vec4(aPos, 1.0);
    vBright = aBright;
  }
`;

export const FS_LINE = `
  precision mediump float;
  uniform vec3 uBaseColor;
  uniform vec3 uGlowColor;
  uniform float uAudio;
  uniform float uFade;
  varying float vBright;
  void main(){
    float b   = clamp(vBright + uAudio * 0.35, 0.0, 1.0);
    vec3 col = mix(uBaseColor, uGlowColor, b);
    float a   = mix(0.55, 1.0, b) * uFade;
    gl_FragColor = vec4(col * a, a);
  }
`;

export const VS_PT = `
  attribute vec3 aPos;
  attribute float aSize;
  attribute float aAlpha;
  uniform mat4 uMVP;
  varying float vAlpha;
  void main(){
    gl_Position   = uMVP * vec4(aPos, 1.0);
    gl_PointSize  = aSize;
    vAlpha = aAlpha;
  }
`;

export const FS_PT = `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uFade;
  varying float vAlpha;
  void main(){
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.3, 1.0, d)) * vAlpha * uFade;
    gl_FragColor = vec4(uColor, a);
  }
`;
