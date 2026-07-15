import { describe, it, expect } from 'vitest';
import { worldToScreen } from '@/lib/webgl/project';
import { mul4, perspective, transl } from '@/lib/webgl/math';

describe('webgl/project', () => {
  it('a point straight ahead of the camera projects to canvas center', () => {
    const mvp = mul4(perspective(Math.PI / 2, 1, 0.1, 100), transl(0, 0, -5));
    const p = worldToScreen(mvp, [0, 0, 0], 400, 300);
    expect(p.behindCamera).toBe(false);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(150);
  });

  it('a point behind the camera is flagged behindCamera', () => {
    const mvp = mul4(perspective(Math.PI / 2, 1, 0.1, 100), transl(0, 0, 5));
    const p = worldToScreen(mvp, [0, 0, 0], 400, 300);
    expect(p.behindCamera).toBe(true);
  });

  it('a point to the right of the camera projects right of center', () => {
    const mvp = mul4(perspective(Math.PI / 2, 1, 0.1, 100), transl(0, 0, -5));
    const p = worldToScreen(mvp, [2, 0, -5], 400, 300);
    expect(p.behindCamera).toBe(false);
    expect(p.x).toBeGreaterThan(200);
  });
});
