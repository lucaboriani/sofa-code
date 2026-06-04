import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioBus, getAudioBus } from '@/lib/audio/bus';
import { makeFakeAudio, advanceFakeAudio } from '../../fixtures/fake-audio';

function audioFactory() {
  return (ctx: AudioContext) => {
    const node = (ctx as unknown as { createGain(): { connect(): void; disconnect(): void } }).createGain();
    return { node: node as unknown as AudioNode };
  };
}

describe('AudioBus', () => {
  let fakeCtx: ReturnType<typeof makeFakeAudio>;
  let bus: AudioBus;

  beforeEach(() => {
    fakeCtx = makeFakeAudio();
    bus = new AudioBus(() => fakeCtx as unknown as AudioContext);
  });

  it('register is idempotent', () => {
    const f = audioFactory();
    bus.register('a', f);
    bus.register('a', f);
    expect(bus.has('a')).toBe(true);
  });

  it('activate creates ctx lazily on first call', async () => {
    expect(bus.hasContext()).toBe(false);
    bus.register('a', audioFactory());
    await bus.activate('a', 100);
    expect(bus.hasContext()).toBe(true);
  });

  it('activate fades new gain from 0 to 1 over duration', async () => {
    bus.register('a', audioFactory());
    await bus.activate('a', 600);
    const current = bus.current();
    expect(current).not.toBeNull();
    const ramps = (current as unknown as { gain: { gain: { ramps: Array<{ value: number; endTime: number }> } } }).gain.gain.ramps;
    expect(ramps[0].value).toBe(1);
    expect(ramps[0].endTime).toBeCloseTo(fakeCtx.currentTime + 0.6, 1);
  });

  it('activate(b) while active(a) fades a out and b in', async () => {
    bus.register('a', audioFactory());
    bus.register('b', audioFactory());
    await bus.activate('a', 100);
    const a = bus.current()!;
    await bus.activate('b', 600);
    const aRamps = (a as unknown as { gain: { gain: { ramps: Array<{ value: number }> } } }).gain.gain.ramps;
    expect(aRamps[aRamps.length - 1].value).toBe(0);
    const b = bus.current()!;
    expect(b).not.toBe(a);
    const bRamps = (b as unknown as { gain: { gain: { ramps: Array<{ value: number }> } } }).gain.gain.ramps;
    expect(bRamps[0].value).toBe(1);
  });

  it('deactivate fades current to 0', async () => {
    bus.register('a', audioFactory());
    await bus.activate('a', 100);
    const a = bus.current()!;
    await bus.deactivate(600);
    const aRamps = (a as unknown as { gain: { gain: { ramps: Array<{ value: number }> } } }).gain.gain.ramps;
    expect(aRamps[aRamps.length - 1].value).toBe(0);
    expect(bus.current()).toBeNull();
  });

  it('resume() resumes the underlying ctx', async () => {
    bus.register('a', audioFactory());
    await bus.activate('a', 0);
    await bus.resume();
    expect(fakeCtx.state).toBe('running');
  });

  it('disconnect old node after crossfade completes', async () => {
    bus.register('a', audioFactory());
    bus.register('b', audioFactory());
    await bus.activate('a', 100);
    const a = bus.current()!;
    const disconnectSpy = vi.fn();
    (a as unknown as { node: { disconnect: typeof disconnectSpy } }).node.disconnect = disconnectSpy;
    await bus.activate('b', 100);
    advanceFakeAudio(fakeCtx, 200);
    await new Promise(r => setTimeout(r, 200));
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('calls active.tick on each animation frame', async () => {
    const ticks: number[] = [];
    bus.register('a', (ctx) => ({
      node: (ctx as unknown as { createGain(): AudioNode }).createGain(),
      tick: () => ticks.push(performance.now())
    }));
    await bus.activate('a', 0);
    // Wait two frames
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r as FrameRequestCallback)));
    expect(ticks.length).toBeGreaterThan(0);
    await bus.deactivate(0);
  });

  it('deactivate calls the room dispose after the fade', async () => {
    const dispose = vi.fn();
    bus.register('a', (ctx) => ({
      node: (ctx as unknown as { createGain(): AudioNode }).createGain(),
      dispose
    }));
    await bus.activate('a', 100);
    await bus.deactivate(100);
    expect(dispose).not.toHaveBeenCalled(); // not before the fade completes
    await new Promise(r => setTimeout(r, 200));
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('activate(b) while active(a) disposes a after the crossfade', async () => {
    const disposeA = vi.fn();
    bus.register('a', (ctx) => ({
      node: (ctx as unknown as { createGain(): AudioNode }).createGain(),
      dispose: disposeA
    }));
    bus.register('b', audioFactory());
    await bus.activate('a', 100);
    await bus.activate('b', 100);
    await new Promise(r => setTimeout(r, 200));
    expect(disposeA).toHaveBeenCalledTimes(1);
  });
});

describe('getAudioBus singleton', () => {
  it('returns the same instance', () => {
    delete (window as { __audioBus__?: unknown }).__audioBus__;
    const a = getAudioBus();
    const b = getAudioBus();
    expect(a).toBe(b);
  });
});
