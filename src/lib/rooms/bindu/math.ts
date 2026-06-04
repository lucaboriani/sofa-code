// ─── Math (bindu.html L72-94) ────────────────────────────────────────────────

export function persp(fov: number, asp: number, n: number, f: number): Float32Array {
  const t = 1 / Math.tan(fov * 0.5), nf = 1 / (n - f);
  return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]);
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

export function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[row + k * 4] * b[k + c * 4];
      r[row + c * 4] = v;
    }
  }
  return r;
}
