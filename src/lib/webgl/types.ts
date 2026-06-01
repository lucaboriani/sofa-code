export type RoomQuality = 'preview' | 'full';

export interface RoomOptions {
  quality: RoomQuality;
  audio: boolean;
  signal?: AbortSignal;
}

export type RoomTeardown = () => void;
export type RoomMount = (canvas: HTMLCanvasElement, opts: RoomOptions) => RoomTeardown;

export type AnyGL = WebGLRenderingContext | WebGL2RenderingContext;
