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

  it('dispatches deactivate(600) on astro:before-preparation', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'deactivate');
    detach = wireTransitions(bus, () => 'neural', () => true);
    document.dispatchEvent(new Event('astro:before-preparation'));
    expect(spy).toHaveBeenCalledWith(600);
    detach();
  });

  it('does not auto-activate on astro:after-swap (audio waits for the user prompt click)', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'activate');
    detach = wireTransitions(bus, () => 'neural', () => true);
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(spy).not.toHaveBeenCalled();
    detach();
  });

  it('detach removes both listeners', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'deactivate');
    detach = wireTransitions(bus, () => 'neural', () => true);
    detach();
    document.dispatchEvent(new Event('astro:before-preparation'));
    expect(spy).not.toHaveBeenCalled();
  });
});
