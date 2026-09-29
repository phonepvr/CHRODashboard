import { expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ARTIFACT = 'file://' + join(root, 'dist', 'index.html');
export const FIX = (f) => join(root, 'tests', 'fixtures', f);

/** Every load passes the "Map your columns" step (D1): wait for it, confirm. */
export async function confirmMapping(page) {
  await expect(page.locator('#map-step')).toBeVisible();
  await expect(page.locator('#ms-confirm')).toBeEnabled();
  await page.click('#ms-confirm');
  await expect(page.locator('#map-step')).toBeHidden();
}

/** From the load gate: mock → mapping step (all auto-mapped) → confirm → dashboard. */
export async function loadMock(page) {
  await page.click('#gate-mock');
  await confirmMapping(page);
  await expect(page.locator('#app')).toBeVisible();
}

/** Open the artifact and load the mock. */
export async function openMock(page) {
  await page.goto(ARTIFACT);
  await loadMock(page);
}

/** BYOF: choose files (gate or header "Load / add files"), confirm the mapping,
 *  land on the dashboard with the load report open. */
export async function loadFiles(page, paths) {
  await page.setInputFiles('#file-input', paths);
  await confirmMapping(page);
  await expect(page.locator('#app')).toBeVisible();
}
