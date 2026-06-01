import { vi } from 'vitest';

if (!('requestAnimationFrame' in globalThis)) {
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const n = ++id;
    callbacks.set(n, cb);
    queueMicrotask(() => { const fn = callbacks.get(n); if (fn) { callbacks.delete(n); fn(performance.now()); } });
    return n;
  };
  globalThis.cancelAnimationFrame = (n: number): void => { callbacks.delete(n); };
}

class FakeIO implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '0px';
  readonly thresholds: ReadonlyArray<number> = [0];
  constructor(private _cb: IntersectionObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  trigger(entries: Partial<IntersectionObserverEntry>[]): void {
    this._cb(entries as IntersectionObserverEntry[], this);
  }
}
(globalThis as unknown as { IntersectionObserver: typeof FakeIO }).IntersectionObserver = FakeIO;

class FakeRO implements ResizeObserver {
  constructor(private _cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(entries: Partial<ResizeObserverEntry>[]): void {
    this._cb(entries as ResizeObserverEntry[], this);
  }
}
(globalThis as unknown as { ResizeObserver: typeof FakeRO }).ResizeObserver = FakeRO;

export { FakeIO, FakeRO };
export const mockedVi = vi;
