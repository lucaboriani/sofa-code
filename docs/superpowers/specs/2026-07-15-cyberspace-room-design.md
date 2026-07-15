# Cyberspace room — design spec

**Date:** 2026-07-15
**Status:** approved
**Source:** `neuromancer-cyberspace.html` (repo root — reference input, not runtime)

## Goal

Port the standalone `neuromancer-cyberspace.html` Three.js experiment into the
gallery as room 10, following the established architecture
(`docs/superpowers/specs/2026-06-01-sofa-gallery-design.md`) and the closest
existing precedent — `neural` (WebGL, hand-rolled mat4 camera, line + point
shader programs). **Every graphics and audio effect in the source file is
preserved — nothing dropped**, continuing the "nothing dropped" precedent set
by the sri-yantra port. The one structural change: the source's Three.js scene
graph is rewritten against the project's own raw-WebGL pipeline — this is the
only sketch in the repo that used Three.js, and no other room carries that
dependency. The camera-ray picking, world→screen projection, and wireframe
solid-geometry helpers this room needs are written as shared primitives in
`src/lib/webgl/` rather than kept room-local, so a future 3D room gets
picking/DOM-anchoring/basic-solids for free.

## Decisions (user-approved)

1. **Slug `cyberspace`**, title "Cyberspace". Module dir
   `src/lib/rooms/cyberspace/`.
2. **Full-fidelity port.** Every mechanic from the source is preserved: the
   fly-through camera, tap-to-lock raycasting (multi-touch, multiple
   simultaneous locks), bridging light filaments between locked/nearby
   structures, floating DOM data-readout labels, the corner telemetry HUD, and
   the full layered audio graph (drone, filtered noise, distortion/
   interference, dual-tone resonance on a bridge, sparse pings).
3. **No Three.js.** Rewritten against the existing raw-WebGL mat4 pipeline
   (`perspective`/`rotX`/`rotY`/`transl` from `src/lib/webgl/math.ts`),
   following `neural`'s pattern of hand-rolled camera + line/point shader
   programs. New shared modules — `src/lib/webgl/polyhedra.ts`,
   `src/lib/webgl/raycast.ts`, `src/lib/webgl/project.ts` — carry the
   wireframe-solid geometry tables, camera-ray/sphere picking, and
   world→screen projection so they're reusable by future 3D rooms, not
   buried in this room's folder.
4. **`accent: cyan`** — the dominant color in the scene (grid, structures, HUD
   text, glow). Shared with `tunnel`; both are flying/corridor rooms so a
   family resemblance is acceptable, and no unused accent token needs
   touching.
5. **Card preview = reduced-density autonomous flythrough.** In
   `quality:'preview'`: smaller structure/particle counts, camera flies
   forward on the source's own idle drift only (`sin(t*0.15)`/`cos(t*0.12)`
   sway) — no pointer listeners attached, no lock mechanic, no filaments, no
   HUD/floating labels, no audio. Matches the gallery's preview policy
   (no live audio, no pointer-dependent effects in card previews).
6. **Sketch's own start-screen chrome dropped**, replaced by shared app
   chrome: `#title`/`#hint`/`#audioBtn` DOM+CSS are not ported — the room
   page's existing header supplies title/subtitle, and the shared
   `AudioPrompt.astro` supplies the audio-enable gesture (same substitution
   the sri-yantra port made for its "Enable Sound" button). The sketch's
   inline error-overlay and WebGL-capability-check fallback markup are also
   not ported — no other room does this per-room.
7. **HUD identity preserved.** The corner telemetry HUD (JACK POINT, DEPTH,
   STATUS, THROUGHPUT, ICE STATUS, VECTOR, NEAREST ARRAY, corner brackets,
   crosshair) and the floating data-readout labels keep their exact text,
   formatting, and cadence from the source — the room's identity, same
   principle as the intentional Italian in `neural` or the Sanskrit labels in
   `sri-yantra`. Full-quality only.

## File inventory

| File | Change |
|---|---|
| `src/content/rooms/cyberspace.yml` | new — `order: 10`, `accent: cyan`, `hasAudio: true` |
| `src/content/schema.ts` | slug enum += `cyberspace` |
| `src/lib/webgl/polyhedra.ts` | new — shared wireframe solid tables (icosahedron/octahedron/box/tetrahedron) |
| `src/lib/webgl/raycast.ts` | new — shared camera-ray construction + ray/sphere intersection |
| `src/lib/webgl/project.ts` | new — shared world→screen projection for DOM-anchored overlays |
| `src/lib/rooms/cyberspace/geometry.ts` | new — pure structure/particle/core layout |
| `src/lib/rooms/cyberspace/shaders.ts` | new — line-wireframe + point-sprite GLSL |
| `src/lib/rooms/cyberspace/state.ts` | new — `sharedState` + `resetState` |
| `src/lib/rooms/cyberspace/mount.ts` | new — `RoomMount` |
| `src/lib/rooms/cyberspace/overlay.ts` | new — corner HUD + floating data-readout labels |
| `src/lib/rooms/cyberspace/audio.ts` | new — `createAudio` factory |
| `src/lib/rooms/cyberspace/index.ts` | new — re-exports `mount` + `createAudio` |
| `src/lib/rooms/registry.ts` | `RoomSlug` += `cyberspace`; lazy import |
| `tests/unit/webgl/polyhedra.test.ts` | new |
| `tests/unit/webgl/raycast.test.ts` | new |
| `tests/unit/webgl/project.test.ts` | new |
| `tests/unit/rooms/cyberspace.test.ts` | new — behavioral + pure-geometry + audio tests |
| `tests/unit/content/schema.test.ts` | `files.length` 9 → 10 |
| `tests/e2e/rooms.spec.ts` | card count 9 → 10; add `cyberspace` to the audio-prompt sweep |

**No edits needed** to `room-stage.ts`, `RoomStage.astro`, `AudioPrompt.astro`,
the gallery index, `tokens.css` or `gallery.css`: slug plumbing derives from
the `RoomSlug` union and the collection/registry are iterated to render cards,
stages and prompts. The new room is picked up automatically once the enum +
registry + YAML exist.

## Room contract (unchanged)

`mount(canvas, opts): RoomHandle` with `teardown/pause/resume`;
`createAudio(ctx): RoomAudio` returning `{ node, tick, dispose? }`. The
AudioBus owns the AudioContext, fades the room node in/out via a bus-side
gain, and calls `tick()` every animation frame. **No room node connects to
`ctx.destination` directly** — everything funnels into the returned `node`.

## New shared modules — `src/lib/webgl/`

### `polyhedra.ts` (pure, unit-testable)

Vertex/edge tables for the four wireframe solids used by the source's data
structures, at unit radius, ready for `gl.LINES` draws:

- `ICOSAHEDRON`, `OCTAHEDRON`, `BOX`, `TETRAHEDRON` — each
  `{ positions: Float32Array, edges: Uint16Array }` (edges as index pairs).

### `raycast.ts` (pure, unit-testable)

- `rayFromCamera(camPos, yaw, pitch, ndcX, ndcY, fovY, aspect) -> { origin, dir }`
  — builds the pick ray the same way the `tunnel` fragment shader builds its
  view ray (yaw/pitch rotation of an NDC-derived direction), done in JS
  instead of GLSL so it can run on the CPU for picking.
- `intersectSphere(origin, dir, center, radius) -> number | null` — nearest
  positive intersection distance, or `null` on a miss.

### `project.ts` (pure, unit-testable)

- `worldToScreen(mvp, worldPos, canvasW, canvasH) -> { x, y, depth, behindCamera }`
  — for anchoring DOM elements (floating data labels) to 3D world positions,
  using the same MVP matrix the frame was rendered with.

## Module breakdown — `src/lib/rooms/cyberspace/`

### `geometry.ts` (pure, unit-testable — no DOM, no canvas, no GL)

Ported from the source, built on `polyhedra.ts`:

- `TUNNEL_LEN = 4200`, `HALF_W = 55`, `HALF_H = 32` — world bounds, verbatim.
- `ARRAY_NAMES` table (`SENSE/NET`, `MAAS-NEO`, `HOSAKA`, `ZAIBATSU-7`,
  `ORBITAL/T-A`, `FISSION/RIM`, `BANK-AX`, `PANTHER/MDN`) — verbatim.
- `buildStructures(count)` — `count` structures (240 full / smaller preview
  tier), each `{ position, scale, solid: 'ico'|'oct'|'box'|'tet', isIce,
  name, spin }`; ~18% `isIce` (crimson), rest cyan. Unseeded `Math.random()`
  layout at build time, same as `neural`'s `buildGeometry` precedent.
- `buildParticles(count)` — mote positions (2600 full / smaller preview
  tier), scattered through the tunnel volume.
- `buildCore()` — the gold core definition (outer/inner nested wireframe
  scale, position at the far end of the tunnel).

### `shaders.ts`

- Line-wireframe program: position + per-vertex color + a `uFade` uniform,
  drawn with `gl.LINES` — used for structures, the grid, and filaments.
- Point-sprite program: position + size + alpha attributes, additive
  blending — used for particle motes and glow sprites (mirrors `neural`'s
  `progPt`).

### `state.ts` (visual → audio bridge)

```
sharedState = {
  speed: 0,          // current camera speed (drives drone pitch-mod / kick-like cues if any)
  lockLevel: 0,       // 0 | 1 | 2 — number of simultaneous locks, clamped at 2 for audio tiering
  bridgeActive: false // true when a filament is actively bridging two locked objects
}
resetState()
```

`mount` writes these; `audio.ts`'s `tick()` reads them — replacing the
source's direct `setInterference(level)` calls from pointer handlers with a
polled read, same three-tier thresholds.

### `mount.ts` (`RoomMount`)

- WebGL1 context (matches `neural` — no readback/MRT needs here, unlike
  `tunnel`'s WebGL2 pixel-sampling), line + point programs from `shaders.ts`.
- **Camera:** position advances along -Z at `speed` (`BASE_SPEED = 11`,
  `BOOST_SPEED = 30`, verbatim); yaw/pitch chase pointer-derived targets
  (`targetYaw = -nx*0.55`, `targetPitch = ny*0.32`, eased ×0.04/frame,
  verbatim) plus the idle sinusoidal sway. Tunnel-length wrap
  (`camera.z` resets to 0 past `-TUNNEL_LEN + 40`) kept verbatim.
  `MVP = perspective × rotX(pitch) × rotY(yaw) × transl(-camPos)`.
- **Picking (full quality only):** on pointer down, `raycast.rayFromCamera`
  + `intersectSphere` against every structure (radius ≈ `baseScale * 1.3`,
  matching the source's mesh scale) and the core; nearest hit wins. A
  `Map<pointerId, target>` tracks simultaneous locks (multi-touch); on lock,
  camera speed eases to 0 and the target is highlighted (flipped to a lit
  color); on release, if no locks remain speed eases back to `BASE_SPEED`.
  Pointer-down on empty space with no active locks triggers `BOOST_SPEED`
  instead (verbatim).
- **Filaments:** pool of 16 short polylines (`FIL_SEGS = 5` segments each),
  each drawn via the line program with additive blending. Per filament: pick
  a locked object as origin; 65% chance (when ≥2 locks exist) of targeting
  another locked object directly (a "bridge", brighter/whiter, sets
  `sharedState.bridgeActive`), otherwise targets a random nearby structure
  or just flickers outward. Growth/fade envelope, wobble via
  `sin`/`cos(t*…)`, and duration ranges kept verbatim. A `Map<object, count>`
  reference-counts "touch" highlighting from passing filaments, separate
  from direct-lock highlighting (verbatim `touchObject`/`untouchObject`).
- **Overlay driving:** each frame, projects locked-object world positions via
  `project.worldToScreen` and calls into `overlay.ts`'s update functions with
  the computed screen coordinates + HUD field values (depth, throughput,
  vector, nearest-array name/distance, ICE status, jack-point ID cycling).
- `teardown`: abort, stop loop, stop resize, remove pointer listeners, remove
  overlay DOM, delete GL programs/buffers. `pause`/`resume` toggle the loop.

### `overlay.ts` (full quality only)

Plain DOM + inline styles (bindu/sri-yantra pattern), appended under
`canvas.parentElement`, torn down in `teardown()`:

- **Corner telemetry HUD:** four corner text blocks (JACK POINT/DEPTH/STATUS;
  THROUGHPUT/ICE STATUS; VECTOR/AUDIO; NEAREST ARRAY), four L-shaped corner
  brackets, and a center crosshair. `update(fields)` is called once per frame
  from `mount.ts` with the source's exact formatting: depth
  `Math.round(-camera.z)` padded to 4 digits, throughput `speed * 7.3`
  to 1 decimal, vector `yaw`/`pitch` to 2 decimals, jack-point ID cycling
  every ~4s (`CASE_NN`). Text content and cadence kept verbatim — this is
  the room's identity.
- **Floating data-readout labels:** pool of 12 absolutely-positioned `div`s
  (monospace, translucent panel), split into two groups of 6 orbiting
  whichever of the first two locked objects they're assigned to (verbatim
  `angle += dt*speed*dir`, radius 46–106, vertical bias). Text is procedural
  fake data (`CHKSUM`, `SIZE`, `CIPHER RSA-…`, `LATENCY …ms` for structures;
  `CIPHER…`, `ICE DENSITY …%`, `TRACE…` for the core), regenerated on a
  low-probability random tick — `dataLines()`/`hex()` generators ported
  verbatim. Hidden when nothing is locked or the projection reports
  `behindCamera`.

### `audio.ts` (`createAudio`)

Verbatim audio graph from the source, rerouted through the returned node:

- Master gain, self-ramped from near-0 to 0.22 over ~1.2s on activation
  (mirrors `tunnel`'s self-fade convention; the bus crossfade sits on top).
- Delay (0.85s)/feedback (0.35)/lowpass (1400Hz) send bus.
- 3 detuned drone oscillators (55/55.6 sawtooth, 110.2 triangle), each
  through its own 420Hz lowpass with a slow LFO (0.03–0.052Hz) drifting the
  cutoff — verbatim frequencies/gains.
- Filtered noise bed: looped 2s buffer → bandpass, center frequency drifted
  by a slow LFO (0.05Hz).
- Distortion/"interference" layer: same noise source → waveshaper (curve
  amount 55, 4x oversample) → highpass (700Hz) → gain, silent at rest.
- Dual-sine resonance layer (440Hz/445.5Hz through a shared bandpass,
  Q5) for the bridge beat, silent at rest.
- Sparse ping scheduler: random 4.2–11.2s cadence, swept tone (sine/
  triangle, base 320–1020Hz) with vibrato LFO and a softening lowpass,
  `setTimeout`-based exactly as in the source. Cleared via the returned
  `dispose()` so it doesn't keep firing after the room deactivates.
- `tick()` reads `sharedState.lockLevel` (0/1/2) each frame and applies the
  source's three-tier `setTargetAtTime` ramps (τ=0.4) to noise gain/filter
  freq/Q, distortion gain, and resonance gain — same thresholds/values as
  the source's `setInterference(level)`, now polled instead of
  event-driven.

### `index.ts`

```ts
export { mount } from './mount';
export { createAudio } from './audio';
```

## Metadata — `src/content/rooms/cyberspace.yml`

```yaml
slug: cyberspace
title: Cyberspace
subtitle: WebGL · 3D · Audio
description: >-
  Fly through a field of corporate data arrays and ICE-guarded structures.
  Tap one to lock on, tap a second to bridge them — light filaments trace
  the connection and the drone stirs. Let go and the HUD keeps its own
  account of depth, throughput, and whatever's nearest.
tags: [WebGL, 3D, Generative, Audio]
year: 2026
accent: cyan
hasAudio: true
order: 10
```

## Lifecycle & safety

- `AbortController` + listener cleanup array; `observeResize` for sizing;
  `createRafLoop` (auto-pauses on `document.hidden`).
- Typed arrays / GL buffers for structures, particles, and the filament pool
  preallocated in the `mount()` closure; no allocations in the RAF tick.
- Teardown removes overlay DOM + listeners, stops the loop, deletes GL
  programs/buffers.
- `exactOptionalPropertyTypes`-clean; no `any` / `as unknown`.

## Testing (TDD)

- `polyhedra.test.ts`: vertex/edge counts per solid; edges reference valid
  vertex indices; bounds within unit radius.
- `raycast.test.ts`: known camera + ray cases hit/miss a sphere at known
  positions; ray-parallel and behind-camera edge cases return `null`.
- `project.test.ts`: known MVP matrix + world point → expected screen
  coordinates; a point behind the camera reports `behindCamera: true`.
- `schema.test.ts`: bump the count to 10; the new YAML parses and
  `slug === filename`.
- `cyberspace.test.ts`:
  - **Pure geometry:** `buildStructures`/`buildParticles` return the
    quality-tiered counts; every structure has a valid `solid` type and a
    name from `ARRAY_NAMES`; positions stay within `HALF_W`/`HALF_H`/
    `TUNNEL_LEN` bounds.
  - **Behavioral (fake-GL fixture, per neural):** `mount` returns a handle;
    teardown is idempotent and does not throw (preview + full); preview
    quality attaches no pointer listeners and builds no overlay DOM; full
    quality does both; fewer GL calls in preview than full.
  - **Overlay:** corner HUD + floater elements exist in full mode only;
    floaters stay hidden with no active lock.
  - **Audio (fake-audio fixture):** `createAudio` returns
    `{ node, tick, dispose }`; `node` is a gain; `tick()` survives many
    frames across `lockLevel` transitions without throwing; `dispose()`
    clears the ping-scheduler timeout.
- `rooms.spec.ts` (e2e): card count 10; `/rooms/cyberspace` shows the audio
  prompt.
- WebGL pixel output and audio waveform output: NOT unit-tested — manual
  browser verification (per project policy).

## Non-goals

- No Three.js — this room, like every other, runs on the shared raw-WebGL
  engine.
- No live audio in card previews.
- No changes to existing rooms beyond the additive `registry.ts`/
  `schema.ts` entries.
