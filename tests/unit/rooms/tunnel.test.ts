import { describe, it, expect, vi } from 'vitest';
import { mount } from '@/lib/rooms/tunnel';

function makeProxyGL(): unknown {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
      if (p === 'createShader' || p === 'createProgram' || p === 'createBuffer' || p === 'createVertexArray' || p === 'createTexture' || p === 'createFramebuffer') return () => ({});
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
    if (type === 'webgl2' || type === 'webgl') return makeProxyGL();
    return null;
  }) as typeof HTMLCanvasElement.prototype.getContext;
  return c;
}

describe('tunnel.mount', () => {
  it('returns a teardown function that does not throw', () => {
    const canvas = makeCanvas();
    const td = mount(canvas, { quality: 'preview', audio: false });
    expect(typeof td).toBe('function');
    expect(() => td()).not.toThrow();
  });

  it('teardown cancels rAF and removes pointer listeners', () => {
    const canvas = makeCanvas();
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const removeSpy = vi.spyOn(canvas, 'removeEventListener');
    const td = mount(canvas, { quality: 'full', audio: false });
    td();
    expect(cancelSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });
});
