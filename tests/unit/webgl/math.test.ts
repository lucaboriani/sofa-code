import { describe, it, expect } from 'vitest';
import { mul4, perspective, lookAt, rotX, rotY, transl } from '@/lib/webgl/math';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

describe('webgl/math (column-major mat4)', () => {
  it('mul4 with identity returns the other operand', () => {
    const m = transl(3, -2, 7);
    expect([...mul4(IDENTITY, m)]).toEqual([...m]);
    expect([...mul4(m, IDENTITY)]).toEqual([...m]);
  });

  it('transl places translation in the 4th column', () => {
    const m = transl(3, -2, 7);
    expect(m[12]).toBe(3);
    expect(m[13]).toBe(-2);
    expect(m[14]).toBe(7);
    expect(m[15]).toBe(1);
  });

  it('perspective sets the projective elements', () => {
    const fov = Math.PI / 2, asp = 2, n = 0.1, f = 100;
    const t = 1 / Math.tan(fov / 2);
    const m = perspective(fov, asp, n, f);
    expect(m[0]).toBeCloseTo(t / asp);
    expect(m[5]).toBeCloseTo(t);
    expect(m[10]).toBeCloseTo((f + n) / (n - f));
    expect(m[11]).toBe(-1);
    expect(m[14]).toBeCloseTo((2 * f * n) / (n - f));
  });

  it('rotX / rotY rotate by 90 degrees correctly', () => {
    const rx = rotX(Math.PI / 2);
    // column-major: Y axis (0,1,0) → (0,0,1)
    expect(rx[5]).toBeCloseTo(0);
    expect(rx[6]).toBeCloseTo(1);
    const ry = rotY(Math.PI / 2);
    // X axis (1,0,0) → (0,0,-1)
    expect(ry[0]).toBeCloseTo(0);
    expect(ry[2]).toBeCloseTo(-1);
  });

  it('lookAt from +Z looks toward origin with up +Y', () => {
    const m = lookAt(0, 0, 10);
    // Eye at (0,0,10): view-space z of the eye position should be the distance
    // m is column-major; transform (0,0,10,1):
    const x = m[0] * 0 + m[4] * 0 + m[8] * 10 + m[12];
    const y = m[1] * 0 + m[5] * 0 + m[9] * 10 + m[13];
    const z = m[2] * 0 + m[6] * 0 + m[10] * 10 + m[14];
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0); // eye maps to view origin
  });
});
