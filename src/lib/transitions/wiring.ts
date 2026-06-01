import type { AudioBus } from '@/lib/audio/bus';

export type SlugResolver = () => string | null;
export type AudioResolver = (slug: string) => boolean;

const FADE_MS = 600;

export function wireTransitions(
  bus: AudioBus,
  resolveSlug: SlugResolver,
  resolveHasAudio: AudioResolver
): () => void {
  const onBeforePrep = (): void => {
    void bus.deactivate(FADE_MS);
  };
  const onAfterSwap = (): void => {
    const slug = resolveSlug();
    if (!slug) return;
    if (!resolveHasAudio(slug)) return;
    void bus.activate(slug, FADE_MS);
  };

  document.addEventListener('astro:before-preparation', onBeforePrep);
  document.addEventListener('astro:after-swap', onAfterSwap);

  return () => {
    document.removeEventListener('astro:before-preparation', onBeforePrep);
    document.removeEventListener('astro:after-swap', onAfterSwap);
  };
}
