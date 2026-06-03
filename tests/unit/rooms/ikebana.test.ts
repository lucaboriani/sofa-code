import { describe, it, expect, vi } from 'vitest';
import { mount, createAudio } from '@/lib/rooms/ikebana';
import { makeFakeAudio } from '../../fixtures/fake-audio';

function makeProxyGL(): unknown {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
      if (p === 'createShader' || p === 'createProgram' || p === 'createBuffer' || p === 'createTexture' || p === 'createFramebuffer') return () => ({});
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
  document.body.appendChild(c);
  return c;
}

describe('ikebana.mount', () => {
  it('returns a handle and teardown does not throw (preview)', () => {
    const handle = mount(makeCanvas(), { quality: 'preview', audio: false });
    expect(typeof handle.teardown).toBe('function');
    expect(() => handle.teardown()).not.toThrow();
  });

  it('teardown cancels rAF (full)', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const handle = mount(makeCanvas(), { quality: 'full', audio: false });
    handle.teardown();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('full mode injects the kanji + hint overlay; teardown removes it', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    const overlay = document.querySelector('[data-ikebana-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain('天');
    expect(overlay!.textContent).toContain('doppio tap — nuovo ikebana');
    handle.teardown();
    expect(document.querySelector('[data-ikebana-overlay]')).toBeNull();
  });

  it('preview mode injects no overlay', () => {
    const handle = mount(makeCanvas(), { quality: 'preview', audio: false });
    expect(document.querySelector('[data-ikebana-overlay]')).toBeNull();
    handle.teardown();
  });
});

describe('ikebana.createAudio', () => {
  it('returns a node and a tick that does not throw', () => {
    const ctx = makeFakeAudio() as unknown as AudioContext;
    const audio = createAudio(ctx);
    expect(audio.node).toBeTruthy();
    expect(typeof audio.tick).toBe('function');
    expect(() => { audio.tick!(); audio.tick!(); }).not.toThrow();
  });
});
