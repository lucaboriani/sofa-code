/**
 * Minimal fake of WebGLRenderingContext that records calls.
 * Provides only the methods our engine uses.
 */
export interface FakeGL {
  // recorded calls
  calls: Array<{ method: string; args: unknown[] }>;
  // mock constants used by callers
  VERTEX_SHADER: 35633;
  FRAGMENT_SHADER: 35632;
  COMPILE_STATUS: 35713;
  LINK_STATUS: 35714;
  // toggles
  __compileStatus: boolean;
  __linkStatus: boolean;
  __infoLog: string;
  // methods
  createShader(type: number): { type: number; src: string | null };
  shaderSource(shader: { src: string | null }, src: string): void;
  compileShader(shader: unknown): void;
  getShaderParameter(shader: unknown, pname: number): boolean;
  getShaderInfoLog(shader: unknown): string;
  createProgram(): { uniforms: Map<string, object> };
  attachShader(program: unknown, shader: unknown): void;
  linkProgram(program: unknown): void;
  getProgramParameter(program: unknown, pname: number): boolean;
  getProgramInfoLog(program: unknown): string;
  getUniformLocation(program: { uniforms: Map<string, object> }, name: string): object | null;
  deleteShader(shader: unknown): void;
  deleteProgram(program: unknown): void;
}

export function makeFakeGL(opts: Partial<Pick<FakeGL, '__compileStatus' | '__linkStatus' | '__infoLog'>> = {}): FakeGL {
  const calls: FakeGL['calls'] = [];
  const record = <A extends unknown[]>(method: string) => (...args: A): unknown => {
    calls.push({ method, args });
    return undefined;
  };
  const gl: FakeGL = {
    calls,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    __compileStatus: opts.__compileStatus ?? true,
    __linkStatus: opts.__linkStatus ?? true,
    __infoLog: opts.__infoLog ?? '',
    createShader(type) { const s = { type, src: null }; calls.push({ method: 'createShader', args: [type] }); return s; },
    shaderSource(shader, src) { shader.src = src; calls.push({ method: 'shaderSource', args: [shader, src] }); },
    compileShader: record('compileShader'),
    getShaderParameter() { return gl.__compileStatus; },
    getShaderInfoLog() { return gl.__infoLog; },
    createProgram() { const p = { uniforms: new Map<string, object>() }; calls.push({ method: 'createProgram', args: [] }); return p; },
    attachShader: record('attachShader'),
    linkProgram: record('linkProgram'),
    getProgramParameter() { return gl.__linkStatus; },
    getProgramInfoLog() { return gl.__infoLog; },
    getUniformLocation(program, name) {
      if (!program.uniforms.has(name)) program.uniforms.set(name, { name });
      const loc = program.uniforms.get(name) ?? null;
      calls.push({ method: 'getUniformLocation', args: [name] });
      return loc;
    },
    deleteShader: record('deleteShader'),
    deleteProgram: record('deleteProgram')
  };
  return gl;
}
