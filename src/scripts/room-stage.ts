import { rooms, type RoomSlug } from '@/lib/rooms/registry';
import { getAudioBus } from '@/lib/audio/bus';
import type { RoomTeardown } from '@/lib/webgl/types';

const isRoomSlug = (s: string): s is RoomSlug => s === 'neural' || s === 'tunnel' || s === 'swarm';

let activeTeardown: RoomTeardown | null = null;

async function mountCurrent(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-room-stage]');
  if (!canvas) return;
  const slugAttr = canvas.dataset.roomStage ?? '';
  if (!isRoomSlug(slugAttr)) return;
  const slug: RoomSlug = slugAttr;
  const hasAudio = canvas.dataset.hasAudio === 'true';

  const mod = await rooms[slug]();
  activeTeardown = mod.mount(canvas, { quality: 'full', audio: hasAudio });

  if (hasAudio && mod.createAudio) {
    const bus = getAudioBus();
    bus.register(slug, mod.createAudio);

    const prompt = document.querySelector<HTMLElement>('[data-audio-prompt]');
    if (prompt) {
      prompt.addEventListener('click', async () => {
        await bus.resume();
        await bus.activate(slug, 600);
        prompt.classList.add('is-dismissed');
      }, { once: true });
    }
  }
}

function teardownCurrent(): void {
  if (activeTeardown) {
    activeTeardown();
    activeTeardown = null;
  }
}

document.addEventListener('astro:page-load', () => { void mountCurrent(); });
document.addEventListener('astro:before-swap', teardownCurrent);
