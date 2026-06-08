export interface FakeRamp { value: number; endTime: number; }
export interface FakeGain {
  gain: {
    value: number;
    ramps: FakeRamp[];
    linearRampToValueAtTime(v: number, t: number): void;
    exponentialRampToValueAtTime(v: number, t: number): void;
    setValueAtTime(v: number, t: number): void;
    setTargetAtTime(v: number, t: number, tc: number): void;
    cancelScheduledValues(t: number): void;
  };
  connect(dest: unknown): void;
  disconnect(): void;
}

function makeAudioParam(initial = 0): {
  value: number;
  setValueAtTime(v: number, t: number): void;
  setTargetAtTime(v: number, t: number, tc: number): void;
  cancelScheduledValues(t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
} {
  let val = initial;
  return {
    get value() { return val; },
    set value(v: number) { val = v; },
    setValueAtTime(v: number) { val = v; },
    setTargetAtTime(v: number) { val = v; },
    cancelScheduledValues() {},
    linearRampToValueAtTime(v: number) { val = v; },
    exponentialRampToValueAtTime(v: number) { val = v; }
  };
}

export interface FakeAudioContext {
  currentTime: number;
  sampleRate: number;
  state: 'suspended' | 'running' | 'closed';
  destination: { _id: 'destination' };
  resume(): Promise<void>;
  close(): Promise<void>;
  createGain(): FakeGain;
  createBufferSource(): { connect(d: unknown): void; start(t?: number): void; stop(t?: number): void; buffer: unknown; loop: boolean };
  createBiquadFilter(): {
    type: string;
    frequency: ReturnType<typeof makeAudioParam>;
    Q: ReturnType<typeof makeAudioParam>;
    connect(d: unknown): void;
    disconnect(): void;
  };
  createOscillator(): {
    type: string;
    frequency: ReturnType<typeof makeAudioParam>;
    detune: ReturnType<typeof makeAudioParam>;
    connect(d: unknown): void;
    start(t?: number): void;
    stop(t?: number): void;
  };
  createBuffer(channels: number, length: number, sampleRate: number): {
    getChannelData(ch: number): Float32Array;
  };
  createConvolver(): { buffer: unknown; connect(d: unknown): void; disconnect(): void };
  createDelay(maxDelay?: number): { delayTime: ReturnType<typeof makeAudioParam>; connect(d: unknown): void; disconnect(): void };
  createConstantSource(): { offset: ReturnType<typeof makeAudioParam>; connect(d: unknown): void; start(): void };
  createAnalyser(): FakeAnalyser;
  createMediaStreamSource(stream: unknown): FakeMediaStreamSource;
  /** test hook: streams passed to createMediaStreamSource */
  _mediaStreamSources: FakeMediaStreamSource[];
}

export interface FakeAnalyser {
  fftSize: number;
  frequencyBinCount: number;
  /** test hook: byte value copied into every bin on getByteFrequencyData */
  _fillValue: number;
  /** test hook: number of getByteFrequencyData calls */
  _reads: number;
  getByteFrequencyData(arr: Uint8Array): void;
  connect(d: unknown): void;
  disconnect(): void;
}

export interface FakeMediaStreamSource {
  stream: unknown;
  /** test hook: nodes this source was connected to */
  _connectedTo: unknown[];
  connect(d: unknown): void;
  disconnect(): void;
}

export interface FakeMediaStreamTrack { stop(): void; _stopped: boolean; }
export interface FakeMediaStream { getTracks(): FakeMediaStreamTrack[]; }

export function makeFakeMediaStream(trackCount = 1): FakeMediaStream {
  const tracks: FakeMediaStreamTrack[] = [];
  for (let i = 0; i < trackCount; i++) {
    const t: FakeMediaStreamTrack = { _stopped: false, stop() { t._stopped = true; } };
    tracks.push(t);
  }
  return { getTracks: () => tracks };
}

export function makeFakeAudio(): FakeAudioContext {
  let now = 0;
  const ctx: FakeAudioContext = {
    get currentTime() { return now; },
    set currentTime(v: number) { now = v; },
    sampleRate: 44100,
    state: 'suspended',
    destination: { _id: 'destination' },
    async resume() { ctx.state = 'running'; },
    async close() { ctx.state = 'closed'; },
    createGain() {
      const ramps: FakeRamp[] = [];
      const g: FakeGain = {
        gain: {
          value: 1,
          ramps,
          linearRampToValueAtTime(v, t) { ramps.push({ value: v, endTime: t }); g.gain.value = v; },
          exponentialRampToValueAtTime(v, _t) { g.gain.value = v; },
          setValueAtTime(v, _t) { g.gain.value = v; },
          setTargetAtTime(v, _t, _tc) { g.gain.value = v; },
          cancelScheduledValues() {}
        },
        connect() {},
        disconnect() {}
      };
      return g;
    },
    createBufferSource() {
      return { connect() {}, start(_t?: number) {}, stop(_t?: number) {}, buffer: null as unknown, loop: false };
    },
    createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: makeAudioParam(350),
        Q: makeAudioParam(1),
        connect() {},
        disconnect() {}
      };
    },
    createOscillator() {
      return {
        type: 'sine',
        frequency: makeAudioParam(440),
        detune: makeAudioParam(0),
        connect() {},
        start(_t?: number) {},
        stop(_t?: number) {}
      };
    },
    createBuffer(_channels: number, length: number) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createConvolver() {
      return { buffer: null as unknown, connect() {}, disconnect() {} };
    },
    createDelay(_maxDelay?: number) {
      return { delayTime: makeAudioParam(0), connect() {}, disconnect() {} };
    },
    createConstantSource() {
      return { offset: makeAudioParam(0), connect() {}, start() {} };
    },
    createAnalyser() {
      const a: FakeAnalyser = {
        fftSize: 2048,
        get frequencyBinCount() { return a.fftSize / 2; },
        _fillValue: 0,
        _reads: 0,
        getByteFrequencyData(arr: Uint8Array) {
          a._reads++;
          arr.fill(a._fillValue);
        },
        connect() {},
        disconnect() {}
      };
      return a;
    },
    createMediaStreamSource(stream: unknown) {
      const s: FakeMediaStreamSource = {
        stream,
        _connectedTo: [],
        connect(d: unknown) { s._connectedTo.push(d); },
        disconnect() {}
      };
      ctx._mediaStreamSources.push(s);
      return s;
    },
    _mediaStreamSources: []
  };
  return ctx;
}

export function advanceFakeAudio(ctx: FakeAudioContext, deltaMs: number): void {
  (ctx as unknown as { currentTime: number }).currentTime = ctx.currentTime + deltaMs / 1000;
}
