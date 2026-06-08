import type { RoomMount } from '@/lib/webgl/types';
import type { RoomAudio } from '@/lib/audio/bus';

export type RoomSlug =
  | 'neural' | 'tunnel' | 'swarm' | 'ikebana' | 'bindu'
  | 'catfish' | 'beauty' | 'tree';

export interface RoomModule {
  mount: RoomMount;
  createAudio?: (ctx: AudioContext) => RoomAudio;
}

export const rooms: Record<RoomSlug, () => Promise<RoomModule>> = {
  neural:  () => import('./neural'),
  tunnel:  () => import('./tunnel'),
  swarm:   () => import('./swarm'),
  ikebana: () => import('./ikebana'),
  bindu:   () => import('./bindu'),
  catfish: () => import('./catfish'),
  beauty:  () => import('./beauty'),
  tree:    () => import('./tree')
};
