// Shared column-major mat4 helpers used by the rooms.
// Consolidated from the per-room ports (neural, bindu) — semantics identical.

export function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[r + k * 4] * b[k + c * 4];
    o[r + c * 4] = s;
  }
  return o;
}

export function perspective(fov: number, asp: number, n: number, f: number): Float32Array {
  const t = 1 / Math.tan(fov / 2), m = new Float32Array(16);
  m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f);
  m[14] = (2 * f * n) / (n - f); m[11] = -1;
  return m;
}

export function rotY(a: number): Float32Array {
  const m = new Float32Array(16), c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[8] = s; m[5] = 1; m[2] = -s; m[10] = c; m[15] = 1;
  return m;
}

export function rotX(a: number): Float32Array {
  const m = new Float32Array(16), c = Math.cos(a), s = Math.sin(a);
  m[0] = 1; m[5] = c; m[9] = -s; m[6] = s; m[10] = c; m[15] = 1;
  return m;
}

export function transl(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function lookAt(ex: number, ey: number, ez: number): Float32Array {
  let zx = ex, zy = ey, zz = ez;
  const zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx: number, xy: number, xz: number;
  if (Math.abs(zy) > 0.99) { xx = 1; xy = 0; xz = 0; }
  else {
    xx = -zz; xy = 0; xz = zx;
    const xl = Math.sqrt(xx * xx + xz * xz) || 1;
    xx /= xl; xz /= xl;
  }
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * ex + xy * ey + xz * ez), -(yx * ex + yy * ey + yz * ez), -(zx * ex + zy * ey + zz * ez), 1
  ]);
}
