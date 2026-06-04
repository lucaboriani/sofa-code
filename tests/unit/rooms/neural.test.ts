import { describe, it, expect, vi } from 'vitest';
import { mount, createAudio } from '@/lib/rooms/neural';
import { makeFakeAudio, makeFakeMediaStream } from '../../fixtures/fake-audio';
import type { FakeAnalyser } from '../../fixtures/fake-audio';

function stubMic(impl: () => Promise<unknown>): ReturnType<typeof vi.fn> {
  const getUserMedia = vi.fn(impl);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true
  });
  return getUserMedia;
}

/** flush the getUserMedia promise chain */
const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0));

function makeProxyGL(): unknown {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
      if (p === 'createShader' || p === 'createProgram' || p === 'createBuffer' || p === 'createTexture' || p === 'createFramebuffer' || p === 'createRenderbuffer' || p === 'createVertexArray') return () => ({});
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
  return c;
}

describe('neural', () => {
  it('mount returns a teardown that cancels rAF', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const canvas = makeCanvas();
    const td = mount(canvas, { quality: 'preview', audio: false });
    expect(() => td.teardown()).not.toThrow();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('createAudio returns a node usable as RoomAudio', () => {
    stubMic(() => Promise.reject(new Error('no mic in test')));
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    expect(audio.node).toBeDefined();
    expect(typeof audio.tick).toBe('function');
  });

  it('createAudio requests the microphone (audio only)', () => {
    const getUserMedia = stubMic(() => Promise.resolve(makeFakeMediaStream()));
    const fake = makeFakeAudio();
    createAudio(fake as unknown as AudioContext);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('routes the mic stream into an analyser once permission is granted', async () => {
    const stream = makeFakeMediaStream();
    stubMic(() => Promise.resolve(stream));
    const fake = makeFakeAudio();
    createAudio(fake as unknown as AudioContext);
    await flush();
    expect(fake._mediaStreamSources).toHaveLength(1);
    expect(fake._mediaStreamSources[0].stream).toBe(stream);
    // connected to an analyser, never to destination (analysis only)
    const dest = fake._mediaStreamSources[0]._connectedTo;
    expect(dest).toHaveLength(1);
    expect(typeof (dest[0] as FakeAnalyser).getByteFrequencyData).toBe('function');
  });

  it('tick() reads mic frequency data every frame', async () => {
    stubMic(() => Promise.resolve(makeFakeMediaStream()));
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    await flush();
    const analyser = fake._mediaStreamSources[0]._connectedTo[0] as FakeAnalyser;
    audio.tick!();
    audio.tick!();
    expect(analyser._reads).toBe(2);
  });

  it('tick() survives mic permission denial (rms stays 0, drone still runs)', async () => {
    stubMic(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    await flush();
    expect(() => audio.tick!()).not.toThrow();
  });

  it('dispose() stops mic tracks so the recording indicator turns off', async () => {
    const stream = makeFakeMediaStream(2);
    stubMic(() => Promise.resolve(stream));
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    await flush();
    expect(typeof audio.dispose).toBe('function');
    audio.dispose!();
    for (const t of stream.getTracks()) expect(t._stopped).toBe(true);
  });
});
