import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = 'file://' + join(root, 'dist', 'index.html');
const SHOTS = join(root, 'test-results', 'screens');
mkdirSync(SHOTS, { recursive: true });

/** Attach a strict zero-network tripwire. The ONLY allowed request is the
 *  file:// document itself (and its own file:// subresources, of which there
 *  should be none — the artifact is a single file). */
function armNetworkTripwire(page, log) {
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('file://')) { log.file.push(url); return; }
    if (url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:')) return;
    log.network.push(url);
  });
}

async function gotoGate(page, log = { file: [], network: [] }) {
  armNetworkTripwire(page, log);
  await page.goto(ARTIFACT);
  return log;
}

async function loadMock(page) {
  await page.click('#gate-mock');
  await expect(page.locator('#app')).toBeVisible();
}

test.describe('HR Dashboard @AM/NS — scaffold', () => {

  test('makes ZERO network requests, even after interacting', async ({ page }) => {
    const log = await gotoGate(page);
    await loadMock(page);
    // walk every tab, open a popover — still nothing on the wire
    for (const t of ['talent', 'scorecard', 'quality', 'methodology', 'overview']) {
      await page.click(`#tab-${t}`);
    }
    expect(log.network, `unexpected network requests: ${log.network.join(', ')}`).toHaveLength(0);
    // single self-contained document: exactly one file:// request
    expect(log.file.length).toBe(1);
  });

  test('opens at the branded load gate with no metrics visible', async ({ page }) => {
    await gotoGate(page);
    await expect(page.locator('#load-gate')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.locator('.tile').count()).toBe(0);
    await expect(page.locator('.gate-title')).toHaveText(/HR Dashboard @AM\/NS/);
    await expect(page.locator('.gate-reassure')).toContainText('never uploaded');
    await page.screenshot({ path: join(SHOTS, '01-load-gate.png'), fullPage: true });
  });

  test('CSP meta is exactly the required policy; no storage APIs are used', async ({ page }) => {
    await gotoGate(page);
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    expect(csp).toBe("default-src 'self' 'unsafe-inline' data:; connect-src 'none'");
    await loadMock(page);
    const storage = await page.evaluate(() => ({
      local: localStorage.length, session: sessionStorage.length, cookies: document.cookie
    }));
    expect(storage.local).toBe(0);
    expect(storage.session).toBe(0);
    expect(storage.cookies).toBe('');
  });

  test('embedded Albert Sans loads when the build includes it', async ({ page }) => {
    await gotoGate(page);
    const hasEmbedded = await page.evaluate(() =>
      [...document.querySelectorAll('style')].some((s) => s.textContent.includes('@font-face')));
    test.skip(!hasEmbedded, 'system-font fallback build');
    const ok = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('700 16px "Albert Sans"') && document.fonts.check('400 14px "Albert Sans"');
    });
    expect(ok).toBe(true);
  });

  test('mock data is deterministic across reloads and labelled illustrative', async ({ page }) => {
    const snapshot = async () => {
      await loadMock(page);
      await expect(page.locator('#data-chip')).toHaveText('Illustrative data');
      const tiles = {};
      for (const t of await page.locator('.tile[data-key]').all()) {
        tiles[await t.getAttribute('data-key')] = (await t.locator('.tile-value').innerText()).trim();
      }
      return tiles;
    };
    await gotoGate(page);
    const a = await snapshot();
    await page.reload();
    const b = await snapshot();
    expect(Object.keys(a).length).toBeGreaterThanOrEqual(8);
    expect(b).toEqual(a);
    // numbers actually computed, not placeholders
    expect(a['headcount_close']).toMatch(/^[\d,]+$/);
    await page.screenshot({ path: join(SHOTS, '02-mock-overview.png'), fullPage: true });
  });

  test('template downloads produce CSVs whose headers match the registry schemas', async ({ page }) => {
    test.setTimeout(120_000);
    await gotoGate(page);
    const expected = await page.evaluate(() =>
      Object.fromEntries(Object.entries(SCHEMAS).map(([id, s]) => [id, s.columns.map((c) => c.name)])));
    await page.click('#gate-templates');
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.click('[data-template-all]');
    await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(Object.keys(expected).length + 1);
    const byName = {};
    for (const d of downloads) {
      const p = await d.path();
      byName[d.suggestedFilename()] = (await import('node:fs')).readFileSync(p, 'utf8');
    }
    for (const [id, cols] of Object.entries(expected)) {
      const text = byName[id + '.csv'];
      expect(text, `${id}.csv downloaded`).toBeTruthy();
      const header = text.split(/\r?\n/)[0];
      expect(header).toBe(cols.join(','));
      // 2–3 example rows present
      expect(text.trim().split(/\r?\n/).length).toBeGreaterThanOrEqual(3);
    }
    expect(byName['data_dictionary.csv']).toContain('Used by metrics');
  });

  test('"i" affordance is keyboard-operable and reveals the exact formula', async ({ page }) => {
    await gotoGate(page);
    await loadMock(page);
    const btn = page.locator('.tile[data-key="headcount_close"] .i-btn');
    await btn.focus();
    await page.keyboard.press('Enter');
    const po = page.locator('.popover');
    await expect(po).toBeVisible();
    await expect(po).toContainText('Active permanent employees at period end');
    await expect(po).toContainText('employee_master.csv');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(po).toHaveCount(0);
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toBeFocused();
  });

  test('BYOF: loading template-conformant CSVs replaces mock data; partial load greys dependents', async ({ page }) => {
    await gotoGate(page);
    // fixture: a tiny employee master + exits, built from the template example format
    const empCsv = [
      'Employee ID,Name,Asset,Grade Band,Grade,Function,Gender,DOB,Date of Joining,Employee Class,TT Flag,CT Flag,Critical Position Flag,Manager ID,Nationality,Disability Flag,Current Role Start Date,Last Promotion Date',
      'E-001,A. One,Hazira,AM-GM,DGM,Operations,Female,10-05-1980,01-04-2010,Permanent,Y,N,N,,Indian,N,01-04-2020,01-04-2020',
      'E-002,B. Two,Hazira,Below AM,S1,Operations,Male,15-08-1990,01-06-2018,Permanent,N,N,N,E-001,Indian,N,01-06-2018,',
      'E-003,C. Three,Paradeep,AM-GM,GM,Finance,Male,20-01-1975,15-03-2005,Permanent,N,Y,Y,E-001,Indian,N,01-01-2022,01-01-2022'
    ].join('\n');
    const fixDir = join(root, 'test-results', 'fixtures');
    mkdirSync(fixDir, { recursive: true });
    const empPath = join(fixDir, 'employee_master.csv');
    writeFileSync(empPath, empCsv);
    await page.setInputFiles('#file-input', empPath);
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('.modal')).toContainText('3 of 3 rows loaded');
    await page.keyboard.press('Escape');
    await expect(page.locator('#data-chip')).toContainText('employee_master.csv');
    // headcount computed from the 3-row file (exits.csv optional for this metric)
    const hcTile = page.locator('.tile[data-key="headcount_close"]');
    await expect(hcTile.locator('.tile-value')).toHaveText('3');
    // attrition needs exits.csv → greyed; contract tile greyed with the file named
    await expect(page.locator('.tile[data-key="attr_annualised"]')).toContainText('No data loaded for this metric');
    await expect(page.locator('.tile[data-key="headcount_contract"]')).toContainText('contract_attendance.csv');
  });

  test('reset returns to the load gate and clears data', async ({ page }) => {
    await gotoGate(page);
    await loadMock(page);
    await page.click('#btn-reset');
    await expect(page.locator('#load-gate')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    const dsCount = await page.evaluate(() => App.state.datasets.size);
    expect(dsCount).toBe(0);
  });
});
