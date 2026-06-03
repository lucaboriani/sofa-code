# Ikebana + Bindu Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `ikebana.html` and `bindu.html` (repo root) into the gallery as rooms 4 and 5, preserving every graphics and audio effect.

**Architecture:** Each room becomes a `src/lib/rooms/<slug>.ts` module exporting `mount` + `createAudio`, built on the shared WebGL primitives, with a module-scoped `sharedState`/`audioLink` bridge carrying per-frame visual state and transient events into the AudioBus-driven audio graph. Decorative DOM overlays are injected by `mount()` in full mode and removed on teardown. Bindu's "ॐ Touch to begin" overlay is replaced by the app's `AudioPrompt`.

**Tech Stack:** Astro 5 + TypeScript (strict), WebGL1, Web Audio, Vitest (jsdom) + fake-GL/fake-audio fixtures, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-03-ikebana-bindu-rooms-design.md` — read it first.

**Reference inputs (read-only, not runtime):** `ikebana.html`, `bindu.html` in the repo root. When in doubt about a constant or formula, the HTML file is the source of truth.

---

## File structure

| File | Responsibility |
|---|---|
| `tests/fixtures/fake-audio.ts` | extend: convolver, constant source, osc detune, gain setTargetAtTime/cancelScheduledValues |
| `src/content/schema.ts` | slug + accent enums widened |
| `src/content/rooms/ikebana.yml`, `bindu.yml` | room metadata |
| `src/styles/tokens.css`, `src/styles/gallery.css` | `gold`/`crimson` accent tokens + tag styles |
| `src/lib/rooms/ikebana.ts` | ikebana room (graphics + interaction + overlay + audio factory) |
| `src/lib/rooms/bindu.ts` | bindu room (graphics + camera + overlay + audio factory) |
| `src/lib/rooms/registry.ts` | register both rooms |
| `src/scripts/room-stage.ts`, `src/scripts/room-preview.ts` | slug guards derive from registry |
| `src/components/RoomStage.astro`, `RoomCanvasPreview.astro`, `AudioPrompt.astro`, `RoomCard.astro`, `src/pages/rooms/[slug].astro` | widen slug/accent prop types |
| `tests/unit/rooms/ikebana.test.ts`, `bindu.test.ts` | behavioral tests |
| `tests/unit/content/schema.test.ts` | entry count 3 → 5 |
| `tests/e2e/home.spec.ts`, `rooms.spec.ts` | card count 5, new slugs in sweeps |

---

### Task 1: Extend the fake-audio fixture

The new rooms use `createConvolver`, `createConstantSource`, `OscillatorNode.detune`, `GainNode.gain.setTargetAtTime` / `cancelScheduledValues`, and assign `buffer` on buffer sources. The fixture lacks all of these. Extensions are additive — existing tests must keep passing.

**Files:**
- Modify: `tests/fixtures/fake-audio.ts`

- [ ] **Step 1: Extend the fixture**

In `tests/fixtures/fake-audio.ts`:

1. Add to the `FakeGain` interface's `gain` object type (after `setValueAtTime`):

```ts
    setTargetAtTime(v: number, t: number, tc: number): void;
    cancelScheduledValues(t: number): void;
```

2. In `createGain()`, add the implementations inside the `gain` object literal (after `setValueAtTime`):

```ts
          setTargetAtTime(v, _t, _tc) { g.gain.value = v; },
          cancelScheduledValues() {}
```

3. Replace the `createBufferSource` return type in the `FakeAudioContext` interface with:

```ts
  createBufferSource(): { connect(d: unknown): void; start(t?: number): void; stop(t?: number): void; buffer: unknown; loop: boolean };
```

4. Replace the `createOscillator` return type in the interface with:

```ts
  createOscillator(): {
    type: string;
    frequency: ReturnType<typeof makeAudioParam>;
    detune: ReturnType<typeof makeAudioParam>;
    connect(d: unknown): void;
    start(t?: number): void;
    stop(t?: number): void;
  };
```

   and add `detune: makeAudioParam(0),` to the object returned by the `createOscillator()` implementation.

5. Add to the `FakeAudioContext` interface (after `createBuffer`):

```ts
  createConvolver(): { buffer: unknown; connect(d: unknown): void; disconnect(): void };
  createConstantSource(): { offset: ReturnType<typeof makeAudioParam>; connect(d: unknown): void; start(): void };
```

   and the implementations in `makeFakeAudio()` (after `createBuffer`):

```ts
    createConvolver() {
      return { buffer: null as unknown, connect() {}, disconnect() {} };
    },
    createConstantSource() {
      return { offset: makeAudioParam(0), connect() {}, start() {} };
    }
```

6. Add `disconnect(): void;` to the `createBiquadFilter` return type in the interface and `disconnect() {}` to its implementation (the rooms re-route filters).

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm test`
Expected: all suites PASS (no behavior change for existing consumers).

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/fake-audio.ts
git commit -m "test(fixtures): extend fake-audio with convolver, constant source, detune, setTargetAtTime"
```

---

### Task 2: Content schema, YAML entries, accent tokens

**Files:**
- Modify: `src/content/schema.ts`
- Create: `src/content/rooms/ikebana.yml`, `src/content/rooms/bindu.yml`
- Modify: `src/styles/tokens.css`, `src/styles/gallery.css`
- Modify: `tests/unit/content/schema.test.ts`

- [ ] **Step 1: Update the schema test to expect 5 entries**

In `tests/unit/content/schema.test.ts` change:

```ts
    expect(files.length).toBe(3);
```

to:

```ts
    expect(files.length).toBe(5);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- schema`
Expected: FAIL — `expected 3 to be 5` (only 3 YAML files exist).

- [ ] **Step 3: Widen the schema enums**

Replace `src/content/schema.ts` content:

```ts
import { z } from 'zod';

export const roomSchema = z.object({
  slug: z.enum(['neural', 'tunnel', 'swarm', 'ikebana', 'bindu']),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string(),
  tags: z.array(z.string()),
  year: z.number().int(),
  accent: z.enum(['cyan', 'purple', 'red', 'gold', 'crimson']),
  hasAudio: z.boolean(),
  order: z.number().int()
});
```

- [ ] **Step 4: Create the two YAML entries**

Create `src/content/rooms/ikebana.yml`:

```yaml
slug: ikebana
title: 池坊 — Ikebana
subtitle: WebGL · Generative · Audio
description: Procedural ikebana drawn as living calligraphy — shin, soe and tai unfurl from the water line. Touch a branch to play it like a string; double-tap grows a new arrangement.
tags: [WebGL, Generative, Audio]
year: 2026
accent: gold
hasAudio: true
order: 4
```

Create `src/content/rooms/bindu.yml`:

```yaml
slug: bindu
title: Bindu — The Three Gunas
subtitle: WebGL · 3D · Audio
description: Comet lines stream from a single point of origin, each weighted by tamas, rajas and sattva. Drag to orbit, pinch to dive into the bindu — the drone breathes with you.
tags: [WebGL, 3D, Audio]
year: 2026
accent: crimson
hasAudio: true
order: 5
```

- [ ] **Step 5: Run the schema test to verify it passes**

Run: `npm test -- schema`
Expected: PASS (5 entries parse; slugs match filenames; malformed fixture still rejects).

- [ ] **Step 6: Add accent tokens and tag styles**

In `src/styles/tokens.css`, add after the `--accent3-rgb` line:

```css
  --accent4: #d2b98c;
  --accent4-rgb: 210, 185, 140;
  --accent5: #c03020;
  --accent5-rgb: 192, 48, 32;
```

(`#d2b98c` is ikebana's `rgba(210,185,140,…)` ink color; `#c03020` is bindu's rajas dot.)

In `src/styles/gallery.css`, add after the `.tag.t-red` rule (line ~206):

```css
  .tag.t-gold { border-color: rgba(var(--accent4-rgb),0.3); color: rgba(var(--accent4-rgb),0.7); }
  .tag.t-crimson { border-color: rgba(var(--accent5-rgb),0.3); color: rgba(var(--accent5-rgb),0.7); }
```

- [ ] **Step 7: Commit**

```bash
git add src/content/schema.ts src/content/rooms/ikebana.yml src/content/rooms/bindu.yml src/styles/tokens.css src/styles/gallery.css tests/unit/content/schema.test.ts
git commit -m "feat(content): ikebana + bindu room entries, gold/crimson accents"
```

---

### Task 3: Ikebana room — failing tests

**Files:**
- Create: `tests/unit/rooms/ikebana.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/rooms/ikebana.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mount, createAudio } from '@/lib/rooms/ikebana';
import { makeFakeAudio } from '../../fixtures/fake-audio';

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

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400 });
  Object.defineProperty(c, 'clientHeight', { get: () => 300 });
  c.getContext = ((type: string): unknown => {
    if (type === 'webgl' || type === 'webgl2') return makeProxyGL();
    return null;
  }) as typeof HTMLCanvasElement.prototype.getContext;
  document.body.appendChild(c);
  return c;
}

describe('ikebana.mount', () => {
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

  it('full mode injects the kanji + hint overlay; teardown removes it', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    const overlay = document.querySelector('[data-ikebana-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain('天');
    expect(overlay!.textContent).toContain('doppio tap — nuovo ikebana');
    handle.teardown();
    expect(document.querySelector('[data-ikebana-overlay]')).toBeNull();
  });

  it('preview mode injects no overlay', () => {
    const handle = mount(makeCanvas(), { quality: 'preview', audio: false });
    expect(document.querySelector('[data-ikebana-overlay]')).toBeNull();
    handle.teardown();
  });
});

describe('ikebana.createAudio', () => {
  it('returns a node and a tick that does not throw', () => {
    const ctx = makeFakeAudio() as unknown as AudioContext;
    const audio = createAudio(ctx);
    expect(audio.node).toBeTruthy();
    expect(typeof audio.tick).toBe('function');
    expect(() => { audio.tick!(); audio.tick!(); }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ikebana`
Expected: FAIL — cannot resolve `@/lib/rooms/ikebana` (module does not exist yet).

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/unit/rooms/ikebana.test.ts
git commit -m "test(ikebana): behavioral tests for mount/overlay/audio factory"
```

---

### Task 4: Ikebana room module

**Files:**
- Create: `src/lib/rooms/ikebana.ts`

Port notes (vs `ikebana.html` — keep every constant and formula identical):
- `ensureAC()` is gone — the AudioBus owns the AudioContext; `AudioPrompt` is the gesture. All `AC.destination` connections route to the returned `out` gain.
- Transient sounds (shimmer, bloom, touch voice, drone surge, drone gain reset) flow visual → audio through the module-scoped `audioLink` hooks, assigned by `createAudio`. Before audio is activated the hooks are `null` and events are silently dropped — identical to the original before its first gesture.
- Continuous coupling (drag velocity → filter, draw progress → drone morph, ikebana geometry → LFO params) flows through module-scoped `sharedState`, written by `mount` each frame, consumed by `tick()`.
- Pointer coords scale by `canvas.width / rect.width` instead of raw `devicePixelRatio` (canvas sizing is owned by `observeResize`, DPR capped at 2 per engine convention — original capped line widths at 2 already).
- The kanji overlay moves from `top:36px` to `top:96px` so it clears the app's back button; everything else is verbatim.
- The original's first-tap/`mousedown` `morphDrone(...)` calls existed to pair with `ensureAC()` audio start — replaced by AudioPrompt activation. The regen-time `morphDrone` (gain reset) is kept as `resetDroneGains`.

- [ ] **Step 1: Write the module**

Create `src/lib/rooms/ikebana.ts`:

```ts
import type { RoomMount } from '@/lib/webgl/types';
import type { RoomAudio } from '@/lib/audio/bus';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';

// Ported from ikebana.html — every constant, range and formula is verbatim.
// Adaptations: AudioBus owns the AudioContext (no ensureAC); transient sounds
// go through `audioLink`, continuous coupling through `sharedState`.

// ─── Types ────────────────────────────────────────────────────────────────────

type Pt = [number, number];

interface Shoot { t: number; angle: number; len: number; delay: number; }

interface Branch {
  color: [number, number, number];
  alpha: number;
  width: number;
  delay: number;
  duration: number;
  cps: Pt[];
  shoots: Shoot[];
  budR: number;
  budDelay: number;
}

interface Ikebana {
  branches: Branch[];
  ox: number;
  oy: number;
  startTime: number | null;
  dying: boolean;
  dead: boolean;
  deathTime: number;
}

interface BranchGeom { idx: number; curvature: number; length: number; angleSpread: number; }

interface IkebanaGeom {
  version: number;
  freqScale: number[];   // 7 per-partial frequency multipliers
  gainScale: number[];   // 7 per-partial gain multipliers
  lfoRateBase: number;
  lfoDepthMult: number;
  rootFreq: number;
}

interface Disturbance { created: number; branchIdx: number; splineT: number; amp: number; ikRef: Ikebana; }
interface ShootReg { sh: Shoot; pts: Pt[]; angle: number; lastHit: number; branchIdx: number; }
interface Petal { x: number; y: number; vy: number; vx: number; phase: number; r: number; alpha: number; }

// ─── Shared visual → audio state ─────────────────────────────────────────────

const sharedState = {
  dragVelocity: 0,   // smoothed px/ms (device px)
  pointerDown: false,
  avgProg: 0,        // average branch draw progress of the active ikebana
  geom: null as IkebanaGeom | null
};

interface AudioLink {
  playShimmer(angle: number, branchIdx: number): void;
  playBloom(rootFreq: number): void;
  startTouchVoice(angle: number, geom: BranchGeom): void;
  retuneTouchVoice(fund: number): void;
  stopTouchVoice(): void;
  surgeDrone(colorR: number): void;
  resetDroneGains(): void;
}
let audioLink: AudioLink | null = null;

// ─── Shaders (ikebana.html L48-59) ───────────────────────────────────────────

const VS = `
attribute vec2 a_pos;
uniform vec2 u_res;
void main() {
  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
}`.trim();

const FS = `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }`.trim();

// ─── Math (ikebana.html L109-130) ────────────────────────────────────────────

const rnd = (a: number, b: number): number => a + (b - a) * Math.random();
const easeOut5 = (t: number): number => 1 - Math.pow(1 - Math.min(t, 1), 5);
const easeOut3 = (t: number): number => 1 - Math.pow(1 - Math.min(t, 1), 3);

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t * t + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t * t * t),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t * t + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t * t * t)
  ];
}

function buildSpline(cps: Pt[], steps = 140): Pt[] {
  const pts: Pt[] = [];
  const n = cps.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = cps[Math.max(i - 1, 0)], p1 = cps[i], p2 = cps[i + 1], p3 = cps[Math.min(i + 2, n - 1)];
    for (let j = 0; j <= steps; j++) pts.push(catmull(p0, p1, p2, p3, j / steps));
  }
  return pts;
}

function splinePt(full: Pt[], t: number): Pt {
  return full[Math.min(Math.floor(t * (full.length - 1)), full.length - 1)];
}

// ─── Procedural generator (ikebana.html L132-236) ───────────────────────────

function genIkebana(): Ikebana {
  const ox = rnd(0.07, 0.20);
  const oy = rnd(0.87, 0.96);

  const palette: [number, number, number][] = [
    [rnd(0.82, 0.92), rnd(0.72, 0.82), rnd(0.50, 0.62)],
    [rnd(0.65, 0.75), rnd(0.55, 0.65), rnd(0.36, 0.48)],
    [rnd(0.50, 0.62), rnd(0.42, 0.54), rnd(0.28, 0.38)],
    [rnd(0.38, 0.50), rnd(0.32, 0.42), rnd(0.20, 0.30)],
    [rnd(0.28, 0.38), rnd(0.22, 0.32), rnd(0.12, 0.22)]
  ];

  function mkBranch(
    color: [number, number, number], alpha: number, width: number,
    ex: number, ey: number, curlX: number,
    shoots: Shoot[], budR: number, budDelay: number
  ): Branch {
    return {
      color, alpha, width,
      delay: 0,
      duration: rnd(2.8, 3.4),
      cps: [
        [ox, oy],
        [ox + (ex - ox) * 0.25 + rnd(-0.04, 0.04), oy - (oy - ey) * 0.25 + rnd(-0.05, 0.05)],
        [ox + (ex - ox) * 0.55 + curlX + rnd(-0.04, 0.04), oy - (oy - ey) * 0.55 + rnd(-0.05, 0.06)],
        [ox + (ex - ox) * 0.80 + rnd(-0.02, 0.02), oy - (oy - ey) * 0.80 + rnd(-0.03, 0.04)],
        [ex, ey]
      ],
      shoots, budR, budDelay
    };
  }

  // SHIN — steep, to upper-right
  const shin = mkBranch(
    palette[0], rnd(0.82, 0.92), rnd(1.8, 2.6),
    rnd(0.62, 0.82), rnd(0.03, 0.12),
    rnd(-0.06, 0.06),
    [
      { t: rnd(0.88, 0.96), angle: rnd(-1.1, -0.5), len: rnd(0.09, 0.14), delay: rnd(3.0, 3.3) },
      { t: rnd(0.60, 0.75), angle: rnd(0.7, 1.4),   len: rnd(0.07, 0.12), delay: rnd(3.1, 3.4) },
      { t: rnd(0.35, 0.52), angle: rnd(1.3, 1.9),   len: rnd(0.05, 0.09), delay: rnd(3.2, 3.5) }
    ],
    rnd(2.8, 4.2), 3.2
  );

  // SOE — medium diagonal
  const soe = mkBranch(
    palette[1], rnd(0.70, 0.82), rnd(1.2, 1.9),
    rnd(0.76, 0.94), rnd(0.10, 0.22),
    rnd(-0.05, 0.07),
    [
      { t: rnd(0.82, 0.94), angle: rnd(-0.6, 0.0),  len: rnd(0.08, 0.13), delay: rnd(3.0, 3.3) },
      { t: rnd(0.48, 0.65), angle: rnd(-1.2, -0.5), len: rnd(0.06, 0.10), delay: rnd(3.2, 3.5) }
    ],
    rnd(2.0, 3.2), 3.5
  );

  // TAI — near-horizontal sweep (earth line)
  const tai = mkBranch(
    palette[2], rnd(0.60, 0.72), rnd(1.0, 1.6),
    rnd(0.84, 0.97), rnd(0.50, 0.66),
    rnd(-0.04, 0.06),
    [
      { t: rnd(0.75, 0.88), angle: rnd(1.4, 2.0),   len: rnd(0.07, 0.11), delay: rnd(3.0, 3.3) },
      { t: rnd(0.42, 0.60), angle: rnd(-1.4, -0.7), len: rnd(0.05, 0.09), delay: rnd(3.2, 3.5) }
    ],
    rnd(1.6, 2.6), 3.8
  );

  // ACCENT — near-vertical, delicate
  const accent = mkBranch(
    palette[3], rnd(0.42, 0.54), rnd(0.7, 1.1),
    rnd(0.38, 0.60), rnd(0.01, 0.09),
    rnd(-0.06, 0.06),
    [
      { t: rnd(0.82, 0.93), angle: rnd(-1.1, -0.5), len: rnd(0.06, 0.10), delay: rnd(3.2, 3.5) },
      { t: rnd(0.52, 0.68), angle: rnd(0.6, 1.2),   len: rnd(0.05, 0.08), delay: rnd(3.3, 3.6) }
    ],
    0, 99
  );

  // WHISPER — ghost, low angle
  const whisper = mkBranch(
    palette[4], rnd(0.22, 0.34), rnd(0.5, 0.85),
    rnd(0.88, 0.98), rnd(0.56, 0.72),
    rnd(-0.03, 0.05),
    [
      { t: rnd(0.70, 0.85), angle: rnd(-1.0, -0.4), len: rnd(0.05, 0.08), delay: rnd(3.4, 3.7) }
    ],
    0, 99
  );

  return {
    branches: [shin, soe, tai, accent, whisper],
    ox, oy,
    startTime: null,
    dying: false, dead: false, deathTime: 0
  };
}

// ─── Geometry → drone parameters (ikebana.html L407-463) ────────────────────

function computeIkebanaGeom(ik: Ikebana, version: number): IkebanaGeom {
  const shin = ik.branches[0], tai = ik.branches[2], accent = ik.branches[3];
  const shinEndY = shin.cps[shin.cps.length - 1][1];
  const taiEndX = tai.cps[tai.cps.length - 1][0];
  const accentEndY = accent.cps[accent.cps.length - 1][1];
  const rootFreq = 55 + (1 - shinEndY) * 55;

  const allShoots = ik.branches.flatMap(br => br.shoots);
  const nShoots = allShoots.length || 1;
  const meanAngle = allShoots.reduce((s, sh) => s + Math.abs(sh.angle), 0) / nShoots;
  const angleVar = allShoots.reduce((s, sh) => s + Math.pow(Math.abs(sh.angle) - meanAngle, 2), 0) / nShoots;
  const angleSpread = Math.sqrt(angleVar);
  const meanLen = allShoots.reduce((s, sh) => s + sh.len, 0) / nShoots;

  const lfoRateBase = 0.03 + (meanAngle / Math.PI) * 0.12 + angleSpread * 0.08;
  const lfoDepthMult = 0.5 + meanLen * 10.0;

  const rootMult = 0.75 + (1 - shinEndY) * 0.80;
  const spreadMult = 0.6 + taiEndX * 0.8;
  const brightMult = 0.4 + (1 - accentEndY) * 1.2;
  const freqScale: number[] = [];
  const gainScale: number[] = [];
  for (let i = 0; i < 7; i++) {
    freqScale.push(i < 2 ? rootMult : i < 4 ? rootMult * spreadMult : rootMult * brightMult);
    gainScale.push(i < 2 ? 1.0 : i < 4 ? spreadMult : brightMult);
  }
  return { version, freqScale, gainScale, lfoRateBase, lfoDepthMult, rootFreq };
}

// ─── Audio factory (ikebana.html L239-401, 570-723) ─────────────────────────

export const createAudio = (ctx: AudioContext): RoomAudio => {
  // out is the single node handed to the AudioBus — everything that connected
  // to AC.destination in the original connects here instead.
  const out = ctx.createGain();
  out.gain.value = 1;

  // Reverb impulse (3 s)
  const conv = ctx.createConvolver();
  const irN = Math.floor(ctx.sampleRate * 3.0);
  const irBuf = ctx.createBuffer(2, irN, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = irBuf.getChannelData(ch);
    for (let i = 0; i < irN; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irN, 1.9);
  }
  conv.buffer = irBuf;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.001, ctx.currentTime);
  masterGain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.05);
  const revSend = ctx.createGain();
  revSend.gain.value = 0.42;
  conv.connect(out);

  // Drag filter: masterGain → droneFilter → out (+ reverb send from filter)
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 800;
  droneFilter.Q.value = 1.8;
  masterGain.connect(droneFilter);
  droneFilter.connect(out);
  droneFilter.connect(revSend);
  revSend.connect(conv);

  // 7-oscillator drone
  const defs: { f: number; t: OscillatorType; g: number }[] = [
    { f: 55,    t: 'sine',     g: 0.40 },
    { f: 55.3,  t: 'sine',     g: 0.24 },
    { f: 82.4,  t: 'sine',     g: 0.18 },
    { f: 110,   t: 'triangle', g: 0.12 },
    { f: 110.5, t: 'sine',     g: 0.07 },
    { f: 165,   t: 'triangle', g: 0.05 },
    { f: 220,   t: 'sine',     g: 0.03 }
  ];
  const droneOscs = defs.map(def => {
    const osc = ctx.createOscillator();
    osc.type = def.t;
    osc.frequency.value = def.f;
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.02 + Math.random() * 0.06;
    lfoG.gain.value = def.f * 0.0018;
    lfo.connect(lfoG); lfoG.connect(osc.frequency); lfo.start();
    const gNode = ctx.createGain();
    gNode.gain.value = def.g;
    osc.connect(gNode); gNode.connect(masterGain); osc.start();
    return { osc, gNode, lfo, lfoG, baseFreq: def.f, baseGain: def.g };
  });

  // Breath LFO
  const breathOsc = ctx.createOscillator();
  breathOsc.frequency.value = 0.055;
  const breathG = ctx.createGain();
  breathG.gain.value = 0.12;
  breathOsc.connect(breathG); breathG.connect(masterGain.gain); breathOsc.start();

  // ── Per-branch shimmer (ikebana.html L325-382) ─────────────────────────────
  const SHIMMER_REGISTERS = [90, 115, 140, 170, 110];
  const SHIMMER_CHARS = [
    { wave: 'triangle' as OscillatorType, lpFMult: 2.0, lpQ: 0.6, gain: 0.028, atk: 0.08, dec: 0.50, rel: 0.90 },
    { wave: 'sine' as OscillatorType,     lpFMult: 3.0, lpQ: 1.2, gain: 0.024, atk: 0.05, dec: 0.35, rel: 0.70 },
    { wave: 'triangle' as OscillatorType, lpFMult: 1.4, lpQ: 3.5, gain: 0.030, atk: 0.03, dec: 0.25, rel: 0.55 },
    { wave: 'sawtooth' as OscillatorType, lpFMult: 1.8, lpQ: 2.8, gain: 0.020, atk: 0.02, dec: 0.20, rel: 0.45 },
    { wave: 'sine' as OscillatorType,     lpFMult: 2.5, lpQ: 0.5, gain: 0.016, atk: 0.10, dec: 0.55, rel: 1.00 }
  ];
  const SHIMMER_NOISE_AMTS = [0.008, 0.005, 0.012, 0.006, 0.020];

  function playShimmer(angle: number, branchIdx: number): void {
    const idx = branchIdx || 0;
    const delay = Math.random() * 0.06;
    const t = ctx.currentTime + delay;

    const freq = (SHIMMER_REGISTERS[idx] ?? 120) * (1 + ((angle + Math.PI) / (Math.PI * 2)) * 0.8);
    const C = SHIMMER_CHARS[idx] ?? SHIMMER_CHARS[0];

    const osc = ctx.createOscillator();
    osc.type = C.wave;
    osc.frequency.value = freq;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = freq * C.lpFMult;
    lp.Q.value = C.lpQ;

    const nLen = Math.floor(ctx.sampleRate * C.rel);
    const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = nBuf;
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = 'bandpass'; nFilt.frequency.value = freq * 1.3; nFilt.Q.value = 3;
    const nG = ctx.createGain();
    nG.gain.value = SHIMMER_NOISE_AMTS[idx] ?? 0.008;
    nSrc.connect(nFilt); nFilt.connect(nG);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(C.gain, t + C.atk);
    env.gain.linearRampToValueAtTime(C.gain * 0.35, t + C.dec);
    env.gain.linearRampToValueAtTime(0.0001, t + C.rel);

    osc.connect(lp); lp.connect(env);
    nG.connect(env);
    env.connect(out);
    osc.start(t); osc.stop(t + C.rel + 0.05);
    nSrc.start(t); nSrc.stop(t + C.rel + 0.05);
  }

  // ── Harmonic bloom (ikebana.html L385-401) ─────────────────────────────────
  function playBloom(rootFreq: number): void {
    const t = ctx.currentTime + 0.02;
    [1, 1.5, 2, 2.5].forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i < 2 ? 'sine' : 'triangle';
      osc.frequency.value = rootFreq * ratio;
      const onset = t + i * 0.18;
      g.gain.setValueAtTime(0.001, onset);
      g.gain.linearRampToValueAtTime(0.07 / (i * 0.5 + 1), onset + 0.45);
      g.gain.linearRampToValueAtTime(0.03 / (i * 0.5 + 1), onset + 2.0);
      g.gain.linearRampToValueAtTime(0.0001, onset + 4.0);
      osc.connect(g); g.connect(out);
      osc.start(onset); osc.stop(onset + 4.5);
    });
  }

  // ── Looped touch voice (ikebana.html L570-723) ─────────────────────────────
  interface TouchVoice {
    oscs: OscillatorNode[];
    subOsc: OscillatorNode | null;
    env: GainNode;
    wingOsc: OscillatorNode;
    wobOsc: OscillatorNode;
    noiseSrc: AudioBufferSourceNode;
    noiseBP: BiquadFilterNode;
  }
  let touchVoice: TouchVoice | null = null;

  const PERSONALITIES = [
    { waves: ['sawtooth', 'sawtooth', 'sawtooth'] as OscillatorType[], detunes: [0, +6, -7], bpFreqMult: 2.2, bpQ: 1.8, lpFreq: 600, wobRate: 5, wobDepth: 0.18, wingDepth: 0.55, noiseQ: 3, noiseMult: 1.0, noiseAmt: 0.035, mixGain: 0.28 },
    { waves: ['square', 'triangle', 'square'] as OscillatorType[],     detunes: [0, +3, -3], bpFreqMult: 2.8, bpQ: 2.5, lpFreq: 750, wobRate: 7, wobDepth: 0.14, wingDepth: 0.40, noiseQ: 5, noiseMult: 1.2, noiseAmt: 0.028, mixGain: 0.26 },
    { waves: ['triangle', 'triangle', 'triangle'] as OscillatorType[], detunes: [0, +2, -2], bpFreqMult: 2.0, bpQ: 4.5, lpFreq: 500, wobRate: 4, wobDepth: 0.22, wingDepth: 0.35, noiseQ: 6, noiseMult: 0.8, noiseAmt: 0.020, mixGain: 0.34 },
    { waves: ['sawtooth', 'sawtooth', 'triangle'] as OscillatorType[], detunes: [0, +5, -4], bpFreqMult: 3.5, bpQ: 3.0, lpFreq: 900, wobRate: 9, wobDepth: 0.12, wingDepth: 0.45, noiseQ: 4, noiseMult: 1.4, noiseAmt: 0.032, mixGain: 0.30 },
    { waves: ['sine', 'sine', 'triangle'] as OscillatorType[],         detunes: [0, +1, -1], bpFreqMult: 1.8, bpQ: 1.2, lpFreq: 400, wobRate: 3, wobDepth: 0.25, wingDepth: 0.20, noiseQ: 2, noiseMult: 0.9, noiseAmt: 0.065, mixGain: 0.22 }
  ];
  const TOUCH_REGISTERS = [90, 115, 140, 170, 110];

  function stopTouchVoice(): void {
    if (!touchVoice) return;
    const t = ctx.currentTime;
    const { oscs, subOsc, env, wingOsc, wobOsc, noiseSrc } = touchVoice;
    env.gain.cancelScheduledValues(t);
    env.gain.setValueAtTime(env.gain.value, t);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.22);
    const stopT = t + 0.30;
    oscs.forEach(o => o.stop(stopT));
    if (subOsc) subOsc.stop(stopT);
    wingOsc.stop(stopT);
    wobOsc.stop(stopT);
    noiseSrc.stop(stopT);
    touchVoice = null;
  }

  function startTouchVoice(angle: number, branchGeom: BranchGeom): void {
    stopTouchVoice();
    const t = ctx.currentTime;
    const idx = branchGeom.idx;

    const fund = (TOUCH_REGISTERS[idx] ?? 120) + ((angle + Math.PI) / (Math.PI * 2)) * 30;
    const P = PERSONALITIES[idx] ?? PERSONALITIES[0];

    const curve = branchGeom.curvature;
    const blen = branchGeom.length;
    const spread = branchGeom.angleSpread;

    const shapedBpQ = P.bpQ * (1 + curve * 1.4);
    const shapedLpFreq = P.lpFreq * (1 + spread * 0.5);
    const shapedWobRate = P.wobRate * (1 - blen * 0.4);
    const shapedWobD = P.wobDepth * (1 + blen * 0.6);
    const shapedDetune = P.detunes.map(d => d * (1 + spread));

    const oscs: OscillatorNode[] = [];
    P.waves.forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = fund * (1 + shapedDetune[i] * 0.0006);
      oscs.push(o);
    });

    let subOsc: OscillatorNode | null = null;
    if (idx === 3) {
      subOsc = ctx.createOscillator();
      subOsc.type = 'square';
      subOsc.frequency.value = fund * 0.5;
    }

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fund * P.bpFreqMult;
    bp.Q.value = shapedBpQ;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = shapedLpFreq;
    lp.Q.value = 0.7;

    const wingOsc = ctx.createOscillator();
    wingOsc.frequency.value = fund * 0.98;
    const wingGain = ctx.createGain();
    wingGain.gain.value = P.wingDepth;

    const wobOsc = ctx.createOscillator();
    wobOsc.frequency.value = shapedWobRate + Math.random() * 2;
    const wobGain = ctx.createGain();
    wobGain.gain.value = shapedWobD;

    const noiseLen = Math.floor(ctx.sampleRate * 2);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;
    const noiseBP = ctx.createBiquadFilter();
    noiseBP.type = 'bandpass';
    noiseBP.frequency.value = fund * P.noiseMult;
    noiseBP.Q.value = P.noiseQ;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = P.noiseAmt * (1 + curve * 0.5);
    noiseSrc.connect(noiseBP); noiseBP.connect(noiseGain);

    const mixer = ctx.createGain();
    mixer.gain.value = P.mixGain;
    oscs.forEach(o => o.connect(mixer));
    if (subOsc) {
      const sg = ctx.createGain();
      sg.gain.value = 0.4;
      subOsc.connect(sg); sg.connect(mixer);
    }
    mixer.connect(bp); bp.connect(lp);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.08, t + 0.14);
    wingOsc.connect(wingGain); wingGain.connect(env.gain);
    wobOsc.connect(wobGain); wobGain.connect(env.gain);
    lp.connect(env);
    noiseGain.connect(env);
    env.connect(out);

    oscs.forEach(o => o.start(t));
    wingOsc.start(t); wobOsc.start(t); noiseSrc.start(t);
    if (subOsc) subOsc.start(t);

    touchVoice = { oscs, subOsc, env, wingOsc, wobOsc, noiseSrc, noiseBP };
  }

  function retuneTouchVoice(newFund: number): void {
    if (!touchVoice) return;
    const t = ctx.currentTime;
    const { oscs, wingOsc, noiseBP } = touchVoice;
    const detunes = [0, +4, -5];
    oscs.forEach((o, i) => {
      const f = newFund * (1 + detunes[i] * 0.0006);
      o.frequency.setTargetAtTime(f, t, 0.04);
    });
    wingOsc.frequency.setTargetAtTime(newFund * 0.98, t, 0.04);
    noiseBP.frequency.setTargetAtTime(newFund * 1.1, t, 0.04);
  }

  // ── Drone surge on branch hit (ikebana.html L789-799) ──────────────────────
  function surgeDrone(colorR: number): void {
    const g = sharedState.geom;
    const lfoRateBase = g?.lfoRateBase ?? 0.06;
    const lfoDepthMult = g?.lfoDepthMult ?? 1;
    const t = ctx.currentTime;
    const surgeRate = lfoRateBase * 6;
    const surgeDepth = colorR * 0.08;
    droneOscs.forEach((d, di) => {
      d.lfo.frequency.setTargetAtTime(surgeRate * (0.8 + di * 0.1), t, 0.05);
      d.lfo.frequency.setTargetAtTime(lfoRateBase * (0.7 + di * 0.12), t + 0.8, 0.4);
      d.lfoG.gain.setTargetAtTime(d.baseFreq * 0.018 * surgeDepth * (0.6 + di * 0.1), t, 0.04);
      d.lfoG.gain.setTargetAtTime(d.baseFreq * 0.0018 * lfoDepthMult * (0.6 + di * 0.1), t + 1.0, 0.5);
    });
  }

  // ── morphDrone equivalent (ikebana.html L312-321) ──────────────────────────
  function resetDroneGains(): void {
    const t = ctx.currentTime;
    droneOscs.forEach(d => {
      d.gNode.gain.cancelScheduledValues(t);
      d.gNode.gain.setValueAtTime(0.0001, t);
    });
  }

  audioLink = { playShimmer, playBloom, startTouchVoice, retuneTouchVoice, stopTouchVoice, surgeDrone, resetDroneGains };

  // ── tick: continuous coupling (ikebana.html L416-461, 520-526, 540-543, 860-889) ──
  let appliedGeomVersion = -1;
  let prevPointerDown = false;

  return {
    node: out,
    tick(): void {
      const t = ctx.currentTime;
      const g = sharedState.geom;

      // New ikebana → apply staggered LFO rates/depths (launchIkebana L452-460)
      if (g && g.version !== appliedGeomVersion) {
        appliedGeomVersion = g.version;
        droneOscs.forEach((d, i) => {
          const rate = g.lfoRateBase * (0.7 + i * 0.12);
          const depth = d.baseFreq * 0.0018 * g.lfoDepthMult * (0.6 + i * 0.1);
          d.lfo.frequency.setTargetAtTime(rate, t, 1.5);
          d.lfoG.gain.setTargetAtTime(depth, t, 1.5);
        });
      }

      // Live drone morphing tied to draw progress (renderIkebana L860-889)
      droneOscs.forEach((d, i) => {
        const partialProg = Math.min(1, Math.max(0, (sharedState.avgProg - i * 0.04) / 0.85));
        const targetGain = d.baseGain * partialProg * (g ? g.gainScale[i] : 1.0);
        d.gNode.gain.setTargetAtTime(Math.max(0.0001, targetGain), t, 0.08);

        const finalFreq = Math.max(20, d.baseFreq * (g ? g.freqScale[i] : 1.0));
        const startFreq = finalFreq * 1.4;
        d.osc.frequency.setTargetAtTime(startFreq + (finalFreq - startFreq) * sharedState.avgProg, t, 0.3);
      });

      // Drag → filter cutoff/Q (pointerMove L520-526, pointerUp L540-543)
      if (sharedState.pointerDown) {
        const targetCutoff = 300 + Math.min(sharedState.dragVelocity * 4000, 1800);
        droneFilter.frequency.setTargetAtTime(targetCutoff, t, 0.08);
        droneFilter.Q.setTargetAtTime(1.4 + sharedState.dragVelocity * 6, t, 0.1);
      } else if (prevPointerDown) {
        droneFilter.frequency.setTargetAtTime(800, t, 0.5);
        droneFilter.Q.setTargetAtTime(1.8, t, 0.5);
      }
      prevPointerDown = sharedState.pointerDown;
    }
  };
};

// ─── Overlay (ikebana.html L11-27, 32-33) ───────────────────────────────────

function makeOverlay(): { root: HTMLElement; hint: HTMLElement } {
  const root = document.createElement('div');
  root.setAttribute('data-ikebana-overlay', '');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';

  const kanji = document.createElement('div');
  kanji.textContent = '天　人　地';
  // top moved 36px → 96px to clear the app's back button; rest verbatim
  kanji.style.cssText =
    "position:absolute;top:96px;left:44px;" +
    "font-family:'Hiragino Mincho ProN','Yu Mincho','MS Mincho',serif;" +
    'font-size:12px;letter-spacing:0.35em;color:rgba(210,185,140,0.28);' +
    'writing-mode:vertical-rl;text-orientation:upright;user-select:none;';

  const hint = document.createElement('div');
  hint.textContent = 'doppio tap — nuovo ikebana';
  hint.style.cssText =
    'position:absolute;bottom:28px;left:50%;transform:translateX(-50%);' +
    "font-family:'Hiragino Mincho ProN','Yu Mincho',Georgia,serif;" +
    'font-size:10px;letter-spacing:0.45em;color:rgba(210,185,140,0.18);' +
    'user-select:none;transition:opacity 2s;white-space:nowrap;';

  root.appendChild(kanji);
  root.appendChild(hint);
  return { root, hint };
}

// ─── Mount ───────────────────────────────────────────────────────────────────

export const mount: RoomMount = (canvas, opts) => {
  const gl = createContext(canvas, { version: 1, antialias: true, alpha: false }) as WebGLRenderingContext;
  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  const full = opts.quality === 'full';

  // ── GL setup (ikebana.html L61-78) ─────────────────────────────────────────
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS);
  const prog = linkProgram(gl, vs, fs);
  gl.useProgram(prog);

  const u = getUniforms(gl, prog, ['u_res', 'u_color'] as const);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  const vbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let W = 1, H = 1;
  const stopResize = observeResize(canvas, () => {
    W = canvas.width;
    H = canvas.height;
    gl.viewport(0, 0, W, H);
  });

  function setColor(r: number, g: number, b: number, a: number): void {
    gl.uniform4f(u.u_color, r, g, b, a);
  }

  // ── Drawing primitives (ikebana.html L82-107) ──────────────────────────────
  function thickPolyline(pts: Pt[], w: number): void {
    if (pts.length < 2) return;
    const verts: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(i - 1, 0)];
      const next = pts[Math.min(i + 1, pts.length - 1)];
      const dx = next[0] - prev[0], dy = next[1] - prev[1];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len * w * 0.5;
      const ny = dx / len * w * 0.5;
      verts.push(pts[i][0] + nx, pts[i][1] + ny,
                 pts[i][0] - nx, pts[i][1] - ny);
    }
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, pts.length * 2);
  }

  function drawCirclePts(cx: number, cy: number, r: number, steps = 32): void {
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    thickPolyline(pts, 0.8);
  }

  // ── State (ikebana.html L403-473, 562-568, 982-991) ───────────────────────
  let geomVersion = 0;

  function launchIkebana(ik: Ikebana): Ikebana {
    if (full) {
      geomVersion++;
      sharedState.geom = computeIkebanaGeom(ik, geomVersion);
    }
    return ik;
  }

  let ikebanas: Ikebana[] = [launchIkebana(genIkebana())];
  const disturbances: Disturbance[] = [];
  const shootRegistry: ShootReg[] = [];
  const shimmeredShoots = new WeakSet<Shoot>();
  let ripplePhase = 0;

  const petals: Petal[] = Array.from({ length: 11 }, () => ({
    x: 0.12 + Math.random() * 0.76,
    y: -0.05 - Math.random() * 0.45,
    vy: 0.00013 + Math.random() * 0.00010,
    vx: (Math.random() - 0.5) * 0.00006,
    phase: Math.random() * Math.PI * 2,
    r: 1.1 + Math.random() * 1.4,
    alpha: 0.09 + Math.random() * 0.14
  }));

  // ── Overlay (full mode only) ───────────────────────────────────────────────
  let overlayRoot: HTMLElement | null = null;
  let hint: HTMLElement | null = null;
  if (full) {
    const ov = makeOverlay();
    overlayRoot = ov.root;
    hint = ov.hint;
    (canvas.parentElement ?? document.body).appendChild(overlayRoot);
  }

  function resetIkebana(): void {
    ikebanas.forEach(ik => { ik.dying = true; ik.deathTime = performance.now(); });
    const ik = launchIkebana(genIkebana());
    ikebanas.push(ik);
    audioLink?.playBloom(sharedState.geom?.rootFreq ?? 82.5);
    audioLink?.resetDroneGains();
    if (hint) hint.style.opacity = '0';
  }

  // ── Pointer tracking (ikebana.html L475-561) ──────────────────────────────
  const pointer = { x: -9999, y: -9999, down: false, moved: false };
  let lastPointerX = 0, lastPointerY = 0, lastPointerTime = 0;
  let dragVelocity = 0;
  let lastTap = 0, lastTouchX = 0, lastTouchY = 0;
  let isOnBranch = false;
  let lastDisturbTime = 0;
  const listenerCleanups: (() => void)[] = [];

  function canvasScale(): { sx: number; sy: number; left: number; top: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      sx: canvas.width / (rect.width || 1),
      sy: canvas.height / (rect.height || 1),
      left: rect.left,
      top: rect.top
    };
  }

  function pointerMove(cx: number, cy: number): void {
    const now = performance.now();
    const { sx, sy, left, top } = canvasScale();
    const nx = (cx - left) * sx;
    const ny = (cy - top) * sy;
    const dt = Math.max(1, now - lastPointerTime);
    const dx = nx - lastPointerX, dy = ny - lastPointerY;
    const speed = Math.sqrt(dx * dx + dy * dy) / dt;
    dragVelocity = dragVelocity * 0.7 + speed * 0.3;
    sharedState.dragVelocity = dragVelocity;

    pointer.x = nx; pointer.y = ny;
    pointer.moved = true;
    lastPointerX = nx; lastPointerY = ny; lastPointerTime = now;
  }
  function pointerDown(cx: number, cy: number): void {
    pointer.down = true;
    sharedState.pointerDown = true;
    pointerMove(cx, cy);
  }
  function pointerUp(): void {
    pointer.down = false;
    sharedState.pointerDown = false;
    pointer.moved = true;
    dragVelocity = 0;
    sharedState.dragVelocity = 0;
  }

  if (full) {
    const onTapStart = (e: TouchEvent): void => {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    };
    const onTapEnd = (e: TouchEvent): void => {
      const dx = e.changedTouches[0].clientX - lastTouchX;
      const dy = e.changedTouches[0].clientY - lastTouchY;
      if (Math.sqrt(dx * dx + dy * dy) > 14) return;
      const now = Date.now();
      if (now - lastTap < 320) resetIkebana();
      lastTap = now;
    };
    const onDblClick = (): void => resetIkebana();
    const onMouseMove = (e: MouseEvent): void => pointerMove(e.clientX, e.clientY);
    const onMouseDown = (e: MouseEvent): void => pointerDown(e.clientX, e.clientY);
    const onMouseUp = (): void => pointerUp();
    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length === 1) {
        pointer.down = true;
        sharedState.pointerDown = true;
        pointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length === 1) {
        pointerDown(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchEnd = (): void => pointerUp();

    canvas.addEventListener('touchstart', onTapStart, { passive: true });
    canvas.addEventListener('touchend', onTapEnd, { passive: true });
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown, { capture: true });
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });

    listenerCleanups.push(
      () => canvas.removeEventListener('touchstart', onTapStart),
      () => canvas.removeEventListener('touchend', onTapEnd),
      () => canvas.removeEventListener('dblclick', onDblClick),
      () => canvas.removeEventListener('mousemove', onMouseMove),
      () => canvas.removeEventListener('mousedown', onMouseDown, { capture: true } as EventListenerOptions),
      () => canvas.removeEventListener('mouseup', onMouseUp),
      () => canvas.removeEventListener('touchmove', onTouchMove),
      () => canvas.removeEventListener('touchstart', onTouchStart, { capture: true } as EventListenerOptions),
      () => canvas.removeEventListener('touchend', onTouchEnd)
    );
  }

  // ── Hit detection (ikebana.html L729-829) ─────────────────────────────────
  function checkLineHit(): void {
    if (!pointer.down && !pointer.moved) return;
    pointer.moved = false;
    const now = performance.now();
    const px = pointer.x, py = pointer.y;
    const hitRadius = Math.min(W, H) * 0.055;

    let hit = false;

    ikebanas.forEach(ik => {
      if (!ik.startTime || hit) return;
      const elapsed = (now - ik.startTime) / 1000;
      ik.branches.forEach((br, bi) => {
        if (hit) return;
        const prog = easeOut5(Math.min(Math.max((elapsed - br.delay) / br.duration, 0), 1));
        if (prog < 0.05) return;
        const full2 = buildSpline(br.cps.map(([x, y]) => [x * W, y * H] as Pt), 140);
        const n = Math.floor(full2.length * prog);
        for (let i = 0; i < n; i += 8) {
          const dx = full2[i][0] - px, dy = full2[i][1] - py;
          if (dx * dx + dy * dy < hitRadius * hitRadius) {
            hit = true;
            if (now - lastDisturbTime > 60) {
              const splineT0 = i / (full2.length - 1);
              disturbances.push({ created: now, branchIdx: bi, splineT: splineT0, amp: hitRadius * 0.55, ikRef: ik });
              lastDisturbTime = now;
            }
            const splineT = i / (full2.length - 1);
            const basePitch = 100 + br.color[0] * 80;
            const newFund = basePitch * (1 + splineT * 1.5);

            if (!isOnBranch) {
              const cps = br.cps;
              const straight = Math.sqrt(Math.pow(cps[cps.length - 1][0] - cps[0][0], 2) + Math.pow(cps[cps.length - 1][1] - cps[0][1], 2));
              let maxDev = 0;
              cps.forEach(p => {
                const t2 = (p[0] - cps[0][0]) / (cps[cps.length - 1][0] - cps[0][0] + 0.001);
                const lx = cps[0][0] + (cps[cps.length - 1][0] - cps[0][0]) * t2;
                const ly = cps[0][1] + (cps[cps.length - 1][1] - cps[0][1]) * t2;
                maxDev = Math.max(maxDev, Math.sqrt(Math.pow(p[0] - lx, 2) + Math.pow(p[1] - ly, 2)));
              });
              const curvature = Math.min(1, maxDev / (straight * 0.5 + 0.001));
              const brLen = Math.min(1, straight / Math.min(W, H));
              const angleSpread = br.shoots.length > 0
                ? Math.min(1, br.shoots.reduce((s, sh) => s + Math.abs(sh.angle), 0) / br.shoots.length / Math.PI)
                : 0.3;
              const geom: BranchGeom = { idx: bi, curvature, length: brLen, angleSpread };
              audioLink?.startTouchVoice(Math.atan2(py - H * 0.5, px - W * 0.5), geom);
            }
            audioLink?.retuneTouchVoice(newFund);
            if (now - lastDisturbTime <= 80) {
              audioLink?.surgeDrone(br.color[0]);
            }
            break;
          }
        }
      });
    });

    if (pointer.down) {
      const shootRadius = Math.min(W, H) * 0.04;
      shootRegistry.forEach(reg => {
        const now2 = performance.now();
        if (now2 - reg.lastHit < 300) return;
        if (!reg.pts || reg.pts.length === 0) return;
        for (let i = 0; i < reg.pts.length; i += 4) {
          const dx = reg.pts[i][0] - px, dy = reg.pts[i][1] - py;
          if (dx * dx + dy * dy < shootRadius * shootRadius) {
            reg.lastHit = now2;
            audioLink?.playShimmer(reg.angle, reg.branchIdx);
            break;
          }
        }
      });
    }

    if (!hit && isOnBranch) audioLink?.stopTouchVoice();
    isOnBranch = hit;

    if (!pointer.down) audioLink?.stopTouchVoice();
  }

  // ── Ripples (ikebana.html L831-846) ────────────────────────────────────────
  function drawRipples(cx: number, cy: number, phase: number, gAlpha: number): void {
    for (let i = 0; i < 4; i++) {
      const rp = (phase * 0.25 + i / 4) % 1;
      const r = rp * W * 0.10;
      const a = (1 - rp) * 0.06 * gAlpha;
      if (a < 0.004) continue;
      setColor(0.65, 0.55, 0.35, a);
      const pts: Pt[] = [];
      for (let j = 0; j <= 40; j++) {
        const ang = (j / 40) * Math.PI * 2;
        pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.14]);
      }
      thickPolyline(pts, 0.6);
    }
  }

  // ── Render one ikebana (ikebana.html L848-980) ────────────────────────────
  const dprW = (): number => Math.min(window.devicePixelRatio || 1, 2);

  function renderIkebana(ik: Ikebana, now: number): void {
    if (!ik.startTime) ik.startTime = now;
    const elapsed = (now - ik.startTime) / 1000;
    const fadeIn = Math.min(1, elapsed / 0.7);
    let gAlpha = fadeIn;
    if (ik.dying) {
      const d = (now - ik.deathTime) / 1000;
      gAlpha = Math.max(0, 1 - d / 1.2);
      if (gAlpha <= 0) { ik.dead = true; return; }
    }

    // Average draw progress feeds the drone morph (full mode only)
    if (!ik.dying && full) {
      sharedState.avgProg = ik.branches.reduce((sum, br) => {
        return sum + easeOut5(Math.min(Math.max((elapsed - br.delay) / br.duration, 0), 1));
      }, 0) / ik.branches.length;
    }

    gl.uniform2f(u.u_res, W, H);

    drawRipples(ik.ox * W, ik.oy * H, ripplePhase, gAlpha);

    ik.branches.forEach((br, bi) => {
      const prog = easeOut5(Math.min(Math.max((elapsed - br.delay) / br.duration, 0), 1));
      if (prog <= 0) return;

      const fullSpline = buildSpline(br.cps.map(([x, y]) => [x * W, y * H] as Pt), 140);
      const n = Math.max(2, Math.floor(fullSpline.length * prog));
      const sub = fullSpline.slice(0, n);
      const [r, g, b] = br.color;
      const a = br.alpha * gAlpha;

      const drawPts: Pt[] = sub.map((pt, pi) => {
        let ox2 = 0, oy2 = 0;
        const tNorm = pi / (sub.length - 1 || 1);
        disturbances.forEach(dis => {
          if (dis.ikRef !== ik || dis.branchIdx !== bi) return;
          const age = (now - dis.created) / 1000;
          const decay = Math.max(0, 1 - age / 1.2);
          if (decay <= 0) return;
          const wave = Math.sin((tNorm - dis.splineT) * 18 - age * 8) * decay;
          const dist = Math.abs(tNorm - dis.splineT);
          const env = Math.exp(-dist * 12) * decay;
          const prev2 = sub[Math.max(pi - 1, 0)];
          const next2 = sub[Math.min(pi + 1, sub.length - 1)];
          const dxs = next2[0] - prev2[0], dys = next2[1] - prev2[1];
          const dlen = Math.sqrt(dxs * dxs + dys * dys) || 1;
          ox2 += (-dys / dlen) * wave * env * dis.amp;
          oy2 += (dxs / dlen) * wave * env * dis.amp;
        });
        return [pt[0] + ox2, pt[1] + oy2];
      });

      // core line
      setColor(r, g, b, a);
      thickPolyline(drawPts, br.width * dprW());

      // glow
      setColor(r, g, b, a * 0.15);
      thickPolyline(drawPts, br.width * dprW() * 4);

      // shoots
      br.shoots.forEach(sh => {
        const shProg = easeOut3(Math.min(Math.max((elapsed - sh.delay) / 0.9, 0), 1));
        if (shProg <= 0) return;
        if (shProg > 0.02 && !shimmeredShoots.has(sh)) {
          shimmeredShoots.add(sh);
          audioLink?.playShimmer(sh.angle, bi);
        }
        const base = splinePt(fullSpline, sh.t);
        const ex = base[0] + Math.cos(sh.angle) * sh.len * W * shProg;
        const ey = base[1] + Math.sin(sh.angle) * sh.len * H * shProg;
        const mid: Pt = [
          base[0] + (ex - base[0]) * 0.5 + rnd(-4, 4),
          base[1] + (ey - base[1]) * 0.5 + rnd(-4, 4)
        ];
        const spts = buildSpline([base, mid, [ex, ey]], 40);
        setColor(r, g, b, a * 0.65);
        thickPolyline(spts, Math.max(0.6, br.width * 0.55 * dprW()));

        let reg = shootRegistry.find(r2 => r2.sh === sh);
        if (!reg) {
          reg = { sh, pts: [], angle: sh.angle, lastHit: 0, branchIdx: bi };
          shootRegistry.push(reg);
        }
        reg.pts = spts;
      });

      // bud
      if (br.budR > 0) {
        const budProg = easeOut3(Math.min(Math.max((elapsed - br.budDelay) / 0.5, 0), 1));
        if (budProg > 0) {
          const tip = splinePt(fullSpline, 1.0);
          const [br2, bg2, bb2] = br.color.map(v => Math.min(1, v + 0.1));
          setColor(br2, bg2, bb2, 0.75 * budProg * gAlpha);
          drawCirclePts(tip[0], tip[1], br.budR * budProg * dprW());
          setColor(br2, bg2, bb2, 0.95 * budProg * gAlpha);
          drawCirclePts(tip[0], tip[1], br.budR * 0.28 * budProg * dprW());
        }
      }
    });
  }

  // ── Main loop (ikebana.html L993-1031) ─────────────────────────────────────
  const loop = createRafLoop((_dt, ts) => {
    gl.uniform2f(u.u_res, W, H);
    gl.clearColor(0.024, 0.019, 0.012, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    ripplePhase = ts / 1000;

    // bg verticals
    for (let i = 0; i < 7; i++) {
      const x = W * (0.08 + i * 0.13);
      setColor(0.50, 0.43, 0.26, 0.007 + 0.004 * Math.sin(ts * 0.0002 + i));
      thickPolyline([[x, 0], [x, H]], 0.5);
    }

    // prune disturbances
    const dNow = performance.now();
    for (let i = disturbances.length - 1; i >= 0; i--) {
      if (dNow - disturbances[i].created > 1300) disturbances.splice(i, 1);
    }
    shootRegistry.length = 0;
    if (full) checkLineHit();

    ikebanas.forEach(ik => renderIkebana(ik, ts));
    if (ikebanas.length > 1) ikebanas = ikebanas.filter(ik => !ik.dead);

    petals.forEach(p => {
      p.x += p.vx + Math.sin(ts * 0.0008 + p.phase) * 0.00002;
      p.y += p.vy;
      if (p.y > 1.08) { p.y = -0.04; p.x = 0.10 + Math.random() * 0.80; }
      setColor(0.80, 0.72, 0.52, p.alpha);
      drawCirclePts(p.x * W, p.y * H, p.r * dprW());
    });
  }, ac.signal);

  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      for (const cleanup of listenerCleanups) cleanup();
      overlayRoot?.remove();
      try { gl.deleteProgram(prog); } catch { /* idempotent */ }
      try { gl.deleteBuffer(vbuf); } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
```

- [ ] **Step 2: Run the ikebana tests**

Run: `npm test -- ikebana`
Expected: PASS (all 5 tests).

- [ ] **Step 3: Run the whole unit suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, 0 type errors. (`registry.ts` does not import ikebana yet — that's Task 7.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/rooms/ikebana.ts
git commit -m "feat(rooms): ikebana room — full graphics/interaction/audio port"
```

---

### Task 5: Bindu room — failing tests

**Files:**
- Create: `tests/unit/rooms/bindu.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/rooms/bindu.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mount, createAudio } from '@/lib/rooms/bindu';
import { makeFakeAudio, advanceFakeAudio } from '../../fixtures/fake-audio';

function makeProxyGL(): unknown {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
      if (p === 'createShader' || p === 'createProgram' || p === 'createBuffer' || p === 'createTexture' || p === 'createFramebuffer') return () => ({});
      if (p === 'getUniformLocation' || p === 'getAttribLocation') return () => ({});
      if (p === 'getExtension') return () => ({});
      if (typeof p === 'string' && p === p.toUpperCase()) return 0;
      return () => undefined;
    }
  });
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400 });
  Object.defineProperty(c, 'clientHeight', { get: () => 300 });
  c.getContext = ((type: string): unknown => {
    if (type === 'webgl' || type === 'webgl2') return makeProxyGL();
    return null;
  }) as typeof HTMLCanvasElement.prototype.getContext;
  document.body.appendChild(c);
  return c;
}

describe('bindu.mount', () => {
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

  it('full mode injects the title + guna legend overlay; teardown removes it', () => {
    const canvas = makeCanvas();
    const handle = mount(canvas, { quality: 'full', audio: false });
    const overlay = document.querySelector('[data-bindu-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain('Bindu · The Origin');
    expect(overlay!.textContent).toContain('Tamas');
    expect(overlay!.textContent).toContain('Rajas');
    expect(overlay!.textContent).toContain('Sattva');
    handle.teardown();
    expect(document.querySelector('[data-bindu-overlay]')).toBeNull();
  });

  it('preview mode injects no overlay', () => {
    const handle = mount(makeCanvas(), { quality: 'preview', audio: false });
    expect(document.querySelector('[data-bindu-overlay]')).toBeNull();
    handle.teardown();
  });
});

describe('bindu.createAudio', () => {
  it('returns a node and a tick that does not throw across walker retargets', () => {
    const fake = makeFakeAudio();
    const audio = createAudio(fake as unknown as AudioContext);
    expect(audio.node).toBeTruthy();
    expect(typeof audio.tick).toBe('function');
    // run ticks across >50ms walker boundaries and a retarget horizon (>14s)
    for (let i = 0; i < 30; i++) {
      advanceFakeAudio(fake, 500);
      expect(() => audio.tick!()).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- bindu`
Expected: FAIL — cannot resolve `@/lib/rooms/bindu`.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/unit/rooms/bindu.test.ts
git commit -m "test(bindu): behavioral tests for mount/overlay/audio factory"
```

---

### Task 6: Bindu room module

**Files:**
- Create: `src/lib/rooms/bindu.ts`

Port notes (vs `bindu.html`):
- The ॐ overlay is replaced by AudioPrompt; visuals run from mount (in the original they also ran behind the 90 %-opaque overlay).
- `master` is the returned node (the original connected it to `AC.destination`); its internal 0 → 0.22 / 5 s swell is kept.
- The walkers' `setInterval(50ms)` becomes a `ctx.currentTime` accumulator in `tick()` firing at the same 50 ms cadence — no leaked interval.
- `updateAudio(vx, vy, zoom)` runs in `tick()` from `sharedState` (drag EMA + camera dist), formulas verbatim.
- The original sized its canvas at DPR 1 (`canvas.width = innerWidth`); pass `dprCap = 1` to `observeResize` to keep line density/brightness identical (additive-blended 1-px `gl.LINES` look different at 2× DPR).
- Camera drag math uses client-pixel deltas (no canvas-pixel conversion needed — verbatim).

- [ ] **Step 1: Write the module**

Create `src/lib/rooms/bindu.ts`:

```ts
import type { RoomMount } from '@/lib/webgl/types';
import type { RoomAudio } from '@/lib/audio/bus';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';

// Ported from bindu.html — every constant and formula is verbatim.
// Adaptations: AudioBus owns the AudioContext; the ॐ start overlay is replaced
// by the app's AudioPrompt; setInterval walkers run from tick().

const NUM_LINES = { preview: 300, full: 1200 } as const;
const SEGS = 80;
const VPL = SEGS + 1;
const FLOATS = 7;

// ─── Shared visual → audio state ─────────────────────────────────────────────

const sharedState = {
  dragX: 0,   // smoothed drag velocity, client px/frame
  dragY: 0,
  dist: 20    // camera distance (zoom)
};

// ─── Shaders (bindu.html L59-61) ─────────────────────────────────────────────

const VS = `attribute vec3 aPos;attribute vec4 aCol;uniform mat4 uMVP;varying vec4 vC;
void main(){gl_Position=uMVP*vec4(aPos,1.);vC=aCol;}`;
const FS = `precision mediump float;varying vec4 vC;void main(){gl_FragColor=vC;}`;

// ─── Math (bindu.html L72-94) ────────────────────────────────────────────────

function persp(fov: number, asp: number, n: number, f: number): Float32Array {
  const t = 1 / Math.tan(fov * 0.5), nf = 1 / (n - f);
  return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]);
}

function lookAt(ex: number, ey: number, ez: number): Float32Array {
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

function mul4(a: Float32Array, b: Float32Array): Float32Array {
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

// ─── Line templates (bindu.html L158-175) ────────────────────────────────────

interface Line {
  ta: number; ra: number; sa: number;
  dx: number; dy: number; dz: number;
  maxLen: number;
  cr: number; cg: number; cb: number;
  baseA: number;
  t: number;
  life: number;
}

function makeTemplate(): Omit<Line, 't' | 'life'> {
  let ta = Math.random(), ra = Math.random(), sa = Math.random();
  const tot = ta + ra + sa;
  ta /= tot; ra /= tot; sa /= tot;
  const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
  return {
    ta, ra, sa,
    dx: Math.sin(ph) * Math.cos(th), dy: Math.sin(ph) * Math.sin(th), dz: Math.cos(ph),
    maxLen: 0.5 + Math.random() * Math.random() * 4.2,
    cr: Math.min(1, ta * 0.06 + ra * 0.88 + sa * 1.0),
    cg: Math.min(1, ta * 0.02 + ra * 0.13 + sa * 1.0),
    cb: Math.min(1, ta * 0.10 + ra * 0.10 + sa * 1.0),
    baseA: 0.12 + sa * 0.46 + ra * 0.24
  };
}

function resetLine(ln: Line): void {
  Object.assign(ln, makeTemplate());
  ln.t = 0;
  ln.life = 3 + Math.random() * 7;
}

// ─── Audio factory (bindu.html L235-431) ─────────────────────────────────────

export const createAudio = (ctx: AudioContext): RoomAudio => {
  // master is the node handed to the AudioBus (original connected it to destination)
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 5);

  // Long cave reverb (6 s)
  const conv = ctx.createConvolver();
  const irLen = Math.floor(ctx.sampleRate * 6);
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 1.35);
  }
  conv.buffer = ir;
  const convG = ctx.createGain();
  convG.gain.value = 0.65;
  conv.connect(convG); convG.connect(master);

  // Dry
  const dry = ctx.createGain();
  dry.gain.value = 0.35;
  dry.connect(master);

  // Low-pass — drag horizontal controls cutoff
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = 380; lpf.Q.value = 0.5;
  lpf.connect(dry); lpf.connect(conv);

  // Global pitch detune — drag vertical
  const det = ctx.createConstantSource();
  det.offset.value = 0;
  det.start();

  const ROOT = 55;

  const voices = [
    { d: 0, a: 0.30 }, { d: -4, a: 0.22 }, { d: 5, a: 0.20 }, { d: -8, a: 0.17 },
    { d: 13, a: 0.14 }, { d: -15, a: 0.11 }, { d: 20, a: 0.09 }, { d: -23, a: 0.08 }
  ];
  const harmonics = [
    { r: 1, g: 0.58 }, { r: 2, g: 0.30 }, { r: 3, g: 0.20 }, { r: 4, g: 0.09 },
    { r: 5, g: 0.14 }, { r: 6, g: 0.06 }, { r: 8, g: 0.04 }
  ];

  voices.forEach(({ d, a }) => {
    const vg = ctx.createGain();
    vg.gain.value = a;
    vg.connect(lpf);
    harmonics.forEach(({ r, g }) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = ROOT * r;
      osc.detune.value = d;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13 + Math.random() * 0.09;
      const lg = ctx.createGain();
      lg.gain.value = 0.8 + Math.random() * 0.6;
      lfo.connect(lg); lg.connect(osc.detune); lfo.start();
      det.connect(osc.detune);
      const hg = ctx.createGain();
      hg.gain.value = g;
      osc.connect(hg); hg.connect(vg); osc.start();
    });
  });

  // Sub: 27.5 Hz
  const sub = ctx.createOscillator();
  sub.type = 'sine'; sub.frequency.value = ROOT * 0.5;
  const subG = ctx.createGain();
  subG.gain.value = 0.12;
  det.connect(sub.detune);
  sub.connect(subG); subG.connect(master); sub.start();

  // Slow breath swell ~8s
  const sw = ctx.createOscillator();
  sw.frequency.value = 0.12;
  const swG = ctx.createGain();
  swG.gain.value = 0.05;
  sw.connect(swG); swG.connect(master.gain); sw.start();

  // Vowel bandpass, parallel with lpf
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass'; bpf.frequency.value = 220; bpf.Q.value = 4.5;
  lpf.connect(bpf);
  const bpG = ctx.createGain();
  bpG.gain.value = 0.12;
  bpf.connect(bpG); bpG.connect(dry); bpG.connect(conv);

  // Random walkers (original setInterval(50ms) → tick-driven accumulator)
  interface Walker { cur: number; target: number; min: number; max: number; nextAt: number; onTick(v: number): void; }
  const walkers: Walker[] = [
    {
      cur: 380, target: 380, min: 120, max: 700, nextAt: 0,
      onTick: v => { lpf.frequency.setTargetAtTime(v, ctx.currentTime, 1.2); }
    },
    {
      cur: 0.22, target: 0.22, min: 0.16, max: 0.26, nextAt: 0,
      onTick: v => { master.gain.setTargetAtTime(v, ctx.currentTime, 2.5); }
    },
    {
      cur: 220, target: 220, min: 90, max: 480, nextAt: 0,
      onTick: v => { bpf.frequency.setTargetAtTime(v, ctx.currentTime, 1.8); }
    }
  ];
  function scheduleWalker(w: Walker): void {
    w.target = w.min + Math.random() * (w.max - w.min);
    w.nextAt = ctx.currentTime + 4 + Math.random() * 10;
  }
  walkers.forEach(scheduleWalker);
  let lastWalk = ctx.currentTime;

  // Zoom-reactive white noise
  const noiseLen = Math.floor(ctx.sampleRate * 2);
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
  const noiseNode = ctx.createBufferSource();
  noiseNode.buffer = noiseBuf;
  noiseNode.loop = true;
  noiseNode.start();

  const nhpf = ctx.createBiquadFilter();
  nhpf.type = 'highpass'; nhpf.frequency.value = 800; nhpf.Q.value = 0.7;
  noiseNode.connect(nhpf);

  const nbpf = ctx.createBiquadFilter();
  nbpf.type = 'bandpass'; nbpf.frequency.value = 3000; nbpf.Q.value = 1.2;
  nhpf.connect(nbpf);

  const ng = ctx.createGain();
  ng.gain.value = 0;
  nbpf.connect(ng);
  ng.connect(master);

  return {
    node: master,
    tick(): void {
      const now = ctx.currentTime;

      // walkers at the original 50ms cadence (bindu.html L343-352)
      if (now - lastWalk >= 0.05) {
        lastWalk = now;
        for (const w of walkers) {
          w.cur += (w.target - w.cur) * 0.08;
          w.onTick(w.cur);
          if (now >= w.nextAt) scheduleWalker(w);
        }
      }

      // updateAudio(vx, vy, zoom) — bindu.html L389-431, formulas verbatim
      const vx = sharedState.dragX, vy = sharedState.dragY, zoom = sharedState.dist;

      const nt = Math.max(0, (9 - zoom) / (9 - 0.3));
      const noiseAmt = Math.min(0.025, 0.025 * Math.pow(nt, 4));
      ng.gain.setTargetAtTime(noiseAmt, now, 0.6);
      const hpTarget = Math.max(200, Math.min(4000, 800 + vx * 60));
      nhpf.frequency.setTargetAtTime(hpTarget, now, 0.15);
      const bpTarget = Math.max(800, Math.min(8000, 3000 - vy * 80));
      nbpf.frequency.setTargetAtTime(bpTarget, now, 0.15);

      const baseF = walkers[0].cur;
      const targetF = Math.max(40, Math.min(1800, baseF + vx * 55));
      lpf.frequency.setTargetAtTime(targetF, now, 0.12);

      const targetD = Math.max(-200, Math.min(200, -vy * 11));
      det.offset.setTargetAtTime(targetD, now, 0.18);

      const baseB = walkers[2].cur;
      const targetB = Math.max(60, Math.min(900, baseB + vx * 30));
      bpf.frequency.setTargetAtTime(targetB, now, 0.18);

      const baseG = walkers[1].cur;
      const targetG = Math.max(0.06, Math.min(0.40, baseG - vy * 0.008));
      walkers[1].cur = targetG;
    }
  };
};

// ─── Overlay (bindu.html L11-24, 39-44) ──────────────────────────────────────

function makeOverlay(): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-bindu-overlay', '');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';

  const title = document.createElement('div');
  title.textContent = 'Bindu · The Origin';
  title.style.cssText =
    'position:absolute;top:26px;left:50%;transform:translateX(-50%);' +
    "font-family:'Georgia',serif;font-size:12px;letter-spacing:.35em;" +
    'color:rgba(255,255,255,.14);text-transform:uppercase;white-space:nowrap;';

  const ui = document.createElement('div');
  ui.style.cssText =
    'position:absolute;bottom:26px;left:50%;transform:translateX(-50%);' +
    "display:flex;gap:26px;font-family:'Georgia',serif;font-size:10px;" +
    'letter-spacing:.22em;color:rgba(255,255,255,.22);text-transform:uppercase;';
  const gunas: [string, string][] = [
    ['Tamas', 'background:#111;border:1px solid #444'],
    ['Rajas', 'background:#c03020'],
    ['Sattva', 'background:rgba(255,255,255,.82)']
  ];
  for (const [label, dotStyle] of gunas) {
    const guna = document.createElement('div');
    guna.style.cssText = 'display:flex;align-items:center;gap:7px;';
    const dot = document.createElement('div');
    dot.style.cssText = `width:5px;height:5px;border-radius:50%;${dotStyle}`;
    guna.appendChild(dot);
    guna.appendChild(document.createTextNode(label));
    ui.appendChild(guna);
  }

  root.appendChild(title);
  root.appendChild(ui);
  return root;
}

// ─── Mount ───────────────────────────────────────────────────────────────────

export const mount: RoomMount = (canvas, opts) => {
  const gl = createContext(canvas, { version: 1, antialias: true, alpha: false }) as WebGLRenderingContext;
  gl.getExtension('OES_element_index_uint');
  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  const full = opts.quality === 'full';
  const NUM = NUM_LINES[opts.quality];

  // ── GL setup ───────────────────────────────────────────────────────────────
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS);
  const prog = linkProgram(gl, vs, fs);
  gl.useProgram(prog);
  const LP = gl.getAttribLocation(prog, 'aPos');
  const LC = gl.getAttribLocation(prog, 'aCol');
  const u = getUniforms(gl, prog, ['uMVP'] as const);

  // Original rendered at DPR 1 (canvas.width = innerWidth) — keep it for
  // identical 1-px additive line density.
  let W = 1, H = 1;
  const stopResize = observeResize(canvas, () => {
    W = canvas.width;
    H = canvas.height;
    gl.viewport(0, 0, W, H);
  }, 1);

  // ── Camera (bindu.html L96-151) ────────────────────────────────────────────
  const cam = { yaw: 0, pitch: 0.22, dist: 20, vy: 0.18, vp: 0 };
  const FRIC = 0.995, DSENS = 0.006;
  let isDrag = false, dX = 0, dY = 0, dDX = 0, dDY = 0;
  let sDX = 0, sDY = 0;
  const listenerCleanups: (() => void)[] = [];

  if (full) {
    const onMouseDown = (e: MouseEvent): void => {
      isDrag = true; dX = e.clientX; dY = e.clientY; dDX = dDY = 0;
    };
    const onMouseMove = (e: MouseEvent): void => {
      if (!isDrag) return;
      dDX = e.clientX - dX; dDY = e.clientY - dY;
      cam.yaw -= dDX * DSENS; cam.pitch -= dDY * DSENS * 0.55;
      cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch));
      dX = e.clientX; dY = e.clientY;
    };
    const onMouseUp = (): void => {
      if (isDrag) { cam.vy = -dDX * DSENS * 60; cam.vp = -dDY * DSENS * 0.55 * 60; }
      isDrag = false; dDX = dDY = 0;
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      cam.dist = Math.max(0.3, Math.min(60, cam.dist + e.deltaY * 0.012));
    };

    const touches: Record<number, { x: number; y: number; dx: number; dy: number }> = {};
    let pinch0: number | null = null;
    const onTouchStart = (e: TouchEvent): void => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        touches[t.identifier] = { x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
      }
      if (e.touches.length === 2) {
        const a = e.touches[0], b = e.touches[1];
        pinch0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      }
      if (e.touches.length === 1) { dDX = dDY = 0; }
    };
    const onTouchMove = (e: TouchEvent): void => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const a = e.touches[0], b = e.touches[1];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinch0 !== null) cam.dist = Math.max(0.3, Math.min(60, cam.dist - (d - pinch0) * 0.12));
        pinch0 = d;
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0], p = touches[t.identifier];
        if (p) {
          dDX = t.clientX - p.x; dDY = t.clientY - p.y;
          p.dx = dDX; p.dy = dDY;
          cam.yaw -= dDX * DSENS; cam.pitch -= dDY * DSENS * 0.55;
          cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch));
          p.x = t.clientX; p.y = t.clientY;
        }
      }
    };
    const onTouchEnd = (e: TouchEvent): void => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        const p = touches[t.identifier];
        if (p && e.touches.length === 0) { cam.vy = -p.dx * DSENS * 60; cam.vp = -p.dy * DSENS * 0.55 * 60; }
        delete touches[t.identifier];
      }
      if (e.touches.length < 2) pinch0 = null;
      if (e.touches.length === 0) { dDX = dDY = 0; isDrag = false; }
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    listenerCleanups.push(
      () => canvas.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => canvas.removeEventListener('wheel', onWheel),
      () => canvas.removeEventListener('touchstart', onTouchStart),
      () => canvas.removeEventListener('touchmove', onTouchMove),
      () => canvas.removeEventListener('touchend', onTouchEnd)
    );
  }

  // Touch drag also sets isDrag for the EMA below — mirror the mouse path.
  // (The original distinguished them via dDX/dDY directly; we treat any
  // nonzero dDX/dDY with active touch as dragging through the same vars.)

  // ── Overlay (full mode only) ───────────────────────────────────────────────
  let overlayRoot: HTMLElement | null = null;
  if (full) {
    overlayRoot = makeOverlay();
    (canvas.parentElement ?? document.body).appendChild(overlayRoot);
  }

  // ── Lines (bindu.html L153-233) ────────────────────────────────────────────
  const vtx = new Float32Array(NUM * VPL * FLOATS);
  const lines: Line[] = [];
  for (let i = 0; i < NUM; i++) {
    const l = makeTemplate() as Line;
    l.t = Math.random() * (3 + Math.random() * 7);
    l.life = 3 + Math.random() * 7;
    lines.push(l);
  }

  function updateGeometry(): void {
    for (let l = 0; l < NUM; l++) {
      const ln = lines[l];
      const p = Math.min(ln.t / ln.life, 1);

      const travelDist = ln.maxLen * 1.6;
      const tipDist = travelDist * p;
      const tailLen = ln.maxLen * 0.55;
      const tailDist = Math.max(0, tipDist - tailLen);
      const birthRamp = Math.min(p / 0.08, 1.0);

      for (let seg = 0; seg <= SEGS; seg++) {
        const uu = seg / SEGS;
        const di = tailDist + uu * (tipDist - tailDist);

        let px = ln.dx * di, py = ln.dy * di, pz = ln.dz * di;
        py += ln.ta * di * di * 0.65;
        py -= ln.sa * di * di * 0.45;
        if (ln.ra > 0.03) {
          const ang = ln.ra * di * 3 + ln.t * ln.ra * 2.2;
          const ca = Math.cos(ang), si = Math.sin(ang);
          const nx = px * ca - pz * si, nz = px * si + pz * ca;
          px = nx; pz = nz;
          const ro = ln.ra * di * 0.22;
          px += Math.cos(ang * 1.3) * ro;
          py += Math.sin(ang * 0.7) * ro * 0.2;
        }

        const alpha = Math.min(ln.baseA * uu * uu * birthRamp, 1.0);

        const vi = (l * VPL + seg) * FLOATS;
        vtx[vi] = px; vtx[vi + 1] = py; vtx[vi + 2] = pz;
        vtx[vi + 3] = ln.cr; vtx[vi + 4] = ln.cg; vtx[vi + 5] = ln.cb; vtx[vi + 6] = alpha;
      }
    }
  }

  const idxArr = new Uint32Array(NUM * SEGS * 2);
  {
    let p = 0;
    for (let l = 0; l < NUM; l++) {
      const b = l * VPL;
      for (let s = 0; s < SEGS; s++) { idxArr[p++] = b + s; idxArr[p++] = b + s + 1; }
    }
  }
  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxArr, gl.STATIC_DRAW);
  const vtxBuf = gl.createBuffer();

  function uploadGeometry(): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, vtxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, vtx, gl.DYNAMIC_DRAW);
    const B = FLOATS * 4;
    gl.enableVertexAttribArray(LP); gl.vertexAttribPointer(LP, 3, gl.FLOAT, false, B, 0);
    gl.enableVertexAttribArray(LC); gl.vertexAttribPointer(LC, 4, gl.FLOAT, false, B, 12);
  }

  // ── Render loop (bindu.html L444-489) ──────────────────────────────────────
  const loop = createRafLoop((dtMs, _ts) => {
    const dt = Math.min(dtMs * 0.001, 0.05);

    // Camera inertia
    if (!isDrag) {
      cam.yaw += cam.vy * dt;
      cam.pitch += cam.vp * dt;
      cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch));
      cam.vy *= FRIC; cam.vp *= FRIC;
    }

    // Smooth drag velocity for audio (exponential moving average)
    sDX = sDX * 0.75 + (isDrag ? dDX : 0) * 0.25;
    sDY = sDY * 0.75 + (isDrag ? dDY : 0) * 0.25;
    if (full) {
      sharedState.dragX = sDX;
      sharedState.dragY = sDY;
      sharedState.dist = cam.dist;
    }

    // MVP
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const ex = cam.dist * cp * Math.sin(cam.yaw);
    const ey = cam.dist * sp;
    const ez = cam.dist * cp * Math.cos(cam.yaw);
    const mvp = mul4(persp(Math.PI / 3.5, W / H, 0.05, 120), lookAt(ex, ey, ez));
    gl.uniformMatrix4fv(u.uMVP, false, mvp);

    // Lines
    for (let l = 0; l < NUM; l++) {
      const ln = lines[l];
      ln.t += dt;
      if (ln.t >= ln.life) resetLine(ln);
    }
    updateGeometry();
    uploadGeometry();

    // Draw
    gl.clearColor(0.023, 0, 0.012, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.drawElements(gl.LINES, NUM * SEGS * 2, gl.UNSIGNED_INT, 0);
  }, ac.signal);

  if (!opts.startPaused) loop.start();

  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      for (const cleanup of listenerCleanups) cleanup();
      overlayRoot?.remove();
      try { gl.deleteProgram(prog); } catch { /* idempotent */ }
      try { gl.deleteBuffer(idxBuf); } catch { /* idempotent */ }
      try { gl.deleteBuffer(vtxBuf); } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
```

Note for the implementer: in the original, `isDrag` is set only by **mouse** events — single-finger touch drives the camera through `dDX/dDY` directly while `isDrag` stays `false`. Because the audio EMA is `sDX = sDX*.75 + (isDrag ? dDX : 0)*.25` (bindu.html L459), only mouse drags modulated the audio; touch drags moved the camera but fed `0` into the EMA. The code above preserves this exactly — do not "fix" it by setting `isDrag` from touch handlers (`onTouchEnd` resetting `isDrag = false` is a harmless safety reset).

- [ ] **Step 2: Run the bindu tests**

Run: `npm test -- bindu`
Expected: PASS (all 5 tests).

- [ ] **Step 3: Run the whole unit suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rooms/bindu.ts
git commit -m "feat(rooms): bindu room — full graphics/camera/audio port"
```

---

### Task 7: Registry + slug type widening

**Files:**
- Modify: `src/lib/rooms/registry.ts`
- Modify: `src/scripts/room-stage.ts:5`
- Modify: `src/scripts/room-preview.ts:5`
- Modify: `src/components/RoomStage.astro:2`
- Modify: `src/components/RoomCanvasPreview.astro:2`
- Modify: `src/components/AudioPrompt.astro:2`
- Modify: `src/components/RoomCard.astro:5,11`
- Modify: `src/pages/rooms/[slug].astro:21,37`

- [ ] **Step 1: Update the registry**

Replace `src/lib/rooms/registry.ts`:

```ts
import type { RoomMount } from '@/lib/webgl/types';
import type { RoomAudio } from '@/lib/audio/bus';

export type RoomSlug = 'neural' | 'tunnel' | 'swarm' | 'ikebana' | 'bindu';

export interface RoomModule {
  mount: RoomMount;
  createAudio?: (ctx: AudioContext) => RoomAudio;
}

export const rooms: Record<RoomSlug, () => Promise<RoomModule>> = {
  neural:  () => import('./neural'),
  tunnel:  () => import('./tunnel'),
  swarm:   () => import('./swarm'),
  ikebana: () => import('./ikebana'),
  bindu:   () => import('./bindu')
};
```

- [ ] **Step 2: Derive the slug guards from the registry**

In `src/scripts/room-stage.ts` line 5, replace:

```ts
const isRoomSlug = (s: string): s is RoomSlug => s === 'neural' || s === 'tunnel' || s === 'swarm';
```

with:

```ts
const isRoomSlug = (s: string): s is RoomSlug => s in rooms;
```

Apply the identical replacement in `src/scripts/room-preview.ts` line 5 (both files already import `rooms`).

- [ ] **Step 3: Widen component prop types**

In `src/components/RoomStage.astro`, replace the frontmatter interface:

```astro
---
import type { RoomSlug } from '@/lib/rooms/registry';
interface Props { slug: RoomSlug; hasAudio: boolean; }
const { slug, hasAudio } = Astro.props;
---
```

In `src/components/RoomCanvasPreview.astro`:

```astro
---
import type { RoomSlug } from '@/lib/rooms/registry';
interface Props { slug: RoomSlug }
const { slug } = Astro.props;
---
```

In `src/components/AudioPrompt.astro`:

```astro
---
import type { RoomSlug } from '@/lib/rooms/registry';
interface Props { slug: RoomSlug; }
const { slug } = Astro.props;
---
```

In `src/components/RoomCard.astro`, replace the two union types in `Props`:

```ts
import type { RoomSlug } from '@/lib/rooms/registry';

interface Props {
  slug: RoomSlug;
  num: string;
  title: string;
  description: string;
  tags: string[];
  year: number;
  accent: 'cyan' | 'purple' | 'red' | 'gold' | 'crimson';
  span?: 'wide' | 'narrow' | 'third' | 'half' | 'full';
}
```

(the `import type` line goes below the existing `import RoomCanvasPreview` line in the frontmatter).

In `src/pages/rooms/[slug].astro`, add to the frontmatter imports:

```ts
import type { RoomSlug } from '@/lib/rooms/registry';
```

and replace both casts (lines 21 and 37):

```astro
<RoomStage slug={d.slug as RoomSlug} hasAudio={d.hasAudio} />
```

```astro
{d.hasAudio && <AudioPrompt slug={d.slug as RoomSlug} />}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS (registry test iterates all 5 slugs and finds `mount` on each), 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rooms/registry.ts src/scripts/room-stage.ts src/scripts/room-preview.ts src/components/RoomStage.astro src/components/RoomCanvasPreview.astro src/components/AudioPrompt.astro src/components/RoomCard.astro src/pages/rooms/\[slug\].astro
git commit -m "feat(rooms): register ikebana + bindu, derive slug types from registry"
```

---

### Task 8: E2E updates + full verification

**Files:**
- Modify: `tests/e2e/home.spec.ts:8`
- Modify: `tests/e2e/rooms.spec.ts:16,29`

- [ ] **Step 1: Update card-count and slug-sweep assertions**

In `tests/e2e/home.spec.ts` line 8:

```ts
  await expect(page.locator('[data-room-card]')).toHaveCount(5);
```

In `tests/e2e/rooms.spec.ts` line 16:

```ts
  for (const slug of ['tunnel', 'swarm', 'neural', 'ikebana', 'bindu'] as const) {
```

and line 29:

```ts
  await expect(page.locator('[data-room-card]')).toHaveCount(5);
```

- [ ] **Step 2: Full verification**

Run: `npm test && npm run typecheck && npm run build && npm run test:e2e`
Expected: unit suite PASS, 0 type errors, build succeeds, all e2e PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/home.spec.ts tests/e2e/rooms.spec.ts
git commit -m "test(e2e): cover ikebana + bindu rooms"
```

---

### Task 9: Manual browser verification (pixels + audio are not unit-tested)

Per project policy, WebGL pixel output and audio waveforms are verified by hand.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` and open `http://localhost:4321`.

- [ ] **Step 2: Gallery checks**

- 5 cards render; ikebana and bindu cards show live previews on hover.
- Card previews are silent; ikebana preview shows the drawing animation + petals; bindu preview shows comet lines with slow yaw drift.

- [ ] **Step 3: `/rooms/ikebana` checks (compare side-by-side with `ikebana.html` opened from disk)**

- Branches draw in with the same easing; shoots, buds, ripples, petals, bg verticals all present; kanji top-left (below back button), Italian hint bottom.
- Click "Enable audio": drone swells following draw progress; shoot shimmers ping as shoots appear.
- Drag along a branch: looped voice with per-branch timbre, pitch glides root→tip, disturbance waves ripple the line, filter opens with drag speed.
- Brushing a shoot pings a shimmer.
- Double-tap / double-click: old ikebana fades, new one draws, bloom chord plays, drone rebuilds from silence, hint fades out.

- [ ] **Step 4: `/rooms/bindu` checks (compare with `bindu.html`)**

- Comet lines stream from the origin; tamas sinks / sattva rises / rajas swirls; additive glow.
- Drag orbits with inertia; wheel zooms; (mobile/trackpad) pinch zooms.
- Enable audio: deep 55 Hz drone with slow vowel wandering; zooming close brings up the airy noise; horizontal drag opens the filter, vertical drag bends pitch.
- Title and guna legend visible, app chrome unobstructed.

- [ ] **Step 5: Cross-room navigation**

- Gallery → ikebana → back → bindu: overlays appear/disappear correctly, audio crossfades, no console errors.
```
