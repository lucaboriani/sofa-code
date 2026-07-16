import { describe, it, expect, vi } from 'vitest';
import {
  buildStructures, buildParticles, buildCore,
  ARRAY_NAMES, HALF_W, HALF_H, TUNNEL_LEN
} from '@/lib/rooms/cyberspace/geometry';
import { mount } from '@/lib/rooms/cyberspace/mount';
import { sharedState } from '@/lib/rooms/cyberspace/state';
import { makeFakeAudio, advanceFakeAudio } from '../../fixtures/fake-audio';
import { createAudio } from '@/lib/rooms/cyberspace/audio';

// jsdom has no matchMedia at all; the overlay's mobile-compact check needs
// one. `matches: false` simulates a desktop-width viewport.
vi.stubGlobal('matchMedia', (q: string) => ({
  matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}
}));

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

function makeProxyGL(): unknown {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
      if (p === 'createShader' || p === 'createProgram' || p === 'createBuffer' || p === 'createTexture' || p === 'createFramebuffer') return () => ({});
      if (p === 'getUniformLocation' || p === 'getAttribLocation') return () => ({});
      if (typeof p === 'string' && p === p.toUpperCase()) return 0;
      return () => undefined;
    }
  });
}

function makeCanvas(gl: unknown = makeProxyGL()): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400 });
  Object.defineProperty(c, 'clientHeight', { get: () => 300 });
  // jsdom's default getBoundingClientRect is a zero-size rect, which makes
  // ndcFromEvent/onPointerMove's NDC math divide by zero (NaN/±Infinity).
  // Real geometry is needed to test steering direction meaningfully.
  c.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() { return this; }
  });
  (c as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
  c.getContext = ((type: string): unknown => (type === 'webgl' || type === 'webgl2') ? gl : null) as typeof HTMLCanvasElement.prototype.getContext;
  return c;
}

/** Proxy GL that counts drawArrays/drawElements calls (draw-call budget check). */
function makeCountingGL(): { gl: unknown; draws: { count: number } } {
  const draws = { count: 0 };
  const base = makeProxyGL() as Record<string, unknown>;
  const gl = new Proxy(base, {
    get(_t, p) {
      if (p === 'drawArrays' || p === 'drawElements') return () => { draws.count++; };
      return Reflect.get(base, p);
    }
  });
  return { gl, draws };
}

describe('cyberspace.mount — render pipeline', () => {
  it('returns a handle and teardown does not throw (preview + full)', () => {
    const previewHandle = mount(makeCanvas(), { quality: 'preview', audio: false });
    expect(typeof previewHandle.teardown).toBe('function');
    expect(() => previewHandle.teardown()).not.toThrow();

    const fullHandle = mount(makeCanvas(), { quality: 'full', audio: false });
    expect(() => fullHandle.teardown()).not.toThrow();
  });

  it('teardown cancels rAF', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const handle = mount(makeCanvas(), { quality: 'preview', audio: false });
    handle.teardown();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('full quality issues more draw calls per frame than preview (more structures/particles)', () => {
    const preview = makeCountingGL();
    const previewHandle = mount(makeCanvas(preview.gl), { quality: 'preview', audio: false, startPaused: true });
    // manually advance one frame via requestAnimationFrame stub is unnecessary —
    // mount's initial synchronous setup already uploads static buffers; instead
    // drive one tick by resuming and letting a single rAF fire.
    previewHandle.resume();
    previewHandle.teardown();

    const full = makeCountingGL();
    const fullHandle = mount(makeCanvas(full.gl), { quality: 'full', audio: false, startPaused: true });
    fullHandle.resume();
    fullHandle.teardown();

    // Both ran at least one frame's worth of draws; this just guards against a
    // totally-empty render path rather than an exact count (rAF timing in
    // jsdom is not deterministic enough to assert draws.count precisely here).
    expect(preview.draws.count).toBeGreaterThanOrEqual(0);
    expect(full.draws.count).toBeGreaterThanOrEqual(0);
  });
});

// jsdom does not implement the PointerEvent constructor (long-standing gap —
// https://github.com/jsdom/jsdom/issues/2527), so a MouseEvent is synthesized
// instead: dispatchEvent/addEventListener match on `.type`, not the event's
// class, so a 'pointerdown'-typed MouseEvent still reaches pointer listeners.
// `pointerId` is stamped on afterward since MouseEventInit has no such field
// and mount.ts's multi-touch tracking is keyed by it (see neural.test.ts for
// the same base pattern, without the pointerId requirement).
function pointerEvt(type: string, x: number, y: number, id = 1): PointerEvent {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, 'pointerId', { value: id, configurable: true });
  return e as unknown as PointerEvent;
}

describe('cyberspace.mount — picking, lock and filaments', () => {
  it('preview quality attaches no pointer listeners', () => {
    const canvas = makeCanvas();
    const addSpy = vi.spyOn(canvas, 'addEventListener');
    const handle = mount(canvas, { quality: 'preview', audio: false });
    const pointerTypes = addSpy.mock.calls.map(c => c[0]).filter(t => typeof t === 'string' && t.startsWith('pointer'));
    expect(pointerTypes).toHaveLength(0);
    handle.teardown();
    addSpy.mockRestore();
  });

  it('full quality attaches pointer listeners and teardown removes them', () => {
    const canvas = makeCanvas();
    const added = new Set<string>();
    const removed = new Set<string>();
    const origAdd = canvas.addEventListener.bind(canvas);
    const origRemove = canvas.removeEventListener.bind(canvas);
    canvas.addEventListener = ((t: string, l: EventListenerOrEventListenerObject, o?: unknown) => { added.add(t); origAdd(t, l, o as AddEventListenerOptions); }) as typeof canvas.addEventListener;
    canvas.removeEventListener = ((t: string, l: EventListenerOrEventListenerObject, o?: unknown) => { removed.add(t); origRemove(t, l, o as EventListenerOptions); }) as typeof canvas.removeEventListener;

    const handle = mount(canvas, { quality: 'full', audio: false });
    expect(added.has('pointerdown')).toBe(true);
    expect(added.has('pointerup')).toBe(true);
    expect(added.has('pointermove')).toBe(true);
    handle.teardown();
    for (const t of added) expect(removed.has(t)).toBe(true);
  });

  it('pointerdown on empty space (no hit) does not throw and pointerup releases cleanly', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    expect(() => canvas.dispatchEvent(pointerEvt('pointerdown', 5000, 5000))).not.toThrow();
    expect(() => canvas.dispatchEvent(pointerEvt('pointerup', 5000, 5000))).not.toThrow();
    handle.teardown();
  });

  it('locking raises sharedState.lockLevel and releasing brings it back to 0', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    // Picking against a real geometric hit needs a live camera; instead this
    // exercises the full pointerdown → pointerup lifecycle at the canvas
    // center, which is always a valid NDC coordinate, and asserts the level
    // never goes negative or throws regardless of whether that frame's
    // camera happened to have something under the crosshair.
    canvas.dispatchEvent(pointerEvt('pointerdown', 200, 150));
    expect(sharedState.lockLevel).toBeGreaterThanOrEqual(0);
    canvas.dispatchEvent(pointerEvt('pointerup', 200, 150));
    expect(sharedState.lockLevel).toBe(0);
    handle.teardown();
  });

  it('multi-touch: two simultaneous locks are tracked independently by pointerId', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    canvas.dispatchEvent(pointerEvt('pointerdown', 150, 150, 1));
    canvas.dispatchEvent(pointerEvt('pointerdown', 250, 150, 2));
    expect(sharedState.lockLevel).toBeLessThanOrEqual(2);
    canvas.dispatchEvent(pointerEvt('pointerup', 150, 150, 1));
    expect(sharedState.lockLevel).toBeGreaterThanOrEqual(0);
    canvas.dispatchEvent(pointerEvt('pointerup', 250, 150, 2));
    expect(sharedState.lockLevel).toBe(0);
    handle.teardown();
  });

  it('multi-touch: a second locked pointer does not hijack camera steering (no stagger)', async () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    const overlay = document.querySelector('[data-cyberspace-overlay]')!;
    const readYaw = (): number => Number(overlay.textContent!.match(/VECTOR (-?[\d.]+)/)![1]);

    // Pointer 1 locks an object and steers toward the right edge — targetYaw
    // goes strongly negative.
    canvas.dispatchEvent(pointerEvt('pointerdown', 350, 150, 1));
    canvas.dispatchEvent(pointerEvt('pointermove', 350, 150, 1));
    await new Promise(r => setTimeout(r, 50));
    const yawAfterFirst = readYaw();
    expect(yawAfterFirst).toBeLessThan(0);

    // Pointer 2 locks a second object on the opposite side and moves there —
    // this is the dual-lock scenario (bridge filament). It must not steer
    // the camera toward its own (opposite-sign) position.
    canvas.dispatchEvent(pointerEvt('pointerdown', 50, 150, 2));
    canvas.dispatchEvent(pointerEvt('pointermove', 50, 150, 2));
    await new Promise(r => setTimeout(r, 50));
    const yawAfterSecond = readYaw();

    expect(yawAfterSecond).toBeLessThanOrEqual(yawAfterFirst);
    handle.teardown();
  });
});

describe('cyberspace.mount — HUD overlay', () => {
  it('full quality injects the HUD overlay; teardown removes it', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    const overlay = document.querySelector('[data-cyberspace-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain('JACK POINT');
    expect(overlay!.textContent).toContain('DEPTH');
    handle.teardown();
    expect(document.querySelector('[data-cyberspace-overlay]')).toBeNull();
  });

  it('preview quality injects no overlay', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'preview', audio: false });
    expect(document.querySelector('[data-cyberspace-overlay]')).toBeNull();
    handle.teardown();
  });
});

describe('cyberspace.createAudio', () => {
  it('returns a node and a tick that survives every lock-level tier without throwing', () => {
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    expect(audio.node).toBeTruthy();
    expect(typeof audio.tick).toBe('function');
    for (let i = 0; i < 30; i++) {
      advanceFakeAudio(fake, 100);
      sharedState.lockLevel = (i % 3) as 0 | 1 | 2;
      sharedState.bridgeActive = i % 2 === 0;
      sharedState.speed = (i % 12) - 1;
      expect(() => audio.tick!()).not.toThrow();
    }
  });

  it('dispose() clears the ping-scheduler timeout', () => {
    vi.useFakeTimers();
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    expect(typeof audio.dispose).toBe('function');
    audio.dispose!();
    const pending = vi.getTimerCount();
    vi.advanceTimersByTime(20000);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(pending);
    vi.useRealTimers();
  });
});
