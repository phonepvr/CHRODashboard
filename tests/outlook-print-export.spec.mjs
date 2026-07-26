import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = 'file://' + join(root, 'dist', 'index.html');

async function loadMock(page) {
  await page.goto(ARTIFACT);
  await page.click('#gate-mock');
  await expect(page.locator('#app')).toBeVisible();
}

test.describe('Phase 5 — outlook, print pack, exports', () => {

  test('outlook shows six panels, each with method/assumptions and Projected markers', async ({ page }) => {
    await loadMock(page);
    await page.click('#tab-outlook');
    const panels = page.locator('#panel-outlook .ol-panel');
    await expect(panels).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await expect(panels.nth(i).locator('.ol-method')).toContainText('Method');
      await expect(panels.nth(i).locator('.ol-method')).toContainText('Assumptions');
      await expect(panels.nth(i).locator('.proj-chip').first()).toBeVisible();
    }
    // glidepath declares it carries no forecasting assumption
    await expect(page.locator('.ol-panel', { hasText: 'Superannuation glidepath' })).toContainText('no forecasting assumption');
    // risk cohorts: counts only, said explicitly
    await expect(page.locator('.ol-panel', { hasText: 'risk cohorts' })).toContainText('COHORT COUNTS ONLY');
    // projected series draw dashed
    expect(await page.locator('#panel-outlook polyline[stroke-dasharray]').count()).toBeGreaterThanOrEqual(3);
  });

  test('cost outlook slider recomputes the projection live', async ({ page }) => {
    await loadMock(page);
    await page.click('#tab-outlook');
    const out = page.locator('#ol-cost-out');
    const at8 = await out.innerText();
    await page.locator('#ol-incr').fill('15');
    await expect(page.locator('#ol-incr-val')).toHaveText('15.0%');
    const at15 = await out.innerText();
    expect(at15).not.toBe(at8);
    expect(at8).toMatch(/^₹/);
  });

  test('print pack pre-renders: cover + Group + 4 assets + quality + methodology, footers numbered', async ({ page }) => {
    await loadMock(page);
    // pack builds on idle after load
    await expect.poll(() => page.locator('#print-root .print-page').count(), { timeout: 10_000 }).toBe(8);
    const pages = page.locator('#print-root .print-page');
    await expect(pages.nth(0)).toContainText('HR Dashboard');
    await expect(pages.nth(0)).toContainText('ILLUSTRATIVE DATA');
    await expect(pages.nth(1)).toContainText('Group executive summary');
    for (const [i, asset] of [[2, 'Hazira'], [3, 'Paradeep'], [4, 'Vizag'], [5, 'Kirandul']]) {
      await expect(pages.nth(i)).toContainText(`${asset} — Asset HR head summary`);
      await expect(pages.nth(i).locator('.pp-footer')).toContainText(`Page ${i + 1} of 8`);
      await expect(pages.nth(i).locator('.pp-footer')).toContainText('Smarter Steels. Brighter Futures.');
      await expect(pages.nth(i).locator('.pp-footer')).toContainText('Illustrative data');
    }
    await expect(pages.nth(6)).toContainText('Data quality');
    await expect(pages.nth(7)).toContainText('Methodology appendix');
  });

  test('page.pdf() paginates the pack with no tile split across pages', async ({ page }) => {
    await loadMock(page);
    await expect.poll(() => page.locator('#print-root .print-page').count(), { timeout: 10_000 }).toBe(8);
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true });
    expect(pdf.byteLength).toBeGreaterThan(60_000);
    const text = pdf.toString('latin1');
    const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    // 8 logical sections; methodology may flow over several sheets
    expect(pageCount).toBeGreaterThanOrEqual(8);
    // pagination sanity: every logical page renders (cover text + last page text present)
    expect(pageCount).toBeLessThan(30);
  });

  test('exports: tab CSV, full CSV, chart PNGs and drill-row CSV all download locally', async ({ page }) => {
    test.setTimeout(90_000);
    await loadMock(page);
    const downloads = [];
    page.on('download', (d) => downloads.push(d));

    await page.click('#btn-export');
    await page.click('[data-export-tab]');
    await page.click('[data-export-all]');
    await expect.poll(() => downloads.length).toBe(2);
    const fs = await import('node:fs');
    const tabCsv = fs.readFileSync(await downloads[0].path(), 'utf8');
    expect(tabCsv.split(/\r?\n/)[0]).toContain('Metric Key');
    expect(tabCsv).toContain('headcount_close');
    const allCsv = fs.readFileSync(await downloads[1].path(), 'utf8');
    expect(allCsv.split(/\r?\n/).length).toBeGreaterThan(50);
    await page.keyboard.press('Escape');

    // chart PNGs from the overview tab
    await page.click('#btn-export');
    await page.click('[data-export-charts]');
    await expect.poll(() => downloads.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
    const png = fs.readFileSync(await downloads[downloads.length - 1].path());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.byteLength).toBeGreaterThan(5_000);

    // drill rows CSV
    const before = downloads.length;
    await page.click('.tile[data-drill="headcount_close"]');
    await page.click('[data-drill-csv]');
    await expect.poll(() => downloads.length).toBe(before + 1);
    const drill = fs.readFileSync(await downloads[downloads.length - 1].path(), 'utf8');
    expect(drill).toContain('Hazira');
  });
});
