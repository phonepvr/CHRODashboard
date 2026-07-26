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

test.describe('Phase 3 — registry, scorecard, data quality', () => {

  test('both scoring formulas reproduce hand-checked arithmetic', async ({ page }) => {
    await page.goto(ARTIFACT);
    const r = await page.evaluate(() => ({
      higherExact: Scorecard.scoreOf(80, 100, 'higher'),      // 80
      higherOver: Scorecard.scoreOf(110, 100, 'higher'),      // 110
      lowerUnder: Scorecard.scoreOf(90, 100, 'lower'),        // (200-90)/100*100 = 110
      lowerOver: Scorecard.scoreOf(50, 40, 'lower'),          // (80-50)/40*100 = 75
      lowerFar: Scorecard.scoreOf(120, 100, 'lower'),         // 80
      noTarget: Scorecard.scoreOf(50, null, 'higher'),        // null
      zeroTarget: Scorecard.scoreOf(50, 0, 'lower'),          // null (guarded)
      clampHigh: Scorecard.scoreOf(0, 10, 'lower')            // 200 exactly
    }));
    expect(r.higherExact).toBeCloseTo(80, 6);
    expect(r.higherOver).toBeCloseTo(110, 6);
    expect(r.lowerUnder).toBeCloseTo(110, 6);
    expect(r.lowerOver).toBeCloseTo(75, 6);
    expect(r.lowerFar).toBeCloseTo(80, 6);
    expect(r.noTarget).toBeNull();
    expect(r.zeroTarget).toBeNull();
    expect(r.clampHigh).toBe(200);
  });

  test('scorecard end-to-end on a hand-checked fixture (incl. Target-not-set exclusion)', async ({ page }) => {
    await page.goto(ARTIFACT);
    await page.setInputFiles('#file-input', [FIX('employee_master.csv'), FIX('exits.csv'), FIX('targets.csv')]);
    await expect(page.locator('#app')).toBeVisible();
    await page.keyboard.press('Escape'); // close load report
    await page.click('#tab-scorecard');
    // Hand-check: 12 permanent, 6 female → female_pct 50, target 50 higher → 100.
    // No exits in period → attr 0, target 10 lower → (20-0)/10×100 = 200.
    // HR Operations total = mean(200, 100) = 150; cumulative = 150 (only scored function).
    await expect(page.locator('.sc-cum-value')).toHaveText('150.0');
    const hrOps = page.locator('.sc-table').filter({ hasText: 'Female share of workforce' });
    await expect(hrOps.locator('.sc-total td').last()).toHaveText('150.0');
    // un-targeted metrics render "Target not set" + em-dash score and are excluded
    await expect(page.locator('.sc-table td', { hasText: 'Target not set' }).first()).toBeVisible();
    // score-cell "i" reveals the applied scoring formula with real numbers
    const scoreInfo = page.locator('[data-scoreinfo="female_pct"]');
    await scoreInfo.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.popover')).toContainText('Score = Actual ÷ Target × 100');
    await expect(page.locator('.popover')).toContainText('50.0 ÷ 50.0 × 100 = 100.0');
    await page.keyboard.press('Escape');
  });

  test('mock mode: scorecard renders all six functions with a cumulative score', async ({ page }) => {
    await loadMock(page);
    await page.click('#tab-scorecard');
    const cum = await page.locator('.sc-cum-value').innerText();
    expect(cum).toMatch(/^\d+\.\d$/);
    for (const fn of ['Talent Acquisition', 'Talent Management', 'Performance & Rewards', 'L&D', 'HR Operations', 'Financial Indicators']) {
      await expect(page.locator('.section-head h2', { hasText: fn })).toBeVisible();
    }
  });

  test('every registry metric has a well-formed entry and its "i" opens with the formula', async ({ page }) => {
    await loadMock(page);
    // registry hygiene: unique keys, formula + inputs on every entry, only known tabs
    const audit = await page.evaluate(() => {
      const tabs = new Set(TABS.map((t) => t.id));
      return REGISTRY.map((e) => ({
        key: e.key,
        ok: !!(e.label && e.formulaText && Array.isArray(e.inputs) && e.inputs.length && tabs.has(e.tab) && typeof e.compute === 'function')
      }));
    });
    expect(audit.length).toBeGreaterThanOrEqual(55);
    expect(audit.filter((a) => !a.ok)).toEqual([]);
    // sample one "i" per tab to confirm the reveal
    for (const [tab, key, text] of [
      ['talent', 'succession_coverage', '≥1 identified successor'],
      ['lnd', 'lms_adoption', 'Licensed users with ≥1 login'],
      ['mobility', 'posting_compliance', 'posted internally'],
      ['attrition', 'attr_regretted', 'Regretted Flag = Y'],
      ['diversity', 'female_tt', 'Female TTs ÷ all TTs'],
      ['contract', 'contract_compliance_idx', 'Simple mean of the four indices']
    ]) {
      await page.click('#tab-' + tab);
      const btn = page.locator(`[data-key="${key}"] .i-btn`).first();
      await btn.click();
      await expect(page.locator('.popover')).toContainText(text);
      await page.keyboard.press('Escape');
    }
  });

  test('data quality tab shows the six dimensions and the seeded mock flaws', async ({ page }) => {
    await loadMock(page);
    await page.click('#tab-quality');
    for (const dim of ['completeness', 'validity', 'consistency', 'uniqueness', 'timeliness', 'conformity']) {
      await expect(page.locator('.tile-label', { hasText: dim })).toBeVisible();
    }
    // seeded flaws must surface: blank exit reasons + duplicate IDs + bad DOBs + stale IDPs
    const issues = page.locator('.data-table');
    await expect(issues).toContainText('Exit Reason');
    await expect(issues).toContainText('Duplicate');
    await expect(issues).toContainText('DOB');
    await expect(issues).toContainText('IDP');
  });

  test('methodology appendix is generated from the registry and covers every metric', async ({ page }) => {
    await loadMock(page);
    await page.click('#tab-methodology');
    const counts = await page.evaluate(() => {
      const keys = REGISTRY.map((e) => e.key);
      const text = document.getElementById('panel-methodology').innerText;
      return { total: keys.length, missing: keys.filter((k) => !text.includes(k)) };
    });
    expect(counts.missing).toEqual([]);
    await expect(page.locator('#panel-methodology')).toContainText('Score = Actual ÷ Target × 100');
    await expect(page.locator('#panel-methodology')).toContainText('steel-specific block');
    await expect(page.locator('#panel-methodology')).toContainText('SIL Open Font License');
  });

  test('exec summary band is computed, specific, and click-through jumps to the metric', async ({ page }) => {
    await loadMock(page);
    const band = page.locator('.exec-band').first();
    await expect(band).toBeVisible();
    const pointCount = await band.locator('.exec-points li').count();
    expect(pointCount).toBeGreaterThanOrEqual(3);
    // numbers, not platitudes
    await expect(band).toContainText(/%|pp|\d/);
    // asset switch recomputes the band
    await page.selectOption('#sel-asset', 'Paradeep');
    await expect(page.locator('.exec-band').first()).toContainText('Paradeep');
    // click-through lands on the metric's tab
    const first = page.locator('.exec-band .linklike').first();
    const key = await first.getAttribute('data-jump');
    await first.click();
    const tab = await page.evaluate((k) => REG_BY_KEY.get(k).tab, key);
    await expect(page.locator('#panel-' + tab)).toBeVisible();
  });

  test('grade-band filter applies to tabs 1–7 and is disabled on contract tab', async ({ page }) => {
    await loadMock(page);
    const hcAll = await page.locator('[data-key="headcount_close"] .tile-value').innerText();
    await page.selectOption('#sel-band', 'AM-GM');
    const hcBand = await page.locator('[data-key="headcount_close"] .tile-value').innerText();
    expect(hcBand).not.toBe(hcAll);
    await page.click('#tab-contract');
    await expect(page.locator('#sel-band')).toBeDisabled();
    await page.click('#tab-overview');
    await expect(page.locator('#sel-band')).toBeEnabled();
  });
});
