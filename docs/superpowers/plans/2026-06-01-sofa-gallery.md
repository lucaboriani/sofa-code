# Sofa Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Astro + TypeScript gallery site that hosts three refactored WebGL "rooms" (`neural`, `tunnel`, `swarm`) with live mini-canvas previews on hover, crossfading audio coordinated by View Transitions, and a shared WebGL engine. TDD-driven where units are pure-ish; manual visual verification for canvas output.

**Architecture:** Static Astro build. Content Collection (`rooms`) provides typed metadata. Each room is a TS module exporting `mount(canvas, opts): teardown`. A shared `src/lib/webgl/` engine extracts boilerplate (context, shaders, resize, RAF). A `window`-scoped `AudioBus` singleton survives Astro `<ClientRouter />` navigations and crossfades audio between rooms. Card preview gating is a pure reconciler (state-machine) bound to IntersectionObserver + pointer events.

**Tech Stack:** Astro 5, TypeScript strict, Vite, Zod, Vitest + JSDOM, Playwright, WebGL/WebGL2, Web Audio API. Plain CSS with custom properties (no Tailwind).

**Reference inputs (existing files in repo root):**
- `projects.html` — visual reference (colors, typography, grid, animations).
- `neural-webgl.html` — source for the `neural` room (audio-reactive).
- `pixel-tunnel.html` — source for the `tunnel` room (WebGL2, drag-to-speed).
- `spiderweb-swarm.html` — source for the `swarm` room.

**Spec:** `docs/superpowers/specs/2026-06-01-sofa-gallery-design.md` (read first).

---

## Task 1: Bootstrap — scaffold Astro, install deps, configure strict TypeScript

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/env.d.ts`
- Create: `public/favicon.svg`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "sofa",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "typecheck": "astro check",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "lighthouse": "lhci autorun || true"
  },
  "dependencies": {
    "astro": "^5.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.0",
    "@playwright/test": "^1.45.0",
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://sofa.local',
  output: 'static',
  vite: {
    resolve: {
      alias: { '@': new URL('./src', import.meta.url).pathname }
    }
  }
});
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["astro/client", "vitest/globals"]
  },
  "include": ["src/**/*", "tests/**/*", "*.d.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules
dist
.astro
.env
.env.*
!.env.example
.DS_Store
coverage
playwright-report
test-results
```

- [ ] **Step 5: Write `src/env.d.ts`**

```ts
/// <reference types="astro/client" />

declare global {
  interface Window {
    __audioBus__?: import('@/lib/audio/bus').AudioBus;
  }
}

export {};
```

- [ ] **Step 6: Write minimal `public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#080b10"/><circle cx="8" cy="8" r="3" fill="#00e5ff"/></svg>
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: dependencies resolve, no errors. `node_modules/` populated.

- [ ] **Step 8: Verify Astro runs**

Run: `npx astro --version`
Expected: prints Astro 5.x version.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json astro.config.mjs tsconfig.json .gitignore src/env.d.ts public/favicon.svg
git commit -m "chore: scaffold astro 5 project with strict TS"
```

---

## Task 2: Run `/init` to generate CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Run `/init` slash command**

In Claude Code, run: `/init`

Expected: Claude inspects the freshly-scaffolded project and writes `CLAUDE.md` describing the layout, scripts, tech stack, and conventions.

- [ ] **Step 2: Verify `CLAUDE.md` exists and references the spec**

Run: `ls -la CLAUDE.md && head -20 CLAUDE.md`
Expected: file exists; opening sections mention Astro, TypeScript strict, the `src/` layout. If the file lacks a reference to `docs/superpowers/specs/2026-06-01-sofa-gallery-design.md`, append one short line pointing future sessions there.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md via /init"
```

---

## Task 3: Set up test infrastructure (vitest, playwright, fixtures)

**Files:**
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `tests/fixtures/fake-gl.ts`
- Create: `tests/fixtures/fake-audio.ts`
- Create: `tests/setup/dom.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup/dom.ts'],
    include: ['tests/unit/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'html'], reportsDirectory: 'coverage' }
  }
});
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
```

- [ ] **Step 3: Write `tests/setup/dom.ts` (polyfills for rAF, IO, ResizeObserver, performance.now)**

```ts
import { vi } from 'vitest';

if (!('requestAnimationFrame' in globalThis)) {
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const n = ++id;
    callbacks.set(n, cb);
    queueMicrotask(() => { const fn = callbacks.get(n); if (fn) { callbacks.delete(n); fn(performance.now()); } });
    return n;
  };
  globalThis.cancelAnimationFrame = (n: number): void => { callbacks.delete(n); };
}

class FakeIO implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '0px';
  readonly thresholds: ReadonlyArray<number> = [0];
  constructor(private _cb: IntersectionObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  trigger(entries: Partial<IntersectionObserverEntry>[]): void {
    this._cb(entries as IntersectionObserverEntry[], this);
  }
}
(globalThis as unknown as { IntersectionObserver: typeof FakeIO }).IntersectionObserver = FakeIO;

class FakeRO implements ResizeObserver {
  constructor(private _cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(entries: Partial<ResizeObserverEntry>[]): void {
    this._cb(entries as ResizeObserverEntry[], this);
  }
}
(globalThis as unknown as { ResizeObserver: typeof FakeRO }).ResizeObserver = FakeRO;

export { FakeIO, FakeRO };
export const mockedVi = vi;
```

- [ ] **Step 4: Write `tests/fixtures/fake-gl.ts`**

```ts
/**
 * Minimal fake of WebGLRenderingContext that records calls.
 * Provides only the methods our engine uses.
 */
export interface FakeGL {
  // recorded calls
  calls: Array<{ method: string; args: unknown[] }>;
  // mock constants used by callers
  VERTEX_SHADER: 35633;
  FRAGMENT_SHADER: 35632;
  COMPILE_STATUS: 35713;
  LINK_STATUS: 35714;
  // toggles
  __compileStatus: boolean;
  __linkStatus: boolean;
  __infoLog: string;
  // methods
  createShader(type: number): { type: number; src: string | null };
  shaderSource(shader: { src: string | null }, src: string): void;
  compileShader(shader: unknown): void;
  getShaderParameter(shader: unknown, pname: number): boolean;
  getShaderInfoLog(shader: unknown): string;
  createProgram(): { uniforms: Map<string, object> };
  attachShader(program: unknown, shader: unknown): void;
  linkProgram(program: unknown): void;
  getProgramParameter(program: unknown, pname: number): boolean;
  getProgramInfoLog(program: unknown): string;
  getUniformLocation(program: { uniforms: Map<string, object> }, name: string): object | null;
  deleteShader(shader: unknown): void;
  deleteProgram(program: unknown): void;
}

export function makeFakeGL(opts: Partial<Pick<FakeGL, '__compileStatus' | '__linkStatus' | '__infoLog'>> = {}): FakeGL {
  const calls: FakeGL['calls'] = [];
  const record = <A extends unknown[]>(method: string) => (...args: A): unknown => {
    calls.push({ method, args });
    return undefined;
  };
  const gl: FakeGL = {
    calls,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    __compileStatus: opts.__compileStatus ?? true,
    __linkStatus: opts.__linkStatus ?? true,
    __infoLog: opts.__infoLog ?? '',
    createShader(type) { const s = { type, src: null }; calls.push({ method: 'createShader', args: [type] }); return s; },
    shaderSource(shader, src) { shader.src = src; calls.push({ method: 'shaderSource', args: [shader, src] }); },
    compileShader: record('compileShader'),
    getShaderParameter() { return gl.__compileStatus; },
    getShaderInfoLog() { return gl.__infoLog; },
    createProgram() { const p = { uniforms: new Map<string, object>() }; calls.push({ method: 'createProgram', args: [] }); return p; },
    attachShader: record('attachShader'),
    linkProgram: record('linkProgram'),
    getProgramParameter() { return gl.__linkStatus; },
    getProgramInfoLog() { return gl.__infoLog; },
    getUniformLocation(program, name) {
      if (!program.uniforms.has(name)) program.uniforms.set(name, { name });
      const loc = program.uniforms.get(name) ?? null;
      calls.push({ method: 'getUniformLocation', args: [name] });
      return loc;
    },
    deleteShader: record('deleteShader'),
    deleteProgram: record('deleteProgram')
  };
  return gl;
}
```

- [ ] **Step 5: Write `tests/fixtures/fake-audio.ts`**

```ts
export interface FakeRamp { value: number; endTime: number; }
export interface FakeGain {
  gain: { value: number; ramps: FakeRamp[]; linearRampToValueAtTime(v: number, t: number): void; setValueAtTime(v: number, t: number): void; };
  connect(dest: unknown): void;
  disconnect(): void;
}
export interface FakeAudioContext {
  currentTime: number;
  state: 'suspended' | 'running' | 'closed';
  destination: { _id: 'destination' };
  resume(): Promise<void>;
  close(): Promise<void>;
  createGain(): FakeGain;
  createBufferSource(): { connect(d: unknown): void; start(): void; stop(): void; buffer: null; loop: boolean };
}

export function makeFakeAudio(): FakeAudioContext {
  let now = 0;
  const ctx: FakeAudioContext = {
    get currentTime() { return now; },
    state: 'suspended',
    destination: { _id: 'destination' },
    async resume() { ctx.state = 'running'; },
    async close() { ctx.state = 'closed'; },
    createGain() {
      const ramps: FakeRamp[] = [];
      const g: FakeGain = {
        gain: {
          value: 1,
          ramps,
          linearRampToValueAtTime(v, t) { ramps.push({ value: v, endTime: t }); g.gain.value = v; },
          setValueAtTime(v, _t) { g.gain.value = v; }
        },
        connect() {},
        disconnect() {}
      };
      return g;
    },
    createBufferSource() {
      return { connect() {}, start() {}, stop() {}, buffer: null, loop: false };
    }
  };
  return ctx;
}

export function advanceFakeAudio(ctx: FakeAudioContext, deltaMs: number): void {
  (ctx as unknown as { currentTime: number }).currentTime = ctx.currentTime + deltaMs / 1000;
}
```

- [ ] **Step 6: Add `tests/.gitkeep` for unit dirs**

```bash
mkdir -p tests/unit/webgl tests/unit/audio tests/unit/preview tests/unit/transitions tests/unit/rooms tests/unit/content tests/e2e
```

- [ ] **Step 7: Run vitest to verify config loads (no tests yet)**

Run: `npm test`
Expected: `No test files found, exiting with code 0` (or similar) — config loaded successfully.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts playwright.config.ts tests/
git commit -m "chore: add vitest+playwright test infra with GL/audio fakes"
```

---

## Task 4: Shared engine — `src/lib/webgl/types.ts` (no test)

**Files:**
- Create: `src/lib/webgl/types.ts`

- [ ] **Step 1: Write `src/lib/webgl/types.ts`**

```ts
export type RoomQuality = 'preview' | 'full';

export interface RoomOptions {
  quality: RoomQuality;
  audio: boolean;
  signal?: AbortSignal;
}

export type RoomTeardown = () => void;
export type RoomMount = (canvas: HTMLCanvasElement, opts: RoomOptions) => RoomTeardown;

export type AnyGL = WebGLRenderingContext | WebGL2RenderingContext;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgl/types.ts
git commit -m "feat(webgl): room types and contracts"
```

---

## Task 5: Shared engine — `src/lib/webgl/shaders.ts` (TDD)

**Files:**
- Create: `tests/unit/webgl/shaders.test.ts`
- Create: `src/lib/webgl/shaders.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/webgl/shaders.test.ts
import { describe, it, expect } from 'vitest';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { makeFakeGL } from '../../fixtures/fake-gl';

describe('compileShader', () => {
  it('returns a shader on success', () => {
    const gl = makeFakeGL({ __compileStatus: true });
    const s = compileShader(gl as never, gl.VERTEX_SHADER, 'void main(){}');
    expect(s).toBeTruthy();
    expect(gl.calls.find(c => c.method === 'compileShader')).toBeDefined();
  });

  it('throws including info log on failure', () => {
    const gl = makeFakeGL({ __compileStatus: false, __infoLog: 'ERROR: line 3' });
    expect(() => compileShader(gl as never, gl.VERTEX_SHADER, 'broken'))
      .toThrowError(/ERROR: line 3/);
  });
});

describe('linkProgram', () => {
  it('returns a program on success', () => {
    const gl = makeFakeGL();
    const vs = compileShader(gl as never, gl.VERTEX_SHADER, 'void main(){}');
    const fs = compileShader(gl as never, gl.FRAGMENT_SHADER, 'void main(){}');
    const p = linkProgram(gl as never, vs, fs);
    expect(p).toBeTruthy();
  });

  it('throws on link failure', () => {
    const gl = makeFakeGL({ __linkStatus: false, __infoLog: 'LINK ERROR' });
    const vs = compileShader(gl as never, gl.VERTEX_SHADER, 'void main(){}');
    const fs = compileShader(gl as never, gl.FRAGMENT_SHADER, 'void main(){}');
    expect(() => linkProgram(gl as never, vs, fs)).toThrowError(/LINK ERROR/);
  });
});

describe('getUniforms', () => {
  it('returns a typed record of locations', () => {
    const gl = makeFakeGL();
    const vs = compileShader(gl as never, gl.VERTEX_SHADER, 'void main(){}');
    const fs = compileShader(gl as never, gl.FRAGMENT_SHADER, 'void main(){}');
    const p = linkProgram(gl as never, vs, fs);
    const u = getUniforms(gl as never, p, ['uA', 'uB'] as const);
    expect(u.uA).toBeDefined();
    expect(u.uB).toBeDefined();
  });

  it('throws if uniform is missing', () => {
    const gl = makeFakeGL();
    // sabotage: return null on lookup
    (gl as unknown as { getUniformLocation: () => null }).getUniformLocation = () => null;
    const vs = compileShader(gl as never, gl.VERTEX_SHADER, 'void main(){}');
    const fs = compileShader(gl as never, gl.FRAGMENT_SHADER, 'void main(){}');
    const p = linkProgram(gl as never, vs, fs);
    expect(() => getUniforms(gl as never, p, ['uMissing'] as const))
      .toThrowError(/uMissing/);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test -- shaders`
Expected: FAIL — module `@/lib/webgl/shaders` not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/webgl/shaders.ts
import type { AnyGL } from './types';

export function compileShader(gl: AnyGL, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader returned null');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export function linkProgram(gl: AnyGL, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram returned null');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

export function getUniforms<const T extends readonly string[]>(
  gl: AnyGL,
  program: WebGLProgram,
  names: T
): { [K in T[number]]: WebGLUniformLocation } {
  const out = {} as { [K in T[number]]: WebGLUniformLocation };
  for (const name of names) {
    const loc = gl.getUniformLocation(program, name);
    if (loc === null) throw new Error(`Missing uniform: ${name}`);
    (out as Record<string, WebGLUniformLocation>)[name] = loc;
  }
  return out;
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- shaders`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/webgl/shaders.test.ts src/lib/webgl/shaders.ts
git commit -m "feat(webgl): compileShader, linkProgram, getUniforms with tests"
```

---

## Task 6: Shared engine — `src/lib/webgl/resize.ts` (TDD)

**Files:**
- Create: `tests/unit/webgl/resize.test.ts`
- Create: `src/lib/webgl/resize.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/webgl/resize.test.ts
import { describe, it, expect, vi } from 'vitest';
import { observeResize } from '@/lib/webgl/resize';

function fakeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400, configurable: true });
  Object.defineProperty(c, 'clientHeight', { get: () => 300, configurable: true });
  return c;
}

describe('observeResize', () => {
  it('sets canvas pixel size based on DPR, capped at 2', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 5, configurable: true });
    const canvas = fakeCanvas();
    const cleanup = observeResize(canvas);
    expect(canvas.width).toBe(800);   // 400 * 2
    expect(canvas.height).toBe(600);  // 300 * 2
    cleanup();
  });

  it('invokes onResize once on observe', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    const canvas = fakeCanvas();
    const cb = vi.fn();
    const cleanup = observeResize(canvas, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(400, 300);
    cleanup();
  });

  it('cleanup disconnects the ResizeObserver', () => {
    const disconnect = vi.fn();
    class RO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void { disconnect(); }
    }
    (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
    const canvas = fakeCanvas();
    const cleanup = observeResize(canvas);
    cleanup();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test -- resize`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/lib/webgl/resize.ts
const DEFAULT_DPR_CAP = 2;

export function observeResize(
  canvas: HTMLCanvasElement,
  onResize?: (cssW: number, cssH: number) => void,
  dprCap = DEFAULT_DPR_CAP
): () => void {
  const apply = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    onResize?.(cssW, cssH);
  };
  apply();
  const ro = new ResizeObserver(apply);
  ro.observe(canvas);
  return () => ro.disconnect();
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- resize`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/webgl/resize.test.ts src/lib/webgl/resize.ts
git commit -m "feat(webgl): observeResize with DPR cap"
```

---

## Task 7: Shared engine — `src/lib/webgl/raf.ts` (TDD)

**Files:**
- Create: `tests/unit/webgl/raf.test.ts`
- Create: `src/lib/webgl/raf.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/webgl/raf.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRafLoop } from '@/lib/webgl/raf';

function installControllableRaf(): { tick: (advanceMs: number) => void; reset: () => void } {
  let now = 0;
  let pending: Array<(t: number) => void> = [];
  globalThis.performance = { now: () => now } as unknown as Performance;
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => { pending.push(cb); return pending.length; }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => { pending[id - 1] = () => {}; }) as typeof cancelAnimationFrame;
  return {
    tick(advanceMs) {
      now += advanceMs;
      const drain = pending;
      pending = [];
      drain.forEach(cb => cb(now));
    },
    reset() { now = 0; pending = []; }
  };
}

describe('createRafLoop', () => {
  let ctrl: ReturnType<typeof installControllableRaf>;
  beforeEach(() => { ctrl = installControllableRaf(); });

  it('calls tick repeatedly with non-decreasing tMs', () => {
    const cb = vi.fn();
    const loop = createRafLoop((dt, t) => cb(dt, t));
    loop.start();
    ctrl.tick(16);
    ctrl.tick(16);
    ctrl.tick(16);
    expect(cb).toHaveBeenCalled();
    const calls = cb.mock.calls;
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i][1]).toBeGreaterThanOrEqual(calls[i - 1][1]);
    }
    loop.stop();
  });

  it('stop() halts further ticks', () => {
    const cb = vi.fn();
    const loop = createRafLoop(cb);
    loop.start();
    ctrl.tick(16);
    const beforeStopCalls = cb.mock.calls.length;
    loop.stop();
    ctrl.tick(16);
    ctrl.tick(16);
    expect(cb.mock.calls.length).toBe(beforeStopCalls);
  });

  it('AbortSignal abortion stops the loop', () => {
    const ac = new AbortController();
    const cb = vi.fn();
    const loop = createRafLoop(cb, ac.signal);
    loop.start();
    ctrl.tick(16);
    const before = cb.mock.calls.length;
    ac.abort();
    ctrl.tick(16);
    expect(cb.mock.calls.length).toBe(before);
  });

  it('first dt is zero', () => {
    const calls: number[] = [];
    const loop = createRafLoop((dt) => calls.push(dt));
    loop.start();
    ctrl.tick(16);
    expect(calls[0]).toBe(0);
    loop.stop();
  });

  it('pauses while document.hidden is true', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const cb = vi.fn();
    const loop = createRafLoop(cb);
    loop.start();
    ctrl.tick(16);
    ctrl.tick(16);
    expect(cb).not.toHaveBeenCalled();
    loop.stop();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test -- raf`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/lib/webgl/raf.ts
export interface RafLoop {
  start(): void;
  stop(): void;
}

export function createRafLoop(
  tick: (dtMs: number, tMs: number) => void,
  signal?: AbortSignal
): RafLoop {
  let id = 0;
  let running = false;
  let lastT: number | null = null;

  const frame = (t: number): void => {
    if (!running) return;
    if (document.hidden) {
      id = requestAnimationFrame(frame);
      return;
    }
    const dt = lastT === null ? 0 : t - lastT;
    lastT = t;
    tick(dt, t);
    id = requestAnimationFrame(frame);
  };

  const stop = (): void => {
    running = false;
    if (id) cancelAnimationFrame(id);
    id = 0;
    lastT = null;
  };

  if (signal) {
    if (signal.aborted) {
      // never start
    } else {
      signal.addEventListener('abort', stop, { once: true });
    }
  }

  return {
    start(): void {
      if (running) return;
      if (signal?.aborted) return;
      running = true;
      lastT = null;
      id = requestAnimationFrame(frame);
    },
    stop
  };
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- raf`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/webgl/raf.test.ts src/lib/webgl/raf.ts
git commit -m "feat(webgl): rAF loop with hidden-pause and AbortSignal"
```

---

## Task 8: Shared engine — `src/lib/webgl/context.ts` (no test, thin wrapper)

**Files:**
- Create: `src/lib/webgl/context.ts`

- [ ] **Step 1: Write `src/lib/webgl/context.ts`**

```ts
import type { AnyGL } from './types';

export interface ContextOpts {
  version: 1 | 2;
  antialias?: boolean;
  alpha?: boolean;
  depth?: boolean;
}

export function createContext(canvas: HTMLCanvasElement, opts: ContextOpts): AnyGL {
  const attribs: WebGLContextAttributes = {
    antialias: opts.antialias ?? true,
    alpha: opts.alpha ?? false,
    depth: opts.depth ?? true
  };
  if (opts.version === 2) {
    const gl2 = canvas.getContext('webgl2', attribs);
    if (gl2) return gl2;
  }
  const gl1 = canvas.getContext('webgl', attribs);
  if (!gl1) throw new Error('WebGL not supported');
  return gl1;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgl/context.ts
git commit -m "feat(webgl): createContext with WebGL2→1 fallback"
```

---

## Task 9: Audio Bus — `src/lib/audio/bus.ts` (TDD)

**Files:**
- Create: `tests/unit/audio/bus.test.ts`
- Create: `src/lib/audio/bus.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/audio/bus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioBus, getAudioBus } from '@/lib/audio/bus';
import { makeFakeAudio, advanceFakeAudio } from '../../fixtures/fake-audio';

function audioFactory() {
  return (ctx: AudioContext) => {
    const node = (ctx as unknown as { createGain(): { connect(): void; disconnect(): void } }).createGain();
    return { node: node as unknown as AudioNode };
  };
}

describe('AudioBus', () => {
  let fakeCtx: ReturnType<typeof makeFakeAudio>;
  let bus: AudioBus;

  beforeEach(() => {
    fakeCtx = makeFakeAudio();
    bus = new AudioBus(() => fakeCtx as unknown as AudioContext);
  });

  it('register is idempotent', () => {
    const f = audioFactory();
    bus.register('a', f);
    bus.register('a', f);
    expect(bus.has('a')).toBe(true);
  });

  it('activate creates ctx lazily on first call', async () => {
    expect(bus.hasContext()).toBe(false);
    bus.register('a', audioFactory());
    await bus.activate('a', 100);
    expect(bus.hasContext()).toBe(true);
  });

  it('activate fades new gain from 0 to 1 over duration', async () => {
    bus.register('a', audioFactory());
    await bus.activate('a', 600);
    const current = bus.current();
    expect(current).not.toBeNull();
    const ramps = (current as { gain: { ramps: Array<{ value: number; endTime: number }> } }).gain.ramps;
    expect(ramps[0].value).toBe(1);
    expect(ramps[0].endTime).toBeCloseTo(fakeCtx.currentTime + 0.6, 1);
  });

  it('activate(b) while active(a) fades a out and b in', async () => {
    bus.register('a', audioFactory());
    bus.register('b', audioFactory());
    await bus.activate('a', 100);
    const a = bus.current()!;
    await bus.activate('b', 600);
    const aRamps = (a as { gain: { ramps: Array<{ value: number }> } }).gain.ramps;
    expect(aRamps[aRamps.length - 1].value).toBe(0);
    const b = bus.current()!;
    expect(b).not.toBe(a);
    const bRamps = (b as { gain: { ramps: Array<{ value: number }> } }).gain.ramps;
    expect(bRamps[0].value).toBe(1);
  });

  it('deactivate fades current to 0', async () => {
    bus.register('a', audioFactory());
    await bus.activate('a', 100);
    const a = bus.current()!;
    await bus.deactivate(600);
    const aRamps = (a as { gain: { ramps: Array<{ value: number }> } }).gain.ramps;
    expect(aRamps[aRamps.length - 1].value).toBe(0);
    expect(bus.current()).toBeNull();
  });

  it('resume() resumes the underlying ctx', async () => {
    bus.register('a', audioFactory());
    await bus.activate('a', 0);
    await bus.resume();
    expect(fakeCtx.state).toBe('running');
  });

  it('disconnect old node after crossfade completes', async () => {
    const factoryA = vi.fn(audioFactory());
    bus.register('a', factoryA);
    bus.register('b', audioFactory());
    await bus.activate('a', 100);
    const a = bus.current()!;
    const disconnectSpy = vi.fn();
    (a as unknown as { node: { disconnect: typeof disconnectSpy } }).node.disconnect = disconnectSpy;
    await bus.activate('b', 100);
    advanceFakeAudio(fakeCtx, 200);
    await new Promise(r => setTimeout(r, 150));
    expect(disconnectSpy).toHaveBeenCalled();
  });
});

describe('getAudioBus singleton', () => {
  it('returns the same instance', () => {
    delete (window as { __audioBus__?: unknown }).__audioBus__;
    const a = getAudioBus();
    const b = getAudioBus();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test -- bus`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/lib/audio/bus.ts
export interface RoomAudio { node: AudioNode; tick?(): void; }
export type AudioFactory = (ctx: AudioContext) => RoomAudio;

interface Active {
  slug: string;
  node: AudioNode;
  gain: GainNode;
}

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: Active | null = null;
  private factories = new Map<string, AudioFactory>();
  private ctxFactory: () => AudioContext;

  constructor(ctxFactory: () => AudioContext = () => new AudioContext()) {
    this.ctxFactory = ctxFactory;
  }

  register(slug: string, factory: AudioFactory): void {
    this.factories.set(slug, factory);
  }

  has(slug: string): boolean { return this.factories.has(slug); }
  hasContext(): boolean { return this.ctx !== null; }
  current(): Active | null { return this.active; }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* user gesture missing */ }
    }
  }

  private ensureCtx(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = this.ctxFactory();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    this.master = master;
    return ctx;
  }

  async activate(slug: string, fadeMs = 600): Promise<void> {
    const factory = this.factories.get(slug);
    if (!factory) return;
    const ctx = this.ensureCtx();
    const master = this.master!;

    const { node } = factory(ctx);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(master);

    const fadeSec = fadeMs / 1000;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeSec);

    const previous = this.active;
    if (previous) {
      previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + fadeSec);
      setTimeout(() => {
        try { previous.node.disconnect(); previous.gain.disconnect(); } catch { /* idempotent */ }
      }, fadeMs + 50);
    }

    this.active = { slug, node, gain };
  }

  async deactivate(fadeMs = 600): Promise<void> {
    if (!this.active || !this.ctx) return;
    const fadeSec = fadeMs / 1000;
    const now = this.ctx.currentTime;
    const a = this.active;
    a.gain.gain.setValueAtTime(a.gain.gain.value, now);
    a.gain.gain.linearRampToValueAtTime(0, now + fadeSec);
    setTimeout(() => {
      try { a.node.disconnect(); a.gain.disconnect(); } catch { /* idempotent */ }
    }, fadeMs + 50);
    this.active = null;
  }
}

const GLOBAL_KEY = '__audioBus__';

export function getAudioBus(): AudioBus {
  const w = window as Window & { __audioBus__?: AudioBus };
  if (!w[GLOBAL_KEY]) {
    w[GLOBAL_KEY] = new AudioBus();
  }
  return w[GLOBAL_KEY]!;
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- bus`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/audio/bus.test.ts src/lib/audio/bus.ts
git commit -m "feat(audio): AudioBus singleton with crossfade and lazy ctx"
```

---

## Task 10: Preview reconciler — `src/lib/preview/reconciler.ts` (TDD)

**Files:**
- Create: `tests/unit/preview/reconciler.test.ts`
- Create: `src/lib/preview/reconciler.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/preview/reconciler.test.ts
import { describe, it, expect } from 'vitest';
import { decide, type ReconcilerInput } from '@/lib/preview/reconciler';

const base: ReconcilerInput = {
  inViewport: false,
  hovered: false,
  reducedMotion: false,
  smallScreen: false,
  currentState: 'idle'
};

describe('decide', () => {
  it('noop when nothing changes', () => {
    expect(decide(base)).toBe('noop');
  });

  it('mounts when in viewport + hovered + idle', () => {
    expect(decide({ ...base, inViewport: true, hovered: true })).toBe('mount');
  });

  it('does not mount when reducedMotion', () => {
    expect(decide({ ...base, inViewport: true, hovered: true, reducedMotion: true })).toBe('noop');
  });

  it('does not mount when smallScreen', () => {
    expect(decide({ ...base, inViewport: true, hovered: true, smallScreen: true })).toBe('noop');
  });

  it('does not mount when already running', () => {
    expect(decide({ ...base, inViewport: true, hovered: true, currentState: 'running' })).toBe('noop');
  });

  it('tears down when running and loses hover', () => {
    expect(decide({ ...base, inViewport: true, hovered: false, currentState: 'running' })).toBe('teardown');
  });

  it('tears down when running and scrolls out of viewport', () => {
    expect(decide({ ...base, inViewport: false, hovered: true, currentState: 'running' })).toBe('teardown');
  });

  it('tears down when running and reducedMotion becomes true', () => {
    expect(decide({ ...base, inViewport: true, hovered: true, reducedMotion: true, currentState: 'running' })).toBe('teardown');
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test -- reconciler`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/lib/preview/reconciler.ts
export interface ReconcilerInput {
  inViewport: boolean;
  hovered: boolean;
  reducedMotion: boolean;
  smallScreen: boolean;
  currentState: 'idle' | 'running';
}

export type ReconcilerOutput = 'mount' | 'teardown' | 'noop';

export function decide(i: ReconcilerInput): ReconcilerOutput {
  const shouldRun = i.inViewport && i.hovered && !i.reducedMotion && !i.smallScreen;
  if (shouldRun && i.currentState === 'idle') return 'mount';
  if (!shouldRun && i.currentState === 'running') return 'teardown';
  return 'noop';
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- reconciler`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/preview/reconciler.test.ts src/lib/preview/reconciler.ts
git commit -m "feat(preview): pure gating reconciler with truth-table tests"
```

---

## Task 11: Content Collection schema + room entries (TDD)

**Files:**
- Create: `src/content/config.ts`
- Create: `src/content/rooms/neural.yml`
- Create: `src/content/rooms/tunnel.yml`
- Create: `src/content/rooms/swarm.yml`
- Create: `tests/unit/content/schema.test.ts`
- Create: `tests/fixtures/bad-room.yml`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/content/schema.test.ts
import { describe, it, expect } from 'vitest';
import { roomSchema } from '@/content/config';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const ROOMS_DIR = resolve(process.cwd(), 'src/content/rooms');

describe('rooms schema', () => {
  it('all real room entries parse successfully and slug matches filename', () => {
    const files = readdirSync(ROOMS_DIR).filter(f => f.endsWith('.yml'));
    expect(files.length).toBe(3);
    for (const f of files) {
      const data = parse(readFileSync(resolve(ROOMS_DIR, f), 'utf8'));
      const parsed = roomSchema.parse(data);
      expect(f).toBe(`${parsed.slug}.yml`);
    }
  });

  it('rejects a malformed fixture', () => {
    const bad = parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/bad-room.yml'), 'utf8'));
    expect(() => roomSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Add `yaml` to dependencies**

Edit `package.json`, under `devDependencies` add: `"yaml": "^2.5.0"`.
Run: `npm install`
Expected: yaml installed.

- [ ] **Step 3: Run test — confirm failure**

Run: `npm test -- schema`
Expected: FAIL (`@/content/config` missing).

- [ ] **Step 4: Implement schema and entries**

```ts
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

export const roomSchema = z.object({
  slug: z.enum(['neural', 'tunnel', 'swarm']),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string(),
  tags: z.array(z.string()),
  year: z.number().int(),
  accent: z.enum(['cyan', 'purple', 'red']),
  hasAudio: z.boolean(),
  cardVisual: z.enum(['nodes', 'grid', 'map']),
  order: z.number().int()
});

const rooms = defineCollection({ type: 'data', schema: roomSchema });

export const collections = { rooms };
```

```yaml
# src/content/rooms/neural.yml
slug: neural
title: Attività Neuronale
subtitle: WebGL · 3D · Audio-reactive
description: Audio-reactive synaptic network rendered in WebGL. Microphone-driven spike events propagate through a 3D neural graph.
tags: [WebGL, Audio, Generative]
year: 2025
accent: purple
hasAudio: true
cardVisual: nodes
order: 1
```

```yaml
# src/content/rooms/tunnel.yml
slug: tunnel
title: Tunnel
subtitle: WebGL2 · Generative
description: Endless pixel tunnel. Drag up and down to control velocity. WebGL2 fragment shader, single quad.
tags: [WebGL2, Generative]
year: 2025
accent: cyan
hasAudio: false
cardVisual: grid
order: 2
```

```yaml
# src/content/rooms/swarm.yml
slug: swarm
title: Spider Web Swarm
subtitle: WebGL · Generative
description: Swarm of radial spider webs drifting through space. Quad-expanded line strands, all motion driven on the GPU.
tags: [WebGL, Generative]
year: 2025
accent: red
hasAudio: false
cardVisual: map
order: 3
```

```yaml
# tests/fixtures/bad-room.yml
slug: not-a-real-slug
title: 42
year: "twenty-five"
accent: blue
```

- [ ] **Step 5: Run test — confirm pass**

Run: `npm test -- schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/content tests/unit/content tests/fixtures/bad-room.yml package.json package-lock.json
git commit -m "feat(content): rooms collection schema with three entries and validation tests"
```

---

## Task 12: Room registry — `src/lib/rooms/registry.ts` (TDD, stubs for now)

**Files:**
- Create: `src/lib/rooms/registry.ts`
- Create: `src/lib/rooms/neural.ts` (stub)
- Create: `src/lib/rooms/tunnel.ts` (stub)
- Create: `src/lib/rooms/swarm.ts` (stub)
- Create: `tests/unit/rooms/registry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/rooms/registry.test.ts
import { describe, it, expect } from 'vitest';
import { rooms } from '@/lib/rooms/registry';

describe('registry', () => {
  it('every slug resolves to a module with a mount function', async () => {
    for (const [slug, loader] of Object.entries(rooms)) {
      const mod = await loader();
      expect(typeof mod.mount).toBe('function');
      expect(slug.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test -- registry`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement stubs**

```ts
// src/lib/rooms/neural.ts (stub — replaced in Task 19)
import type { RoomMount } from '@/lib/webgl/types';

export const mount: RoomMount = (_canvas, _opts) => {
  return () => { /* teardown */ };
};
```

```ts
// src/lib/rooms/tunnel.ts (stub — replaced in Task 18)
import type { RoomMount } from '@/lib/webgl/types';

export const mount: RoomMount = (_canvas, _opts) => {
  return () => { /* teardown */ };
};
```

```ts
// src/lib/rooms/swarm.ts (stub — replaced in Task 17)
import type { RoomMount } from '@/lib/webgl/types';

export const mount: RoomMount = (_canvas, _opts) => {
  return () => { /* teardown */ };
};
```

```ts
// src/lib/rooms/registry.ts
import type { RoomMount } from '@/lib/webgl/types';
import type { RoomAudio } from '@/lib/audio/bus';

export type RoomSlug = 'neural' | 'tunnel' | 'swarm';

export interface RoomModule {
  mount: RoomMount;
  createAudio?: (ctx: AudioContext) => RoomAudio;
}

export const rooms: Record<RoomSlug, () => Promise<RoomModule>> = {
  neural: () => import('./neural'),
  tunnel: () => import('./tunnel'),
  swarm:  () => import('./swarm')
};
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- registry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rooms tests/unit/rooms/registry.test.ts
git commit -m "feat(rooms): typed registry with stub modules"
```

---

## Task 13: View Transitions wiring — `src/lib/transitions/wiring.ts` (TDD)

**Files:**
- Create: `tests/unit/transitions/wiring.test.ts`
- Create: `src/lib/transitions/wiring.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/transitions/wiring.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wireTransitions } from '@/lib/transitions/wiring';
import { AudioBus } from '@/lib/audio/bus';
import { makeFakeAudio } from '../../fixtures/fake-audio';

function makeBus() {
  const fake = makeFakeAudio();
  const bus = new AudioBus(() => fake as unknown as AudioContext);
  bus.register('neural', (ctx) => ({ node: ctx.createGain() as unknown as AudioNode }));
  return { bus, fake };
}

describe('wireTransitions', () => {
  let detach: () => void;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/'),
      configurable: true
    });
  });

  it('dispatches deactivate(600) on astro:before-preparation when leaving a room', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'deactivate');
    Object.defineProperty(window, 'location', { value: new URL('http://localhost/rooms/neural'), configurable: true });
    detach = wireTransitions(bus, () => 'neural', () => true);
    document.dispatchEvent(new Event('astro:before-preparation'));
    expect(spy).toHaveBeenCalledWith(600);
    detach();
  });

  it('dispatches activate(slug, 600) on astro:after-swap for a room with audio', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'activate');
    detach = wireTransitions(bus, () => 'neural', () => true);
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(spy).toHaveBeenCalledWith('neural', 600);
    detach();
  });

  it('does not call activate on non-room route', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'activate');
    detach = wireTransitions(bus, () => null, () => false);
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(spy).not.toHaveBeenCalled();
    detach();
  });

  it('does not activate for a room without audio', () => {
    const { bus } = makeBus();
    const spy = vi.spyOn(bus, 'activate');
    detach = wireTransitions(bus, () => 'tunnel', () => false);
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(spy).not.toHaveBeenCalled();
    detach();
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test -- wiring`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/lib/transitions/wiring.ts
import type { AudioBus } from '@/lib/audio/bus';

export type SlugResolver = () => string | null;
export type AudioResolver = (slug: string) => boolean;

const FADE_MS = 600;

export function wireTransitions(
  bus: AudioBus,
  resolveSlug: SlugResolver,
  resolveHasAudio: AudioResolver
): () => void {
  const onBeforePrep = (): void => {
    void bus.deactivate(FADE_MS);
  };
  const onAfterSwap = (): void => {
    const slug = resolveSlug();
    if (!slug) return;
    if (!resolveHasAudio(slug)) return;
    void bus.activate(slug, FADE_MS);
  };

  document.addEventListener('astro:before-preparation', onBeforePrep);
  document.addEventListener('astro:after-swap', onAfterSwap);

  return () => {
    document.removeEventListener('astro:before-preparation', onBeforePrep);
    document.removeEventListener('astro:after-swap', onAfterSwap);
  };
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- wiring`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/transitions src/lib/transitions
git commit -m "feat(transitions): audio bus wiring with route/audio resolvers"
```

---

## Task 14: Styles — tokens.css, global.css, gallery.css

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `src/styles/gallery.css`

- [ ] **Step 1: Write `src/styles/tokens.css`** (lifted from `projects.html` lines 10–24)

```css
:root {
  --bg: #080b10;
  --surface: #0d1117;
  --surface2: #131920;
  --border: rgba(255,255,255,0.06);
  --border-bright: rgba(255,255,255,0.12);
  --accent: #00e5ff;
  --accent2: #7b61ff;
  --accent3: #ff4d6d;
  --text: #e2e8f0;
  --text-dim: #5a6a7a;
  --text-mid: #8899aa;
  --mono: 'DM Mono', monospace;
  --sans: 'Syne', sans-serif;
}
```

- [ ] **Step 2: Write `src/styles/global.css`** (reset, body, noise + grid overlays — from `projects.html` lines 26–58, 280–290)

```css
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  min-height: 100vh;
  overflow-x: hidden;
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 1000;
  opacity: 0.4;
}

body::after {
  content: '';
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(0,229,255,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,229,255,0.025) 1px, transparent 1px);
  background-size: 60px 60px;
  pointer-events: none;
  z-index: 0;
}

@keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { to { opacity: 1; } }
@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes statusPulse { 0%, 100% { box-shadow: 0 0 6px #22c55e; } 50% { box-shadow: 0 0 12px #22c55e; } }
```

- [ ] **Step 3: Write `src/styles/gallery.css`** — port the nav, hero, filter, grid, card, footer styles from `projects.html` lines 60–289 verbatim. Drop demo-specific overrides for cards #1–6; keep generic `.project-card`, `.card-*`, `.visual-*` rules. Treat as a translation of those lines into this file.

(Implementer: open `projects.html` and copy CSS rules from lines 60 through 289. Do not change selectors. Save as `src/styles/gallery.css`.)

- [ ] **Step 4: Verify build picks up styles**

Run: `npm run build`
Expected: build runs (may warn about missing pages — addressed next tasks).

- [ ] **Step 5: Commit**

```bash
git add src/styles
git commit -m "feat(styles): port tokens, global, and gallery CSS from reference"
```

---

## Task 15: Layout + Nav + Footer components

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/components/Nav.astro`
- Create: `src/components/Footer.astro`

- [ ] **Step 1: Write `src/components/Nav.astro`** (from `projects.html` lines 304–314)

```astro
---
interface Props {
  active?: 'home' | 'about';
}
const { active = 'home' } = Astro.props;
---
<nav>
  <a href="/" class="nav-logo">SOFA<span>/</span>WORKS</a>
  <ul class="nav-links">
    <li><a href="/" class:list={[active === 'home' && 'is-active']}>Index</a></li>
    <li><a href="/about" class:list={[active === 'about' && 'is-active']}>About</a></li>
  </ul>
  <div class="nav-badge">Human + AI coded · 2025</div>
</nav>
```

- [ ] **Step 2: Write `src/components/Footer.astro`** (from `projects.html` lines 443–446)

```astro
---
---
<footer>
  <div class="footer-copy">© 2025 SOFA/WORKS — All experiments operational</div>
  <div class="footer-status"><div class="status-dot"></div>All systems nominal</div>
</footer>
```

- [ ] **Step 3: Write `src/layouts/BaseLayout.astro`**

```astro
---
import { ClientRouter } from 'astro:transitions';
import Nav from '@/components/Nav.astro';
import Footer from '@/components/Footer.astro';
import '@/styles/tokens.css';
import '@/styles/global.css';
import '@/styles/gallery.css';

interface Props {
  title: string;
  active?: 'home' | 'about';
}
const { title, active = 'home' } = Astro.props;
---
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <link rel="icon" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Mono:ital,wght@0,300;0,400;1,300&display=swap" rel="stylesheet" />
  <ClientRouter />
</head>
<body>
  <Nav active={active} />
  <slot />
  <Footer />
</body>
</html>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/layouts src/components/Nav.astro src/components/Footer.astro
git commit -m "feat(ui): BaseLayout with Nav, Footer, and ClientRouter"
```

---

## Task 16: Hero + FilterBar + RoomCard + RoomCanvasPreview + home page

**Files:**
- Create: `src/components/Hero.astro`
- Create: `src/components/FilterBar.astro`
- Create: `src/components/RoomCard.astro`
- Create: `src/components/RoomCanvasPreview.astro`
- Create: `src/components/CardVisual.astro`
- Create: `src/scripts/room-preview.ts`
- Create: `src/pages/index.astro`

- [ ] **Step 1: Write `src/components/Hero.astro`** (from `projects.html` lines 317–327, copy stripped of fake metrics)

```astro
---
---
<section class="hero">
  <div class="hero-orb"></div>
  <div class="hero-eyebrow">// Human + AI coded experiments — 2025</div>
  <h1 class="hero-title">FROM<br><span class="dim">THE SOFA.</span><br><span class="accent">EXPERIMENTS IN MOTION.</span></h1>
  <p class="hero-sub">A small gallery of WebGL rooms. Hover any card to preview. Click to enter.</p>
</section>
```

- [ ] **Step 2: Write `src/components/FilterBar.astro`** (decorative, from `projects.html` lines 330–337)

```astro
---
---
<div class="filter-bar">
  <span class="filter-label">Filter:</span>
  <button class="filter-btn active" type="button" data-filter="all">All</button>
  <button class="filter-btn" type="button" data-filter="webgl">WebGL</button>
  <button class="filter-btn" type="button" data-filter="audio">Audio</button>
  <button class="filter-btn" type="button" data-filter="generative">Generative</button>
</div>
<script>
  // decorative only — clicking just swaps the active class
  const btns = document.querySelectorAll<HTMLButtonElement>('.filter-btn');
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  }));
</script>
```

- [ ] **Step 3: Write `src/components/CardVisual.astro`** — renders one of three reference visualizations behind the live canvas slot

```astro
---
interface Props { kind: 'nodes' | 'grid' | 'map' }
const { kind } = Astro.props;
---
{kind === 'nodes' && (
  <div class="visual-nodes" data-visual="nodes">
    <!-- SVG node graph rendered by inline script below for any [data-visual=nodes] -->
  </div>
)}
{kind === 'grid' && (
  <div class="visual-grid" data-visual="grid">
    {Array.from({ length: 32 }).map(() => <div class="visual-grid-cell"></div>)}
  </div>
)}
{kind === 'map' && (
  <div class="visual-map" data-visual="map">
    <div class="map-dot" style="top:40%;left:30%"><div class="map-ring" style="width:40px;height:40px;top:50%;left:50%;animation-delay:0s"></div></div>
    <div class="map-dot" style="top:55%;left:68%;background:var(--accent2);box-shadow:0 0 6px var(--accent2)"><div class="map-ring" style="width:30px;height:30px;top:50%;left:50%;border-color:rgba(123,97,255,0.3);animation-delay:0.7s"></div></div>
    <div class="map-dot" style="top:25%;left:55%;background:var(--accent);box-shadow:0 0 6px var(--accent)"><div class="map-ring" style="width:24px;height:24px;top:50%;left:50%;border-color:rgba(0,229,255,0.2);animation-delay:1.4s"></div></div>
  </div>
)}
<script>
  // Build SVG node graph(s) once
  const graphs = document.querySelectorAll<HTMLElement>('[data-visual="nodes"]');
  graphs.forEach(g => {
    if (g.dataset.built === '1') return;
    g.dataset.built = '1';
    const nodes = [{x:10,y:50},{x:25,y:20},{x:25,y:80},{x:45,y:40},{x:45,y:70},{x:65,y:25},{x:65,y:55},{x:80,y:45},{x:90,y:70},{x:90,y:20}];
    const edges: [number, number][] = [[0,1],[0,2],[1,3],[2,4],[3,5],[3,6],[4,6],[5,7],[6,7],[7,8],[7,9]];
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width','100%'); svg.setAttribute('height','100%'); svg.setAttribute('viewBox','0 0 100 100');
    svg.setAttribute('style','position:absolute;inset:0');
    edges.forEach(([a,b]) => {
      const l = document.createElementNS(NS,'line');
      l.setAttribute('x1', String(nodes[a].x)); l.setAttribute('y1', String(nodes[a].y));
      l.setAttribute('x2', String(nodes[b].x)); l.setAttribute('y2', String(nodes[b].y));
      l.setAttribute('stroke','rgba(0,229,255,0.15)'); l.setAttribute('stroke-width','0.5');
      svg.appendChild(l);
    });
    nodes.forEach((n,i) => {
      const c = document.createElementNS(NS,'circle');
      c.setAttribute('cx', String(n.x)); c.setAttribute('cy', String(n.y));
      c.setAttribute('r', i===7 ? '2.5' : '1.5');
      c.setAttribute('fill', i===7 ? '#00e5ff' : 'rgba(0,229,255,0.5)');
      svg.appendChild(c);
    });
    g.appendChild(svg);
  });

  // Animate grid cells (lifted from projects.html lines 482-494)
  const grids = document.querySelectorAll<HTMLElement>('[data-visual="grid"] .visual-grid-cell');
  grids.forEach(cell => {
    const v = Math.random();
    if (v > 0.8) cell.style.background = 'rgba(0,229,255,0.12)';
    else if (v > 0.6) cell.style.background = 'rgba(0,229,255,0.06)';
    cell.style.animationDelay = `${Math.random() * 2}s`;
  });
</script>
```

- [ ] **Step 4: Write `src/components/RoomCanvasPreview.astro`** — the live canvas overlaid on the static visual

```astro
---
interface Props { slug: 'neural' | 'tunnel' | 'swarm' }
const { slug } = Astro.props;
---
<canvas
  class="room-preview-canvas"
  data-room-preview={slug}
  transition:name={`room-canvas-${slug}`}
  aria-hidden="true"
></canvas>
<style>
  .room-preview-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 300ms;
    pointer-events: none;
  }
  .project-card:hover .room-preview-canvas { opacity: 1; }
</style>
```

- [ ] **Step 5: Write `src/components/RoomCard.astro`**

```astro
---
import CardVisual from './CardVisual.astro';
import RoomCanvasPreview from './RoomCanvasPreview.astro';

interface Props {
  slug: 'neural' | 'tunnel' | 'swarm';
  num: string;
  title: string;
  description: string;
  tags: string[];
  year: number;
  accent: 'cyan' | 'purple' | 'red';
  cardVisual: 'nodes' | 'grid' | 'map';
  span?: 'wide' | 'narrow' | 'third' | 'half' | 'full';
}
const { slug, num, title, description, tags, year, accent, cardVisual, span = 'third' } = Astro.props;
const tagClass = (i: number): string => i === 0 ? `tag t-${accent}` : 'tag';
---
<article class={`project-card card-${span}`} data-room-card={slug}>
  <div class="card-glow"></div>
  <div class="card-num">{num}</div>
  <div class="card-visual">
    <CardVisual kind={cardVisual} />
    <RoomCanvasPreview slug={slug} />
  </div>
  <div class="card-tags">
    {tags.map((t, i) => <span class={tagClass(i)}>{t}</span>)}
  </div>
  <a class="card-title" href={`/rooms/${slug}`} transition:name={`room-title-${slug}`}>{title}</a>
  <p class="card-desc">{description}</p>
  <div class="card-footer">
    <span class="card-year">{year}</span>
    <a class="card-arrow" href={`/rooms/${slug}`} aria-label={`Enter ${title}`}>↗</a>
  </div>
</article>
```

- [ ] **Step 6: Write `src/scripts/room-preview.ts`**

```ts
import { decide, type ReconcilerInput } from '@/lib/preview/reconciler';
import { rooms, type RoomSlug } from '@/lib/rooms/registry';
import type { RoomTeardown } from '@/lib/webgl/types';

const isRoomSlug = (s: string): s is RoomSlug => s === 'neural' || s === 'tunnel' || s === 'swarm';

function init(): void {
  const canvases = document.querySelectorAll<HTMLCanvasElement>('[data-room-preview]');
  if (!canvases.length) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smallScreen = matchMedia('(max-width: 640px)').matches;

  canvases.forEach(canvas => {
    const slugAttr = canvas.dataset.roomPreview ?? '';
    if (!isRoomSlug(slugAttr)) return;
    const slug: RoomSlug = slugAttr;
    const card = canvas.closest<HTMLElement>('[data-room-card]');
    if (!card) return;

    let inViewport = false;
    let hovered = false;
    let state: 'idle' | 'running' = 'idle';
    let teardown: RoomTeardown | null = null;
    let mountInFlight = false;

    const reconcile = async (): Promise<void> => {
      const input: ReconcilerInput = { inViewport, hovered, reducedMotion, smallScreen, currentState: state };
      const action = decide(input);
      if (action === 'mount' && !mountInFlight) {
        mountInFlight = true;
        try {
          const mod = await rooms[slug]();
          teardown = mod.mount(canvas, { quality: 'preview', audio: false });
          state = 'running';
        } finally {
          mountInFlight = false;
        }
      } else if (action === 'teardown' && teardown) {
        teardown();
        teardown = null;
        state = 'idle';
      }
    };

    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        inViewport = e.isIntersecting;
        void reconcile();
      }
    }, { rootMargin: '200px', threshold: 0.1 });
    io.observe(card);

    const onEnter = (): void => { hovered = true; void reconcile(); };
    const onLeave = (): void => { hovered = false; void reconcile(); };
    card.addEventListener('pointerenter', onEnter);
    card.addEventListener('pointerleave', onLeave);
    card.addEventListener('focusin', onEnter);
    card.addEventListener('focusout', onLeave);
  });
}

// Re-init after View Transitions navigate to the home page
document.addEventListener('astro:page-load', init);
init();
```

- [ ] **Step 7: Write `src/pages/index.astro`**

```astro
---
import { getCollection } from 'astro:content';
import BaseLayout from '@/layouts/BaseLayout.astro';
import Hero from '@/components/Hero.astro';
import FilterBar from '@/components/FilterBar.astro';
import RoomCard from '@/components/RoomCard.astro';

const all = await getCollection('rooms');
const sorted = all.sort((a, b) => a.data.order - b.data.order);

const spanFor = (i: number): 'wide' | 'narrow' | 'third' => {
  if (i === 0) return 'wide';
  if (i === 1) return 'narrow';
  return 'third';
};
---
<BaseLayout title="SOFA/WORKS — Gallery" active="home">
  <Hero />
  <FilterBar />
  <section class="projects">
    {sorted.map((entry, i) => (
      <RoomCard
        slug={entry.data.slug}
        num={String(i + 1).padStart(2, '0')}
        title={entry.data.title}
        description={entry.data.description}
        tags={entry.data.tags}
        year={entry.data.year}
        accent={entry.data.accent}
        cardVisual={entry.data.cardVisual}
        span={spanFor(i)}
      />
    ))}
  </section>
  <script>
    import '@/scripts/room-preview.ts';
  </script>
</BaseLayout>
```

- [ ] **Step 8: Run dev and verify visually**

Run: `npm run dev`
Expected: dev server starts on http://localhost:4321. Open in browser:
- Home page renders with the dark grid background, hero, filter bar, three cards (one wide, one narrow, one third).
- No console errors.
- Hovering each card shows the live preview canvas appearing (but the stub rooms in Task 12 are no-ops — so the canvas stays blank). This is expected until Tasks 17–19 ship the actual rooms.

Stop the dev server (Ctrl+C).

- [ ] **Step 9: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both pass.

- [ ] **Step 10: Commit**

```bash
git add src/components src/scripts/room-preview.ts src/pages/index.astro
git commit -m "feat(ui): home page with hero, filter, card grid, and preview gating"
```

---

## Task 17: Room `swarm` — refactor from `spiderweb-swarm.html` (TDD)

**Files:**
- Modify: `src/lib/rooms/swarm.ts`
- Create: `tests/unit/rooms/swarm.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/rooms/swarm.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@/lib/rooms/swarm';

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400 });
  Object.defineProperty(c, 'clientHeight', { get: () => 300 });
  return c;
}

describe('swarm.mount', () => {
  beforeEach(() => {
    // stub WebGL context on canvas
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, type: string): unknown {
      if (type === 'webgl' || type === 'webgl2') {
        return makeMinimalGL();
      }
      return null;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  it('returns a teardown function', () => {
    const canvas = makeCanvas();
    const td = mount(canvas, { quality: 'full', audio: false });
    expect(typeof td).toBe('function');
    td();
  });

  it('teardown disconnects the rAF loop', () => {
    const canvas = makeCanvas();
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const td = mount(canvas, { quality: 'preview', audio: false });
    td();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('preview mode allocates fewer strands than full', () => {
    const previewCalls = countDrawCalls('preview');
    const fullCalls = countDrawCalls('full');
    expect(previewCalls).toBeLessThan(fullCalls);
  });
});

function countDrawCalls(quality: 'preview' | 'full'): number {
  let count = 0;
  HTMLCanvasElement.prototype.getContext = function (type: string): unknown {
    if (type === 'webgl' || type === 'webgl2') {
      const gl = makeMinimalGL();
      const origDraw = gl.drawArrays;
      gl.drawArrays = (...args: unknown[]) => { count++; return origDraw?.(...args); };
      return gl;
    }
    return null;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  const canvas = makeCanvas();
  const td = mount(canvas, { quality, audio: false });
  // give the rAF microtask polyfill a tick to fire once
  return new Promise<number>(resolve => setTimeout(() => { td(); resolve(count); }, 50)) as unknown as number;
  // Note: this returns a Promise; the assertion will use await. Adjust the assertion in the test below if needed.
}

function makeMinimalGL(): Record<string, unknown> {
  // Minimal stub returning safe defaults for any method called on it.
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'getParameter') return () => null;
      if (prop === 'getExtension') return () => null;
      if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => true;
      if (prop === 'getShaderInfoLog' || prop === 'getProgramInfoLog') return () => '';
      if (prop === 'createBuffer' || prop === 'createShader' || prop === 'createProgram' || prop === 'createTexture' || prop === 'createFramebuffer' || prop === 'createRenderbuffer' || prop === 'createVertexArray') return () => ({});
      if (prop === 'getUniformLocation' || prop === 'getAttribLocation') return () => ({});
      if (typeof prop === 'string' && prop.toUpperCase() === prop) return 0; // constants
      return () => undefined;
    }
  });
}
```

Note for implementer: the third assertion (`expect(previewCalls).toBeLessThan(fullCalls)`) needs the test rewritten with async/await — adjust the test to:

```ts
  it('preview mode allocates fewer strands than full', async () => {
    const previewCalls = await countDrawCalls('preview');
    const fullCalls = await countDrawCalls('full');
    expect(previewCalls).toBeLessThan(fullCalls);
  });
```

and change `countDrawCalls` to `async function ... return new Promise<number>(...)`. This is the correct shape — make sure the test reflects it before committing.

- [ ] **Step 2: Run — confirm failure**

Run: `npm test -- swarm`
Expected: FAIL (stub `mount` returns no-op teardown that doesn't cancel rAF; preview vs full call counts are equal).

- [ ] **Step 3: Implement `src/lib/rooms/swarm.ts`**

Refactor the inline `<script>` from `spiderweb-swarm.html` into a typed module that:

1. Imports `createContext`, `compileShader`, `linkProgram`, `getUniforms` from `@/lib/webgl/*`.
2. Imports `observeResize` and `createRafLoop`.
3. Defines two quality constants:

```ts
const STRAND_COUNT = { preview: 24, full: 96 };
const WEB_COUNT    = { preview: 4,  full: 12 };
```

4. Exports a single `mount(canvas, opts)`:

```ts
import type { RoomMount } from '@/lib/webgl/types';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';

const STRAND_COUNT = { preview: 24, full: 96 } as const;
const WEB_COUNT    = { preview: 4,  full: 12 } as const;

export const mount: RoomMount = (canvas, opts) => {
  const gl = createContext(canvas, { version: 1, antialias: true, alpha: false }) as WebGLRenderingContext;
  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  // ── Shaders: copy strandVS and strandFS sources from spiderweb-swarm.html (the .join('\n') string arrays)
  const VS = `...VS source...`;
  const FS = `...FS source...`;
  const program = linkProgram(gl,
    compileShader(gl, gl.VERTEX_SHADER, VS),
    compileShader(gl, gl.FRAGMENT_SHADER, FS)
  );
  const u = getUniforms(gl, program, ['uTrans','uScale','uCos','uSin','uAlpha','uRes','uW','uCol'] as const);

  // ── Geometry/state setup: port the buffer creation, strand allocation, web pool logic
  // ── from spiderweb-swarm.html lines ~140-... using STRAND_COUNT[opts.quality] and WEB_COUNT[opts.quality]
  // ── Allocate ALL typed arrays here, OUTSIDE the rAF tick.
  // ── (Implementer: keep the structural logic identical; just type it and parameterize counts.)

  const stopResize = observeResize(canvas, (cssW, cssH) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    // any per-resize uniform updates here (e.g. gl.uniform2f(u.uRes, cssW, cssH))
  });

  const loop = createRafLoop((dtMs, tMs) => {
    // port the per-frame logic from the original script, calling gl.draw* per web
    // No new allocations inside this function — reuse the typed arrays from above.
  }, ac.signal);

  loop.start();

  return () => {
    ac.abort();
    loop.stop();
    stopResize();
    try { gl.deleteProgram(program); } catch { /* noop */ }
  };
};
```

Implementation guidance:
- Source for VS, FS, and the strand/web logic is in `spiderweb-swarm.html` lines ~26–600. Read top-to-bottom. The vertex shader is `strandVS`, the fragment shader is `strandFS`. They are arrays of source lines joined with `'\n'` — replace with template strings.
- The original allocates per-web `Float32Array`s for `aA`/`aB`/`aSide`/`aT`/`aBaseAlpha`. Allocate them up front based on `STRAND_COUNT[opts.quality]`.
- The web pool size becomes `WEB_COUNT[opts.quality]`.
- Replace any inline `setInterval` / `window.requestAnimationFrame` calls with `createRafLoop`.
- Replace `window.addEventListener('resize', ...)` with `observeResize`.
- Eliminate any `new` inside the rAF tick. Pre-allocate temp vectors at the closure scope.

- [ ] **Step 4: Run test — confirm pass**

Run: `npm test -- swarm`
Expected: all tests PASS.

- [ ] **Step 5: Visual verify**

Run: `npm run dev`, open http://localhost:4321/, hover the Swarm card.
Expected: a small spider-web swarm animates inside the card. No console errors. Hovering off pauses/tears down.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rooms/swarm.ts tests/unit/rooms/swarm.test.ts
git commit -m "feat(rooms): refactor swarm to typed module with shared engine"
```

---

## Task 18: Room `tunnel` — refactor from `pixel-tunnel.html` (TDD)

**Files:**
- Modify: `src/lib/rooms/tunnel.ts`
- Create: `tests/unit/rooms/tunnel.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/rooms/tunnel.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@/lib/rooms/tunnel';

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400 });
  Object.defineProperty(c, 'clientHeight', { get: () => 300 });
  HTMLCanvasElement.prototype.getContext = function (type: string): unknown {
    if (type === 'webgl2' || type === 'webgl') return makeProxyGL();
    return null;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return c;
}

function makeProxyGL(): Record<string, unknown> {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
      if (p === 'createShader' || p === 'createProgram' || p === 'createBuffer' || p === 'createVertexArray' || p === 'createTexture' || p === 'createFramebuffer') return () => ({});
      if (p === 'getUniformLocation' || p === 'getAttribLocation') return () => ({});
      if (typeof p === 'string' && p === p.toUpperCase()) return 0;
      return () => undefined;
    }
  });
}

describe('tunnel.mount', () => {
  it('returns a teardown that cancels rAF', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const canvas = makeCanvas();
    const td = mount(canvas, { quality: 'full', audio: false });
    td();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('attaches drag listeners that detach on teardown', () => {
    const canvas = makeCanvas();
    const addSpy = vi.spyOn(canvas, 'addEventListener');
    const removeSpy = vi.spyOn(canvas, 'removeEventListener');
    const td = mount(canvas, { quality: 'full', audio: false });
    expect(addSpy).toHaveBeenCalled();
    td();
    expect(removeSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test -- tunnel`
Expected: FAIL (stub doesn't cancel rAF or attach listeners).

- [ ] **Step 3: Implement**

Refactor `pixel-tunnel.html` inline `<script>` into `src/lib/rooms/tunnel.ts`. Structure mirrors swarm:

- `createContext(canvas, { version: 2, antialias: false, alpha: false, depth: false })` — pass version=2 (this demo requires WebGL2; throw a descriptive error if `gl instanceof WebGLRenderingContext` rather than WebGL2).
- Copy the VS (full-screen triangle) and FS (raymarched tunnel) source from `pixel-tunnel.html`.
- One fullscreen-quad attribute buffer (single allocation).
- A `quality` knob controls fragment iteration count (e.g. `MARCH_STEPS = { preview: 24, full: 48 }`) used as a uniform integer passed to the shader, OR as a `#define` injected into the FS source string per mount call. Inject via string replace before compile.
- Drag-to-speed: pointer event listeners on the canvas. Store the speed in a closure variable. Teardown removes them.
- Use `observeResize` and `createRafLoop`.
- The original samples pixels back to estimate curve coverage (lines ~50+); preserve that logic but allocate the `Uint8Array` once outside the rAF, sized for the largest expected dimension.
- Teardown calls `loop.stop()`, `stopResize()`, removes drag listeners, `gl.deleteProgram(program)`.

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- tunnel`
Expected: PASS.

- [ ] **Step 5: Visual verify**

Run: `npm run dev`. Hover the Tunnel card. Click into `/rooms/tunnel` (won't exist until Task 20 — temporarily verify just on the gallery card hover).
Expected: tunnel animates inside the card. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rooms/tunnel.ts tests/unit/rooms/tunnel.test.ts
git commit -m "feat(rooms): refactor tunnel to typed module"
```

---

## Task 19: Room `neural` — refactor from `neural-webgl.html` with audio (TDD)

**Files:**
- Modify: `src/lib/rooms/neural.ts`
- Create: `tests/unit/rooms/neural.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/rooms/neural.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mount, createAudio } from '@/lib/rooms/neural';
import { makeFakeAudio } from '../../fixtures/fake-audio';

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { get: () => 400 });
  Object.defineProperty(c, 'clientHeight', { get: () => 300 });
  HTMLCanvasElement.prototype.getContext = function (type: string): unknown {
    if (type === 'webgl' || type === 'webgl2') return makeProxyGL();
    return null;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return c;
}

function makeProxyGL(): Record<string, unknown> {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
      if (p === 'createShader' || p === 'createProgram' || p === 'createBuffer' || p === 'createTexture' || p === 'createFramebuffer' || p === 'createRenderbuffer' || p === 'createVertexArray') return () => ({});
      if (p === 'getUniformLocation' || p === 'getAttribLocation') return () => ({});
      if (typeof p === 'string' && p === p.toUpperCase()) return 0;
      return () => undefined;
    }
  });
}

describe('neural', () => {
  it('mount returns a teardown that cancels rAF', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const canvas = makeCanvas();
    const td = mount(canvas, { quality: 'full', audio: false });
    td();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('createAudio returns a node connected via gain chain', () => {
    const fake = makeFakeAudio();
    const { node } = createAudio(fake as unknown as AudioContext);
    expect(node).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test -- neural`
Expected: FAIL (`createAudio` not exported).

- [ ] **Step 3: Implement**

Refactor `neural-webgl.html` into `src/lib/rooms/neural.ts`:

- Same structure as swarm/tunnel for mount.
- Quality constants control synapse/neuron counts: `NEURON_COUNT = { preview: 48, full: 220 }`, `SPIKE_RATE = { preview: 0.2, full: 0.6 }`.
- Audio extraction: the original creates an `AudioContext`, a microphone source, an analyser, and uses `analyser.getByteFrequencyData` to drive spike events. Move that into:

```ts
import type { RoomAudio } from '@/lib/audio/bus';

interface SharedSpikeState { rms: number; }
const sharedState: SharedSpikeState = { rms: 0 };

export const createAudio = (ctx: AudioContext): RoomAudio => {
  // ask for microphone (mediaDevices.getUserMedia)
  // create a MediaStreamSource + AnalyserNode
  // route source -> analyser; do NOT connect to destination (analysis only)
  // expose tick() that reads getByteFrequencyData into a pre-allocated Uint8Array
  // and updates sharedState.rms

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  const bins = new Uint8Array(analyser.frequencyBinCount);

  // The bus expects a node; we connect a silent gain so the bus has something to disconnect.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  silent.connect(ctx.destination);

  let mediaStream: MediaStream | null = null;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    mediaStream = stream;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);
  }).catch(() => { /* permission denied — RMS stays 0, demo still runs */ });

  return {
    node: silent,
    tick() {
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i];
      sharedState.rms = Math.sqrt(sum / bins.length) / 255;
    }
  };
};

export const mount: RoomMount = (canvas, opts) => {
  // ... mount logic, reads sharedState.rms each frame to drive synaptic spikes
};
```

- The `mount` function's rAF tick reads `sharedState.rms` to drive spike rate. When `opts.audio === false` (card preview), the bus is never activated, so `sharedState.rms` stays at 0 — the demo still runs visually but without audio reactivity. Same module, no branching.
- Preserve the Italian title and HUD strings.
- Teardown stops the loop and the resize observer. The audio side is torn down by `AudioBus.deactivate()` which disconnects the silent gain.

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- neural`
Expected: PASS.

- [ ] **Step 5: Visual verify**

Run: `npm run dev`. Hover the Neural card on the home page.
Expected: synapse network animates inside the card (without audio). No console errors. Microphone permission is NOT requested (audio: false in preview).

- [ ] **Step 6: Commit**

```bash
git add src/lib/rooms/neural.ts tests/unit/rooms/neural.test.ts
git commit -m "feat(rooms): refactor neural with audio factory and shared rms state"
```

---

## Task 20: Room page `/rooms/[slug]` + RoomStage + AudioPrompt + room-stage script

**Files:**
- Create: `src/components/RoomStage.astro`
- Create: `src/components/AudioPrompt.astro`
- Create: `src/scripts/room-stage.ts`
- Create: `src/pages/rooms/[slug].astro`

- [ ] **Step 1: Write `src/components/RoomStage.astro`**

```astro
---
interface Props { slug: 'neural' | 'tunnel' | 'swarm'; }
const { slug } = Astro.props;
---
<canvas
  class="room-stage"
  data-room-stage={slug}
  transition:name={`room-canvas-${slug}`}
></canvas>
<style>
  .room-stage {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    display: block;
    z-index: 0;
    background: #000;
  }
</style>
```

- [ ] **Step 2: Write `src/components/AudioPrompt.astro`**

```astro
---
interface Props { slug: 'neural' | 'tunnel' | 'swarm'; }
const { slug } = Astro.props;
---
<div class="audio-prompt" data-audio-prompt={slug}>
  <button type="button" class="audio-prompt-btn">▶ Click to enable audio</button>
</div>
<style>
  .audio-prompt {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.72);
    z-index: 10;
    cursor: pointer;
  }
  .audio-prompt.is-dismissed { display: none; }
  .audio-prompt-btn {
    font-family: var(--mono);
    font-size: 13px;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: rgba(200,140,255,0.9);
    background: transparent;
    border: 1px solid rgba(180,80,255,0.4);
    padding: 14px 32px;
    cursor: pointer;
  }
  .audio-prompt-btn:hover { background: rgba(140,60,255,0.15); }
</style>
```

- [ ] **Step 3: Write `src/scripts/room-stage.ts`**

```ts
import { rooms, type RoomSlug } from '@/lib/rooms/registry';
import { getAudioBus } from '@/lib/audio/bus';
import type { RoomTeardown } from '@/lib/webgl/types';

const isRoomSlug = (s: string): s is RoomSlug => s === 'neural' || s === 'tunnel' || s === 'swarm';

let activeTeardown: RoomTeardown | null = null;

async function mountCurrent(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-room-stage]');
  if (!canvas) return;
  const slugAttr = canvas.dataset.roomStage ?? '';
  if (!isRoomSlug(slugAttr)) return;
  const slug: RoomSlug = slugAttr;
  const hasAudio = canvas.dataset.hasAudio === 'true';

  const mod = await rooms[slug]();
  activeTeardown = mod.mount(canvas, { quality: 'full', audio: hasAudio });

  if (hasAudio && mod.createAudio) {
    const bus = getAudioBus();
    bus.register(slug, mod.createAudio);

    const prompt = document.querySelector<HTMLElement>('[data-audio-prompt]');
    if (prompt) {
      prompt.addEventListener('click', async () => {
        await bus.resume();
        await bus.activate(slug, 600);
        prompt.classList.add('is-dismissed');
      }, { once: true });
    }
  }
}

function teardownCurrent(): void {
  if (activeTeardown) {
    activeTeardown();
    activeTeardown = null;
  }
}

document.addEventListener('astro:page-load', () => { void mountCurrent(); });
document.addEventListener('astro:before-swap', teardownCurrent);
```

- [ ] **Step 4: Write `src/pages/rooms/[slug].astro`**

```astro
---
import { getCollection, type CollectionEntry } from 'astro:content';
import BaseLayout from '@/layouts/BaseLayout.astro';
import RoomStage from '@/components/RoomStage.astro';
import AudioPrompt from '@/components/AudioPrompt.astro';

export async function getStaticPaths() {
  const all = await getCollection('rooms');
  return all.map((entry: CollectionEntry<'rooms'>) => ({
    params: { slug: entry.data.slug },
    props: { entry }
  }));
}

interface Props { entry: CollectionEntry<'rooms'>; }
const { entry } = Astro.props;
const d = entry.data;
---
<BaseLayout title={`${d.title} — SOFA/WORKS`}>
  <main class="room-page">
    <RoomStage slug={d.slug} />
    <header class="room-chrome room-chrome-top">
      <a class="room-back" href="/">← Index</a>
      <div class="room-meta">
        <h1 class="room-title" transition:name={`room-title-${d.slug}`}>{d.title}</h1>
        <p class="room-subtitle">{d.subtitle}</p>
      </div>
    </header>
    <aside class="room-info">
      <button type="button" class="room-info-toggle" aria-label="Info">i</button>
      <div class="room-info-panel">
        <p class="card-desc">{d.description}</p>
        <ul class="room-tags">{d.tags.map(t => <li>{t}</li>)}</ul>
        <p class="room-year">{d.year}</p>
      </div>
    </aside>
    {d.hasAudio && <AudioPrompt slug={d.slug} />}
  </main>
  <script>
    // Stamp hasAudio onto the canvas dataset so the stage script can read it
    document.querySelectorAll<HTMLCanvasElement>('[data-room-stage]').forEach(c => {
      c.dataset.hasAudio = String(/* injected from frontmatter — */ false);
    });
  </script>
  <script define:vars={{ hasAudio: d.hasAudio }}>
    document.querySelectorAll('[data-room-stage]').forEach((c) => {
      (c as HTMLElement).dataset.hasAudio = String(hasAudio);
    });
  </script>
  <script>
    import '@/scripts/room-stage.ts';
  </script>
</BaseLayout>
<style>
  .room-page { position: relative; }
  .room-chrome {
    position: fixed; z-index: 5;
    font-family: var(--mono);
    color: var(--text-mid);
  }
  .room-chrome-top {
    top: 0; left: 0; right: 0;
    padding: 20px 32px;
    display: flex; justify-content: space-between; align-items: flex-start;
    pointer-events: none;
  }
  .room-back, .room-meta, .room-info-toggle { pointer-events: auto; }
  .room-back {
    font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase;
    color: var(--text-mid); text-decoration: none;
    border: 1px solid var(--border); padding: 8px 14px;
    background: rgba(8,11,16,0.6); backdrop-filter: blur(8px);
  }
  .room-back:hover { color: var(--accent); border-color: var(--accent); }
  .room-meta { text-align: right; max-width: 50ch; }
  .room-title { font-family: var(--sans); font-size: clamp(18px, 3vw, 28px); font-weight: 800; letter-spacing: -0.02em; color: var(--text); }
  .room-subtitle { font-size: 10px; letter-spacing: 0.2em; color: var(--text-dim); text-transform: uppercase; margin-top: 4px; }
  .room-info {
    position: fixed; right: 24px; bottom: 24px; z-index: 5;
  }
  .room-info-toggle {
    width: 36px; height: 36px;
    border: 1px solid var(--border-bright); background: rgba(8,11,16,0.6); backdrop-filter: blur(8px);
    color: var(--text-mid); font-family: var(--mono); font-style: italic;
    cursor: pointer;
  }
  .room-info-toggle:hover { color: var(--accent); border-color: var(--accent); }
  .room-info-panel {
    position: absolute; bottom: 48px; right: 0;
    width: min(360px, 70vw);
    background: rgba(8,11,16,0.85); backdrop-filter: blur(12px);
    border: 1px solid var(--border);
    padding: 20px;
    display: none;
  }
  .room-info[data-open="true"] .room-info-panel { display: block; }
  .room-tags { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .room-tags li { font-family: var(--mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-dim); border: 1px solid var(--border); padding: 3px 8px; }
  .room-year { font-family: var(--mono); font-size: 10px; color: var(--text-dim); margin-top: 12px; }
</style>
<script>
  // Wire the info toggle
  document.addEventListener('astro:page-load', () => {
    const info = document.querySelector<HTMLElement>('.room-info');
    const btn = info?.querySelector<HTMLButtonElement>('.room-info-toggle');
    btn?.addEventListener('click', () => {
      const open = info!.dataset.open === 'true';
      info!.dataset.open = String(!open);
    });
  });
</script>
```

Remove the redundant first inline `<script>` in step 4 above — it was scaffolding. The `define:vars` script is the canonical one.

- [ ] **Step 5: Wire transitions in BaseLayout**

Edit `src/layouts/BaseLayout.astro`. Inside the `<head>` section, after `<ClientRouter />`, add this `is:inline` script so the audio bus is created once and the wiring is bound exactly once:

```astro
<script is:inline define:vars={{}}>
  // Bootstraps the singleton so it survives ClientRouter swaps.
  // The actual import lives in a module script below to use bundler resolution.
</script>
<script>
  import { getAudioBus } from '@/lib/audio/bus';
  import { wireTransitions } from '@/lib/transitions/wiring';

  const bus = getAudioBus();

  const resolveSlug = (): string | null => {
    const m = location.pathname.match(/^\/rooms\/([a-z-]+)/);
    return m ? m[1] : null;
  };

  const resolveHasAudio = (slug: string): boolean => {
    const el = document.querySelector<HTMLCanvasElement>(`[data-room-stage="${slug}"]`);
    return el?.dataset.hasAudio === 'true';
  };

  // Detach any previous binding (idempotent across ClientRouter swaps)
  const detachKey = '__sofaTransitionsDetach__' as const;
  const w = window as Window & { [detachKey]?: () => void };
  w[detachKey]?.();
  w[detachKey] = wireTransitions(bus, resolveSlug, resolveHasAudio);
</script>
```

- [ ] **Step 6: Visual verify**

Run: `npm run dev`. Navigate to http://localhost:4321/, click into a room from the gallery.

Expected:
- View Transition animates between gallery and room.
- Room renders full-bleed canvas with overlay chrome.
- Audio prompt shows only on Neural.
- Clicking audio prompt resumes the bus and starts the audio (microphone permission requested).
- Navigating back to gallery: audio fades out during the transition.
- Navigating Neural → Tunnel: audio fades out smoothly.

- [ ] **Step 7: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/RoomStage.astro src/components/AudioPrompt.astro src/scripts/room-stage.ts src/pages/rooms src/layouts/BaseLayout.astro
git commit -m "feat(rooms): full-bleed room pages with view transitions and audio bus wiring"
```

---

## Task 21: About page

**Files:**
- Create: `src/pages/about.astro`

- [ ] **Step 1: Write `src/pages/about.astro`**

```astro
---
import BaseLayout from '@/layouts/BaseLayout.astro';

const tech = ['Astro 5', 'TypeScript', 'WebGL / WebGL2', 'Web Audio API', 'Vitest', 'Playwright', 'View Transitions API'];
---
<BaseLayout title="About — SOFA/WORKS" active="about">
  <section class="about">
    <div class="hero-eyebrow">// About</div>
    <h1 class="about-title">Human + AI coded<br/><span class="dim">from the</span><br/><span class="accent">sofa.</span></h1>
    <div class="about-body">
      <p>SOFA/WORKS is a small, growing gallery of WebGL experiments. Each room is one idea, one canvas, one evening's worth of curiosity. No business case. No roadmap. Just looking for the shape of something interesting and saving it before it's gone.</p>
      <p>Hover any card to peek inside. Click to enter.</p>
    </div>
    <div class="about-tech">
      <div class="hero-eyebrow">// Built with</div>
      <ul class="tech-list">
        {tech.map(t => <li class="tag t-cyan">{t}</li>)}
      </ul>
    </div>
    <div class="about-contact">
      <div class="hero-eyebrow">// Contact</div>
      <p class="contact-line">lboriani@contents.com</p>
    </div>
  </section>
</BaseLayout>
<style>
  .about {
    padding: clamp(120px, 18vw, 180px) clamp(20px, 5vw, 48px) 80px;
    max-width: 880px;
    position: relative; z-index: 1;
  }
  .about-title {
    font-size: clamp(36px, 7vw, 80px); font-weight: 800;
    line-height: 0.95; letter-spacing: -0.03em; margin-bottom: 40px;
  }
  .about-title .dim { color: var(--text-dim); }
  .about-title .accent { color: var(--accent); }
  .about-body p { font-family: var(--mono); font-size: 13px; color: var(--text-mid); line-height: 1.8; max-width: 60ch; margin-bottom: 16px; }
  .about-tech, .about-contact { margin-top: 56px; padding-top: 32px; border-top: 1px solid var(--border); }
  .tech-list { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin-top: 20px; }
  .contact-line { font-family: var(--mono); font-size: 14px; color: var(--text); margin-top: 16px; }
</style>
```

- [ ] **Step 2: Visual verify**

Run: `npm run dev`, navigate to /about.
Expected: about page renders with manifesto, tech list, contact. Nav shows "About" highlighted.

- [ ] **Step 3: Commit**

```bash
git add src/pages/about.astro
git commit -m "feat(pages): about page with manifesto, tech list, contact"
```

---

## Task 22: Playwright smoke tests

**Files:**
- Create: `tests/e2e/home.spec.ts`
- Create: `tests/e2e/rooms.spec.ts`

- [ ] **Step 1: Install Playwright browsers**

Run: `npx playwright install chromium`
Expected: chromium downloaded.

- [ ] **Step 2: Write `tests/e2e/home.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('home renders three room cards with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.locator('[data-room-card]')).toHaveCount(3);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('hovering a card causes its preview canvas to draw at least one frame', async ({ page }) => {
  await page.goto('/');
  await page.addInitScript(() => {
    (window as unknown as { __drawCount: number }).__drawCount = 0;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]): RenderingContext | null {
      const ctx = (orig as unknown as (t: string, ...r: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      if (ctx && (type === 'webgl' || type === 'webgl2')) {
        const draw = (ctx as WebGLRenderingContext).drawArrays.bind(ctx);
        (ctx as WebGLRenderingContext).drawArrays = (...args) => { (window as unknown as { __drawCount: number }).__drawCount++; return draw(...args); };
      }
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.reload();
  const card = page.locator('[data-room-card="swarm"]');
  await card.hover();
  await page.waitForTimeout(800);
  const count = await page.evaluate(() => (window as unknown as { __drawCount: number }).__drawCount);
  expect(count).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Write `tests/e2e/rooms.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('clicking a card navigates into the room with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.locator('[data-room-card="tunnel"] a.card-title').click();
  await expect(page).toHaveURL(/\/rooms\/tunnel$/);
  await expect(page.locator('[data-room-stage="tunnel"]')).toBeVisible();
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('audio prompt appears only on neural room', async ({ page }) => {
  await page.goto('/rooms/tunnel');
  await expect(page.locator('[data-audio-prompt]')).toHaveCount(0);
  await page.goto('/rooms/neural');
  await expect(page.locator('[data-audio-prompt]')).toBeVisible();
});

test('navigation between rooms does not throw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/rooms/neural');
  await page.locator('.room-back').click();
  await expect(page).toHaveURL(/\/$/);
  await page.locator('[data-room-card="tunnel"] a.card-title').click();
  await expect(page).toHaveURL(/\/rooms\/tunnel$/);
  expect(errors, errors.join('\n')).toHaveLength(0);
});
```

- [ ] **Step 4: Run E2E**

Run: `npm run test:e2e`
Expected: all tests pass. (`webServer` in `playwright.config.ts` will run `astro build && astro preview` automatically.)

- [ ] **Step 5: Commit**

```bash
git add tests/e2e
git commit -m "test(e2e): playwright smoke tests for home, hover, navigation"
```

---

## Task 23: Final verification — typecheck, all tests, build, Lighthouse, visual

**Files:** none

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: passes with zero errors.

- [ ] **Step 2: All unit tests**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 3: E2E**

Run: `npm run test:e2e`
Expected: passes.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: builds without errors. `dist/` contains:
- `dist/index.html`
- `dist/about/index.html`
- `dist/rooms/neural/index.html`
- `dist/rooms/tunnel/index.html`
- `dist/rooms/swarm/index.html`
- Per-route JS chunks under `_astro/`.

- [ ] **Step 5: Preview and walk every route manually**

Run: `npm run preview`
Open http://localhost:4321/ in a real browser. Walk through:

1. Home loads, three cards, no console errors. No WebGL contexts created (DevTools → Memory: zero canvas contexts).
2. Hover swarm card → spider web swarm animates. Move cursor off → animation stops.
3. Hover neural card → neural network animates (no audio, no mic prompt).
4. Hover tunnel card → tunnel animates.
5. Click into tunnel → room page opens with View Transition, full-bleed canvas, drag-to-speed works.
6. Back to home, click into neural → audio prompt appears. Click prompt → microphone permission requested → audio activates, network reacts to sound.
7. Navigate neural → swarm via gallery → swarm room loads, audio fades to silence smoothly during the transition.
8. About page renders correctly.
9. Resize browser to mobile width → cards stack, live previews are disabled.
10. With OS reduced-motion on → live previews are disabled, no animations.

- [ ] **Step 6: Optional Lighthouse (skip if not in environment)**

Run: `npx lighthouse http://localhost:4321/ --only-categories=performance --output=json --output-path=./lighthouse-home.json`
Expected: performance score ≥ 90 on mobile preset with no hover.

- [ ] **Step 7: Final commit + tag**

```bash
git add -A
git status   # confirm clean / only intended files
git commit --allow-empty -m "chore: ship v0.1 — sofa gallery with 3 rooms"
git tag v0.1.0
```

Done. The gallery is live at `npm run preview`.

---

## Self-review (post-plan, before handoff)

**Spec coverage check:**
- Bootstrap order (scaffold + /init) → Tasks 1, 2 ✓
- TypeScript strict, path aliases → Task 1 ✓
- File structure with `tests/`, configs → Task 1, 3, 14 ✓
- Content Collection schema + 3 entries → Task 11 ✓
- Shared WebGL engine (types, shaders, resize, raf, context) → Tasks 4–8 ✓
- AudioBus singleton with crossfade → Task 9 ✓
- Preview reconciler (pure decide) → Task 10 ✓
- Room registry → Task 12 ✓
- View Transitions wiring → Task 13 + integrated in Task 20 ✓
- Styles (tokens, global, gallery) → Task 14 ✓
- BaseLayout, Nav, Footer → Task 15 ✓
- Hero, FilterBar, RoomCard, RoomCanvasPreview, CardVisual → Task 16 ✓
- Card preview gating script → Task 16 ✓
- Home page (index.astro) → Task 16 ✓
- Refactor swarm, tunnel, neural → Tasks 17–19 ✓
- Room page `/rooms/[slug]` + RoomStage + AudioPrompt + room-stage script → Task 20 ✓
- About page → Task 21 ✓
- Playwright smoke tests → Task 22 ✓
- Final verification & Lighthouse → Task 23 ✓
- TDD discipline (tests first) → Tasks 5, 6, 7, 9, 10, 11, 12, 13, 17, 18, 19 ✓

**Placeholder scan:**
- Task 17 step 3 has `const VS = "...VS source..."` and `// port the buffer creation...` — these are intentional references to the original file content that the implementer must copy. This is a known concession because pasting ~500 lines of WebGL into the plan would be unreadable. The instruction is precise enough: "open `spiderweb-swarm.html` lines ~26-600 and translate to TS". Same for tasks 18 and 19. Acceptable.
- No `TBD`, `fill in later`, `add error handling` strings found.

**Type consistency:**
- `RoomMount`, `RoomTeardown`, `RoomOptions`, `RoomQuality` — defined in Task 4 and consistently referenced in Tasks 12, 17, 18, 19, 20.
- `RoomSlug` — defined in Task 12, consistently used in Tasks 13, 16, 20.
- `AudioBus.activate(slug, ms)`, `deactivate(ms)`, `register(slug, factory)`, `resume()` — consistent across Tasks 9, 13, 20.
- `decide(input): 'mount' | 'teardown' | 'noop'` — consistent across Tasks 10, 16.
- `rooms` registry shape `Record<RoomSlug, () => Promise<RoomModule>>` — consistent across Tasks 12, 16, 20.

No gaps found.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-01-sofa-gallery.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
