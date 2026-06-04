// ─── Shaders (ikebana.html L48-59) ───────────────────────────────────────────

export const VS = `
attribute vec2 a_pos;
uniform vec2 u_res;
void main() {
  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
}`.trim();

export const FS = `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }`.trim();
