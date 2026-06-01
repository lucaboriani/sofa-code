import { describe, it, expect } from 'vitest';
import { decide, type ReconcilerInput } from '@/lib/preview/reconciler';

const base: ReconcilerInput = {
  inViewport: false,
  hovered: false,
  reducedMotion: false,
  smallScreen: false,
  currentState: 'idle'
};

describe('decide', () => {
  it('noop when nothing changes', () => {
    expect(decide(base)).toBe('noop');
  });

  it('mounts when in viewport + hovered + idle', () => {
    expect(decide({ ...base, inViewport: true, hovered: true })).toBe('mount');
  });

  it('does not mount when reducedMotion', () => {
    expect(decide({ ...base, inViewport: true, hovered: true, reducedMotion: true })).toBe('noop');
  });

  it('does not mount when smallScreen', () => {
    expect(decide({ ...base, inViewport: true, hovered: true, smallScreen: true })).toBe('noop');
  });

  it('does not mount when already running', () => {
    expect(decide({ ...base, inViewport: true, hovered: true, currentState: 'running' })).toBe('noop');
  });

  it('tears down when running and loses hover', () => {
    expect(decide({ ...base, inViewport: true, hovered: false, currentState: 'running' })).toBe('teardown');
  });

  it('tears down when running and scrolls out of viewport', () => {
    expect(decide({ ...base, inViewport: false, hovered: true, currentState: 'running' })).toBe('teardown');
  });

  it('tears down when running and reducedMotion becomes true', () => {
    expect(decide({ ...base, inViewport: true, hovered: true, reducedMotion: true, currentState: 'running' })).toBe('teardown');
  });
});
