import { describe, it, expect, vi } from 'vitest';
import { mount } from '@/lib/rooms/swarm';

function makeProxyGL(): unknown {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
      if (p === 'createShader' || p === 'createProgram' || p === 'createBuffer' || p === 'createTexture' || p === 'createFramebuffer' || p === 'createRenderbuffer' || p === 'createVertexArray') return () => ({});
      if (p === 'getUniformLocation' || p === 'getAttribLocation') return () => ({});
      if (typeof p === 'string' && p === p.toUpperCase()) return 0;
      return () => undefined;
    }
  });
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400 });
  Object.defineProperty(c, 'clientHeight', { get: () => 300 });
  c.getContext = ((type: string): unknown => {
    if (type === 'webgl' || type === 'webgl2') return makeProxyGL();
    return null;
  }) as typeof HTMLCanvasElement.prototype.getContext;
  return c;
}

describe('swarm.mount', () => {
  it('returns a teardown function and calling it does not throw', () => {
    const canvas = makeCanvas();
    const td = mount(canvas, { quality: 'preview', audio: false });
    expect(typeof td.teardown).toBe("function");
    expect(() => td.teardown()).not.toThrow();
  });

  it('teardown cancels rAF', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const canvas = makeCanvas();
    const td = mount(canvas, { quality: 'full', audio: false });
    td.teardown();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });
});
