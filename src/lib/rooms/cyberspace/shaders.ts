// ─── Shaders ──────────────────────────────────────────────────────────────────
// VS_LINE/FS_LINE: per-vertex colored lines — grid, structures, core, and
// (Task 4) filaments.
// VS_PT/FS_PT: point sprites — particle motes and glow blobs, per-draw uColor,
// perspective-correct size via division by clip-space w.
// Both fade toward FOG_COLOR with distance — equivalent to the source's
// `scene.fog = new THREE.FogExp2(0x000308, 0.0075)`.

export const VS_LINE = `
  attribute vec3 aPos;
  attribute vec3 aColor;
  attribute float aAlpha;
  uniform mat4 uMVP;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFogW;
  void main(){
    gl_Position = uMVP * vec4(aPos, 1.0);
    vColor = aColor;
    vAlpha = aAlpha;
    vFogW = gl_Position.w;
  }
`;

export const FS_LINE = `
  precision mediump float;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFogW;
  void main(){
    float fog = 1.0 - clamp(exp(-uFogDensity * uFogDensity * vFogW * vFogW), 0.0, 1.0);
    vec3 col = mix(vColor, uFogColor, fog);
    gl_FragColor = vec4(col * vAlpha, vAlpha);
  }
`;

export const VS_PT = `
  attribute vec3 aPos;
  attribute float aSize;
  attribute float aAlpha;
  uniform mat4 uMVP;
  varying float vAlpha;
  varying float vFogW;
  void main(){
    gl_Position = uMVP * vec4(aPos, 1.0);
    vFogW = gl_Position.w;
    gl_PointSize = clamp(aSize * (140.0 / max(gl_Position.w, 0.001)), 1.0, 64.0);
    vAlpha = aAlpha;
  }
`;

export const FS_PT = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying float vAlpha;
  varying float vFogW;
  void main(){
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d) * 2.0;
    float edge = 1.0 - smoothstep(0.3, 1.0, r);
    float fog = 1.0 - clamp(exp(-uFogDensity * uFogDensity * vFogW * vFogW), 0.0, 1.0);
    vec3 col = mix(uColor, uFogColor, fog);
    float a = edge * vAlpha;
    gl_FragColor = vec4(col * a, a);
  }
`;
