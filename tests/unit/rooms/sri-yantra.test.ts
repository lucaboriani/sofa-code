import { describe, it, expect } from 'vitest';
import {
  buildYantra, petalRing, bhupuraParts, palettes, pickScheme,
  prog, startOf, N_LAYERS, NAMES
} from '@/lib/rooms/sri-yantra/geometry';
import { createAudio } from '@/lib/rooms/sri-yantra/audio';
import { sharedState } from '@/lib/rooms/sri-yantra/state';
import { makeFakeAudio, advanceFakeAudio } from '../../fixtures/fake-audio';

describe('sri-yantra geometry', () => {
  it('buildYantra returns 9 triangle layers with strictly descending radii', () => {
    const layers = buildYantra(1, 1);
    expect(layers).toHaveLength(9);
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i].radius).toBeLessThan(layers[i - 1].radius);
    }
    expect(layers.every(l => l.pts.length === 3)).toBe(true);
  });

  it('petalRing returns one segment per petal', () => {
    expect(petalRing(8, 0.72, 0.89)).toHaveLength(8);
    expect(petalRing(16, 0.89, 1.0)).toHaveLength(16);
    expect(petalRing(8, 0.72, 0.89)[0].length).toBeGreaterThan(2);
  });

  it('bhupuraParts returns the enclosure plus twelve gate polylines', () => {
    const b = bhupuraParts(1);
    expect(b.outer.length).toBeGreaterThan(0);
    expect(b.inner.length).toBeGreaterThan(0);
    expect(b.gates).toHaveLength(12); // 3 polylines × 4 sides
  });

  it('every palette exposes a bg string and four colour functions', () => {
    for (const key of Object.keys(palettes)) {
      const p = palettes[key as keyof typeof palettes];
      expect(typeof p.bg).toBe('string');
      for (const fn of [p.pri, p.sec, p.acc, p.glow]) expect(fn(0.5)).toContain('hsla(');
    }
  });

  it('pickScheme returns a known palette key', () => {
    expect(Object.keys(palettes)).toContain(pickScheme());
  });

  it('timeline: prog ramps 0→1 over APPEAR_DUR; NAMES covers every layer', () => {
    expect(prog(0, startOf(0) - 0.001)).toBe(0);
    expect(prog(0, startOf(0) + 1.0)).toBe(1);
    expect(prog(3, startOf(3) + 0.5)).toBeCloseTo(0.5, 5);
    expect(NAMES).toHaveLength(N_LAYERS);
  });
});

describe('sri-yantra.createAudio', () => {
  it('returns a node and a tick that survives drag, idle and scheme transitions', () => {
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    expect(audio.node).toBeTruthy();
    expect(typeof audio.tick).toBe('function');
    const schemes = Object.keys(palettes) as (keyof typeof palettes)[];
    for (let i = 0; i < 24; i++) {
      advanceFakeAudio(fake, 100);
      sharedState.dragging = i % 2 === 0;
      sharedState.dragSpeed = (i % 10) / 10;
      sharedState.autoActivity = (i % 7) / 7;
      sharedState.scheme = schemes[i % schemes.length];
      expect(() => audio.tick!()).not.toThrow();
    }
  });
});
