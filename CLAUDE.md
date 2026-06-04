# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**SOFA/WORKS** — a personal Astro + TypeScript gallery hosting interactive WebGL "rooms" (creative-coding experiments). The first three rooms are refactored from the standalone HTML files in the repo root (`neural-webgl.html`, `pixel-tunnel.html`, `spiderweb-swarm.html`). Visual design is taken from `projects.html`.

## Authoritative documents

When working in this repo, **read these first** — they describe the architecture and the current implementation plan in detail:

- `docs/superpowers/specs/2026-06-01-sofa-gallery-design.md` — design spec (architecture, contracts, testing strategy)
- `docs/superpowers/plans/2026-06-01-sofa-gallery.md` — task-by-task implementation plan (TDD-driven)

These are the source of truth. The original `*.html` files in the root are reference inputs to be refactored, not part of the runtime.

## Commands

```bash
npm run dev         # astro dev server (http://localhost:4321)
npm run build       # static production build to dist/
npm run preview     # serve the production build locally
npm run typecheck   # astro check (TypeScript + Astro)
npm test            # vitest run — all unit tests
npm run test:watch  # vitest in watch mode
npm test -- <name>  # run a specific suite by name fragment (e.g. npm test -- shaders)
npm run test:e2e    # playwright e2e smoke tests (auto-builds and serves)
```

## Architecture overview

**Pages (`src/pages/`):**
- `/` — gallery (hero + decorative filter bar + three room cards)
- `/about` — manifesto + tech list + contact
- `/rooms/[slug]` — full-bleed room page, generated from the `rooms` content collection

**Content (`src/content/rooms/*.yml`)** — typed via Zod schema in `src/content/config.ts`. Adding a new room = drop a YAML entry + add a `src/lib/rooms/<slug>/` directory (an `index.ts` re-exporting `mount` + `createAudio` from sibling modules: `state`, `shaders`, `audio`, `mount`, plus room-specific geometry/overlay files) + register it in `src/lib/rooms/registry.ts`.

**Shared WebGL engine (`src/lib/webgl/`)** — `context`, `shaders`, `resize`, `raf` are the four primitives. Every room imports these instead of writing boilerplate. Each room exports `mount(canvas, opts): teardown` matching `RoomMount`/`RoomTeardown` in `src/lib/webgl/types.ts`.

**Audio bus (`src/lib/audio/bus.ts`)** — `window`-scoped singleton that survives Astro View Transitions. Crossfades between rooms with `linearRampToValueAtTime`. Only rooms whose YAML has `hasAudio: true` register a `createAudio(ctx)` factory. AudioContext is created lazily on first user gesture.

**Card preview gating (`src/scripts/room-preview.ts` + `src/lib/preview/reconciler.ts`)** — pure `decide()` function (truth table tested) drives a mount/teardown state machine. Live mini-canvas previews are activated only when `inViewport && hovered && !reducedMotion && !smallScreen`. Audio is OFF in card previews.

**View Transitions** — `<ClientRouter />` in `src/layouts/BaseLayout.astro` enables SPA-style navigation. `src/lib/transitions/wiring.ts` binds `astro:before-preparation` and `astro:after-swap` events to AudioBus crossfades. The canvas + title use `transition:name="room-canvas-<slug>"` so the card preview morphs into the full-bleed room stage.

## TDD discipline

Test-first for every pure(ish) unit:
- `src/lib/webgl/*` — fake-GL fixture in `tests/fixtures/fake-gl.ts` records calls
- `src/lib/audio/bus.ts` — fake-AudioContext fixture in `tests/fixtures/fake-audio.ts` records gain ramps
- `src/lib/preview/reconciler.ts` — full truth-table coverage
- `src/lib/transitions/wiring.ts` — synthetic event dispatch
- `src/content/config.ts` — every real YAML entry must parse; a malformed fixture must reject
- Room modules — thin behavioral tests (mount returns teardown; preview mode uses fewer GL calls)

WebGL pixel output and audio waveform output are NOT unit-tested — verified manually in a real browser.

## Path aliases

`@/*` maps to `src/*` (set in both `tsconfig.json` and `vitest.config.ts`/`astro.config.mjs`).

## TypeScript

Strict mode is enabled (`strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`). Do not loosen this; prefer narrowing types over `any` or `as unknown`.

## Conventions worth knowing

- **No frameworks** beyond Astro — no React/Vue/Svelte. `.astro` components + plain TS modules.
- **Plain CSS** with custom properties in `src/styles/tokens.css`. No Tailwind, no preprocessor.
- **No allocations inside RAF ticks** — preallocate typed arrays in the closure scope of `mount()`. The shared `raf.ts` already pauses on `document.hidden`.
- **Italian wording is intentional** in `neural-webgl.html` ("Attività Neuronale", "Sinapsi attive") — preserved as the room's identity.
- **Commits** follow conventional-commit prefixes (`feat`, `chore`, `docs`, `test`). Tasks in the plan commit at each TDD checkpoint.

## What NOT to do

- Don't add a JS framework or CSS framework — explicit non-goal in the spec.
- Don't introduce live audio in card previews — explicit non-goal.
- Don't invent fictional metrics or fake corporate-tone copy — voice is personal.
- Don't unilaterally restructure existing files unless the spec/plan calls for it.
