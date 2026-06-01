import type { RoomMount } from '@/lib/webgl/types';

export const mount: RoomMount = (_canvas, _opts) => {
  return () => { /* teardown */ };
};
