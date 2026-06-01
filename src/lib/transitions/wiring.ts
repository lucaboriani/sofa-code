import type { AudioBus } from '@/lib/audio/bus';

export type SlugResolver = () => string | null;
export type AudioResolver = (slug: string) => boolean;

const FADE_MS = 600;

export function wireTransitions(
  bus: AudioBus,
  _resolveSlug: SlugResolver,
  _resolveHasAudio: AudioResolver
): () => void {
  // Crossfade out on navigation. The new room's audio is activated only
  // when the user clicks the audio prompt — auto-activating here creates
  // an AudioContext without a user gesture (suspended on Safari/Firefox)
  // and stacks duplicate audio graphs across navigations.
  const onBeforePrep = (): void => {
    void bus.deactivate(FADE_MS);
  };

  document.addEventListener('astro:before-preparation', onBeforePrep);

  return () => {
    document.removeEventListener('astro:before-preparation', onBeforePrep);
  };
}
