import { describe, it, expect, vi } from 'vitest';
import { mount } from '@/lib/rooms/tree';

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

describe('tree.mount', () => {
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

  it('full mode injects the hint + restart overlay; teardown removes it', () => {
    const handle = mount(makeCanvas(), { quality: 'full', audio: false });
    const overlay = document.querySelector('[data-tree-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain('Disegna la direzione del tronco');
    handle.teardown();
    expect(document.querySelector('[data-tree-overlay]')).toBeNull();
  });

  it('preview mode injects no overlay', () => {
    const handle = mount(makeCanvas(), { quality: 'preview', audio: false });
    expect(document.querySelector('[data-tree-overlay]')).toBeNull();
    handle.teardown();
  });
});
