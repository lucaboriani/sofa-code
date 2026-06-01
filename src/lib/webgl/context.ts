import type { AnyGL } from './types';

export interface ContextOpts {
  version: 1 | 2;
  antialias?: boolean;
  alpha?: boolean;
  depth?: boolean;
}

export function createContext(canvas: HTMLCanvasElement, opts: ContextOpts): AnyGL {
  const attribs: WebGLContextAttributes = {
    antialias: opts.antialias ?? true,
    alpha: opts.alpha ?? false,
    depth: opts.depth ?? true
  };
  if (opts.version === 2) {
    const gl2 = canvas.getContext('webgl2', attribs);
    if (gl2) return gl2;
  }
  const gl1 = canvas.getContext('webgl', attribs);
  if (!gl1) throw new Error('WebGL not supported');
  return gl1;
}
