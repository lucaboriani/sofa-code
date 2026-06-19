# Sri Yantra room — design spec

**Date:** 2026-06-19
**Status:** approved
**Source:** `sri-yantra.html` (repo root — reference input, not runtime)

## Goal

Port the standalone `sri-yantra.html` Canvas-2D experiment into the gallery as
room 9, following the established architecture
(`docs/superpowers/specs/2026-06-01-sofa-gallery-design.md`) and the two existing
Canvas-2D ports — `catfish` (2D + audio) and `tree` (2D + overlay/restart).
**Every graphics and audio effect in the source file is preserved — nothing
dropped.** Only the plumbing is adapted to the shared engine and audio bus.

## Decisions (user-approved)

1. **Slug `sri-yantra`**, title "Sri Yantra". Module dir
   `src/lib/rooms/sri-yantra/`.
2. **Card preview = assembled + gentle auto-rotation.** In `quality:'preview'`
   the timeline is jumped so all 14 layers are already present, and the idle
   "nudge" auto-rotation drifts the rings. No pointer input, no overlay, no
   audio (per the gallery's preview policy).
3. **Faithful port into the module pattern** (`mount` + `createAudio` +
   `sharedState` bridge), exactly like `catfish`/`tree`. Canvas 2D, no WebGL.
   DPR pinned to **1** (as the original ran) so drag coordinates map 1:1 to
   canvas pixels.
4. **Identity preserved.** The Sanskrit phase labels (`ॐ`, "Bindu",
   "Triangle 1…9", "8-Petal Lotus", "16-Petal Lotus", "Circles", "Bhupura")
   are kept verbatim — the room's identity, same principle as the intentional
   Italian in `neural`/`tree`.
5. **`accent: gold`** — the source's default feel is the golden palette; the
   `gold` accent token and `.tag.t-gold` style already exist (used by
   `ikebana`/`tree`), so no token/CSS changes are needed.

## File inventory

| File | Change |
|---|---|
| `src/content/rooms/sri-yantra.yml` | new — `order: 9`, `accent: gold`, `hasAudio: true` |
| `src/content/schema.ts` | slug enum += `sri-yantra` |
| `src/lib/rooms/sri-yantra/geometry.ts` | new — pure geometry/palette/timeline |
| `src/lib/rooms/sri-yantra/state.ts` | new — `sharedState` + `resetState` |
| `src/lib/rooms/sri-yantra/audio.ts` | new — `createAudio` factory |
| `src/lib/rooms/sri-yantra/mount.ts` | new — `RoomMount` |
| `src/lib/rooms/sri-yantra/overlay.ts` | new — phase label + Regenerate button |
| `src/lib/rooms/sri-yantra/index.ts` | new — re-exports `mount` + `createAudio` |
| `src/lib/rooms/registry.ts` | `RoomSlug` += `sri-yantra`; lazy import |
| `tests/unit/rooms/sri-yantra.test.ts` | new — behavioral + pure-geometry tests |
| `tests/unit/content/schema.test.ts` | `files.length` 8 → 9 |
| `tests/e2e/rooms.spec.ts` | card count 8 → 9; add `sri-yantra` to the audio-prompt sweep |

**No edits needed** to `room-stage.ts`, `RoomStage.astro`, `AudioPrompt.astro`,
the gallery index, `tokens.css` or `gallery.css`: slug plumbing derives from the
`RoomSlug` union (`isRoomSlug` = `s in rooms`; components import `RoomSlug`), and
the collection/registry are iterated to render cards, stages and prompts. The
new room is picked up automatically once the enum + registry + YAML exist.

## Room contract (unchanged)

`mount(canvas, opts): RoomHandle` with `teardown/pause/resume`;
`createAudio(ctx): RoomAudio` returning `{ node, tick }`. The AudioBus owns the
AudioContext, fades the room node in/out via a bus-side gain, and calls `tick()`
every animation frame. **No room node connects to `ctx.destination` directly** —
everything funnels into the returned `node`.

## Module breakdown — `src/lib/rooms/sri-yantra/`

### `geometry.ts` (pure, unit-testable — no DOM, no canvas)

Verbatim from `sri-yantra.html`:

- `hsl(h,s,l,a)` colour helper and the `palettes` table — six schemes
  (`golden`, `indigo`, `crimson`, `emerald`, `dusk`, `ivory`), each with
  `bg` + `pri/sec/acc/glow` alpha-functions. Verbatim values.
- `buildYantra(R, v)` → 9 triangle layers (`up`/`dn` helpers), each
  `{ pts, up, radius }`, in unit space (×R applied at draw time).
- `petalRing(R, n, inner, outer)` → `n` petal segments (60 steps each).
- `bhupuraParts(R)` → `{ outer, inner, gates }` square enclosure + 4 gates.
- Timeline: `NAMES` (14 layer labels), `N_LAYERS = 14`, `APPEAR_DUR = 1.0`,
  `STEP = 1.2`, `startOf(i)`, `prog(i, age)`. Plus small math helpers
  (`rand`, `randInt`, `lerp`, `clamp`, `easeOut`).
- `genPalette()` equivalent: pick a random scheme; expose the **scheme key**
  (a `keyof typeof palettes`) so `mount` can publish it to `sharedState` for
  audio retuning.

### `state.ts` (visual → audio bridge)

```
sharedState = {
  scheme: 'golden',     // current palette key — drives drone base freq + cutoff
  dragSpeed: 0,         // normalised |drag velocity|, 0..1 (drives filter/drone bend while dragging)
  autoActivity: 0,      // idle-nudge energy, 0..1 (drives gentle bend while idle)
  dragging: false       // pointer currently dragging a ring
}
resetState()            // back to defaults on (re)mount
```

`mount` writes these; `audio.ts` `tick()` reads them. (Mirrors `catfish`'s
`mx/my/dispersion/shocks/collisions` bridge.)

### `mount.ts` (`RoomMount`)

- 2D context; `observeResize(canvas, regenerateLayout, 1)` (DPR 1);
  `createRafLoop((dtMs, tMs) => render(tMs), signal)`.
- Per-layer rotation state preallocated in closure scope (`Float64Array`s for
  `layerRot`, `layerTarget`, `layerIntroOff`, `layerRadii`, `nextNudge`;
  `Uint8Array layerUnwound`; `pendingDeltas` arrays) — **verbatim** from the
  source. No per-tick allocation beyond what the original draws.
- `generateScene()`: pick palette, set intro offsets, reset nudges/activity,
  publish `scheme` to `sharedState`. **Full mode**: `lastInteraction` set in the
  future (idle suppressed until the user has had a moment), `birthTime = now` so
  the timeline plays the layer-by-layer assembly. **Preview mode**:
  `birthTime` set far in the past (all layers unwound/assembled) and
  `lastInteraction` set in the past so the idle nudge rotation drifts the rings.
- `render(ts)`: clear to `palette.bg`; breath pulse; flush pending deltas;
  idle `scheduleNudges`; decay `autoActivity`; chase targets + intro unwind;
  update phase label; draw triangle fills + outlines, 8/16-petal lotuses
  (`arc`-smooth circles), bhupura, bindu glow. **All formulas verbatim.**
- **Interaction (full mode only):** drag-to-spin via `mousedown/move/up` +
  `touchstart/move/end` (verbatim `pointerAngle`/`closestLayer`/`startDrag`/
  `moveDrag`/`endDrag` logic). Instead of poking audio nodes directly, the drag
  handlers write `dragSpeed`/`dragging` to `sharedState`; the idle loop writes
  `autoActivity`. Listeners tracked in a cleanup array; pointer coords use
  `getBoundingClientRect()` (DPR 1) so they map to canvas pixels.
- **Overlay (full mode only):** `makeOverlay(onRegenerate)` injects the phase
  label + Regenerate button next to the canvas; `mount` updates the label text
  each frame; teardown removes it.
- `teardown`: abort, stop loop, stop resize, remove listeners, remove overlay.
  `pause`/`resume` toggle the loop.

### `audio.ts` (`createAudio`)

Verbatim audio graph from `sri-yantra.html`, rerouted through the returned node:

- Internal `droneGain` ramps `0 → 0.11` over 10 s on activation (the room's own
  swell; the bus crossfade sits on top).
- Convolver reverb (`makeImpulse`, 2.5 s decaying noise, send 0.28).
- Lowpass `filterNode` (320 Hz / Q 0.5) → droneGain + reverb.
- Drone partials 1/2/3/5 of the base freq (sine, gains 0.55/0.18/0.09/0.04);
  shimmer osc ×9 with a 1/23 Hz LFO; breath LFO (0.07 Hz, ±0.022 on droneGain);
  wobble LFO (0.031 Hz, depth 0.28) on partials 1 & 2.
- **Per-scheme tuning tables live here** (base freq `golden:136.1, indigo:141,
  crimson:128, emerald:144, dusk:138.5, ivory:130.8`; cutoff `golden:360 …`).
- `tick()` reads `sharedState`:
  - On `scheme` change → glide partials/shimmer/filter to the new scheme's
    tuning (the original `updateDrone`), with the 4 s time-constant.
  - While `dragging`: `filter ≈ 320 + dragSpeed*1200`, drone bend
    `≈ base + dragSpeed*40` (fast time constants) — verbatim.
  - While idle: `filter ≈ cutoff + autoActivity*500`, drone bend
    `≈ base + autoActivity*18` — verbatim.
- **Adaptation notes:** `startAudio()`/`window.AudioContext` and the
  "Enable Sound" button disappear — the bus owns the context and the
  `AudioPrompt` is the user-gesture entry point. Direct node pokes from the
  drag handler move behind the `sharedState` bridge. All `audioCtx.destination`
  connects reroute into the returned `out` node.

### `overlay.ts`

`makeOverlay(onRegenerate): { root, label }`. Full mode only,
`data-yantra-overlay`, `z-index` above room chrome (like tree's overlay):

- **Phase label** (top-center): `ॐ` initially; `mount` sets `label.textContent`
  to the current layer name each frame. Styling verbatim (letter-spaced
  uppercase, low-opacity serif).
- **Regenerate button** (bottom): mirrors tree's "Pulisci" — calls
  `onRegenerate` (→ `generateScene()`), hover styling verbatim-ish.

### `index.ts`

```ts
export { mount } from './mount';
export { createAudio } from './audio';
```

## Metadata — `src/content/rooms/sri-yantra.yml`

```yaml
slug: sri-yantra
title: Sri Yantra
subtitle: Canvas · 2D · Audio
description: >-
  Nine interlocking triangles, lotus petals and the bhupura gates assemble
  around the bindu over a slow timeline. Drag any ring to spin it and the whole
  figure responds, the drone bending with your motion; leave it and it drifts on
  its own. Regenerate for a new palette and tuning.
tags: [Canvas, 2D, Sacred Geometry, Audio]
year: 2026
accent: gold
hasAudio: true
order: 9
```

## Lifecycle & safety

- `AbortController` + listener cleanup array; `observeResize` for sizing;
  `createRafLoop` (auto-pauses on `document.hidden`).
- Typed arrays preallocated in the `mount()` closure; no allocations in the RAF
  tick beyond what the original draws per frame (the gradient for the bindu glow
  — verbatim).
- Teardown removes overlay DOM + listeners and stops the loop.
- `exactOptionalPropertyTypes`-clean; no `any` / `as unknown`.

## Testing (TDD)

- `schema.test.ts`: bump the count to 9; the new YAML parses and
  `slug === filename`.
- `sri-yantra.test.ts`:
  - **Pure geometry:** `buildYantra` returns 9 layers with the expected radius
    ordering (descending); `petalRing(R, n, …)` returns `n` segments;
    `bhupuraParts` returns `outer`/`inner`/`gates` (4 gates); every palette has
    `bg/pri/sec/acc/glow`; `prog`/`startOf` timeline math.
  - **Behavioral (2D proxy canvas, per catfish/tree):** `mount` returns a handle;
    teardown is idempotent and does not throw (preview + full); teardown cancels
    rAF; full mode injects `[data-yantra-overlay]` and teardown removes it;
    preview injects no overlay.
  - **Audio (fake-audio fixture):** `createAudio` returns `{ node, tick }`;
    `node` is a gain; `tick()` survives many frames across `dragging`/`scheme`
    transitions without throwing.
- `rooms.spec.ts` (e2e): card count 9; `/rooms/sri-yantra` shows the audio
  prompt.
- Pixel and waveform output: manual browser verification (per project policy).

## Non-goals

- No WebGL — this room is Canvas 2D (matching the source).
- No live audio in card previews.
- No shared audio-helper extraction across rooms.
- No changes to existing rooms.
