import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = 'file://' + join(root, 'dist', 'index.html');
const FIX = (f) => join(root, 'tests', 'fixtures', f);

async function loadMock(page) {
  await page.goto(ARTIFACT);
  await page.click('#gate-mock');
  await expect(page.locator('#app')).toBeVisible();
}

test.describe('Phase 4 — charts & interactivity', () => {

  test('every tab renders its charts with direct labels; funnel and donut draw', async ({ page }) => {
    await loadMock(page);
    // overview trend charts
    expect(await page.locator('#charts-overview svg').count()).toBe(2);
    await expect(page.locator('#charts-overview .series-label', { hasText: 'Group' }).first()).toBeVisible();
    // attrition line + reasons + early turnover
    await page.click('#tab-attrition');
    expect(await page.locator('#panel-attrition .card svg').count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator('#panel-attrition .card', { hasText: 'Exits by stated reason' })).toContainText('(blank)');
    // mobility funnel
    await page.click('#tab-mobility');
    await expect(page.locator('#panel-mobility .card', { hasText: 'funnel' })).toBeVisible();
    // lnd donut
    await page.click('#tab-lnd');
    await expect(page.locator('#panel-lnd .donut-center')).toHaveText('person-days');
    // contract charts carry source labels
    await page.click('#tab-contract');
    await expect(page.locator('#panel-contract .card-sub', { hasText: 'SCRUM' }).first()).toBeVisible();
    await expect(page.locator('#panel-contract .card-sub', { hasText: 'Aparajita' }).first()).toBeVisible();
  });

  test('hover tooltip appears over chart marks', async ({ page }) => {
    await loadMock(page);
    const strip = page.locator('#charts-overview svg rect[data-tip]').first();
    await strip.hover();
    const tip = page.locator('#tip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Hazira');
  });

  test('clicking an asset bar cross-filters the whole dashboard', async ({ page }) => {
    await loadMock(page);
    const groupHc = await page.locator('[data-key="headcount_close"] .tile-value').innerText();
    await page.click('#tab-attrition');
    await page.locator('#panel-attrition [data-setasset="Paradeep"]').first().click();
    await expect(page.locator('#sel-asset')).toHaveValue('Paradeep');
    await page.click('#tab-overview');
    const paradeepHc = await page.locator('[data-key="headcount_close"] .tile-value').innerText();
    expect(paradeepHc).not.toBe(groupHc);
    await expect(page.locator('.exec-band').first()).toContainText('Paradeep');
  });

  test('drill-down modal opens from a tile and from keyboard', async ({ page }) => {
    await loadMock(page);
    const tile = page.locator('.tile[data-drill="headcount_close"]');
    await tile.click();
    await expect(page.locator('.modal')).toContainText('Headcount by asset and grade band');
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toHaveCount(0);
    // keyboard: Enter on focused tile
    await tile.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.modal')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('partial load: charts needing missing datasets show the named empty state', async ({ page }) => {
    await page.goto(ARTIFACT);
    await page.setInputFiles('#file-input', [FIX('employee_master.csv'), FIX('exits.csv')]);
    await expect(page.locator('#app')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.click('#tab-contract');
    await expect(page.locator('#panel-contract .chart-empty').first()).toContainText('contract_attendance.csv');
    await page.click('#tab-mobility');
    await expect(page.locator('#panel-mobility .chart-empty').first()).toContainText('requisitions.csv');
  });

  test('search filters tiles on the active tab', async ({ page }) => {
    await loadMock(page);
    const before = await page.locator('#panel-overview .tile:visible').count();
    await page.fill('#search', 'attrition');
    await page.waitForTimeout(250);
    const after = await page.locator('#panel-overview .tile:visible').count();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(1);
    await page.fill('#search', '');
  });
});
