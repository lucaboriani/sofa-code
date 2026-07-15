import { describe, it, expect } from 'vitest';
import { rayFromCamera, intersectSphere } from '@/lib/webgl/raycast';

describe('webgl/raycast', () => {
  it('rayFromCamera with zero yaw/pitch and centered NDC looks straight down -Z', () => {
    const ray = rayFromCamera([0, 0, 0], 0, 0, 0, 0, Math.PI / 2, 1);
    expect(ray.origin).toEqual([0, 0, 0]);
    expect(ray.dir[0]).toBeCloseTo(0);
    expect(ray.dir[1]).toBeCloseTo(0);
    expect(ray.dir[2]).toBeCloseTo(-1);
  });

  it('rayFromCamera rotates with yaw: turning 90° right points the ray toward +X', () => {
    const ray = rayFromCamera([0, 0, 0], Math.PI / 2, 0, 0, 0, Math.PI / 2, 1);
    expect(ray.dir[0]).toBeCloseTo(1);
    expect(ray.dir[1]).toBeCloseTo(0);
    expect(ray.dir[2]).toBeCloseTo(0);
  });

  it('intersectSphere hits a sphere ahead of the ray at the expected distance', () => {
    const t = intersectSphere([0, 0, 0], [0, 0, -1], [0, 0, -10], 2);
    expect(t).toBeCloseTo(8);
  });

  it('intersectSphere misses a sphere off to the side', () => {
    const t = intersectSphere([0, 0, 0], [0, 0, -1], [50, 0, -10], 2);
    expect(t).toBeNull();
  });

  it('intersectSphere returns null when the sphere is entirely behind the ray origin', () => {
    const t = intersectSphere([0, 0, 0], [0, 0, -1], [0, 0, 10], 2);
    expect(t).toBeNull();
  });

  it('rayFromCamera + intersectSphere: turning to face a sphere off to the right hits it', () => {
    const ray = rayFromCamera([0, 0, 0], Math.PI / 2, 0, 0, 0, Math.PI / 2, 1);
    const t = intersectSphere(ray.origin, ray.dir, [10, 0, 0], 2);
    expect(t).toBeCloseTo(8);
  });
});
