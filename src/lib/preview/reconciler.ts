export interface ReconcilerInput {
  inViewport: boolean;
  reducedMotion: boolean;
  smallScreen: boolean;
  currentState: 'idle' | 'running';
}

export type ReconcilerOutput = 'mount' | 'teardown' | 'noop';

export function decide(i: ReconcilerInput): ReconcilerOutput {
  const shouldRun = i.inViewport && !i.reducedMotion && !i.smallScreen;
  if (shouldRun && i.currentState === 'idle') return 'mount';
  if (!shouldRun && i.currentState === 'running') return 'teardown';
  return 'noop';
}
