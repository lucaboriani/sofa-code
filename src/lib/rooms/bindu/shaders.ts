// ─── Shaders (bindu.html L59-61) ─────────────────────────────────────────────

export const VS = `attribute vec3 aPos;attribute vec4 aCol;uniform mat4 uMVP;varying vec4 vC;
void main(){gl_Position=uMVP*vec4(aPos,1.);vC=aCol;}`;
export const FS = `precision mediump float;varying vec4 vC;void main(){gl_FragColor=vC;}`;
