# Sri Yantra Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the standalone `sri-yantra.html` Canvas-2D mandala into the gallery as room 9, preserving every graphic and audio effect.

**Architecture:** Faithful port into the established room module pattern (`mount` + `createAudio` + a `sharedState` visual→audio bridge), exactly like the existing 2D ports `catfish` and `tree`. The standalone file's inline `requestAnimationFrame`/resize become the shared engine primitives (`createRafLoop`, `observeResize`); the "Enable Sound" button is replaced by the app's `AudioPrompt` (the AudioBus owns the AudioContext + fade); the phase label + Regenerate button move to a DOM overlay. Pure geometry/palette/timeline math lives in a unit-testable `geometry.ts`.

**Tech Stack:** Astro + TypeScript (strict), Canvas 2D, Web Audio API, Vitest (unit) + Playwright (e2e). No frameworks, plain CSS.

## Global Constraints

- TypeScript strict: `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`. No `any` / `as unknown` (except the established test casts to fixture types).
- No frameworks beyond Astro; plain CSS; path alias `@/*` → `src/*`.
- **No allocations inside RAF ticks** — preallocate in the `mount()` closure.
- DPR pinned to **1** (`observeResize(canvas, …, 1)`) so drag coordinates map 1:1 to canvas pixels — the original ran at DPR 1.
- **Audio funnels through the returned `node`** — no room node connects to `ctx.destination` directly; the bus owns the context, fade, and per-frame `tick()`.
- All geometry/timeline/drag-physics/audio **formulas are verbatim** from `sri-yantra.html`.
- Preserve the Sanskrit identity (`ॐ` + layer names) verbatim, as with the Italian in `neural`/`tree`.
- Conventional-commit messages (`feat`, `test`, …). Commit at each TDD checkpoint.
- Reference spec: `docs/superpowers/specs/2026-06-19-sri-yantra-room-design.md`.

---

### Task 1: Pure geometry, palette & timeline (`geometry.ts`)

**Files:**
- Create: `src/lib/rooms/sri-yantra/geometry.ts`
- Test: `tests/unit/rooms/sri-yantra.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Pt = [number, number]`
  - `rand(a,b)`, `randInt(a,b)`, `lerp(a,b,t)`, `clamp(v,a,b)`, `easeOut(t)` — all `(…: number) => number`
  - `hsl(h,s,l,a?)` → `string`
  - `type AlphaFn = (a: number) => string`; `interface Palette { bg: string; pri: AlphaFn; sec: AlphaFn; acc: AlphaFn; glow: AlphaFn }`
  - `palettes` (6 schemes) `satisfies Record<string, Palette>`; `type SchemeKey = keyof typeof palettes`; `pickScheme(): SchemeKey`
  - `interface YantraLayer { pts: Pt[]; up: boolean; radius: number }`; `buildYantra(R, v): YantraLayer[]`
  - `petalRing(n, inner, outer): Pt[][]`
  - `interface Bhupura { outer: Pt[]; inner: Pt[]; gates: Pt[][] }`; `bhupuraParts(R): Bhupura`
  - `NAMES: string[]`, `N_LAYERS = 14`, `APPEAR_DUR = 1.0`, `STEP = 1.2`, `startOf(i): number`, `prog(i, age): number`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/rooms/sri-yantra.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildYantra, petalRing, bhupuraParts, palettes, pickScheme,
  prog, startOf, N_LAYERS, NAMES
} from '@/lib/rooms/sri-yantra/geometry';

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- sri-yantra`
Expected: FAIL — `Cannot find module '@/lib/rooms/sri-yantra/geometry'`.

- [ ] **Step 3: Implement `geometry.ts`**

Create `src/lib/rooms/sri-yantra/geometry.ts`:

```ts
// Pure geometry, palette and timeline helpers ported verbatim from
// sri-yantra.html. No DOM, no canvas — unit-testable.

export type Pt = [number, number];

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const easeOut = (t: number): number => 1 - (1 - clamp(t, 0, 1)) * (1 - clamp(t, 0, 1));

export function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;
}

export type AlphaFn = (a: number) => string;
export interface Palette { bg: string; pri: AlphaFn; sec: AlphaFn; acc: AlphaFn; glow: AlphaFn; }

export const palettes = {
  golden:  { bg: '#0a0501', pri: (a: number) => hsl(50, 100, 82, a),  sec: (a: number) => hsl(30, 100, 70, a),  acc: (a: number) => hsl(15, 100, 72, a),  glow: (a: number) => hsl(55, 100, 90, a) },
  indigo:  { bg: '#05060f', pri: (a: number) => hsl(195, 100, 82, a), sec: (a: number) => hsl(265, 95, 80, a),  acc: (a: number) => hsl(175, 100, 82, a), glow: (a: number) => hsl(215, 100, 90, a) },
  crimson: { bg: '#0d0103', pri: (a: number) => hsl(345, 100, 78, a), sec: (a: number) => hsl(18, 100, 72, a),  acc: (a: number) => hsl(335, 100, 86, a), glow: (a: number) => hsl(5, 100, 82, a) },
  emerald: { bg: '#010d05', pri: (a: number) => hsl(145, 100, 72, a), sec: (a: number) => hsl(115, 90, 68, a),  acc: (a: number) => hsl(55, 100, 78, a),  glow: (a: number) => hsl(135, 100, 82, a) },
  dusk:    { bg: '#08030f', pri: (a: number) => hsl(300, 90, 82, a),  sec: (a: number) => hsl(265, 95, 78, a),  acc: (a: number) => hsl(45, 100, 82, a),  glow: (a: number) => hsl(290, 100, 90, a) },
  ivory:   { bg: '#100d06', pri: (a: number) => hsl(38, 60, 96, a),   sec: (a: number) => hsl(32, 40, 88, a),   acc: (a: number) => hsl(0, 0, 100, a),    glow: (a: number) => hsl(42, 100, 96, a) }
} satisfies Record<string, Palette>;

export type SchemeKey = keyof typeof palettes;

export function pickScheme(): SchemeKey {
  const keys = Object.keys(palettes) as SchemeKey[];
  return keys[randInt(0, keys.length - 1)];
}

export interface YantraLayer { pts: Pt[]; up: boolean; radius: number; }

export function buildYantra(R: number, v: number): YantraLayer[] {
  const up = (r: number, yo = 0): Pt[] => [[0, r + yo], [-r * 0.866, -r * 0.5 + yo], [r * 0.866, -r * 0.5 + yo]];
  const dn = (r: number, yo = 0): Pt[] => up(r, yo).map(([x, y]) => [x, -y + yo * 2] as Pt);
  return [
    { r: R * 0.97, yo: 0,             up: false },
    { r: R * 0.82, yo: R * 0.03 * v,  up: true  },
    { r: R * 0.78, yo: -R * 0.04 * v, up: false },
    { r: R * 0.66, yo: R * 0.04 * v,  up: true  },
    { r: R * 0.62, yo: -R * 0.04 * v, up: false },
    { r: R * 0.52, yo: R * 0.03 * v,  up: true  },
    { r: R * 0.48, yo: -R * 0.03 * v, up: false },
    { r: R * 0.37, yo: R * 0.03 * v,  up: true  },
    { r: R * 0.33, yo: -R * 0.02 * v, up: false }
  ].map(({ r, yo, up: u }) => ({ pts: u ? up(r, yo) : dn(r, yo), up: u, radius: r }));
}

// The original took an unused leading `R` arg (call sites passed 1); dropped here.
export function petalRing(n: number, inner: number, outer: number): Pt[][] {
  const all: Pt[][] = [];
  const steps = 60;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const seg: Pt[] = [];
    for (let s = 0; s <= steps; s++) {
      const tt = s / steps, a = lerp(a0, a1, tt), rr = lerp(inner, outer, Math.sin(tt * Math.PI));
      seg.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    for (let s = steps; s >= 0; s--) {
      const tt = s / steps, a = lerp(a0, a1, tt);
      seg.push([Math.cos(a) * inner, Math.sin(a) * inner]);
    }
    all.push(seg);
  }
  return all;
}

export interface Bhupura { outer: Pt[]; inner: Pt[]; gates: Pt[][]; }

export function bhupuraParts(R: number): Bhupura {
  const S = R * 1.12, S2 = R * 1.04, gw = S * 0.14;
  const sq = (s: number): Pt[] => [[-s, -s], [s, -s], [s, s], [-s, s], [-s, -s]];
  const gates: Pt[][] = [];
  for (const [ax, sg] of [['x', 1], ['x', -1], ['y', 1], ['y', -1]] as const) {
    if (ax === 'x') {
      const y = sg * S2;
      gates.push([[-S, y], [-gw / 2, y]]);
      gates.push([[gw / 2, y], [S, y]]);
      gates.push([[-gw / 2, y], [-gw / 2, y + sg * gw * 0.55], [gw / 2, y + sg * gw * 0.55], [gw / 2, y]]);
    } else {
      const x = sg * S2;
      gates.push([[x, -S], [x, -gw / 2]]);
      gates.push([[x, gw / 2], [x, S]]);
      gates.push([[x, -gw / 2], [x + sg * gw * 0.55, -gw / 2], [x + sg * gw * 0.55, gw / 2], [x, gw / 2]]);
    }
  }
  return { outer: sq(S), inner: sq(S2), gates };
}

// ── Timeline ─────────────────────────────────────────────────────────────────
export const APPEAR_DUR = 1.0;
export const STEP = 1.2;
export const N_LAYERS = 14;
export const NAMES = [
  'Bindu', 'Triangle 1', 'Triangle 2', 'Triangle 3', 'Triangle 4', 'Triangle 5',
  'Triangle 6', 'Triangle 7', 'Triangle 8', 'Triangle 9',
  '8-Petal Lotus', '16-Petal Lotus', 'Circles', 'Bhupura'
];
export function startOf(i: number): number { return i * STEP; }
export function prog(i: number, age: number): number { return clamp((age - startOf(i)) / APPEAR_DUR, 0, 1); }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- sri-yantra`
Expected: PASS (6 geometry tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rooms/sri-yantra/geometry.ts tests/unit/rooms/sri-yantra.test.ts
git commit -m "feat(sri-yantra): pure geometry, palette and timeline helpers"
```

---

### Task 2: Visual→audio state + audio factory (`state.ts`, `audio.ts`)

**Files:**
- Create: `src/lib/rooms/sri-yantra/state.ts`
- Create: `src/lib/rooms/sri-yantra/audio.ts`
- Test: `tests/unit/rooms/sri-yantra.test.ts` (append)

**Interfaces:**
- Consumes: `SchemeKey` from `./geometry`; `AudioFactory` from `@/lib/audio/bus`.
- Produces:
  - `sharedState: { scheme: SchemeKey; dragSpeed: number; autoActivity: number; dragging: boolean }`
  - `resetState(): void`
  - `createAudio: AudioFactory` returning `{ node: GainNode; tick(): void }`

- [ ] **Step 1: Write the failing audio test (append to `tests/unit/rooms/sri-yantra.test.ts`)**

Add these imports at the top of the file (below the existing import):

```ts
import { createAudio } from '@/lib/rooms/sri-yantra/audio';
import { sharedState } from '@/lib/rooms/sri-yantra/state';
import { makeFakeAudio, advanceFakeAudio } from '../../fixtures/fake-audio';
```

Append this describe block:

```ts
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
```

Add `palettes` to the existing geometry import so the test can enumerate schemes:

```ts
import {
  buildYantra, petalRing, bhupuraParts, palettes, pickScheme,
  prog, startOf, N_LAYERS, NAMES
} from '@/lib/rooms/sri-yantra/geometry';
```

(`palettes` is already in that import from Task 1 — confirm it is present.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- sri-yantra`
Expected: FAIL — `Cannot find module '@/lib/rooms/sri-yantra/audio'`.

- [ ] **Step 3: Implement `state.ts`**

Create `src/lib/rooms/sri-yantra/state.ts`:

```ts
// ─── Shared visual → audio state ─────────────────────────────────────────────
// The visual loop publishes the active palette scheme (drives the drone's base
// frequency + filter cutoff), the normalised drag speed, the idle "nudge"
// energy, and whether a ring is currently being dragged. The audio tick() reads
// these — mirroring the standalone file's direct node pokes from its drag
// handler, now routed through the bus.

import type { SchemeKey } from './geometry';

export const sharedState: {
  scheme: SchemeKey;
  dragSpeed: number;   // |drag velocity| clamped/normalised to 0..1
  autoActivity: number; // idle nudge energy, 0..1
  dragging: boolean;
} = {
  scheme: 'golden',
  dragSpeed: 0,
  autoActivity: 0,
  dragging: false
};

export function resetState(): void {
  sharedState.scheme = 'golden';
  sharedState.dragSpeed = 0;
  sharedState.autoActivity = 0;
  sharedState.dragging = false;
}
```

- [ ] **Step 4: Implement `audio.ts`**

Create `src/lib/rooms/sri-yantra/audio.ts`:

```ts
import type { AudioFactory } from '@/lib/audio/bus';
import { sharedState } from './state';

// ─── Audio factory (sri-yantra.html startAudio/updateDrone) ──────────────────
// The standalone file owned its own AudioContext + "Enable Sound" button; here
// the bus owns the context and the on/off fade, and the AudioPrompt is the
// user-gesture entry point. updateDrone() becomes tick(), which reads drag/idle/
// scheme state from sharedState. All AC.destination connects funnel into `out`.
// Formulas are verbatim.

const BASE_FREQ: Record<string, number> = { golden: 136.1, indigo: 141, crimson: 128, emerald: 144, dusk: 138.5, ivory: 130.8 };
const CUTOFF: Record<string, number> = { golden: 360, indigo: 420, crimson: 300, emerald: 440, dusk: 380, ivory: 260 };

function makeImpulse(ctx: AudioContext, dur = 2.5, decay = 3.2): AudioBuffer {
  const sr = ctx.sampleRate, len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export const createAudio: AudioFactory = (ctx) => {
  const out = ctx.createGain();
  out.gain.value = 1;

  // droneGain — the room's own slow swell (the bus crossfade sits on top).
  const droneGain = ctx.createGain();
  droneGain.gain.setValueAtTime(0, ctx.currentTime);
  droneGain.gain.linearRampToValueAtTime(0.11, ctx.currentTime + 10);
  droneGain.connect(out);

  const revNode = ctx.createConvolver();
  revNode.buffer = makeImpulse(ctx);
  const revGain = ctx.createGain(); revGain.gain.value = 0.28;
  revNode.connect(revGain); revGain.connect(out);

  const filterNode = ctx.createBiquadFilter();
  filterNode.type = 'lowpass'; filterNode.frequency.value = 320; filterNode.Q.value = 0.5;
  filterNode.connect(droneGain); filterNode.connect(revNode);

  let baseFreq = BASE_FREQ[sharedState.scheme] ?? 136.1;
  const f = baseFreq;

  let droneOsc: OscillatorNode | null = null;
  let droneOsc2: OscillatorNode | null = null;
  let droneOsc3: OscillatorNode | null = null;
  for (const [n, gv] of [[1, 0.55], [2, 0.18], [3, 0.09], [5, 0.04]] as const) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * n;
    const g = ctx.createGain(); g.gain.value = gv;
    o.connect(g); g.connect(filterNode); o.start();
    if (n === 1) droneOsc = o;
    if (n === 2) droneOsc2 = o;
    if (n === 3) droneOsc3 = o;
  }

  const shimmerOsc = ctx.createOscillator(); shimmerOsc.type = 'sine'; shimmerOsc.frequency.value = f * 9;
  const shimGain = ctx.createGain(); shimGain.gain.value = 0;
  shimmerOsc.connect(shimGain); shimGain.connect(revNode); shimmerOsc.start();
  const shimLfo = ctx.createOscillator(); shimLfo.type = 'sine'; shimLfo.frequency.value = 1 / 23;
  const shimDepth = ctx.createGain(); shimDepth.gain.value = 0.018;
  shimLfo.connect(shimDepth); shimDepth.connect(shimGain.gain); shimLfo.start();

  const breathLfo = ctx.createOscillator(); breathLfo.type = 'sine'; breathLfo.frequency.value = 0.07;
  const breathGain = ctx.createGain(); breathGain.gain.value = 0.022;
  breathLfo.connect(breathGain); breathGain.connect(droneGain.gain); breathLfo.start();

  const wobbleOsc = ctx.createOscillator(); wobbleOsc.type = 'sine'; wobbleOsc.frequency.value = 0.031;
  const wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = 0.28;
  wobbleOsc.connect(wobbleDepth);
  if (droneOsc) wobbleDepth.connect(droneOsc.frequency);
  if (droneOsc2) wobbleDepth.connect(droneOsc2.frequency);
  wobbleOsc.start();

  let lastScheme = sharedState.scheme;

  return {
    node: out,
    tick(): void {
      const now = ctx.currentTime;

      // Scheme change → glide drone + filter to the new tuning (updateDrone).
      if (sharedState.scheme !== lastScheme) {
        lastScheme = sharedState.scheme;
        baseFreq = BASE_FREQ[sharedState.scheme] ?? 136.1;
        const fc = CUTOFF[sharedState.scheme] ?? 320;
        droneOsc?.frequency.setTargetAtTime(baseFreq, now, 4);
        droneOsc2?.frequency.setTargetAtTime(baseFreq * 2, now, 4);
        droneOsc3?.frequency.setTargetAtTime(baseFreq * 3, now, 4);
        shimmerOsc.frequency.setTargetAtTime(baseFreq * 9, now, 4);
        filterNode.frequency.setTargetAtTime(fc, now, 4);
      }

      if (sharedState.dragging) {
        const spd = sharedState.dragSpeed; // 0..1
        filterNode.frequency.setTargetAtTime(320 + spd * 1200, now, 0.1);
        droneOsc?.frequency.setTargetAtTime(baseFreq + spd * 40, now, 0.08);
      } else {
        const act = sharedState.autoActivity;
        filterNode.frequency.setTargetAtTime(320 + act * 500, now, 1.2);
        droneOsc?.frequency.setTargetAtTime(baseFreq + act * 18, now, 1.5);
      }
    }
  };
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- sri-yantra`
Expected: PASS (geometry + audio).

- [ ] **Step 6: Commit**

```bash
git add src/lib/rooms/sri-yantra/state.ts src/lib/rooms/sri-yantra/audio.ts tests/unit/rooms/sri-yantra.test.ts
git commit -m "feat(sri-yantra): visual→audio state bridge and drone audio factory"
```

---

### Task 3: Overlay, mount & module index (`overlay.ts`, `mount.ts`, `index.ts`)

**Files:**
- Create: `src/lib/rooms/sri-yantra/overlay.ts`
- Create: `src/lib/rooms/sri-yantra/mount.ts`
- Create: `src/lib/rooms/sri-yantra/index.ts`
- Test: `tests/unit/rooms/sri-yantra.test.ts` (append)

**Interfaces:**
- Consumes: everything from `./geometry`, `sharedState`/`resetState` from `./state`, `makeOverlay` from `./overlay`; `RoomMount` from `@/lib/webgl/types`; `observeResize`, `createRafLoop`.
- Produces:
  - `makeOverlay(onRegenerate: () => void): { root: HTMLElement; label: HTMLElement }`
  - `mount: RoomMount` (returns `{ teardown, pause, resume }`)
  - `index.ts` re-exports `mount` + `createAudio`

- [ ] **Step 1: Write the failing mount tests (append to `tests/unit/rooms/sri-yantra.test.ts`)**

Add the import (mount now comes via the module index):

```ts
import { mount } from '@/lib/rooms/sri-yantra';
import { vi } from 'vitest';
```

(If `vi` is already imported in the file, do not duplicate the import — add `vi` to the existing `vitest` import instead.)

Append:

```ts
function makeProxy2D(): unknown {
  const grad = { addColorStop(): void {} };
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
      return () => undefined;
    },
    set() { return true; }
  });
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400 });
  Object.defineProperty(c, 'clientHeight', { get: () => 300 });
  c.getContext = ((type: string): unknown => (type === '2d' ? makeProxy2D() : null)) as typeof HTMLCanvasElement.prototype.getContext;
  document.body.appendChild(c);
  return c;
}

describe('sri-yantra.mount', () => {
  it('returns a handle and teardown does not throw (preview)', () => {
    const handle = mount(makeCanvas(), { quality: 'preview', audio: false });
    expect(typeof handle.teardown).toBe('function');
    expect(() => handle.teardown()).not.toThrow();
  });

  it('teardown cancels rAF (full)', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const handle = mount(makeCanvas(), { quality: 'full', audio: false });
    handle.teardown();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('full mode injects the phase-label + Regenerate overlay; teardown removes it', () => {
    const handle = mount(makeCanvas(), { quality: 'full', audio: false });
    const overlay = document.querySelector('[data-yantra-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain('Regenerate');
    handle.teardown();
    expect(document.querySelector('[data-yantra-overlay]')).toBeNull();
  });

  it('preview mode injects no overlay', () => {
    const handle = mount(makeCanvas(), { quality: 'preview', audio: false });
    expect(document.querySelector('[data-yantra-overlay]')).toBeNull();
    handle.teardown();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- sri-yantra`
Expected: FAIL — `Cannot find module '@/lib/rooms/sri-yantra'` (index not created yet).

- [ ] **Step 3: Implement `overlay.ts`**

Create `src/lib/rooms/sri-yantra/overlay.ts`:

```ts
// ─── Overlay (sri-yantra.html #phase-label + #ui) ────────────────────────────
// The ॐ phase label (top-center, updated each frame by mount) + the Regenerate
// button. Full mode only. The "Enable Sound" button is NOT ported — the app's
// AudioPrompt replaces it. z-index 6 sits above the room page chrome (z 5).

export function makeOverlay(onRegenerate: () => void): { root: HTMLElement; label: HTMLElement } {
  const root = document.createElement('div');
  root.setAttribute('data-yantra-overlay', '');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;';

  const label = document.createElement('div');
  label.textContent = 'ॐ';
  label.style.cssText =
    'position:absolute;top:20px;left:50%;transform:translateX(-50%);' +
    'color:rgba(255,255,255,0.3);font-size:11px;letter-spacing:0.26em;' +
    'text-transform:uppercase;font-family:serif;';

  const regen = document.createElement('button');
  regen.innerHTML = '&#8635; Regenerate';
  regen.style.cssText =
    'position:absolute;bottom:24px;left:50%;transform:translateX(-50%);pointer-events:auto;' +
    'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.2);' +
    'color:rgba(255,255,255,0.85);padding:9px 24px;border-radius:30px;cursor:pointer;' +
    'font-size:12px;letter-spacing:0.1em;font-family:serif;transition:background 0.2s;';
  regen.addEventListener('mouseenter', () => { regen.style.background = 'rgba(255,255,255,0.16)'; });
  regen.addEventListener('mouseleave', () => { regen.style.background = 'rgba(255,255,255,0.07)'; });
  regen.addEventListener('click', onRegenerate);

  root.appendChild(label);
  root.appendChild(regen);
  return { root, label };
}
```

- [ ] **Step 4: Implement `mount.ts`**

Create `src/lib/rooms/sri-yantra/mount.ts`:

```ts
import type { RoomMount } from '@/lib/webgl/types';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import {
  buildYantra, petalRing, bhupuraParts, palettes, pickScheme,
  NAMES, N_LAYERS, startOf, prog, rand, lerp, easeOut,
  type Pt, type Palette, type SchemeKey, type YantraLayer
} from './geometry';
import { sharedState, resetState } from './state';
import { makeOverlay } from './overlay';

// Ported from sri-yantra.html — a 2D-canvas mandala that assembles on a timeline
// and can be spun by dragging. Geometry/timeline/drag physics are verbatim; the
// standalone file's inline rAF + resize become the shared engine primitives, the
// "Enable Sound" button becomes the app's AudioPrompt (audio lives in ./audio,
// driven through sharedState), and DPR is pinned to 1 as the original ran.

const CHASE_SPEED = 6;
const IDLE_AFTER = 2.0;
const PREVIEW_AGE = 60; // seconds — jump the timeline so all layers are assembled
const CIRCLES: readonly (readonly [number, number])[] = [[1.02, 0.9], [1.06, 0.7], [1.11, 0.5]];

interface PendingDelta { delta: number; t: number; dist: number; }

export const mount: RoomMount = (canvas, opts) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  const full = opts.quality === 'full';
  resetState();

  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  // ── Per-layer rotation state (preallocated; verbatim) ──────────────────────
  const layerRot = new Float64Array(N_LAYERS);
  const layerTarget = new Float64Array(N_LAYERS);
  const layerIntroOff = new Float64Array(N_LAYERS);
  const layerUnwound = new Uint8Array(N_LAYERS);
  const layerRadii = new Float64Array(N_LAYERS);
  const nextNudge = new Float64Array(N_LAYERS);
  const pendingDeltas: PendingDelta[][] = Array.from({ length: N_LAYERS }, () => []);

  // Static geometry (rotation-applied per frame via project()); never reallocated.
  const petals8 = petalRing(8, 0.72, 0.89);
  const petals16 = petalRing(16, 0.89, 1.0);
  const bhupura = bhupuraParts(1);

  let palette: Palette = palettes.golden;
  let yantra: YantraLayer[] = buildYantra(1, 1);
  let params: { rotSpeed: number; pulse: number } = { rotSpeed: 0, pulse: 0.01 };
  let birthTime = 0;
  let lastInteraction = 0;

  // Live screen transform, recomputed each frame; drag handlers read cx/cy.
  let cx = 0, cy = 0;
  const scratch = new Float64Array(2);

  // Overlay label (full mode); updated each frame.
  let labelEl: HTMLElement | null = null;
  let lastLabel = '';
  function setLabel(name: string): void {
    lastLabel = name;
    if (labelEl) labelEl.textContent = name;
  }

  function resetNudges(): void { for (let i = 0; i < N_LAYERS; i++) nextNudge[i] = 0; }

  function generateScene(): void {
    const scheme: SchemeKey = pickScheme();
    palette = palettes[scheme];
    sharedState.scheme = scheme;

    const v = rand(0.75, 1.25);
    params = { rotSpeed: rand(-0.0012, 0.0012) * Math.PI * 2, pulse: rand(0.006, 0.015) };
    yantra = buildYantra(1, v);

    layerRadii[0] = 0;
    for (let i = 0; i < 9; i++) layerRadii[i + 1] = yantra[i].radius;
    layerRadii[10] = 0.80; layerRadii[11] = 0.94; layerRadii[12] = 1.06; layerRadii[13] = 1.08;

    for (let i = 0; i < N_LAYERS; i++) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const off = dir * (Math.PI * 0.6 + rand(0, Math.PI * 0.3));
      layerIntroOff[i] = off; layerRot[i] = off; layerTarget[i] = off;
      layerUnwound[i] = 0; pendingDeltas[i] = [];
    }
    resetNudges();
    sharedState.autoActivity = 0;

    const nowS = performance.now() / 1000;
    if (full) {
      birthTime = nowS;
      lastInteraction = nowS + 20; // suppress idle nudges until the assembly plays
      setLabel('ॐ');
    } else {
      birthTime = nowS - PREVIEW_AGE; // fully assembled
      lastInteraction = nowS - 100;   // idle immediately → gentle nudge rotation
    }
  }

  function scheduleNudges(now: number): void {
    let activity = sharedState.autoActivity;
    for (let i = 0; i < N_LAYERS; i++) {
      if (!layerUnwound[i]) continue;
      if (nextNudge[i] === 0) nextNudge[i] = now + rand(0, 3);
      if (now >= nextNudge[i]) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        layerTarget[i] += dir * (Math.PI * 0.15 + rand(0, Math.PI * 0.35));
        nextNudge[i] = now + rand(3, 9);
        activity = Math.min(activity + 0.35, 1.0);
      }
    }
    sharedState.autoActivity = activity;
  }

  function flushPending(now: number): void {
    for (let i = 0; i < N_LAYERS; i++) {
      const list = pendingDeltas[i];
      const keep: PendingDelta[] = [];
      for (const ev of list) {
        if (now - ev.t >= ev.dist * 0.18) layerTarget[i] += ev.delta;
        else keep.push(ev);
      }
      pendingDeltas[i] = keep;
    }
  }

  // ── Screen projection (allocation-free; writes scratch) ────────────────────
  function project(i: number, x: number, y: number, S: number): void {
    const r = layerRot[i];
    const c = Math.cos(r), s = Math.sin(r);
    const rx = x * c - y * s, ry = x * s + y * c;
    scratch[0] = cx + rx * S;
    scratch[1] = cy - ry * S;
  }

  function strokePolyline(layerIdx: number, pts: readonly Pt[], S: number): void {
    project(layerIdx, pts[0][0], pts[0][1], S); ctx!.moveTo(scratch[0], scratch[1]);
    for (let k = 1; k < pts.length; k++) { project(layerIdx, pts[k][0], pts[k][1], S); ctx!.lineTo(scratch[0], scratch[1]); }
  }

  // ── Drag (full mode) — verbatim physics ────────────────────────────────────
  let dragging = false, dragPrevAngle = 0, touchedLayerIdx = 0, dragVelocity = 0, lastDragTime = 0;

  function pointerAngle(px: number, py: number): number { return Math.atan2(-(py - cy), px - cx); }
  // The original divided by scale (=1, a no-op) and compared a pixel distance to
  // normalised layer radii — kept verbatim so the drag picks the same ring.
  function pointerDist(px: number, py: number): number { return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2); }
  function closestLayer(px: number, py: number): number {
    const r = pointerDist(px, py);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < N_LAYERS; i++) {
      const d = Math.abs(r - layerRadii[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function localX(clientX: number): number { return clientX - canvas.getBoundingClientRect().left; }
  function localY(clientY: number): number { return clientY - canvas.getBoundingClientRect().top; }

  function startDrag(clientX: number, clientY: number): void {
    const px = localX(clientX), py = localY(clientY);
    dragging = true; sharedState.dragging = true;
    dragPrevAngle = pointerAngle(px, py);
    touchedLayerIdx = closestLayer(px, py);
    lastInteraction = performance.now() / 1000;
    resetNudges();
  }

  function moveDrag(clientX: number, clientY: number): void {
    if (!dragging) return;
    const px = localX(clientX), py = localY(clientY);
    const now = performance.now() / 1000;
    const angle = pointerAngle(px, py);
    let delta = angle - dragPrevAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    dragPrevAngle = angle;
    const dt = Math.max(now - lastDragTime, 0.001);
    dragVelocity = delta / dt; lastDragTime = now;
    layerTarget[touchedLayerIdx] += delta;
    for (let i = 0; i < N_LAYERS; i++) {
      if (i === touchedLayerIdx) continue;
      pendingDeltas[i].push({ delta, t: now, dist: Math.abs(i - touchedLayerIdx) });
    }
    sharedState.dragSpeed = Math.min(Math.abs(dragVelocity), 10) / 10;
  }

  function endDrag(): void {
    dragging = false; sharedState.dragging = false;
    dragVelocity = 0; sharedState.dragSpeed = 0;
    lastInteraction = performance.now() / 1000;
  }

  // ── Render (verbatim draw order) ───────────────────────────────────────────
  function render(tMs: number): void {
    const t = tMs / 1000;
    const age = t - birthTime;
    const now = t;
    const { rotSpeed, pulse } = params;

    cx = canvas.width / 2; cy = canvas.height / 2;
    const minDim = Math.min(canvas.width, canvas.height);
    const S = minDim * 0.40;

    flushPending(now);

    let allCreated = true;
    for (let i = 0; i < N_LAYERS; i++) if (layerUnwound[i] !== 1) { allCreated = false; break; }
    if (!dragging && allCreated && (now - lastInteraction) > IDLE_AFTER) scheduleNudges(now);

    sharedState.autoActivity *= 0.993;

    const dt = 0.016;
    for (let i = 0; i < N_LAYERS; i++) {
      if (!layerUnwound[i] && prog(i, age) > 0) { layerTarget[i] = 0; layerUnwound[i] = 1; }
      if (layerUnwound[i]) layerTarget[i] += rotSpeed * dt;
      layerRot[i] = lerp(layerRot[i], layerTarget[i], 1 - Math.exp(-CHASE_SPEED * dt));
    }

    let curIdx = -1;
    for (let i = 0; i < NAMES.length; i++) if (age >= startOf(i)) curIdx = i;
    const curName = curIdx >= 0 ? NAMES[curIdx] : 'ॐ';
    if (curName !== lastLabel) setLabel(curName);

    ctx!.fillStyle = palette.bg;
    ctx!.fillRect(0, 0, canvas.width, canvas.height);

    const breath = 0.82 + 0.18 * Math.sin(t * pulse * Math.PI * 2);
    const LW = 1.5;

    ctx!.save();
    ctx!.lineCap = 'round';
    ctx!.lineJoin = 'round';

    // triangle fills
    for (let i = 0; i < 9; i++) {
      const p = easeOut(prog(i + 1, age)); if (p <= 0) continue;
      const tri = yantra[i];
      ctx!.beginPath();
      project(i + 1, tri.pts[0][0], tri.pts[0][1], S); ctx!.moveTo(scratch[0], scratch[1]);
      project(i + 1, tri.pts[1][0], tri.pts[1][1], S); ctx!.lineTo(scratch[0], scratch[1]);
      project(i + 1, tri.pts[2][0], tri.pts[2][1], S); ctx!.lineTo(scratch[0], scratch[1]);
      ctx!.closePath();
      ctx!.fillStyle = tri.up ? palette.pri(p * 0.18 * breath) : palette.sec(p * 0.18 * breath);
      ctx!.fill();
    }
    // triangle outlines
    for (let i = 0; i < 9; i++) {
      const p = easeOut(prog(i + 1, age)); if (p <= 0) continue;
      const tri = yantra[i];
      ctx!.beginPath();
      project(i + 1, tri.pts[0][0], tri.pts[0][1], S); ctx!.moveTo(scratch[0], scratch[1]);
      project(i + 1, tri.pts[1][0], tri.pts[1][1], S); ctx!.lineTo(scratch[0], scratch[1]);
      project(i + 1, tri.pts[2][0], tri.pts[2][1], S); ctx!.lineTo(scratch[0], scratch[1]);
      ctx!.closePath();
      ctx!.strokeStyle = tri.up ? palette.pri(p * breath) : palette.sec(p * breath);
      ctx!.lineWidth = LW; ctx!.stroke();
    }
    // 8-petal lotus
    const p10 = easeOut(prog(10, age));
    if (p10 > 0) {
      ctx!.strokeStyle = palette.acc(p10 * 0.9 * breath); ctx!.lineWidth = LW;
      for (const seg of petals8) { ctx!.beginPath(); strokePolyline(10, seg, S); ctx!.stroke(); }
    }
    // 16-petal lotus
    const p11 = easeOut(prog(11, age));
    if (p11 > 0) {
      ctx!.strokeStyle = palette.sec(p11 * 0.8 * breath); ctx!.lineWidth = LW;
      for (const seg of petals16) { ctx!.beginPath(); strokePolyline(11, seg, S); ctx!.stroke(); }
    }
    // 3 circles (rotation-invariant)
    const p12 = easeOut(prog(12, age));
    if (p12 > 0) {
      for (const [rf, al] of CIRCLES) {
        ctx!.beginPath(); ctx!.arc(cx, cy, rf * S, 0, Math.PI * 2);
        ctx!.strokeStyle = palette.pri(p12 * al * breath); ctx!.lineWidth = LW; ctx!.stroke();
      }
    }
    // bhupura
    const p13 = easeOut(prog(13, age));
    if (p13 > 0) {
      ctx!.lineWidth = LW;
      ctx!.strokeStyle = palette.acc(p13 * breath); ctx!.beginPath(); strokePolyline(13, bhupura.outer, S); ctx!.stroke();
      ctx!.strokeStyle = palette.pri(p13 * 0.8 * breath); ctx!.beginPath(); strokePolyline(13, bhupura.inner, S); ctx!.stroke();
      ctx!.strokeStyle = palette.acc(p13 * 0.9 * breath);
      for (const g of bhupura.gates) { ctx!.beginPath(); strokePolyline(13, g, S); ctx!.stroke(); }
    }
    // bindu
    const p0 = easeOut(prog(0, age));
    if (p0 > 0) {
      const gr = 0.065 * (0.75 + 0.25 * Math.sin(t * 1.6));
      const grd = ctx!.createRadialGradient(cx, cy, 0, cx, cy, gr * S);
      grd.addColorStop(0, palette.glow(p0 * breath * 0.9));
      grd.addColorStop(1, palette.glow(0));
      ctx!.beginPath(); ctx!.arc(cx, cy, gr * S, 0, Math.PI * 2); ctx!.fillStyle = grd; ctx!.fill();
      const br = 0.024 * (0.9 + 0.1 * Math.sin(t * 4.0));
      ctx!.beginPath(); ctx!.arc(cx, cy, br * S, 0, Math.PI * 2); ctx!.fillStyle = palette.acc(p0); ctx!.fill();
    }

    ctx!.restore();
  }

  // ── Input + overlay (full mode only) ───────────────────────────────────────
  const listenerCleanups: (() => void)[] = [];
  let overlayRoot: HTMLElement | null = null;

  if (full) {
    const ov = makeOverlay(() => generateScene());
    overlayRoot = ov.root; labelEl = ov.label;
    (canvas.parentElement ?? document.body).appendChild(overlayRoot);

    const md = (e: MouseEvent): void => startDrag(e.clientX, e.clientY);
    const mm = (e: MouseEvent): void => { if (dragging) moveDrag(e.clientX, e.clientY); };
    const mu = (): void => endDrag();
    const ts = (e: TouchEvent): void => { e.preventDefault(); startDrag(e.touches[0].clientX, e.touches[0].clientY); };
    const tm = (e: TouchEvent): void => { e.preventDefault(); moveDrag(e.touches[0].clientX, e.touches[0].clientY); };
    const te = (): void => endDrag();

    canvas.addEventListener('mousedown', md);
    canvas.addEventListener('mousemove', mm);
    canvas.addEventListener('mouseup', mu);
    canvas.addEventListener('touchstart', ts, { passive: false });
    canvas.addEventListener('touchmove', tm, { passive: false });
    canvas.addEventListener('touchend', te);
    listenerCleanups.push(
      () => canvas.removeEventListener('mousedown', md),
      () => canvas.removeEventListener('mousemove', mm),
      () => canvas.removeEventListener('mouseup', mu),
      () => canvas.removeEventListener('touchstart', ts),
      () => canvas.removeEventListener('touchmove', tm),
      () => canvas.removeEventListener('touchend', te)
    );
  }

  const stopResize = observeResize(canvas, undefined, 1);
  generateScene();

  const loop = createRafLoop((_dt, tMs) => render(tMs), ac.signal);
  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      for (const c of listenerCleanups) c();
      overlayRoot?.remove();
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
```

- [ ] **Step 5: Implement `index.ts`**

Create `src/lib/rooms/sri-yantra/index.ts`:

```ts
// Ported from sri-yantra.html — Canvas-2D mandala; geometry/timeline/drag are
// verbatim. The bus owns the AudioContext + fade; the "Enable Sound" button
// becomes the app's AudioPrompt; the phase label + Regenerate move to an
// overlay; preview mode jumps the timeline to a fully-assembled, gently
// auto-rotating figure.
export { mount } from './mount';
export { createAudio } from './audio';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- sri-yantra`
Expected: PASS (geometry + audio + 4 mount tests).

- [ ] **Step 7: Typecheck the new module**

Run: `npm run typecheck`
Expected: no errors. (If `astro check` reports an unused symbol, remove it; every import listed above is used.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/rooms/sri-yantra/overlay.ts src/lib/rooms/sri-yantra/mount.ts src/lib/rooms/sri-yantra/index.ts tests/unit/rooms/sri-yantra.test.ts
git commit -m "feat(sri-yantra): canvas mount, drag interaction and overlay"
```

---

### Task 4: Register the room (schema, registry, content + schema test)

**Files:**
- Modify: `src/content/schema.ts:5`
- Modify: `src/lib/rooms/registry.ts:4-22`
- Create: `src/content/rooms/sri-yantra.yml`
- Modify: `tests/unit/content/schema.test.ts:12`

**Interfaces:**
- Consumes: `mount`/`createAudio` from `@/lib/rooms/sri-yantra` (Task 3).
- Produces: `'sri-yantra'` as a valid `RoomSlug`; a parseable room entry; the registry loader covered by `registry.test.ts`.

- [ ] **Step 1: Update the schema test expectation (failing first)**

In `tests/unit/content/schema.test.ts`, change line 12:

```ts
    expect(files.length).toBe(9);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- schema`
Expected: FAIL — received 8, expected 9 (the YAML does not exist yet).

- [ ] **Step 3: Add the slug to the Zod schema**

In `src/content/schema.ts`, change the slug enum (line 5) to include `sri-yantra`:

```ts
  slug: z.enum(['neural', 'tunnel', 'swarm', 'ikebana', 'bindu', 'catfish', 'beauty', 'tree', 'sri-yantra']),
```

- [ ] **Step 4: Register the room in the registry**

In `src/lib/rooms/registry.ts`, extend the union and the loader map:

```ts
export type RoomSlug =
  | 'neural' | 'tunnel' | 'swarm' | 'ikebana' | 'bindu'
  | 'catfish' | 'beauty' | 'tree' | 'sri-yantra';
```

```ts
export const rooms: Record<RoomSlug, () => Promise<RoomModule>> = {
  neural:  () => import('./neural'),
  tunnel:  () => import('./tunnel'),
  swarm:   () => import('./swarm'),
  ikebana: () => import('./ikebana'),
  bindu:   () => import('./bindu'),
  catfish: () => import('./catfish'),
  beauty:  () => import('./beauty'),
  tree:    () => import('./tree'),
  'sri-yantra': () => import('./sri-yantra')
};
```

- [ ] **Step 5: Create the content entry**

Create `src/content/rooms/sri-yantra.yml`:

```yaml
slug: sri-yantra
title: Sri Yantra
subtitle: Canvas · 2D · Audio
description: >-
  Nine interlocking triangles, lotus petals and the bhupura gates assemble around
  the bindu over a slow timeline. Drag any ring to spin it and the whole figure
  responds, the drone bending with your motion; leave it and it drifts on its own.
  Regenerate for a new palette and tuning.
tags: [Canvas, 2D, Sacred Geometry, Audio]
year: 2026
accent: gold
hasAudio: true
order: 9
```

- [ ] **Step 6: Run the registry + schema + room suites to verify they pass**

Run: `npm test -- schema registry sri-yantra`
Expected: PASS — schema counts 9 entries and `sri-yantra.yml` parses; the registry resolves `sri-yantra` to a module with a `mount` function.

- [ ] **Step 7: Typecheck (content collection + registry)**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/content/schema.ts src/lib/rooms/registry.ts src/content/rooms/sri-yantra.yml tests/unit/content/schema.test.ts
git commit -m "feat(sri-yantra): register the room (schema, registry, content entry)"
```

---

### Task 5: End-to-end coverage (`rooms.spec.ts`)

**Files:**
- Modify: `tests/e2e/rooms.spec.ts:16,29,33-41`

**Interfaces:**
- Consumes: the built site (the room page at `/rooms/sri-yantra`, rendered from the registered collection entry).
- Produces: e2e assertions that the new card exists, the audio prompt shows, and the room renders without console errors.

- [ ] **Step 1: Add `sri-yantra` to the audio-prompt sweep**

In `tests/e2e/rooms.spec.ts`, update the slug list (line 16):

```ts
  for (const slug of ['tunnel', 'swarm', 'neural', 'ikebana', 'bindu', 'catfish', 'beauty', 'sri-yantra'] as const) {
```

- [ ] **Step 2: Bump the gallery card count**

In the same file, update the back-to-gallery assertion (line 29):

```ts
  await expect(page.locator('[data-room-card]')).toHaveCount(9);
```

- [ ] **Step 3: Exercise the new room's render path (no console errors)**

Replace the `direct navigation across rooms does not throw` test (lines 33-41) so it also visits the new Canvas-2D room — this catches any render-time throw in a real browser:

```ts
test('direct navigation across rooms does not throw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/rooms/swarm');
  await page.goto('/rooms/tunnel');
  await expect(page.locator('[data-room-stage="tunnel"]')).toBeVisible();
  await page.goto('/rooms/sri-yantra');
  await expect(page.locator('[data-room-stage="sri-yantra"]')).toBeVisible();
  await page.waitForTimeout(500); // let a few RAF frames run
  expect(errors, errors.join('\n')).toHaveLength(0);
});
```

- [ ] **Step 4: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS (the command auto-builds and serves). The new room card is present, its audio prompt is visible, and navigating to `/rooms/sri-yantra` produces no console errors.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/rooms.spec.ts
git commit -m "test(sri-yantra): e2e card count, audio prompt and render sweep"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: PASS — all suites green, including the new `sri-yantra` geometry/audio/mount tests and the updated schema/registry tests.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; `/rooms/sri-yantra` is emitted as a static page.

- [ ] **Step 4: Manual browser check (per project policy — pixels & audio are not unit-tested)**

Run: `npm run dev`, then verify in a browser:
- Gallery `/` shows the **Sri Yantra** card (gold accent) and its hover preview renders the fully-assembled, gently rotating mandala.
- `/rooms/sri-yantra` plays the layer-by-layer assembly (bindu → triangles → lotuses → circles → bhupura), the phase label updates, dragging spins the rings, and Regenerate yields a new palette.
- Enabling audio via the AudioPrompt produces the drone; dragging bends the filter/pitch; the tuning shifts on Regenerate.

- [ ] **Step 5: (Optional) Remove the root reference file**

The root `*.html` files are kept as reference inputs (per `CLAUDE.md`), so leave `sri-yantra.html` in place. No action unless the user asks to remove it.

---

## Self-Review

**Spec coverage:**
- Slug `sri-yantra`, dir `src/lib/rooms/sri-yantra/` → Tasks 1-4. ✓
- Preview = assembled + gentle auto-rotation → `PREVIEW_AGE` + past `lastInteraction` in `generateScene` (Task 3). ✓
- Canvas 2D, DPR 1, shared engine primitives → Task 3 mount. ✓
- Sanskrit identity preserved (`ॐ` + `NAMES`) → `geometry.ts` `NAMES` (Task 1) + overlay/render (Task 3). ✓
- `accent: gold`, no token/CSS changes → Task 4 YAML; gold token/`.tag.t-gold` already exist. ✓
- File inventory (schema, registry, YAML, tests) → Tasks 4-5. ✓
- Audio: bus owns context/fade, funnels through `node`, per-scheme tuning + drag/idle bend via `sharedState` → Task 2. ✓
- Testing: pure geometry, behavioral mount, fake-audio tick, schema parse, e2e sweep → Tasks 1-5. ✓
- Non-goals (no WebGL, no preview audio, no shared-helper extraction, no changes to other rooms) → respected. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete file content or an exact edit. ✓

**Type consistency:** `sharedState` shape (`scheme`/`dragSpeed`/`autoActivity`/`dragging`) is identical across `state.ts`, `audio.ts`, and `mount.ts`. `petalRing(n, inner, outer)` signature matches its call sites in `mount.ts` and the geometry test. `makeOverlay(onRegenerate) → { root, label }` matches its use in `mount.ts`. `project`/`strokePolyline`/`generateScene`/`scheduleNudges`/`flushPending` names are consistent within `mount.ts`. ✓
