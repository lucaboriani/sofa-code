import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wireTransitions } from '@/lib/transitions/wiring';
import { AudioBus } from '@/lib/audio/bus';
import { makeFakeAudio } from '../../fixtures/fake-audio';

function makeBus() {
  const fake = makeFakeAudio();
  const bus = new AudioBus(() => fake as unknown as AudioContext);
  bus.register('neural', (ctx) => ({ node: ctx.createGain() as unknown as AudioNode }));
  return { bus, fake };
}

describe('wireTransitions', () => {
  let detach: () => void;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/'),
      configurable: true
    });
  });

  it('dispatches deactivate(600) on astro:before-preparation when leaving a room', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'deactivate');
    Object.defineProperty(window, 'location', { value: new URL('http://localhost/rooms/neural'), configurable: true });
    detach = wireTransitions(bus, () => 'neural', () => true);
    document.dispatchEvent(new Event('astro:before-preparation'));
    expect(spy).toHaveBeenCalledWith(600);
    detach();
  });

  it('dispatches activate(slug, 600) on astro:after-swap for a room with audio', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'activate');
    detach = wireTransitions(bus, () => 'neural', () => true);
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(spy).toHaveBeenCalledWith('neural', 600);
    detach();
  });

  it('does not call activate on non-room route', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'activate');
    detach = wireTransitions(bus, () => null, () => false);
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(spy).not.toHaveBeenCalled();
    detach();
  });

  it('does not activate for a room without audio', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'activate');
    detach = wireTransitions(bus, () => 'tunnel', () => false);
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(spy).not.toHaveBeenCalled();
    detach();
  });
});
