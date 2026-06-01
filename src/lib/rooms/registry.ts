import type { RoomMount } from '@/lib/webgl/types';
import type { RoomAudio } from '@/lib/audio/bus';

export type RoomSlug = 'neural' | 'tunnel' | 'swarm';

export interface RoomModule {
  mount: RoomMount;
  createAudio?: (ctx: AudioContext) => RoomAudio;
}

export const rooms: Record<RoomSlug, () => Promise<RoomModule>> = {
  neural: () => import('./neural'),
  tunnel: () => import('./tunnel'),
  swarm:  () => import('./swarm')
};
