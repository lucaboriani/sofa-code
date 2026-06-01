export type RoomQuality = 'preview' | 'full';

export interface RoomOptions {
  quality: RoomQuality;
  audio: boolean;
  startPaused?: boolean;
  signal?: AbortSignal;
}

export interface RoomHandle {
  teardown: () => void;
  pause: () => void;
  resume: () => void;
}
export type RoomMount = (canvas: HTMLCanvasElement, opts: RoomOptions) => RoomHandle;
export type RoomTeardown = () => void;

export type AnyGL = WebGLRenderingContext | WebGL2RenderingContext;
