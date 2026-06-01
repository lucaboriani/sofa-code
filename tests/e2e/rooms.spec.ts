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

test('audio prompt appears only on neural room', async ({ page }) => {
  await page.goto('/rooms/tunnel');
  await expect(page.locator('[data-audio-prompt]')).toHaveCount(0);
  await page.goto('/rooms/neural');
  await expect(page.locator('[data-audio-prompt]')).toBeVisible();
});

test('back-to-gallery from a room does not throw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/rooms/swarm');
  await page.locator('.room-back').click();
  await page.waitForURL(/\/$/);
  await expect(page.locator('[data-room-card]')).toHaveCount(3);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('direct navigation across rooms does not throw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/rooms/swarm');
  await page.goto('/rooms/tunnel');
  await expect(page.locator('[data-room-stage="tunnel"]')).toBeVisible();
  expect(errors, errors.join('\n')).toHaveLength(0);
});
