// ─── Shaders (line-of-beauty.html L68-71) ────────────────────────────────────

export const VS = `attribute vec2 pos;attribute float alpha;varying float vA;uniform vec2 res;
void main(){vA=alpha;vec2 cl=(pos/res)*2.0-1.0;gl_Position=vec4(cl.x,-cl.y,0,1);}`;

export const FS = `precision mediump float;varying float vA;uniform vec3 col;
void main(){gl_FragColor=vec4(col,vA);}`;
