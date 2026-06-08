import { describe, it, expect, vi } from 'vitest';
import { mount, createAudio } from '@/lib/rooms/beauty';
import { sharedState } from '@/lib/rooms/beauty/state';
import { makeFakeAudio, advanceFakeAudio } from '../../fixtures/fake-audio';

function makeProxyGL(): unknown {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
      if (p === 'createShader' || p === 'createProgram' || p === 'createBuffer') return () => ({});
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

describe('beauty.mount', () => {
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

  it('full mode injects the construction overlay canvas; teardown removes it', () => {
    const handle = mount(makeCanvas(), { quality: 'full', audio: false });
    expect(document.querySelector('[data-beauty-overlay]')).not.toBeNull();
    handle.teardown();
    expect(document.querySelector('[data-beauty-overlay]')).toBeNull();
  });

  it('preview mode injects no overlay', () => {
    const handle = mount(makeCanvas(), { quality: 'preview', audio: false });
    expect(document.querySelector('[data-beauty-overlay]')).toBeNull();
    handle.teardown();
  });
});

describe('beauty.createAudio', () => {
  it('returns a node and a tick that survives queued string hits', () => {
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    expect(audio.node).toBeTruthy();
    expect(typeof audio.tick).toBe('function');
    for (let i = 0; i < 12; i++) {
      advanceFakeAudio(fake, 100);
      sharedState.pluck.push({ axis: i % 6, prox: 0.5 });
      sharedState.hover.push({ axis: (i + 1) % 6, prox: 0.3 });
      sharedState.angle = i * 0.1;
      sharedState.dragVel = i % 2 === 0 ? 12 : 0;
      sharedState.isDragging = i % 2 === 0;
      expect(() => audio.tick!()).not.toThrow();
    }
    expect(sharedState.pluck.length).toBe(0);
    expect(sharedState.hover.length).toBe(0);
  });
});
