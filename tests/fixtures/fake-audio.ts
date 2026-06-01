export interface FakeRamp { value: number; endTime: number; }
export interface FakeGain {
  gain: { value: number; ramps: FakeRamp[]; linearRampToValueAtTime(v: number, t: number): void; setValueAtTime(v: number, t: number): void; };
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
  createBufferSource(): { connect(d: unknown): void; start(): void; stop(): void; buffer: null; loop: boolean };
  createBiquadFilter(): {
    type: string;
    frequency: ReturnType<typeof makeAudioParam>;
    Q: ReturnType<typeof makeAudioParam>;
    connect(d: unknown): void;
  };
  createOscillator(): {
    type: string;
    frequency: ReturnType<typeof makeAudioParam>;
    connect(d: unknown): void;
    start(): void;
    stop(): void;
  };
  createBuffer(channels: number, length: number, sampleRate: number): {
    getChannelData(ch: number): Float32Array;
  };
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
          setValueAtTime(v, _t) { g.gain.value = v; }
        },
        connect() {},
        disconnect() {}
      };
      return g;
    },
    createBufferSource() {
      return { connect() {}, start() {}, stop() {}, buffer: null, loop: false };
    },
    createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: makeAudioParam(350),
        Q: makeAudioParam(1),
        connect() {}
      };
    },
    createOscillator() {
      return {
        type: 'sine',
        frequency: makeAudioParam(440),
        connect() {},
        start() {},
        stop() {}
      };
    },
    createBuffer(_channels: number, length: number) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    }
  };
  return ctx;
}

export function advanceFakeAudio(ctx: FakeAudioContext, deltaMs: number): void {
  (ctx as unknown as { currentTime: number }).currentTime = ctx.currentTime + deltaMs / 1000;
}
