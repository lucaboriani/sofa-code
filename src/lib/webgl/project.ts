// World→screen projection for anchoring DOM elements to 3D points, using the
// same column-major MVP convention as ./math.ts.

export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
  behindCamera: boolean;
}

export function worldToScreen(
  mvp: Float32Array,
  worldPos: readonly [number, number, number],
  canvasW: number,
  canvasH: number
): ScreenPoint {
  const [x, y, z] = worldPos;
  const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
  const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
  const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
  if (cw <= 0) {
    return { x: 0, y: 0, depth: cw, behindCamera: true };
  }
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  return {
    x: (ndcX * 0.5 + 0.5) * canvasW,
    y: (-ndcY * 0.5 + 0.5) * canvasH,
    depth: cw,
    behindCamera: false
  };
}
