# SOFA/WORKS

A small, growing gallery of WebGL "rooms" — creative-coding experiments
vibe-coded from the sofa. Each room is one idea, one canvas, one
evening's worth of curiosity.

Live: _(deploy to Netlify and link here)_

---

## Stack

- **[Astro 5](https://astro.build)** — static site, content collections, view transitions
- **TypeScript strict** — no `any`, no implicit anything
- **WebGL / WebGL2** — three hand-rolled scenes (no three.js / regl)
- **Web Audio API** — drone synths per room, crossfaded by a singleton bus
- **Vitest** + **Playwright** — unit + e2e
- Plain CSS, no Tailwind, no preprocessor

## Local dev

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # static build → dist/
npm run preview      # serve dist/ locally
npm run typecheck    # astro check
npm test             # vitest run
npm run test:e2e     # playwright (auto-builds + serves)
```

## What's inside

| Route | What it is |
|---|---|
| `/` | Gallery — cards show the first frame of each demo, hover to animate |
| `/about` | Manifesto + tech list + signature |
| `/rooms/tunnel` | Endless raymarched corridor (drag to control speed) |
| `/rooms/swarm` | Drifting spider-web swarm (drag to push, pinch to scatter) |
| `/rooms/neural` | Audio-reactive synaptic network (drag to rotate, mic enables reactivity) |

Each room has an audio drone you can enable from a button bottom-left.
Audio crossfades between rooms via a `window`-scoped singleton bus that
survives Astro's view-transition navigations.

## Architecture overview

```
src/
├─ content/rooms/         YAML entries (Zod-validated)
├─ layouts/BaseLayout     html shell + ClientRouter + audio bus wiring
├─ pages/
│  ├─ index.astro         the gallery
│  ├─ about.astro
│  └─ rooms/[slug].astro  dynamic room page
├─ components/            Astro components (Nav, Hero, RoomCard, RoomStage, AudioPrompt, …)
├─ lib/
│  ├─ webgl/              shared engine — context, shaders, resize, raf, types
│  ├─ audio/bus.ts        singleton crossfade bus
│  ├─ preview/reconciler  pure decide() for card preview state
│  ├─ transitions/wiring  binds astro navigation events to the audio bus
│  └─ rooms/              one .ts module per room — mount(canvas, opts): handle
├─ scripts/
│  ├─ room-preview.ts     IntersectionObserver-driven preview gating
│  └─ room-stage.ts       full-bleed room mount + audio prompt wiring
└─ styles/                tokens.css · global.css · gallery.css
```

Each room module exports:

```ts
export const mount: RoomMount = (canvas, opts) => ({ teardown, pause, resume });
export const createAudio?: (ctx: AudioContext) => { node: AudioNode; tick?(): void };
```

Adding a new room = drop a YAML in `src/content/rooms/`, write a
`.ts` module in `src/lib/rooms/`, register it in `lib/rooms/registry.ts`.

## TDD-driven

Pure-ish units have tests written first:

- `lib/webgl/{shaders,resize,raf}` — fake-GL fixture records calls
- `lib/audio/bus` — fake AudioContext records gain ramps
- `lib/preview/reconciler` — full truth-table coverage
- `lib/transitions/wiring` — synthetic event dispatch
- `content/schema` — every real YAML must parse; malformed fixture must reject
- Per-room — thin behavioral tests (mount returns teardown; preview vs full)

WebGL pixel output and audio waveform output are **not** unit-tested —
verified by hand in a real browser.

## Source for the demos

The three room scripts started as the standalone files in the repo root:

- `neural-webgl.html`
- `pixel-tunnel.html`
- `spiderweb-swarm.html`

They're kept around as reference inputs. The Astro site refactors them
into typed modules using the shared engine; the originals are not part
of the runtime.

## Docs

- `docs/superpowers/specs/2026-06-01-sofa-gallery-design.md` — design spec
- `docs/superpowers/plans/2026-06-01-sofa-gallery.md` — task-by-task implementation plan
- `CLAUDE.md` — guidance for future AI sessions in this repo

## Deploy

Static build, no adapter needed. On Netlify:

- **Base directory:** *(empty)*
- **Build command:** `npm run build`
- **Publish directory:** `dist`

---

Made with Astro and stubbornness. — **ZeroPara**
