import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = 'file://' + join(root, 'dist', 'index.html');
const FIX = (f) => join(root, 'tests', 'fixtures', f);
const tmp = join(root, 'test-results', 'harden');
mkdirSync(tmp, { recursive: true });

async function loadMock(page) {
  await page.goto(ARTIFACT);
  await page.click('#gate-mock');
  await expect(page.locator('#app')).toBeVisible();
}

test.describe('Phase 6 — hardening (adversarial-review fixes)', () => {

  test('PRIVACY: reset wipes the pre-rendered print pack so nothing prints from the gate', async ({ page }) => {
    await page.goto(ARTIFACT);
    await page.setInputFiles('#file-input', [FIX('employee_master.csv'), FIX('exits.csv')]);
    await expect(page.locator('#app')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('#print-root .print-page').count(), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.click('#btn-reset');
    await expect(page.locator('#load-gate')).toBeVisible();
    // the confidential pack must be gone, even after a beforeprint
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    expect(await page.locator('#print-root').innerHTML()).toBe('');
    expect(await page.evaluate(() => App.__lastDrill)).toBeNull();
  });

  test('OFFLINE: an inline favicon is present so a served origin issues no /favicon.ico request', async ({ page }) => {
    await page.goto(ARTIFACT);
    const href = await page.getAttribute('link[rel="icon"]', 'href');
    expect(href).toMatch(/^data:image\/svg\+xml/);
  });

  test('CSV: a stray quote mid-value is kept literally and never swallows later rows', async ({ page }) => {
    await page.goto(ARTIFACT);
    const r = await page.evaluate(() => {
      const txt = 'Employee ID,Name,Asset,Grade Band,Grade,Function,Gender,DOB,Date of Joining,Employee Class\n'
        + 'Z-1,height 5\'6" tall,Hazira,Below AM,S1,Operations,Male,01-01-1990,01-01-2015,Permanent\n'
        + 'Z-2,Normal Name,Vizag,Below AM,S1,Operations,Female,01-01-1991,01-01-2016,Permanent\n'
        + 'Z-3,Another,Paradeep,Below AM,S1,Operations,Male,01-01-1992,01-01-2017,Permanent\n';
      const parsed = CSV.parse(txt);
      return { rowCount: parsed.rows.length, warnings: parsed.warnings, firstNameField: parsed.rows[0][1] };
    });
    expect(r.rowCount).toBe(3);                       // all three rows survive
    expect(r.firstNameField).toContain('5\'6" tall'); // the inch mark is kept
    expect(r.warnings.join(' ')).toMatch(/stray double-quote/);
  });

  test('CORRECTNESS: duplicate employee_master rows are not double-counted in headcount', async ({ page }) => {
    await page.goto(ARTIFACT);
    const dupCsv = [
      'Employee ID,Name,Asset,Grade Band,Grade,Function,Gender,DOB,Date of Joining,Employee Class',
      'D-1,A,Hazira,Below AM,S1,Operations,Male,01-01-1990,01-01-2015,Permanent',
      'D-1,A,Hazira,Below AM,S1,Operations,Male,01-01-1990,01-01-2015,Permanent',
      'D-2,B,Hazira,Below AM,S1,Operations,Female,01-01-1991,01-01-2016,Permanent'
    ].join('\n');
    const p = join(tmp, 'employee_master.csv');
    writeFileSync(p, dupCsv);
    await page.setInputFiles('#file-input', p);
    await expect(page.locator('#app')).toBeVisible();
    await page.keyboard.press('Escape');
    // 3 rows in, one is a duplicate ID → 2 unique employees counted
    await expect(page.locator('[data-key="headcount_close"] .tile-value')).toHaveText('2');
    // and the duplicate is still reported on the Data Quality tab
    await page.click('#tab-quality');
    await expect(page.locator('#panel-quality .data-table')).toContainText('Duplicate');
  });

  test('CORRECTNESS: scorecard "i" shows raw arithmetic + an explicit clamp note when it binds', async ({ page }) => {
    await page.goto(ARTIFACT);
    const worked = await page.evaluate(() => {
      // higher-is-better, actual 25, target 10 → raw 250, clamped 200
      const raw = 25 / 10 * 100, s = Scorecard.scoreOf(25, 10, 'higher');
      return { raw, s };
    });
    expect(worked.raw).toBe(250);
    expect(worked.s).toBe(200);
    // popover honesty: for a metric whose raw score falls outside [0,200], the
    // worked equation shows the RAW figure and an explicit clamp line.
    await page.click('#gate-mock');
    const info = await page.evaluate(() => Scorecard.scoreInfoHTML('tt_3yr_nopromo'));
    // actual (~dozens) far exceeds target 10 on a lower-is-better metric → raw < 0
    expect(info).toContain('Clamped to the [0, 200] range');
    // the equation line ends in the true raw value, not the clamped one
    expect(info).not.toMatch(/× 100 = 0\.0<\/div>/);
  });

  test('ROBUSTNESS: a file dropped on the dashboard does not navigate away', async ({ page }) => {
    await loadMock(page);
    // simulate a drop on the app body; the guard must preventDefault (no navigation)
    const navigated = await page.evaluate(() => {
      const ev = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { files: [] } });
      document.getElementById('app').dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(navigated).toBe(true);
    await expect(page.locator('#app')).toBeVisible();
  });

  test('BYOF: incremental add via header keeps previously loaded files', async ({ page }) => {
    await page.goto(ARTIFACT);
    await page.setInputFiles('#file-input', FIX('employee_master.csv'));
    await expect(page.locator('#app')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#data-chip')).toContainText('employee_master.csv');
    // add exits.csv from inside the dashboard — must NOT wipe employee_master
    await page.click('#btn-add');
    await page.setInputFiles('#file-input', FIX('exits.csv'));
    // the second load is async (FileReader); wait for it to land before asserting
    await expect.poll(() => page.evaluate(() => [...App.state.datasets.keys()].sort()))
      .toEqual(['employee_master', 'exits']);
  });
});
