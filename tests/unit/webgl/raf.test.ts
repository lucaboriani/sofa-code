import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRafLoop } from '@/lib/webgl/raf';

function installControllableRaf(): { tick: (advanceMs: number) => void; reset: () => void } {
  let now = 0;
  let pending: Array<(t: number) => void> = [];
  globalThis.performance = { now: () => now } as unknown as Performance;
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => { pending.push(cb); return pending.length; }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => { pending[id - 1] = () => {}; }) as typeof cancelAnimationFrame;
  return {
    tick(advanceMs) {
      now += advanceMs;
      const drain = pending;
      pending = [];
      drain.forEach(cb => cb(now));
    },
    reset() { now = 0; pending = []; }
  };
}

describe('createRafLoop', () => {
  let ctrl: ReturnType<typeof installControllableRaf>;
  beforeEach(() => { ctrl = installControllableRaf(); });

  it('calls tick repeatedly with non-decreasing tMs', () => {
    const cb = vi.fn();
    const loop = createRafLoop((dt, t) => cb(dt, t));
    loop.start();
    ctrl.tick(16);
    ctrl.tick(16);
    ctrl.tick(16);
    expect(cb).toHaveBeenCalled();
    const calls = cb.mock.calls;
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i][1]).toBeGreaterThanOrEqual(calls[i - 1][1]);
    }
    loop.stop();
  });

  it('stop() halts further ticks', () => {
    const cb = vi.fn();
    const loop = createRafLoop(cb);
    loop.start();
    ctrl.tick(16);
    const beforeStopCalls = cb.mock.calls.length;
    loop.stop();
    ctrl.tick(16);
    ctrl.tick(16);
    expect(cb.mock.calls.length).toBe(beforeStopCalls);
  });

  it('AbortSignal abortion stops the loop', () => {
    const ac = new AbortController();
    const cb = vi.fn();
    const loop = createRafLoop(cb, ac.signal);
    loop.start();
    ctrl.tick(16);
    const before = cb.mock.calls.length;
    ac.abort();
    ctrl.tick(16);
    expect(cb.mock.calls.length).toBe(before);
  });

  it('first dt is zero', () => {
    const calls: number[] = [];
    const loop = createRafLoop((dt) => calls.push(dt));
    loop.start();
    ctrl.tick(16);
    expect(calls[0]).toBe(0);
    loop.stop();
  });

  it('pauses while document.hidden is true', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const cb = vi.fn();
    const loop = createRafLoop(cb);
    loop.start();
    ctrl.tick(16);
    ctrl.tick(16);
    expect(cb).not.toHaveBeenCalled();
    loop.stop();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });
});
