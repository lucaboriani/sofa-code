export interface RafLoop {
  start(): void;
  stop(): void;
}

export function createRafLoop(
  tick: (dtMs: number, tMs: number) => void,
  signal?: AbortSignal
): RafLoop {
  let id = 0;
  let running = false;
  let lastT: number | null = null;

  const frame = (t: number): void => {
    if (!running) return;
    if (document.hidden) {
      id = requestAnimationFrame(frame);
      return;
    }
    const dt = lastT === null ? 0 : t - lastT;
    lastT = t;
    tick(dt, t);
    id = requestAnimationFrame(frame);
  };

  const stop = (): void => {
    running = false;
    if (id) cancelAnimationFrame(id);
    id = 0;
    lastT = null;
  };

  if (signal && !signal.aborted) {
    signal.addEventListener('abort', stop, { once: true });
  }

  return {
    start(): void {
      if (running) return;
      if (signal?.aborted) return;
      running = true;
      lastT = null;
      id = requestAnimationFrame(frame);
    },
    stop
  };
}
