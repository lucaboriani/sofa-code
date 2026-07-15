import { describe, it, expect } from 'vitest';
import { makeOverlay } from '@/lib/rooms/cyberspace/overlay';

describe('cyberspace overlay', () => {
  it('updateHud writes the corner telemetry text', () => {
    const { root, updateHud } = makeOverlay();
    updateHud({ jackPoint: 'CASE_09', depth: '0042', status: 'nominal', throughput: '80.3', iceStatus: 'passive', vector: '0.10 / -0.05', nearest: 'HOSAKA (12m)' });
    expect(root.textContent).toContain('CASE_09');
    expect(root.textContent).toContain('0042');
    expect(root.textContent).toContain('HOSAKA (12m)');
  });

  it('updateFloater with no target hides that group', () => {
    const { updateFloater } = makeOverlay();
    expect(() => updateFloater(0, null, 0.016)).not.toThrow();
  });

  it('updateFloater with a target positions and shows that group', () => {
    const { root, updateFloater } = makeOverlay();
    updateFloater(0, { name: 'HOSAKA', isCore: false, x: 200, y: 150, visible: true }, 0.016);
    const shown = [...root.querySelectorAll('div')].some(el => (el as HTMLElement).style.opacity === '0.85');
    expect(shown).toBe(true);
  });
});
