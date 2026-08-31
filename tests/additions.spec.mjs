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

test.describe('Phase 7 — metrics incorporated from the second reference pass', () => {

  test('demographics: age buckets sum to the DOB-carrying headcount; averages render', async ({ page }) => {
    await loadMock(page);
    const r = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      const perm = Compute.actives(m, ctx, 'Permanent').filter((e) => e.dob != null);
      return {
        headcount: perm.length,
        avgAge: Compute.metric('avg_age').value,
        avgTenure: Compute.metric('avg_tenure').value
      };
    });
    expect(r.avgAge).toBeGreaterThan(25);
    expect(r.avgAge).toBeLessThan(55);
    expect(r.avgTenure).toBeGreaterThan(1);
    // bars in the age chart sum to the population
    const barTips = await page.locator('#charts-overview-demo .card').first().locator('[data-tip]').allTextContents();
    const sum = await page.evaluate(() => {
      const svg = document.querySelector('#charts-overview-demo .card svg');
      return [...svg.querySelectorAll('.bar-value')].reduce((s, t) => s + (parseInt(t.textContent.replace(/,/g, '')) || 0), 0);
    });
    expect(sum).toBe(r.headcount);
  });

  test('performance cycle: goal setting high, mid-year lagging and asset-varied; scorecard P&R includes both', async ({ page }) => {
    await loadMock(page);
    const r = await page.evaluate(() => ({
      goal: Compute.metric('goal_setting_pct').value,
      mid: Compute.metric('midyear_review_pct').value,
      midHz: Compute.metric('midyear_review_pct', { asset: 'Hazira' }).value,
      midKd: Compute.metric('midyear_review_pct', { asset: 'Kirandul' }).value
    }));
    expect(r.goal).toBeGreaterThan(85);
    expect(r.mid).toBeLessThan(r.goal);
    expect(r.midHz).not.toBeCloseTo(r.midKd, 0); // the by-asset story exists
    await page.click('#tab-scorecard');
    const pr = page.locator('.sc-table').filter({ hasText: 'Goal-setting completion' });
    await expect(pr).toContainText('Mid-year review completion');
    await expect(pr).toContainText('Recognition coverage');
  });

  test('L&D depth: feedback, cost, compliance coverage, HSE days compute; programme drill opens', async ({ page }) => {
    await loadMock(page);
    const r = await page.evaluate(() => ({
      fb: Compute.metric('learning_feedback_avg').value,
      cost: Compute.metric('lnd_cost_per_emp').value,
      comp: Compute.metric('compliance_coverage').value,
      hse: Compute.metric('safety_learning_days').value,
      done: Compute.metric('programme_completion_pct').value
    }));
    expect(r.fb).toBeGreaterThan(3);
    expect(r.fb).toBeLessThanOrEqual(5);
    expect(r.cost).toBeGreaterThan(100);
    expect(r.comp).toBeGreaterThan(0);
    expect(r.hse).toBeGreaterThan(0);
    expect(r.done).toBeGreaterThan(50);
    await page.click('#tab-lnd');
    await page.click('.tile[data-drill="learning_feedback_avg"]');
    const modal = page.locator('.modal');
    await expect(modal).toContainText('Programme summary');
    await expect(modal).toContainText('Cost / participant');
    await page.keyboard.press('Escape');
  });

  test('attrition split: voluntary ≤ total; senior-exit drill shows the reasons table', async ({ page }) => {
    await loadMock(page);
    const r = await page.evaluate(() => ({
      total: Compute.metric('attr_annualised').value,
      vol: Compute.metric('attr_voluntary').value
    }));
    expect(r.vol).toBeGreaterThan(0);
    expect(r.vol).toBeLessThanOrEqual(r.total);
    await page.click('#tab-attrition');
    await expect(page.locator('#panel-attrition .card', { hasText: 'Total vs voluntary' })).toBeVisible();
    const seniorTile = page.locator('.tile[data-key="senior_exits"]');
    await expect(seniorTile).toBeVisible();
    await seniorTile.click();
    await expect(page.locator('.modal')).toContainText('Senior exits in period');
    await expect(page.locator('.modal .data-table')).toContainText('Reason');
    await page.keyboard.press('Escape');
  });

  test('recognition + wellbeing: coverage computes; wellbeing tiles declare aggregate-only', async ({ page }) => {
    await loadMock(page);
    const cov = await page.evaluate(() => Compute.metric('recognition_coverage').value);
    expect(cov).toBeGreaterThan(20);
    expect(cov).toBeLessThan(100);
    await page.click('#tab-diversity');
    await expect(page.locator('.tile[data-key="counselling_sessions"]')).toBeVisible();
    const iBtn = page.locator('.tile[data-key="counselling_sessions"] .i-btn');
    await iBtn.click();
    await expect(page.locator('.popover')).toContainText('Aggregate counts only');
    await page.keyboard.press('Escape');
  });

  test('new templates download with registry-matching headers (pms, recognition, wellbeing)', async ({ page }) => {
    await page.goto(ARTIFACT);
    const expected = await page.evaluate(() =>
      Object.fromEntries(['pms_status', 'recognition', 'wellbeing']
        .map((id) => [id, SCHEMAS[id].columns.map((c) => c.name)])));
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.click('#gate-templates');
    for (const id of Object.keys(expected)) await page.click(`[data-template="${id}"]`);
    await expect.poll(() => downloads.length).toBe(3);
    const fs = await import('node:fs');
    for (const d of downloads) {
      const name = d.suggestedFilename().replace('.csv', '');
      const text = fs.readFileSync(await d.path(), 'utf8');
      expect(text.split(/\r?\n/)[0]).toBe(expected[name].join(','));
    }
  });
});
