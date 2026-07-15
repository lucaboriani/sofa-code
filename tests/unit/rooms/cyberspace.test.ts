import { describe, it, expect } from 'vitest';
import {
  buildStructures, buildParticles, buildCore,
  ARRAY_NAMES, HALF_W, HALF_H, TUNNEL_LEN
} from '@/lib/rooms/cyberspace/geometry';

describe('cyberspace geometry', () => {
  it('buildStructures returns the requested count with valid fields', () => {
    const structures = buildStructures(240);
    expect(structures).toHaveLength(240);
    for (const s of structures) {
      expect(['ico', 'oct', 'box', 'tet']).toContain(s.solid);
      expect(ARRAY_NAMES).toContain(s.name);
      expect(Math.abs(s.position[0])).toBeLessThanOrEqual(HALF_W);
      expect(Math.abs(s.position[1])).toBeLessThanOrEqual(HALF_H);
      expect(s.position[2]).toBeLessThan(0);
      expect(s.position[2]).toBeGreaterThan(-TUNNEL_LEN);
      expect(s.scale).toBeGreaterThanOrEqual(2);
      expect(s.scale).toBeLessThanOrEqual(10);
    }
  });

  it('buildStructures marks roughly 18% of structures as ice (crimson)', () => {
    const structures = buildStructures(2000);
    const iceFraction = structures.filter(s => s.isIce).length / structures.length;
    expect(iceFraction).toBeGreaterThan(0.1);
    expect(iceFraction).toBeLessThan(0.26);
  });

  it('buildParticles returns count*3 floats within the tunnel bounds', () => {
    const { positions } = buildParticles(500);
    expect(positions.length).toBe(1500);
    for (let i = 0; i < 500; i++) {
      expect(Math.abs(positions[i * 3])).toBeLessThanOrEqual(HALF_W);
      expect(Math.abs(positions[i * 3 + 1])).toBeLessThanOrEqual(HALF_H);
      expect(positions[i * 3 + 2]).toBeLessThanOrEqual(0);
      expect(positions[i * 3 + 2]).toBeGreaterThanOrEqual(-TUNNEL_LEN);
    }
  });

  it('buildCore returns a fixed far-end position and nested scales', () => {
    const core = buildCore();
    expect(core.position[0]).toBe(0);
    expect(core.position[1]).toBe(0);
    expect(core.position[2]).toBeCloseTo(-TUNNEL_LEN + 140);
    expect(core.outerScale).toBe(58);
    expect(core.innerScale).toBe(30);
    expect(core.innerScale).toBeLessThan(core.outerScale);
  });
});
