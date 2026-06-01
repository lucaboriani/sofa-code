import { describe, it, expect, vi } from 'vitest';
import { observeResize } from '@/lib/webgl/resize';

function fakeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400, configurable: true });
  Object.defineProperty(c, 'clientHeight', { get: () => 300, configurable: true });
  return c;
}

describe('observeResize', () => {
  it('sets canvas pixel size based on DPR, capped at 2', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 5, configurable: true });
    const canvas = fakeCanvas();
    const cleanup = observeResize(canvas);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    cleanup();
  });

  it('invokes onResize once on observe', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    const canvas = fakeCanvas();
    const cb = vi.fn();
    const cleanup = observeResize(canvas, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(400, 300);
    cleanup();
  });

  it('cleanup disconnects the ResizeObserver', () => {
    const disconnect = vi.fn();
    class RO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void { disconnect(); }
    }
    (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
    const canvas = fakeCanvas();
    const cleanup = observeResize(canvas);
    cleanup();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
