import type { AnyGL } from './types';

export function compileShader(gl: AnyGL, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader returned null');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export function linkProgram(gl: AnyGL, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram returned null');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

export function getUniforms<const T extends readonly string[]>(
  gl: AnyGL,
  program: WebGLProgram,
  names: T
): { [K in T[number]]: WebGLUniformLocation } {
  const out = {} as { [K in T[number]]: WebGLUniformLocation };
  for (const name of names) {
    const loc = gl.getUniformLocation(program, name);
    if (loc === null) throw new Error(`Missing uniform: ${name}`);
    (out as Record<string, WebGLUniformLocation>)[name] = loc;
  }
  return out;
}
