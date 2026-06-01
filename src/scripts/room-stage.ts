import { rooms, type RoomSlug } from '@/lib/rooms/registry';
import { getAudioBus } from '@/lib/audio/bus';
import type { RoomHandle } from '@/lib/webgl/types';

const isRoomSlug = (s: string): s is RoomSlug => s === 'neural' || s === 'tunnel' || s === 'swarm';

let activeHandle: RoomHandle | null = null;
let gestureCleanup: (() => void) | null = null;

// iOS Safari ignores `touch-action` for pinch-zoom, so suppress its synthesized
// gesture events while a room is mounted. Pointer events still fire, so the
// room's own two-finger pinch keeps working — only the page zoom is blocked.
function blockPageZoom(): void {
  const prevent = (e: Event): void => e.preventDefault();
  document.addEventListener('gesturestart', prevent, { passive: false });
  document.addEventListener('gesturechange', prevent, { passive: false });
  document.addEventListener('gestureend', prevent, { passive: false });
  gestureCleanup = () => {
    document.removeEventListener('gesturestart', prevent);
    document.removeEventListener('gesturechange', prevent);
    document.removeEventListener('gestureend', prevent);
    gestureCleanup = null;
  };
}

async function mountCurrent(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-room-stage]');
  if (!canvas) return;
  blockPageZoom();
  const slugAttr = canvas.dataset.roomStage ?? '';
  if (!isRoomSlug(slugAttr)) return;
  const slug: RoomSlug = slugAttr;
  const hasAudio = canvas.dataset.hasAudio === 'true';

  const mod = await rooms[slug]();
  activeHandle = mod.mount(canvas, { quality: 'full', audio: hasAudio });

  if (hasAudio && mod.createAudio) {
    const bus = getAudioBus();
    bus.register(slug, mod.createAudio);

    const prompt = document.querySelector<HTMLElement>('[data-audio-prompt]');
    if (prompt) {
      prompt.addEventListener('click', () => {
        void bus.activate(slug, 600);
        void bus.resume();
        prompt.classList.add('is-dismissed');
      }, { once: true });
    }
  }
}

function teardownCurrent(): void {
  if (activeHandle) {
    activeHandle.teardown();
    activeHandle = null;
  }
  gestureCleanup?.();
}

document.addEventListener('astro:page-load', () => { void mountCurrent(); });
document.addEventListener('astro:before-swap', teardownCurrent);
