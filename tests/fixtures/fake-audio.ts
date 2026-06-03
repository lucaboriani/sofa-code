export interface FakeRamp { value: number; endTime: number; }
export interface FakeGain {
  gain: {
    value: number;
    ramps: FakeRamp[];
    linearRampToValueAtTime(v: number, t: number): void;
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
  exponentialRampToValueAtTime(v: number, t: number): void;
} {
  let val = initial;
  return {
    get value() { return val; },
    set value(v: number) { val = v; },
    setValueAtTime(v: number) { val = v; },
    setTargetAtTime(v: number) { val = v; },
    cancelScheduledValues() {},
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
  createConstantSource(): { offset: ReturnType<typeof makeAudioParam>; connect(d: unknown): void; start(): void };
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
    createConstantSource() {
      return { offset: makeAudioParam(0), connect() {}, start() {} };
    }
  };
  return ctx;
}

export function advanceFakeAudio(ctx: FakeAudioContext, deltaMs: number): void {
  (ctx as unknown as { currentTime: number }).currentTime = ctx.currentTime + deltaMs / 1000;
}
