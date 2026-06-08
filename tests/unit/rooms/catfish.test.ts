import { describe, it, expect, vi } from 'vitest';
import { mount, createAudio } from '@/lib/rooms/catfish';
import { sharedState } from '@/lib/rooms/catfish/state';
import { makeFakeAudio, advanceFakeAudio } from '../../fixtures/fake-audio';

function makeProxy2D(): unknown {
  const grad = { addColorStop(): void {} };
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
      return () => undefined;
    },
    set() { return true; }
  });
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400 });
  Object.defineProperty(c, 'clientHeight', { get: () => 300 });
  c.getContext = ((type: string): unknown => (type === '2d' ? makeProxy2D() : null)) as typeof HTMLCanvasElement.prototype.getContext;
  document.body.appendChild(c);
  return c;
}

describe('catfish.mount', () => {
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
});

describe('catfish.createAudio', () => {
  it('returns a node and a tick that survives shock + collision triggers', () => {
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    expect(audio.node).toBeTruthy();
    expect(typeof audio.tick).toBe('function');
    for (let i = 0; i < 20; i++) {
      advanceFakeAudio(fake, 100);
      if (i % 3 === 0) sharedState.shocks++;
      if (i % 5 === 0) sharedState.collisions++;
      sharedState.dispersion = (i % 7) / 7;
      expect(() => audio.tick!()).not.toThrow();
    }
  });
});
