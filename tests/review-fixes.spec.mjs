import { test, expect } from '@playwright/test';
import { ARTIFACT, openMock, confirmMapping } from './helpers.mjs';

/* Regression tests for the Phase 8 review findings on metric correctness and
   the mock's internal consistency. */

test.describe('Phase 8 review — metric correctness and mock consistency', () => {

  test('one time-to-fill definition (D3) on the Scorecard and the TA tab; delivery metrics never stated from n<5', async ({ page }) => {
    await openMock(page);
    const r = await page.evaluate(() => {
      const out = [];
      for (const pm of [3, 12]) {
        App.state.filters.periodMonths = pm;
        Compute.invalidate();
        for (const asset of ['Group', ...CONFIG.assets]) {
          const sc = Compute.metric('time_to_fill_median', { asset }).value, ta = Compute.metric('ta_ttf_median', { asset }).value;
          const n = TAKit.filledInPeriod(Compute.build(), Compute.ctxNow({ asset })).map((x) => TAKit.capped(TAKit.ttf(x))).filter((x) => x != null).length;
          const offers = TAKit.offersInPeriod(Compute.build(), Compute.ctxNow({ asset })).length;
          out.push({ pm, asset, sc, ta, n, offers, sla: Compute.metric('ta_sla_breach', { asset }).value,
            acc: Compute.metric('ta_offer_accept', { asset }).value, q: Compute.metric('ta_ttf_median', { asset }).quality });
        }
      }
      App.state.filters.periodMonths = 3;
      Compute.invalidate();
      return out;
    });
    for (const x of r) {
      expect(x.sc, `${x.asset} ${x.pm}`).toBe(x.ta);
      if (x.n < 5) {
        expect(x.ta, `${x.asset} ${x.pm}`).toBeNull();
        expect(x.sla).toBeNull();
        if (x.n > 0) expect(x.q).toContain('n<5');
      } else expect(x.ta).not.toBeNull();
      if (x.offers < 5) expect(x.acc).toBeNull();
    }
    // the default view has at least one small asset, shown as "—" in the TA scorecard table
    const small = r.filter((x) => x.pm === 3 && x.n > 0 && x.n < 5);
    expect(small.length).toBeGreaterThan(0);
    await page.click('#tab-ta');
    const row = page.locator('#panel-ta .card', { hasText: 'Scorecard by asset' }).locator('tr', { hasText: small[0].asset });
    await expect(row.locator('td').nth(5)).toHaveText('—');
  });

  test('an unmapped optional column reads "not computable", never a count of everyone or a false zero', async ({ page }) => {
    await page.goto(ARTIFACT);
    const csvs = await page.evaluate(() => {
      const all = Mock.toCSVs();
      const p = CSV.parse(all.get('employee_master'));
      const drop = ['Position ID', 'Level'].map((h) => p.headers.indexOf(h));
      const keep = p.headers.map((_, i) => i).filter((i) => !drop.includes(i));
      return { emp: CSV.serialize(keep.map((i) => p.headers[i]), p.rows.map((row) => keep.map((i) => row[i]))), pos: all.get('positions') };
    });
    await page.setInputFiles('#file-input', [
      { name: 'employee_master.csv', mimeType: 'text/csv', buffer: Buffer.from(csvs.emp) },
      { name: 'positions.csv', mimeType: 'text/csv', buffer: Buffer.from(csvs.pos) }
    ]);
    await confirmMapping(page);
    await page.keyboard.press('Escape');
    const v = await page.evaluate(() => ['pb_no_position_id', 'mgr_same_level', 'line_managers'].map((k) => {
      const res = Compute.metric(k);
      return [k, res.value, res.quality];
    }));
    expect(v[0][1]).toBeNull();
    expect(v[0][2]).toContain('Position ID not in employee_master.csv');
    expect(v[1][1]).toBeNull();
    expect(v[1][2]).toContain('Level not in employee_master.csv');
    expect(v[2][1]).toBeGreaterThan(0);
  });

  test('statutory register: critical items open past due — flag first, item-name fallback', async ({ page }) => {
    await openMock(page);
    const mock = await page.evaluate(() => {
      const rows = CompKit.overdueRows(Compute.build(), Compute.ctxNow());
      return { v: Compute.metric('stat_critical_open').value, expect: rows.filter((r) => r.critical_flag).length, flagged: rows.some((r) => r.critical_flag) };
    });
    expect(mock.flagged).toBe(true);
    expect(mock.v).toBe(mock.expect);
    await page.click('#tab-contract');
    await expect(page.locator('#panel-contract .tile[data-key="stat_critical_open"] .tile-value')).toHaveText(String(mock.v));
    await expect(page.locator('#panel-contract .ck-worklist thead')).toContainText('Critical');
    // a register without the flag column: critical by item name (CONFIG.criticalComplianceItems)
    const csv = [
      'Asset,Business Segment,Month,Compliance Item,Due Date,Completed Date,Status',
      'Hazira,Operations,01-2025,Factory licence renewal,31-01-2025,,Pending',
      'Hazira,Operations,05-2025,PF remittance,15-06-2025,,Pending',
      'Vizag,Operations,03-2025,Pollution control consent renewal,31-03-2025,15-03-2025,On time',
      'Vizag,Operations,04-2025,Fire NOC renewal,30-04-2025,,Pending'
    ].join('\n');
    await page.click('#btn-reset');
    await page.setInputFiles('#file-input', [{ name: 'statutory_compliance.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }]);
    await confirmMapping(page);
    await page.keyboard.press('Escape');
    const byo = await page.evaluate(() => ({ v: Compute.metric('stat_critical_open').value, q: Compute.metric('stat_critical_open').quality, all: Compute.metric('stat_pending_overdue').value }));
    expect(byo).toEqual({ v: 2, q: expect.stringContaining('judged from their names'), all: 3 });
  });

  test('count metrics carry zero targets: the tile reads against 0 and the Scorecard never scores them by scope size', async ({ page }) => {
    await openMock(page);
    const r = await page.evaluate(() => ['attr_tt_count', 'tt_3yr_nopromo', 'cp_vacancy', 'req_open_90d', 'mobility_ageing'].map((k) => {
      const t = Compute.build().targets.get(k);
      const rows = CONFIG.assets.map((a) => { App.state.filters.asset = a; Compute.invalidate(); return Scorecard.compute().functions.flatMap((f) => f.rows).find((x) => x.entry.key === k); });
      App.state.filters.asset = 'Group';
      Compute.invalidate();
      return { k, target: t?.value, scores: rows.filter(Boolean).map((x) => x.score) };
    }));
    for (const x of r) {
      expect(x.target, x.k).toBe(0);
      expect(x.scores.every((s) => s == null), x.k).toBe(true);
    }
  });

  test('superannuation "≤ 3 yrs" counts the month exactly 36 months out, matching the Outlook glidepath', async ({ page }) => {
    await openMock(page);
    const r = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      const pop = DemoKit.onRoll(m, ctx).filter((e) => e.dob != null);
      const rm = (e) => retireMonthIdx(e.dob, CONFIG.retirementAge);
      return {
        tile: Compute.metric('demo_superann_3y').value,
        window: pop.filter((e) => rm(e) <= ctx.endMonth + 36).length,
        edge: pop.filter((e) => rm(e) === ctx.endMonth + 36).length,
        edgeBucket: [...new Set(pop.filter((e) => rm(e) === ctx.endMonth + 36).map((e) => DemoKit.superBucket(e, ctx)))],
        next37: pop.filter((e) => rm(e) === ctx.endMonth + 37).map((e) => DemoKit.superBucket(e, ctx)).filter(Boolean).length
      };
    });
    expect(r.edge).toBeGreaterThan(0);
    expect(r.edgeBucket).toEqual(['2–3Y']);
    expect(r.tile).toBe(r.window);
    expect(r.next37).toBe(0);
  });

  test('scorecard: snapshot metrics show no prior actual; the contract ratio is labelled by its permanent denominator', async ({ page }) => {
    await openMock(page);
    await page.click('#tab-scorecard');
    for (const k of ['succession_coverage', 'goal_setting_pct', 'annual_review_pct', 'lms_adoption']) {
      const row = page.locator('.sc-table tr', { has: page.locator(`[data-scoreinfo="${k}"]`) });
      await expect(row.locator('td').nth(1), k).toHaveText('snapshot');
    }
    const attr = page.locator('.sc-table tr', { has: page.locator('[data-scoreinfo="attr_annualised"]') });
    await expect(attr.locator('td').nth(1)).toHaveText(/\d/);
    await page.click('#tab-contract');
    await expect(page.locator('#panel-contract .tile[data-key="contract_onroll_ratio"] .tile-label')).toContainText('Contract-to-permanent ratio');
  });

  test('mock consistency: voluntary exits carry no involuntary reason; master promotions have a Promotion row; Gen Z sits on the permanent roll', async ({ page }) => {
    await openMock(page);
    const r = await page.evaluate(() => {
      const m = Compute.build();
      const vol = m.exits.filter((x) => x.exit_type === 'Voluntary');
      const invReasons = vol.filter((x) => ['Performance', 'Disciplinary', 'Absconding'].includes(x.exit_reason)).length;
      const promoRows = new Set(m.movements.filter((x) => x.movement_type === 'Promotion').map((x) => x.employee_id + '|' + x.effective_date));
      const active = Compute.actives(m, Compute.ctxNow(), null);
      const withMaster = active.filter((e) => e.last_promotion != null);
      const orphan = withMaster.filter((e) => !promoRows.has(e.employee_id + '|' + e.last_promotion)).length;
      const onDoj = m.emps.filter((e) => e.last_promotion != null && e.last_promotion === e.doj).length;
      const perm = Compute.actives(m, Compute.ctxNow(), 'Permanent');
      const genz = perm.filter((e) => generationOf(e.dob) === 'Gen Z').length;
      return { vol: vol.length, invReasons, withMaster: withMaster.length, orphan, onDoj, genz, perm: perm.length,
        genzRate: Compute.rateBy(m, Compute.ctxNow({ periodMonths: 12 }), (e) => generationOf(e.dob), {}).find((x) => x.key === 'Gen Z') };
    });
    expect(r.vol).toBeGreaterThan(100);
    expect(r.invReasons).toBe(0);
    expect(r.withMaster).toBeGreaterThan(1000);
    expect(r.orphan).toBe(0);
    expect(r.onDoj).toBe(0);
    expect(r.genz / r.perm).toBeGreaterThan(0.04);
    expect(r.genzRate.exits).toBeGreaterThan(0);
  });
});
