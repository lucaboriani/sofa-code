import { test, expect } from '@playwright/test';

test('clicking a card navigates into the room with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.locator('[data-room-card="tunnel"] a.card-title').click({ force: true });
  await expect(page).toHaveURL(/\/rooms\/tunnel\/?$/);
  await expect(page.locator('[data-room-stage="tunnel"]')).toBeVisible();
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('audio prompt appears on every audio-enabled room', async ({ page }) => {
  for (const slug of ['tunnel', 'swarm', 'neural', 'ikebana', 'bindu', 'catfish', 'beauty', 'sri-yantra', 'cyberspace'] as const) {
    await page.goto(`/rooms/${slug}`);
    await expect(page.locator(`[data-audio-prompt="${slug}"]`)).toBeVisible();
  }
});

test('back-to-gallery from a room does not throw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/rooms/swarm');
  await page.locator('.room-back').click();
  await page.waitForURL(/\/$/);
  await expect(page.locator('[data-room-card]')).toHaveCount(10);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('direct navigation across rooms does not throw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/rooms/swarm');
  await page.goto('/rooms/tunnel');
  await expect(page.locator('[data-room-stage="tunnel"]')).toBeVisible();
  await page.goto('/rooms/sri-yantra');
  await expect(page.locator('[data-room-stage="sri-yantra"]')).toBeVisible();
  await page.goto('/rooms/cyberspace');
  const stage = page.locator('[data-room-stage="cyberspace"]');
  await expect(stage).toBeVisible();
  await page.waitForTimeout(500); // let a few RAF frames run
  const box = await stage.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  expect(errors, errors.join('\n')).toHaveLength(0);
});
