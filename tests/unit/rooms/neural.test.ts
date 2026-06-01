import { describe, it, expect, vi } from 'vitest';
import { mount, createAudio } from '@/lib/rooms/neural';
import { makeFakeAudio } from '../../fixtures/fake-audio';

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

describe('neural', () => {
  it('mount returns a teardown that cancels rAF', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const canvas = makeCanvas();
    const td = mount(canvas, { quality: 'preview', audio: false });
    expect(() => td.teardown()).not.toThrow();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('createAudio returns a node usable as RoomAudio', () => {
    // stub mediaDevices to avoid actual mic prompt in JSDOM
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.reject(new Error('no mic in test')) },
      configurable: true
    });
    const fake = makeFakeAudio();
    // Patch createAnalyser, createMediaStreamSource on fake
    (fake as unknown as { createAnalyser: () => unknown }).createAnalyser = () => ({
      fftSize: 256,
      frequencyBinCount: 128,
      getByteFrequencyData: (_a: Uint8Array) => {}
    });
    (fake as unknown as { createMediaStreamSource: (s: unknown) => { connect: (n: unknown) => void } }).createMediaStreamSource = () => ({ connect: () => {} });
    const audio = createAudio(fake as unknown as AudioContext);
    expect(audio.node).toBeDefined();
    expect(typeof audio.tick).toBe('function');
  });
});
