# Ikebana + Bindu rooms — design spec

**Date:** 2026-06-03
**Status:** approved
**Sources:** `ikebana.html`, `bindu.html` (repo root — reference inputs, not runtime)

## Goal

Port two standalone HTML WebGL experiments into the gallery as rooms 4 and 5,
following the established architecture (`docs/superpowers/specs/2026-06-01-sofa-gallery-design.md`).
**Every graphics and audio effect in the source files is preserved — nothing dropped.**

## Decisions (user-approved)

1. **Overlays are room-managed.** Each room module injects its decorative DOM
   overlays next to the canvas on mount (full mode only) and removes them on
   teardown. Bindu's "ॐ Touch to begin" start screen is **replaced** by the
   app's standard `AudioPrompt` — it served the same user-gesture/audio-start
   role. Kanji `天 人 地`, the Italian hint "doppio tap — nuovo ikebana", and
   the Tamas/Rajas/Sattva guna legend are kept verbatim.
2. **Two new accent tokens.** `gold` (ikebana — warm beige-gold) and `crimson`
   (bindu — deep red) are added to `tokens.css`, the Zod schema, card styles.
3. **Approach:** faithful port into the module pattern (mount + createAudio +
   sharedState bridge), like `swarm.ts`. No verbatim embed, no cross-room
   refactor of shared audio helpers (later cleanup if ever).

## File inventory

| File | Change |
|---|---|
| `src/content/rooms/ikebana.yml` | new — `order: 4`, `accent: gold`, `hasAudio: true` |
| `src/content/rooms/bindu.yml` | new — `order: 5`, `accent: crimson`, `hasAudio: true` |
| `src/content/schema.ts` | slug enum += `ikebana`, `bindu`; accent enum += `gold`, `crimson` |
| `src/lib/rooms/ikebana.ts` | new room module |
| `src/lib/rooms/bindu.ts` | new room module |
| `src/lib/rooms/registry.ts` | `RoomSlug` += both; lazy imports |
| `src/scripts/room-stage.ts` | `isRoomSlug` accepts new slugs |
| `src/components/RoomStage.astro`, `AudioPrompt.astro`, `src/pages/rooms/[slug].astro` | widen slug prop type (use `RoomSlug` from registry) |
| `src/styles/tokens.css` | `--accent4` / `--accent4-rgb` (gold), `--accent5` / `--accent5-rgb` (crimson) |
| `src/styles/gallery.css` | `.tag.t-gold`, `.tag.t-crimson` |
| `tests/unit/rooms/ikebana.test.ts`, `bindu.test.ts` | new — behavioral tests |
| `tests/unit/content/schema.test.ts` | new entries parse |
| `tests/e2e/rooms.spec.ts` | include new slugs in the room-page sweep |

## Room contract (unchanged)

`mount(canvas, opts): RoomHandle` with `teardown/pause/resume`;
`createAudio(ctx): RoomAudio` returning `{ node, tick }`. The AudioBus owns the
AudioContext, fades the room node in/out via a bus-side gain, and calls
`tick()` every animation frame. **No room node may connect to
`ctx.destination` directly** — everything funnels into the returned `node`.

## Ikebana module

### Graphics (all preserved from `ikebana.html`)

- WebGL1, `{ antialias: true, alpha: false }`, clear `#060503`-ish (0.024, 0.019, 0.012).
- Thick polylines as triangle strips (`thickPolyline`), circle outlines (`drawCirclePts`).
- Catmull-Rom spline builder (140 steps/segment), `easeOut5`/`easeOut3` easing.
- Procedural generator: origin point, 5-color earth palette, five branches
  (shin / soe / tai / accent / whisper) with per-branch endpoints, curl,
  shoots (angle/len/delay), buds (radius/delay) — all random ranges verbatim.
- Render: ripples at the origin (4 phased ellipses), per-branch draw progress,
  disturbance waves (sin wave travelling along spline, exp envelope, 1.2 s
  decay, perpendicular displacement), core line + 4× glow pass, shoots with
  jittered midpoints, buds (outer + inner circle), 11 falling petals,
  7 breathing background verticals, ikebana fade-in (0.7 s) and death fade
  (1.2 s) with multi-instance crossfade on regen, DPR-aware sizing
  (`devicePixelRatio` clamped to 2 for line widths).

### Audio (all preserved, rerouted through master node)

- Master gain → drag lowpass (`droneFilter`, 800 Hz / Q 1.8 base) → out-node;
  reverb send (3 s decaying-noise IR convolver, 0.42 send) from filter output.
- 7-oscillator drone (55/55.3/82.4/110/110.5/165/220 Hz, sine/triangle mix)
  with per-partial pitch LFOs; rates/depths derived from shoot geometry
  (mean |angle|, angle spread, mean length) and staggered per partial.
- Breath LFO (0.055 Hz, ±0.12) on master gain.
- Live drone morphing in `tick()`: per-partial gain follows average branch
  draw progress (staggered entry), per-partial frequency glides from 1.4× to
  the geometry-scaled target (`rootMult`/`spreadMult`/`brightMult` from
  shin end-Y, tai end-X, accent end-Y).
- Drag-velocity → filter cutoff 300–2100 Hz and Q surge; release returns to
  800 Hz / 1.8 over 0.5 s.
- `playShimmer(angle, branchIdx)`: 5 per-branch timbres (wave/filter/env
  tables verbatim) + bandpassed noise layer; fired once per shoot on first
  appearance and on shoot touch (300 ms per-shoot cooldown).
- Looped touch voice: 5 personalities (osc trios, detunes, bandpass/lowpass,
  wing-beat AM, wobble LFO, looped noise, accent sub-octave), shaped by branch
  geometry (curvature → Q, length → wobble, spread → detune/brightness);
  `retuneTouchVoice` glides fundamental with finger position along the
  branch (root low → tip 2.5×); 0.22 s release on lift/leave.
- `playBloom(rootFreq)`: 4-note open-fifth chord on regen, root from shin
  height (55–110 Hz).
- Drone LFO surge on branch hit (rate ×6, depth from branch color, relax
  ramps) — verbatim constants.
- **Adaptation notes:** `ensureAC()` disappears (bus owns the context).
  The original's first-tap `morphDrone` reset and the audio-start side of
  `mousedown`/`touchend` map to AudioPrompt activation; double-tap regen no
  longer needs to create audio. All `AC.destination` connects (shimmer, bloom,
  touch voice, filter output) reroute to the master out-node. Audio-affecting
  events flow visual→audio through a module-scoped `sharedState` (drag
  velocity + pointer-down, draw progress, hit/shimmer/bloom event queues)
  written by `mount()` and consumed by `createAudio`'s closures/`tick()`.
  When audio is not yet active, event queues are bounded (latest-wins) so
  nothing accumulates.

### Interaction (full mode only)

- Double-tap (≤320 ms, ≤14 px movement) and `dblclick` → new ikebana
  (old ones fade out and are pruned).
- Pointer drag along a branch: hit test every 8th spline point within
  `min(W,H)*0.055`, spawns disturbances (60 ms throttle), starts/retunes the
  touch voice; shoot proximity (`min(W,H)*0.04`, every 4th point) triggers
  shimmers. Mouse and single-finger touch both tracked; shoot registry rebuilt
  per frame.
- Overlays: vertical kanji `天 人 地` (top-left) and hint
  "doppio tap — nuovo ikebana" (bottom-center, 2 s opacity transition,
  hidden on first regen) — injected as positioned elements, removed on
  teardown, fonts/colors verbatim.

### Preview mode

No pointer listeners, no overlays, no audio. The drawing animation, ripples,
petals and background verticals run as-is (geometry is cheap; no count
reduction needed).

## Bindu module

### Graphics (all preserved from `bindu.html`)

- WebGL1 + `OES_element_index_uint`, `{ antialias: true, alpha: false }`,
  clear (0.023, 0, 0.012), additive blending (`SRC_ALPHA, ONE`).
- 1200 lines × 80 segments, 7 floats/vertex (pos3 + rgba), Uint32 indices,
  `gl.LINES` draw, dynamic vertex upload each frame.
- Guna template: random tamas/rajas/sattva weights (normalized), random unit
  direction, maxLen, color mix and base alpha formulas verbatim.
- Comet motion: tip travels 0→1.6×maxLen over life (3–10 s), fixed-length
  tail (0.55×maxLen), birth ramp (p/0.08), u² comet alpha gradient; tamas
  pulls down (di²·0.65), sattva lifts (di²·0.45), rajas swirls (rotation +
  radial wobble) — all formulas verbatim.
- Camera: yaw/pitch/dist (20 default), drag sensitivity 0.006 (pitch ×0.55,
  clamp ±1.35), release inertia (velocity ×60, friction 0.995), wheel zoom
  (×0.012, clamp 0.3–60), two-finger pinch zoom (×0.12). Hand-rolled
  `persp`/`lookAt`/`mul4` math ported as-is.

### Audio (all preserved, rerouted through master node)

- Master gain ramps 0 → 0.22 over 5 s on activation (the bus crossfade sits
  on top; the internal ramp is the room's own swell, kept).
- 6 s cave reverb IR (decay exp 1.35), wet 0.65 / dry 0.35.
- Drone: 8 detuned voices (0/−4/+5/−8/+13/−15/+20/−23 cents) × 7 harmonics
  (ratios 1,2,3,4,5,6,8 with verbatim gains) of ROOT 55 Hz, all sine;
  per-oscillator vibrato LFOs (0.13–0.22 Hz, 0.8–1.4 cents); global detune
  `ConstantSource` (drag-vertical, ±200 cents).
- Sub sine at 27.5 Hz (gain 0.12, follows global detune); breath swell LFO
  (0.12 Hz, ±0.05 on master gain).
- Lowpass (380 Hz / Q 0.5) → dry+wet; parallel vowel bandpass (220 Hz /
  Q 4.5, gain 0.12).
- Three random walkers (filter cutoff 120–700, master gain 0.16–0.26,
  bandpass centre 90–480): retarget every 4–14 s, exponential glide
  (0.08/tick at ~20 Hz). **Adaptation:** ported from `setInterval(50ms)` to
  the bus-driven `tick()` with a time accumulator that fires at the same
  50 ms cadence — identical behavior, no leaked interval on room exit.
- Zoom-reactive looping white noise: highpass 800 Hz → bandpass 3 kHz →
  gain 0 (zoom-controlled, `0.025·((9−dist)/8.7)⁴` clamp); drag-horizontal
  sweeps the highpass (200–4000 Hz), drag-vertical the bandpass colour
  (800–8000 Hz).
- `updateAudio(vx, vy, zoom)` runs in `tick()` from `sharedState` (smoothed
  drag velocity EMA ×0.75/0.25 computed in the RAF loop, camera dist):
  cutoff = walker base + vx·55 (40–1800), detune = −vy·11 (±200),
  bandpass = walker base + vx·30 (60–900), master gain nudge − vy·0.008
  (0.06–0.40, feeds back into walker state) — verbatim formulas.

### Interaction (full mode only)

- Pointer-based drag orbit (mouse + single touch), release inertia, wheel
  zoom, two-finger pinch zoom. Ported to pointer events where 1:1 (mouse
  drag), keeping touch events where the original semantics need them
  (multi-touch pinch with per-identifier tracking) — behavior identical.
- Overlay: title "Bindu · The Origin" (top-center) + guna legend with the
  three dots (bottom-center) — injected on mount, removed on teardown,
  styles verbatim. Positioned to avoid the app's room chrome (z-index below
  chrome, pointer-events none — same as original).
- The ॐ start overlay is **not ported** — `AudioPrompt` is its replacement.
  Visuals run immediately on mount (in the original they also ran behind the
  90 %-opaque overlay; the only gated thing was audio).

### Preview mode

No pointer listeners, no overlays, no audio. Line count reduced
(`NUM = { preview: 300, full: 1200 }`); camera keeps the gentle initial
yaw drift (`vy = 0.18` decaying at 0.995) — same as the untouched original.

## Lifecycle & safety

- `AbortController` + cleanup arrays for listeners; `observeResize` for
  sizing; `createRafLoop` (auto-pauses on `document.hidden`).
- Typed arrays preallocated in `mount()` closure; no allocations in RAF ticks
  except what the originals themselves allocate per-frame intentionally
  (ikebana rebuilds splines per frame — verbatim; bindu refills one
  preallocated `Float32Array`).
- Teardown deletes GL programs/buffers, removes overlay DOM, clears
  module-scoped registries (disturbances, shoot registry).
- `exactOptionalPropertyTypes`-clean; no `any`.

## Testing (TDD)

- `schema.test.ts`: both YAML entries parse; bad accent rejects.
- `ikebana.test.ts` / `bindu.test.ts` against fake-GL fixture:
  mount returns handle; teardown idempotent and removes overlay nodes +
  listeners; preview mode issues fewer/equal GL calls and injects no overlay;
  pause/resume toggle the loop.
- Fake-audio fixture: `createAudio` returns `{ node, tick }`; node is a gain;
  master ramp scheduled; tick() does not throw with empty state; walker
  retarget timing advances with the fake clock (bindu).
- e2e sweep includes `/rooms/ikebana` and `/rooms/bindu`.
- Pixel and waveform output: manual browser verification (per project policy).

## Non-goals

- No shared audio-helper extraction (reverb IR, noise buffers) across rooms.
- No live audio in card previews.
- No changes to existing rooms beyond type widening.
