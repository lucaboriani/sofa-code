import { rooms, type RoomSlug } from '@/lib/rooms/registry';
import { getAudioBus } from '@/lib/audio/bus';
import type { RoomHandle } from '@/lib/webgl/types';

const isRoomSlug = (s: string): s is RoomSlug => s in rooms;

let activeHandle: RoomHandle | null = null;
let gestureCleanup: (() => void) | null = null;
let contextMenuCleanup: (() => void) | null = null;

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

// A held press on the canvas (rooms with tap-and-hold interactions, e.g.
// cyberspace's tap-to-lock) otherwise surfaces the browser's native
// image-style context menu (Android long-press, desktop right-click, and
// Chrome's touch-emulation long-press all fire this same event — iOS
// Safari's long-press callout is the separate `-webkit-touch-callout: none`
// in RoomStage.astro). Scoped to the canvas, not the whole page, so links
// like the back-to-index button keep their normal context menu.
function blockCanvasContextMenu(canvas: HTMLCanvasElement): void {
  const prevent = (e: Event): void => e.preventDefault();
  canvas.addEventListener('contextmenu', prevent);
  contextMenuCleanup = () => {
    canvas.removeEventListener('contextmenu', prevent);
    contextMenuCleanup = null;
  };
}

async function mountCurrent(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-room-stage]');
  if (!canvas) return;
  blockPageZoom();
  blockCanvasContextMenu(canvas);
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
  contextMenuCleanup?.();
}

document.addEventListener('astro:page-load', () => { void mountCurrent(); });
document.addEventListener('astro:before-swap', teardownCurrent);
