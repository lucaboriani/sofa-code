import { describe, it, expect } from 'vitest';
import { rooms } from '@/lib/rooms/registry';

describe('registry', () => {
  it('every slug resolves to a module with a mount function', async () => {
    for (const [slug, loader] of Object.entries(rooms)) {
      const mod = await loader();
      expect(typeof mod.mount).toBe('function');
      expect(slug.length).toBeGreaterThan(0);
    }
  });
});
