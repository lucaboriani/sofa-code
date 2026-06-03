import { decide, type ReconcilerInput } from '@/lib/preview/reconciler';
import { rooms, type RoomSlug } from '@/lib/rooms/registry';
import type { RoomHandle } from '@/lib/webgl/types';

const isRoomSlug = (s: string): s is RoomSlug => s in rooms;

async function paintFirstFrame(handle: RoomHandle): Promise<void> {
  handle.resume();
  // Multi-pass rooms (swarm's blur ping-pong, neural's halo pass) need
  // a few rAF cycles to settle into a presentable composite — one frame
  // can leave intermediate FBOs as the visible result.
  for (let i = 0; i < 3; i++) {
    await new Promise<void>(r => requestAnimationFrame(() => r()));
  }
  handle.pause();
}

// All live preview handles on the current page. Used to tear them down before
// View Transitions swap the DOM out, so their rAF loops don't keep running
// against detached canvases (which then throws WebGL errors when the new room
// mounts).
const liveHandles = new Set<RoomHandle>();

function init(): void {
  const canvases = document.querySelectorAll<HTMLCanvasElement>('[data-room-preview]');
  if (!canvases.length) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  canvases.forEach(canvas => {
    const slugAttr = canvas.dataset.roomPreview ?? '';
    if (!isRoomSlug(slugAttr)) return;
    const slug: RoomSlug = slugAttr;
    const card = canvas.closest<HTMLElement>('[data-room-card]');
    if (!card) return;

    let inViewport = false;
    let hovered = false;
    let state: 'idle' | 'running' = 'idle';
    let handle: RoomHandle | null = null;
    let mountInFlight = false;

    const reconcile = async (): Promise<void> => {
      const input: ReconcilerInput = { inViewport, reducedMotion, currentState: state };
      const action = decide(input);
      if (action === 'mount' && !mountInFlight) {
        mountInFlight = true;
        try {
          const mod = await rooms[slug]();
          handle = mod.mount(canvas, { quality: 'preview', audio: false, startPaused: true });
          liveHandles.add(handle);
          state = 'running';
          await paintFirstFrame(handle);
          if (hovered) handle.resume();
        } finally {
          mountInFlight = false;
        }
      } else if (action === 'teardown' && handle) {
        liveHandles.delete(handle);
        handle.teardown();
        handle = null;
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

    const onEnter = (): void => { hovered = true; handle?.resume(); };
    const onLeave = (): void => { hovered = false; handle?.pause(); };
    card.addEventListener('pointerenter', onEnter);
    card.addEventListener('pointerleave', onLeave);
    card.addEventListener('focusin', onEnter);
    card.addEventListener('focusout', onLeave);
  });
}

function teardownAll(): void {
  for (const h of liveHandles) {
    try { h.teardown(); } catch { /* idempotent */ }
  }
  liveHandles.clear();
}

document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', teardownAll);
init();
