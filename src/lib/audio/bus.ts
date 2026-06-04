export interface RoomAudio {
  node: AudioNode;
  tick?(): void;
  /** Release resources the graph disconnect can't reach (e.g. stop mic MediaStream tracks). */
  dispose?(): void;
}
export type AudioFactory = (ctx: AudioContext) => RoomAudio;

export interface Active {
  slug: string;
  node: AudioNode;
  gain: GainNode;
  tick?: () => void;
  dispose?: () => void;
}

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: Active | null = null;
  private factories = new Map<string, AudioFactory>();
  private ctxFactory: () => AudioContext;
  private rafId = 0;

  constructor(ctxFactory: () => AudioContext = () => new AudioContext()) {
    this.ctxFactory = ctxFactory;
  }

  register(slug: string, factory: AudioFactory): void {
    this.factories.set(slug, factory);
  }

  has(slug: string): boolean { return this.factories.has(slug); }
  hasContext(): boolean { return this.ctx !== null; }
  current(): Active | null { return this.active; }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* user gesture missing */ }
    }
  }

  private ensureCtx(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = this.ctxFactory();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    this.master = master;
    return ctx;
  }

  async activate(slug: string, fadeMs = 600): Promise<void> {
    const factory = this.factories.get(slug);
    if (!factory) return;
    const ctx = this.ensureCtx();
    const master = this.master!;

    const result = factory(ctx);
    const node = result.node;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(master);

    const fadeSec = fadeMs / 1000;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeSec);

    const previous = this.active;
    if (previous) {
      previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + fadeSec);
      setTimeout(() => {
        try { previous.node.disconnect(); previous.gain.disconnect(); } catch { /* idempotent */ }
        previous.dispose?.();
      }, fadeMs + 50);
    }

    this.active = {
      slug,
      node,
      gain,
      ...(result.tick ? { tick: result.tick } : {}),
      ...(result.dispose ? { dispose: result.dispose } : {})
    };
    this.ensureLoop();
  }

  async deactivate(fadeMs = 600): Promise<void> {
    if (!this.active || !this.ctx) return;
    const fadeSec = fadeMs / 1000;
    const now = this.ctx.currentTime;
    const a = this.active;
    a.gain.gain.setValueAtTime(a.gain.gain.value, now);
    a.gain.gain.linearRampToValueAtTime(0, now + fadeSec);
    setTimeout(() => {
      try { a.node.disconnect(); a.gain.disconnect(); } catch { /* idempotent */ }
      a.dispose?.();
    }, fadeMs + 50);
    this.active = null;
    this.stopLoop();
  }

  private ensureLoop(): void {
    if (this.rafId !== 0) return;
    const frame = (): void => {
      if (!this.active) { this.rafId = 0; return; }
      this.active.tick?.();
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private stopLoop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }
}

const GLOBAL_KEY = '__audioBus__';

export function getAudioBus(): AudioBus {
  const w = window as Window & { __audioBus__?: AudioBus };
  if (!w[GLOBAL_KEY]) {
    w[GLOBAL_KEY] = new AudioBus();
  }
  return w[GLOBAL_KEY]!;
}
