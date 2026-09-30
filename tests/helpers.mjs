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

// surface uncaught page errors in the test log (CI has no other window into them)
const watched = new WeakSet();
function watchErrors(page) {
  if (watched.has(page)) return;
  watched.add(page);
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.stack || e.message}`));
}

/** From the load gate: mock → mapping step (all auto-mapped) → confirm → dashboard. */
export async function loadMock(page) {
  watchErrors(page);
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
  watchErrors(page);
  await page.setInputFiles('#file-input', paths);
  await confirmMapping(page);
  await expect(page.locator('#app')).toBeVisible();
}

/** Non-appendix print-pack sections — or the pack's build error, so a failed
 *  poll names the cause instead of reading 0. */
export function packPages(page) {
  return page.evaluate(() => PrintPack.lastError
    ? 'build error: ' + PrintPack.lastError
    : document.querySelectorAll('#print-root .print-page:not(.pp-method-page)').length);
}
