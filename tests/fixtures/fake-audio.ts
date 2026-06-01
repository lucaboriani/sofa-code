export interface FakeRamp { value: number; endTime: number; }
export interface FakeGain {
  gain: { value: number; ramps: FakeRamp[]; linearRampToValueAtTime(v: number, t: number): void; setValueAtTime(v: number, t: number): void; };
  connect(dest: unknown): void;
  disconnect(): void;
}
export interface FakeAudioContext {
  currentTime: number;
  state: 'suspended' | 'running' | 'closed';
  destination: { _id: 'destination' };
  resume(): Promise<void>;
  close(): Promise<void>;
  createGain(): FakeGain;
  createBufferSource(): { connect(d: unknown): void; start(): void; stop(): void; buffer: null; loop: boolean };
}

export function makeFakeAudio(): FakeAudioContext {
  let now = 0;
  const ctx: FakeAudioContext = {
    get currentTime() { return now; },
    set currentTime(v: number) { now = v; },
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
    }
  };
  return ctx;
}

export function advanceFakeAudio(ctx: FakeAudioContext, deltaMs: number): void {
  (ctx as unknown as { currentTime: number }).currentTime = ctx.currentTime + deltaMs / 1000;
}
