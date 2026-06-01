import { describe, it, expect } from 'vitest';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { makeFakeGL } from '../../fixtures/fake-gl';

describe('compileShader', () => {
  it('returns a shader on success', () => {
    const gl = makeFakeGL({ __compileStatus: true });
    const s = compileShader(gl as never, gl.VERTEX_SHADER, 'void main(){}');
    expect(s).toBeTruthy();
    expect(gl.calls.find(c => c.method === 'compileShader')).toBeDefined();
  });

  it('throws including info log on failure', () => {
    const gl = makeFakeGL({ __compileStatus: false, __infoLog: 'ERROR: line 3' });
    expect(() => compileShader(gl as never, gl.VERTEX_SHADER, 'broken'))
      .toThrowError(/ERROR: line 3/);
  });
});

describe('linkProgram', () => {
  it('returns a program on success', () => {
    const gl = makeFakeGL();
    const vs = compileShader(gl as never, gl.VERTEX_SHADER, 'void main(){}');
    const fs = compileShader(gl as never, gl.FRAGMENT_SHADER, 'void main(){}');
    const p = linkProgram(gl as never, vs, fs);
    expect(p).toBeTruthy();
  });

  it('throws on link failure', () => {
    const gl = makeFakeGL({ __linkStatus: false, __infoLog: 'LINK ERROR' });
    const vs = compileShader(gl as never, gl.VERTEX_SHADER, 'void main(){}');
    const fs = compileShader(gl as never, gl.FRAGMENT_SHADER, 'void main(){}');
    expect(() => linkProgram(gl as never, vs, fs)).toThrowError(/LINK ERROR/);
  });
});

describe('getUniforms', () => {
  it('returns a typed record of locations', () => {
    const gl = makeFakeGL();
    const vs = compileShader(gl as never, gl.VERTEX_SHADER, 'void main(){}');
    const fs = compileShader(gl as never, gl.FRAGMENT_SHADER, 'void main(){}');
    const p = linkProgram(gl as never, vs, fs);
    const u = getUniforms(gl as never, p, ['uA', 'uB'] as const);
    expect(u.uA).toBeDefined();
    expect(u.uB).toBeDefined();
  });

  it('throws if uniform is missing', () => {
    const gl = makeFakeGL();
    (gl as unknown as { getUniformLocation: () => null }).getUniformLocation = () => null;
    const vs = compileShader(gl as never, gl.VERTEX_SHADER, 'void main(){}');
    const fs = compileShader(gl as never, gl.FRAGMENT_SHADER, 'void main(){}');
    const p = linkProgram(gl as never, vs, fs);
    expect(() => getUniforms(gl as never, p, ['uMissing'] as const))
      .toThrowError(/uMissing/);
  });
});
