# Sofa Gallery — Design Spec

**Date:** 2026-06-01
**Status:** Draft for user review

## Summary

An Astro + TypeScript site that hosts a gallery of "vibe-coded-from-the-sofa" interactive WebGL **rooms**. The look and feel is taken from `projects.html` (dark cyber/grid aesthetic, Syne + DM Mono typography), but copy and identity are personal — real rooms, no invented corporate metrics.

The first three rooms are refactored from the existing standalone files in the repo root:

- `neural-webgl.html` → `neural` (audio-reactive WebGL synapses)
- `pixel-tunnel.html` → `tunnel` (WebGL2 generative pixel tunnel)
- `spiderweb-swarm.html` → `swarm` (WebGL spider-web swarm)

## Goals

- A clean Astro 5 project structure with strict TypeScript everywhere.
- Each room's runtime is refactored from inline `<script>` into a typed module with a uniform `mount(canvas, opts): teardown` interface.
- Shared WebGL utilities (context, shaders, resize, RAF) extracted from the duplicated boilerplate across the three demos.
- Gallery cards show **live mini-canvas previews** of their rooms, gated by IntersectionObserver + hover, audio off.
- Audio **crossfades** between rooms via a singleton AudioBus coordinated with Astro View Transitions.
- Visual transitions between gallery and room pages animated by View Transitions API (`<ClientRouter />`).
- Lighthouse mobile performance ≥ 90 on the homepage with no hover activity.
- **TDD discipline** — every testable unit (shared engine, audio bus, gating reconciler, schema, transitions wiring) has its test written and failing before implementation. See **Testing** section below.

## Non-goals

- No real filtering on the filter bar (decorative only for now — categories are styled but don't hide cards).
- No CMS, no MDX bodies for rooms (frontmatter-only collection entries).
- No live preview audio in cards (audio is room-page only).
- No invented fictional metrics (no "40M events/day"-style copy).
- No live mini-canvases on mobile small screens if perf budget is tight (fallback: static first-frame). Decision deferred to implementation.

## Information architecture

| Route | Purpose |
|---|---|
| `/` | Gallery: hero + decorative filter bar + 3-card grid |
| `/about` | Manifesto + tech list + contact |
| `/rooms/[slug]` | Full-bleed room with overlay chrome (back, title, info toggle) |

Slugs: `neural`, `tunnel`, `swarm`.

## Identity & tone

- Personal voice. The site is "by Luca Boriani" (or chosen handle — placeholder in copy, easy to swap).
- Visual identity from `projects.html` is preserved: color tokens, typography, noise overlay, grid background, animated card glow, nav structure, footer status indicator.
- Brand wordmark in nav is a placeholder (`SOFA/WORKS` or similar — final wordmark TBD by the user; one-line change in `Nav.astro`).

### Filter bar

Decorative. Categories: `All / WebGL / Audio / Generative`. `All` is active; clicking others highlights visually but does not hide cards (current count of three makes real filtering pointless and visually awkward). The interaction shell is in place so real filtering can be turned on later by flipping a single flag.

## Tech stack

- **Astro 5** — static site with View Transitions (`<ClientRouter />`).
- **TypeScript strict** — `strict: true`, `noImplicitAny: true`, `noUnusedLocals`, `noUnusedParameters`. Path aliases `@/lib`, `@/components`, `@/styles`.
- **Content Collections** — typed `rooms` collection with Zod schema, YAML entries.
- **No JS framework** — `.astro` components + plain TS modules. No React/Vue/Svelte (zero need for this scope, smaller bundle).
- **Styling** — plain CSS with custom properties in `src/styles/tokens.css`. Lifted directly from `projects.html`. No Tailwind, no preprocessor.
- **Build target** — modern browsers (no IE/legacy WebGL1-only constraints). WebGL2 where the original used it (`tunnel`), WebGL1 where the original used it (`neural`, `swarm`).

## Bootstrap order

The implementation plan must start with these two steps, in this order, before any feature work:

1. **Scaffold the Astro project** in `/Users/lucaboriani/Sites/sofa` (with TypeScript strict mode and the file layout below).
2. **Run `/init`** to generate `CLAUDE.md` with codebase documentation for the freshly-scaffolded project. This ensures future sessions in this directory have project context loaded automatically.

All subsequent work (test scaffolding, shared engine, rooms, pages) builds on top of these two foundations.

## File structure

```
sofa/
├─ astro.config.mjs
├─ tsconfig.json                  # strict TS, path aliases
├─ vitest.config.ts               # JSDOM env, path aliases mirrored
├─ playwright.config.ts           # e2e smoke tests against astro preview
├─ package.json
├─ public/
│  └─ favicon.svg
├─ tests/
│  ├─ unit/                       # vitest unit tests, mirror src/ structure
│  │  ├─ webgl/
│  │  ├─ audio/
│  │  ├─ preview/
│  │  ├─ transitions/
│  │  ├─ rooms/
│  │  └─ content/
│  ├─ fixtures/                   # malformed YAML fixtures, fake GL records, etc.
│  └─ e2e/                        # playwright smoke tests
└─ src/
   ├─ content/
   │  ├─ config.ts                # defineCollection('rooms', { schema })
   │  └─ rooms/
   │     ├─ neural.yml
   │     ├─ tunnel.yml
   │     └─ swarm.yml
   ├─ pages/
   │  ├─ index.astro              # Gallery (home)
   │  ├─ about.astro
   │  └─ rooms/[slug].astro       # getStaticPaths from collection
   ├─ layouts/
   │  └─ BaseLayout.astro         # html shell, fonts, nav, footer, <ClientRouter />, AudioBus init
   ├─ components/
   │  ├─ Nav.astro
   │  ├─ Footer.astro
   │  ├─ Hero.astro
   │  ├─ FilterBar.astro          # decorative
   │  ├─ RoomCard.astro
   │  ├─ RoomCanvasPreview.astro  # in-card live preview (client island)
   │  ├─ RoomStage.astro          # full-bleed canvas on /rooms/[slug]
   │  └─ AudioPrompt.astro        # "click to enable audio" overlay (only if hasAudio)
   ├─ scripts/                    # client-side TS, imported by <script> in .astro
   │  ├─ room-preview.ts          # IO + hover gating for card previews
   │  └─ room-stage.ts            # mount/teardown on the room page
   ├─ lib/
   │  ├─ webgl/
   │  │  ├─ context.ts            # createContext
   │  │  ├─ shaders.ts            # compileShader, linkProgram, getUniforms<T>
   │  │  ├─ resize.ts             # observeResize (ResizeObserver, DPR-capped)
   │  │  ├─ raf.ts                # createRafLoop (pauses on document.hidden, AbortSignal)
   │  │  └─ types.ts              # RoomMount, RoomTeardown, RoomOptions
   │  ├─ audio/
   │  │  └─ bus.ts                # AudioBus singleton (window-scoped)
   │  ├─ preview/
   │  │  └─ reconciler.ts         # pure gating state machine (testable without DOM)
   │  ├─ transitions/
   │  │  └─ wiring.ts             # binds astro:before-preparation / after-swap to AudioBus
   │  └─ rooms/
   │     ├─ registry.ts           # slug → () => import('./<slug>') (typed)
   │     ├─ neural.ts
   │     ├─ tunnel.ts
   │     └─ swarm.ts
   └─ styles/
      ├─ tokens.css                # CSS custom properties (colors, fonts)
      ├─ global.css                # reset, body, noise + grid overlays
      └─ gallery.css               # gallery-specific (filter bar, grid, cards)
```

## Content Collection: `rooms`

```ts
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const rooms = defineCollection({
  type: 'data',
  schema: z.object({
    slug: z.enum(['neural', 'tunnel', 'swarm']),
    title: z.string(),
    subtitle: z.string().optional(),
    description: z.string(),
    tags: z.array(z.string()),
    year: z.number().int(),
    accent: z.enum(['cyan', 'purple', 'red']),
    hasAudio: z.boolean(),
    cardVisual: z.enum(['nodes', 'grid', 'map']),  // which reference viz to render in the card frame around the live canvas
    order: z.number().int(),
  }),
});

export const collections = { rooms };
```

Example entry:

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

## Runtime contracts

```ts
// src/lib/webgl/types.ts
export type RoomQuality = 'preview' | 'full';

export interface RoomOptions {
  quality: RoomQuality;          // 'preview' → reduced particle/segment counts
  audio: boolean;                // false in card previews; true on /rooms/[slug] when user enables
  signal?: AbortSignal;
}

export type RoomTeardown = () => void;
export type RoomMount = (canvas: HTMLCanvasElement, opts: RoomOptions) => RoomTeardown;
```

Each room module:

```ts
// src/lib/rooms/<slug>.ts
import type { RoomMount } from '@/lib/webgl/types';
export const mount: RoomMount = (canvas, opts) => { /* … */ return teardown; };
export const createAudio = (ctx: AudioContext) => ({ node, tick? });  // only when hasAudio
```

Typed registry:

```ts
// src/lib/rooms/registry.ts
import type { RoomMount } from '@/lib/webgl/types';

export type RoomSlug = 'neural' | 'tunnel' | 'swarm';

export interface RoomModule {
  mount: RoomMount;
  createAudio?: (ctx: AudioContext) => { node: AudioNode; tick?(): void };
}

export const rooms: Record<RoomSlug, () => Promise<RoomModule>> = {
  neural: () => import('./neural'),
  tunnel: () => import('./tunnel'),
  swarm:  () => import('./swarm'),
};
```

All three modules conform to `RoomModule`; the registry is a `Record<RoomSlug, () => Promise<RoomModule>>` so the import type is uniform regardless of which module is loaded.

## Shared WebGL engine

`src/lib/webgl/` extracts the boilerplate currently repeated across the three HTML demos:

- `context.ts` — `createContext(canvas, { version: 1 | 2, antialias, alpha, depth })`. Falls back to WebGL1 if WebGL2 requested but unavailable (matches what `tunnel` already does inline).
- `shaders.ts` — `compileShader(gl, type, source)` throws with a useful error including the info log; `linkProgram(gl, vs, fs)` ditto; `getUniforms<T extends readonly string[]>(gl, program, names: T): Record<T[number], WebGLUniformLocation>` — typed name → location map.
- `resize.ts` — `observeResize(canvas, gl, onResize?): () => void`. Uses `ResizeObserver` rather than `window.resize`. Caps `devicePixelRatio` (default 2) for perf.
- `raf.ts` — `createRafLoop(tick: (dtMs, tMs) => void, signal?: AbortSignal): { start, stop }`. Pauses automatically while `document.hidden` is true. Aborts on signal.

Room modules import these and focus on their unique scene logic.

## Audio Bus

`src/lib/audio/bus.ts` — a singleton attached to `window` so it survives Astro's View Transition DOM swaps.

```ts
class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: { slug: string; node: AudioNode; gain: GainNode } | null = null;
  private factories = new Map<string, (ctx: AudioContext) => { node: AudioNode; tick?(): void }>();

  register(slug: string, factory): void
  async activate(slug: string, fadeMs = 600): Promise<void>   // crossfade out current → in new
  async deactivate(fadeMs = 600): Promise<void>               // fade out to silence
  resume(): Promise<void>                                     // call after user gesture
}
```

Properties:

- **Lazy**: `AudioContext` created on first `activate()` (after a user gesture). Homepage never instantiates it.
- **Persistent**: lives on `window.__audioBus__`. `BaseLayout` initializes it via `is:inline` `<script>` so the singleton is created exactly once and survives `<ClientRouter />` navigation.
- **Crossfade**: `linearRampToValueAtTime` on individual gains. Old node disconnected after fade-out completes.

## View Transitions wiring

`<ClientRouter />` is included in `BaseLayout`. `src/lib/transitions/wiring.ts` binds the audio bus to navigation events:

| Event | Action |
|---|---|
| `astro:before-preparation` | start `AudioBus.deactivate(600)` (non-blocking) — fades current audio to silence |
| `astro:before-swap` | call current room stage's `teardown()` |
| `astro:after-swap` | mount new room stage if on `/rooms/[slug]`; if `hasAudio` and bus is resumed, `AudioBus.activate(slug, 600ms)` |
| `astro:page-load` | (no-op for this design — audio activation happens on swap; visuals are handled by VT API) |

**Element-level transitions:**

- `transition:name="room-canvas-{slug}"` on both the gallery card canvas and the room stage canvas → the small preview literally morphs into the full-bleed stage.
- `transition:name="room-title-{slug}"` on the card title and the room page title.
- Other elements use the default cross-fade.

## Card preview gating

`src/scripts/room-preview.ts`, included once on the home page:

```
For each [data-room] canvas:
  state: 'idle' | 'running'
  inViewport = false
  hovered = false
  teardown: RoomTeardown | null = null

  IntersectionObserver({ rootMargin: '200px', threshold: 0.1 })
    → inViewport = entry.isIntersecting

  card.addEventListener('pointerenter' | 'focusin', () => hovered = true)
  card.addEventListener('pointerleave' | 'focusout', () => hovered = false)

  reconcile():
    shouldRun = inViewport && hovered
                && !matchMedia('(prefers-reduced-motion: reduce)').matches
                && !matchMedia('(max-width: 640px)').matches    // mobile fallback decision
    if shouldRun && state === 'idle':
      const mod = await rooms[slug]()
      teardown = mod.mount(canvas, { quality: 'preview', audio: false })
      state = 'running'
    if !shouldRun && state === 'running':
      teardown?.(); teardown = null; state = 'idle'
```

Net result on the homepage:

- Zero WebGL contexts at page load.
- Hover one card → exactly one context spins up.
- Move cursor to another card → previous tears down before next mounts.
- Scroll a hovered card off-screen → tears down (defensive).
- `prefers-reduced-motion` users see static frames or nothing (zero contexts).

A static first-frame snapshot (PNG, ~10KB) is rendered behind each canvas as a placeholder. This is what users see before/after live preview.

## Room page (`/rooms/[slug]`)

Full-bleed canvas, minimal overlay chrome:

- **Top-left**: back-to-gallery link (`← /`), styled like nav.
- **Top-right**: room title + tags (faded).
- **Bottom-right**: small `i` button — toggles a sliding panel with description, year, tech, source link.
- **Audio overlay** (only if `hasAudio`): the existing "▶ Click to enable audio" pattern from `neural-webgl.html`, but as a shared `<AudioPrompt>` component. On click: `AudioBus.resume()` then `AudioBus.activate(slug)`.

`src/scripts/room-stage.ts`:

```
On page load (and astro:page-load):
  if (location.pathname.startsWith('/rooms/')):
    const slug = parsePathSlug()
    const mod = await rooms[slug]()
    const canvas = document.querySelector('[data-room-stage]')
    teardown = mod.mount(canvas, { quality: 'full', audio: hasAudio })
    if (hasAudio) wire up AudioPrompt → bus

On astro:before-swap:
  teardown?.()
```

## Room refactor strategy

For each of the three files, the conversion is:

1. **Extract logic** from inline `<script>` into `src/lib/rooms/<slug>.ts`, structured as one exported `mount(canvas, opts)` function returning a teardown. No top-level side effects — all state lives in the closure scope of `mount`.
2. **Type everything** — uniform locations, attribute locations, buffer layouts. Use `getUniforms()` helper for typed uniform records. Strict TS, no `any`.
3. **Replace boilerplate** with the shared engine — resize handler, RAF, context creation.
4. **Add `quality: 'preview'`** — each scene exposes constants like `PARTICLE_COUNT`, `SEGMENT_COUNT`, `STRAND_COUNT`. Preview mode picks ~1/4 of each at mount time (not branched per frame).
5. **Audio extraction (Neural only)** — existing audio code moves into `createAudio(ctx)`. Triggered by `AudioBus.activate('neural')` after user gesture via the shared `<AudioPrompt>` overlay.
6. **Italian title preserved** — "Attività Neuronale" stays as Neural's title (distinctive, intentional). HUD strings inside the room ("Sinapsi attive") are kept as-is per personal/playful tone.
7. **Per-room performance audit** — line-by-line read of each original file; flag and fix only what is measurably wrong (allocations in RAF, redundant matrix work, uncached `getUniformLocation`, missed `bindBuffer` reuse). Don't speculate. Don't golf.

## Performance plan

- Static build (`astro build`) — three room routes are pre-rendered HTML.
- Per-route code splitting — each `/rooms/[slug]` ships only its own room module; homepage ships only the registry + preview gating script (the room modules themselves are dynamic-imported on hover).
- Zero WebGL contexts on idle homepage.
- One WebGL context max at any time on the homepage (single-hover invariant).
- `prefers-reduced-motion` and small-screen breakpoints disable live previews.
- `document.hidden` pauses all RAF loops via the shared `raf.ts` helper.
- AudioContext is lazy; not created until first audio-enabled activation.

**Targets:**

- Homepage Lighthouse mobile perf ≥ 90 with no hover.
- Room page Time-To-Interactive < 1.5s on a mid-range laptop.
- No allocations inside RAF tick (zero-GC steady state in the room pages).

## Testing

Implementation is **TDD-driven**: every unit listed below has its test written and failing before the code is implemented. The shared engine, the audio bus, the preview gating reconciler, and the content schema are all designed to be testable as pure(ish) units. Visual/WebGL rendering correctness is verified manually in a real browser (it is not economic to unit-test pixel output).

### Test stack

- **Vitest** — unit + integration tests. Fast, native TS, no Jest config friction.
- **JSDOM** — DOM environment for component-adjacent tests (IntersectionObserver, pointer events). IO/pointer/resize APIs polyfilled or stubbed per test as needed.
- **happy-dom** considered if JSDOM perf becomes an issue (unlikely at this scale).
- **Playwright** — a small set of end-to-end smoke tests (1 per page + 1 cross-page navigation with audio).
- **`@vitest/coverage-v8`** — coverage report in CI (no enforced threshold initially; signal, not gate).
- WebGL is mocked at the `gl: WebGLRenderingContext` interface seam — the engine functions accept the context as a parameter, so tests pass a hand-rolled fake that records calls.

### What is unit-tested (TDD)

**`src/lib/webgl/shaders.ts`**
- `compileShader` returns the shader on success.
- `compileShader` throws including `getShaderInfoLog` text on failure.
- `linkProgram` throws on link failure with the info log.
- `getUniforms(['uA','uB'])` returns `{ uA, uB }` with the locations from the fake GL.
- `getUniforms` throws if any requested uniform is missing (catches typos at startup, not at frame 1).

**`src/lib/webgl/resize.ts`**
- `observeResize` calls `onResize` once on initial observation.
- DPR is capped at 2 by default.
- Cleanup unobserves the element (verifiable via a stub `ResizeObserver`).

**`src/lib/webgl/raf.ts`**
- `createRafLoop` calls `tick` with monotonically increasing `tMs`.
- Pauses when `document.hidden` becomes true; resumes on `visibilitychange`.
- `stop()` halts the loop; calling `tick` after `stop` does not happen.
- `AbortSignal.abort()` also stops the loop.
- `dtMs` for the first call is small/zero, not garbage from `performance.now()` baseline.

**`src/lib/audio/bus.ts`** — the highest-value tests, since this is shared mutable state across navigations.
- `register(slug, factory)` is idempotent.
- `activate(slug)` with no current room: instantiates context lazily, runs the factory, fades from 0 → 1 on the new gain over the configured duration.
- `activate(b)` with active `a`: fades `a.gain` to 0 over duration and `b.gain` from 0 to 1 in parallel; after duration, `a.node.disconnect()` was called.
- `deactivate()` fades current to 0 and disconnects.
- `resume()` calls `ctx.resume()` and is safe to call multiple times.
- The singleton lookup (`window.__audioBus__`) returns the same instance across calls (simulates surviving a View Transition).
- Tests use a fake `AudioContext` whose `createGain()` records `linearRampToValueAtTime` calls; assertions check ramp targets and timestamps, not real audio.

**`src/scripts/room-preview.ts`** — gating logic extracted into a pure reconciler function for testability:

```ts
// src/lib/preview/reconciler.ts
export type ReconcilerInput = {
  inViewport: boolean;
  hovered: boolean;
  reducedMotion: boolean;
  smallScreen: boolean;
  currentState: 'idle' | 'running';
};
export type ReconcilerOutput = 'mount' | 'teardown' | 'noop';
export const decide = (i: ReconcilerInput): ReconcilerOutput => { ... }
```

Tests cover the full truth table: `mount` only when `inViewport && hovered && !reducedMotion && !smallScreen && state==='idle'`; `teardown` only when `state==='running'` and the predicate goes false; otherwise `noop`. This makes the gating logic reviewable and bug-resistant without DOM.

The DOM-bound part of `room-preview.ts` (event wiring + IntersectionObserver) is covered by one JSDOM integration test that dispatches synthetic pointer/IO events and asserts `mount`/`teardown` invocations on a stubbed registry.

**`src/lib/rooms/registry.ts`**
- All declared slugs resolve to a module that exports a `mount` function with the right shape.
- Registry keys match the Zod enum in the content schema (prevents drift between schema and registry — a failing test forces them to be kept in sync).

**`src/content/config.ts`**
- Parsing each real `src/content/rooms/*.yml` against the schema succeeds.
- A malformed fixture (missing `slug`, wrong `accent`, etc.) is rejected with a useful error.
- `slug` field on entry equals the filename (catches typos).

**`src/lib/transitions/wiring.ts`**
- Dispatching a synthetic `astro:before-preparation` event causes `AudioBus.deactivate(600)` to be called (when current path is a room page).
- Dispatching `astro:after-swap` on a room route with `hasAudio: true` calls `AudioBus.activate(slug, 600)`.
- Wiring does not call audio methods for non-room routes.

### Per-room tests

For each of the three rooms, a thin behavioral test:
- `mount(canvas, opts)` returns a function (the teardown).
- Calling teardown disconnects all GL programs (verifiable via fake GL recording `deleteProgram` calls) and cancels the RAF loop.
- `quality: 'preview'` mounts faster (lower particle count visible as fewer attribute buffer writes — assert via fake GL call count is below a threshold). This isn't a perf test; it's a regression guard that "preview" actually picks the smaller constants.
- `createAudio(ctx)` (Neural only) returns a node connected to a destination-bound chain when given a fake `AudioContext`.

### What is NOT unit-tested

- Actual WebGL pixel output. Visual regression would require a real GPU + screenshot diff (Playwright `expect(page).toHaveScreenshot()` is an option later but not in v1 — high cost, low signal for creative animations).
- Audio waveform output. We test gain ramp scheduling, not what comes out of the speakers.
- Real `ResizeObserver` / `IntersectionObserver` browser behavior — we trust the platform.

### End-to-end smoke tests (Playwright)

Small set — these run against `astro preview`:

1. Home loads, three cards present, no console errors, no WebGL contexts initially (assert via `page.evaluate` checking `WebGL2RenderingContext.prototype.drawArrays` not called via a counter shim).
2. Hover a card → canvas reports having drawn at least one frame within 1s.
3. Click into `/rooms/neural` → page renders, audio prompt visible.
4. Click "enable audio" → `AudioBus.activate('neural')` ran (assert via global counter set by test hook).
5. Navigate `/rooms/neural` → `/rooms/tunnel` → `astro:before-preparation` fired, `AudioBus.deactivate` called, then `astro:after-swap` fired (no audio for tunnel). No console errors.

### CI

A single `npm test` runs vitest + a `playwright test` step. `astro check` runs first as a typecheck gate. No coverage gates initially.

## Verification

- `npm test` clean (vitest + playwright smoke).
- `astro check` and `tsc --noEmit` clean.
- Manual visual verification in a real browser:
  - Home loads, three cards render with static placeholders, no console errors, no WebGL contexts.
  - Hovering each card spins up its preview; leaving tears it down.
  - Click into a room: View Transition animates, full-bleed canvas mounts, audio overlay appears only on Neural.
  - Audio crossfade: navigate Neural → tunnel; Neural's audio fades out smoothly, no abrupt cut.
  - Back to gallery: View Transition reverses, audio fades to silence.
- Lighthouse run on home and one room page; record results in PR.

## Open items (not blocking)

- Final wordmark/handle (placeholder `SOFA/WORKS` used until decided — single string in `Nav.astro`).
- Final about-page copy (manifesto wording placeholder).
- Whether to keep mobile live-preview off entirely or attempt at lower quality — defer to first measurement.
- Static first-frame placeholder PNGs — generated by running each room briefly and capturing — implementation detail of the plan.
