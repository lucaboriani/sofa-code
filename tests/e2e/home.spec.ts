import { test, expect } from '@playwright/test';

test('home renders all room cards with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.locator('[data-room-card]')).toHaveCount(10);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('hovering a card causes its preview canvas to draw at least one frame', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __drawCount: number }).__drawCount = 0;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]): RenderingContext | null {
      const ctx = (orig as unknown as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      if (ctx && (type === 'webgl' || type === 'webgl2')) {
        const gl = ctx as WebGLRenderingContext;
        const draw = gl.drawArrays.bind(gl);
        gl.drawArrays = (...args) => { (window as unknown as { __drawCount: number }).__drawCount++; return draw(...args); };
      }
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/');
  const card = page.locator('[data-room-card="swarm"]');
  await card.hover();
  await page.waitForTimeout(1500);
  const count = await page.evaluate(() => (window as unknown as { __drawCount: number }).__drawCount);
  expect(count).toBeGreaterThan(0);
});
