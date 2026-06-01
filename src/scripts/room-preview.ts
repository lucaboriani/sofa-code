import { decide, type ReconcilerInput } from '@/lib/preview/reconciler';
import { rooms, type RoomSlug } from '@/lib/rooms/registry';
import type { RoomHandle } from '@/lib/webgl/types';

const isRoomSlug = (s: string): s is RoomSlug => s === 'neural' || s === 'tunnel' || s === 'swarm';

async function paintFirstFrame(handle: RoomHandle): Promise<void> {
  handle.resume();
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  handle.pause();
}

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
    let handle: RoomHandle | null = null;
    let mountInFlight = false;

    const reconcile = async (): Promise<void> => {
      const input: ReconcilerInput = { inViewport, reducedMotion, smallScreen, currentState: state };
      const action = decide(input);
      if (action === 'mount' && !mountInFlight) {
        mountInFlight = true;
        try {
          const mod = await rooms[slug]();
          handle = mod.mount(canvas, { quality: 'preview', audio: false, startPaused: true });
          state = 'running';
          await paintFirstFrame(handle);
          if (hovered) handle.resume();
        } finally {
          mountInFlight = false;
        }
      } else if (action === 'teardown' && handle) {
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

document.addEventListener('astro:page-load', init);
init();
