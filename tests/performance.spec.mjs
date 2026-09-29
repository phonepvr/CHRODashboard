import { test, expect } from '@playwright/test';
import { openMock } from './helpers.mjs';

const KEYS = ['goal_setting_pct', 'midyear_review_pct', 'annual_review_pct', 'perf_cycle_headcount', 'perf_awaiting_manager'];
const PSEUDO = /^EMP-[0-9A-F]{6}$/;
const num = (s) => Number(String(s).replace(/[^\d.]/g, ''));

async function openTab(page) {
  await page.click('#tab-performance');
  await expect(page.locator('#panel-performance .perf-strip')).toBeVisible();
}

test.describe('Phase 8 — R6 Performance tab (goal setting → mid-year → annual)', () => {

  test('tiles compute real numbers; strip, funnels and cuts render, reconcile and switch phase', async ({ page }) => {
    await openMock(page);
    await openTab(page);
    const panel = page.locator('#panel-performance');

    // registry: every metric on the tab is class perf, uses real schema column names
    const reg = await page.evaluate((keys) => {
      const m = Compute.build();
      const rows = App.state.datasets.get('pms_status').rows;
      const annualScope = rows.filter((r) => r.annual_flag != null);
      return {
        tabs: keys.map((k) => REG_BY_KEY.get(k).tab),
        classes: keys.map((k) => Access.classOf(k)),
        badCols: REGISTRY.filter((e) => e.tab === 'performance').flatMap((e) => e.inputs.flatMap((i) =>
          i.columns.filter((c) => !SCHEMAS[i.dataset].columns.some((s) => s.name === c)).map((c) => `${e.key}:${i.dataset}.${c}`))),
        v: Object.fromEntries(keys.map((k) => [k, Compute.metric(k).value])),
        annualHand: annualScope.filter((r) => r.annual_flag === true).length / annualScope.length * 100,
        rows: rows.length,
        orphans: rows.filter((r) => !m.empById.has(r.employee_id)).length,
        goalDone: rows.filter((r) => r.goal_flag === true).length,
        pendingAnnual: annualScope.filter((r) => r.annual_flag !== true).length,
        scorecard: REG_BY_KEY.get('annual_review_pct').scorecard
      };
    }, KEYS);
    expect(reg.tabs).toEqual(KEYS.map(() => 'performance'));
    expect(reg.classes).toEqual(KEYS.map(() => 'perf'));
    expect(reg.badCols).toEqual([]);
    expect(reg.scorecard).toBe('Performance & Rewards');
    expect(reg.v.goal_setting_pct).toBeGreaterThan(85);
    expect(reg.v.midyear_review_pct).toBeLessThan(reg.v.goal_setting_pct);
    expect(reg.v.annual_review_pct).toBeGreaterThan(50);
    expect(reg.v.annual_review_pct).toBeLessThan(100);
    expect(reg.v.annual_review_pct).toBeCloseTo(reg.annualHand, 9);        // hand check at Group
    expect(reg.v.perf_cycle_headcount).toBe(reg.rows);                     // unscoped: every cycle row
    expect(reg.v.perf_awaiting_manager).toBeGreaterThan(0);
    expect(reg.v.perf_awaiting_manager).toBeLessThan(reg.v.perf_cycle_headcount);

    // tiles show the values; goal + mid-year moved here from Talent
    for (const k of KEYS) await expect(panel.locator(`.tile[data-key="${k}"] .tile-value`)).toHaveText(/\d/);
    await expect(panel.locator('.tile[data-key="perf_cycle_headcount"] .tile-value')).toHaveText(reg.rows.toLocaleString('en-IN'));
    await expect(panel.locator('.tile[data-key="annual_review_pct"] .tile-value')).toHaveText(`${reg.v.annual_review_pct.toFixed(1)}%`);

    // cycle strip: three steps in order, values = tiles, hover tips on the status mix
    const steps = panel.locator('.perf-step');
    await expect(steps).toHaveCount(3);
    expect(await steps.locator('.perf-step-name').allTextContents()).toEqual(['Goal setting', 'Mid-year review', 'Annual review']);
    await expect(steps.nth(2).locator('.perf-step-val')).toHaveText(`${reg.v.annual_review_pct.toFixed(1)}%`);
    await expect(steps.nth(0).locator('.perf-step-n')).toContainText(`${reg.goalDone.toLocaleString('en-IN')} of ${reg.rows.toLocaleString('en-IN')}`);
    expect(await steps.nth(1).locator('.perf-stack [data-tip]').count()).toBeGreaterThan(1);

    // status funnels: base = cycle rows, final goal stage = Goal flag Y (mock is consistent)
    const funnels = panel.locator('.perf-funnels .card');
    await expect(funnels).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(funnels.nth(i).locator('svg')).toHaveCount(1);
    const goalVals = await funnels.nth(0).locator('.bar-value').allTextContents();
    expect(num(goalVals[0])).toBe(reg.rows);
    expect(num(goalVals.at(-1).trim().split(/\s+/)[0])).toBe(reg.goalDone);   // "7,884 99% of prior"
    await expect(funnels.nth(0).locator('[data-tip]').first()).toHaveAttribute('data-tip', /In cycle/);

    // completion cuts (default phase Mid-year): five cards, each drawn
    const by = panel.locator('[data-perf-slot="by"] .card');
    await expect(by).toHaveCount(5);
    for (let i = 0; i < 5; i++) await expect(by.nth(i).locator('svg')).toHaveCount(1);
    await expect(panel.locator('[data-perf-phase="midyear"]')).toHaveAttribute('aria-pressed', 'true');
    // function bars partition the cycle: Σ n = cycle rows, and exactly one red laggard bar
    const fnCard = by.filter({ hasText: 'Mid-year review by function' });
    const fnVals = await fnCard.locator('.bar-value').allTextContents();
    const sumN = fnVals.reduce((s, t) => s + num(t.split('/')[1]), 0);
    expect(sumN).toBe(reg.rows);
    expect(await fnCard.locator('rect[fill="var(--red)"]').count()).toBe(1);
    const lag = await page.evaluate(() => PerfKit.laggards(Compute.build(), Compute.ctxNow(), 'midyear', 5));
    expect(lag.length).toBe(5);
    for (const c of lag) expect(c.n).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < lag.length; i++) expect(lag[i].pct).toBeGreaterThanOrEqual(lag[i - 1].pct);
    await expect(panel.locator('.perf-lag tbody tr').first()).toContainText(lag[0].key);
    // Group bar on the asset cut = the tile
    const assetVals = await by.nth(0).locator('.bar-value').allTextContents();
    expect(assetVals.at(-1)).toContain(`${Math.round(reg.v.midyear_review_pct)}%`);

    // phase switch → annual: cuts + laggards re-render, focus stays on the switch
    await page.click('[data-perf-phase="annual"]');
    await expect(panel.locator('[data-perf-phase="annual"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('[data-perf-phase="midyear"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(by.nth(0)).toContainText('Annual review by asset');
    await expect(panel.locator('.perf-stuck .card').first()).toContainText('Laggard functions — annual review');
    expect((await by.nth(0).locator('.bar-value').allTextContents()).at(-1)).toContain(`${Math.round(reg.v.annual_review_pct)}%`);
    await expect(panel.locator('[data-perf-phase="annual"]')).toBeFocused();

    // every card declares its access class (persona enforcement applies)
    expect(await panel.locator('.card:not([data-access="perf"])').count()).toBe(0);

    // CHRO drills: annual pending list (raw IDs) and the aggregate asset table
    await panel.locator('.tile[data-drill="annual_review_pct"]').click();
    const modal = page.locator('.modal');
    await expect(modal).toContainText('Annual review not complete');
    expect(await modal.locator('.data-table tbody tr').count()).toBe(Math.min(200, reg.pendingAnnual));
    await expect(modal.locator('.data-table tbody tr td').first()).not.toHaveText(PSEUDO);
    await page.keyboard.press('Escape');
    await panel.locator('.tile[data-drill="perf_cycle_headcount"]').click();
    await expect(modal).toContainText('Cycle completion by asset');
    await expect(modal.locator('.data-table tbody tr')).toHaveCount(5);   // 4 assets + Group
    await page.keyboard.press('Escape');

    // Talent keeps recognition only; the cycle metrics are gone from it
    await page.click('#tab-talent');
    await expect(page.locator('#panel-talent .tile[data-key="recognition_coverage"]')).toBeVisible();
    await expect(page.locator('#panel-talent .tile[data-key="goal_setting_pct"]')).toHaveCount(0);
  });

  test('segment filter changes the numbers; a segment-locked persona sees the same slice', async ({ page }) => {
    await openMock(page);
    await openTab(page);
    const panel = page.locator('#panel-performance');
    const tile = panel.locator('.tile[data-key="perf_cycle_headcount"] .tile-value');
    const all = num(await tile.innerText());
    await page.selectOption('#sel-seg', 'Projects');
    await expect.poll(async () => num(await tile.innerText())).toBeLessThan(all);
    const proj = num(await tile.innerText());
    expect(proj).toBeGreaterThan(0);
    const segCard = panel.locator('[data-perf-slot="by"] .card', { hasText: 'by business segment' });
    await expect(segCard.locator('svg text', { hasText: 'Projects' })).toHaveCount(1);
    await expect(segCard.locator('svg text', { hasText: 'Operations' })).toHaveCount(0);
    expect(num((await panel.locator('.perf-funnels .card').first().locator('.bar-value').first().textContent()))).toBe(proj);
    const projAnnual = await page.evaluate(() => Compute.metric('annual_review_pct').value);
    // Business HR Head (Projects): locked slice equals the CHRO Projects slice
    await page.evaluate(() => App.setPersona('segment_head', { segment: 'Projects' }));
    await openTab(page);
    await expect(panel.locator('.tile[data-key="perf_cycle_headcount"] .tile-value')).toHaveText(proj.toLocaleString('en-IN'));
    expect(await page.evaluate(() => Compute.metric('annual_review_pct').value)).toBeCloseTo(projAnnual, 9);
  });

  test('masked persona (HRBP): own asset + function, pseudonymised drills and manager table, small cells withheld', async ({ page }) => {
    await openMock(page);
    const groupN = await page.evaluate(() => Compute.metric('perf_cycle_headcount').value);
    await page.evaluate(() => App.setPersona('hrbp', { asset: 'Vizag' }));
    await openTab(page);
    const panel = page.locator('#panel-performance');
    const scope = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      const rows = PerfKit.rows(m, ctx);
      return {
        fn: Access.lockedFunction(), n: Compute.metric('perf_cycle_headcount').value,
        offScope: rows.filter(({ e }) => !e || e.asset !== 'Vizag' || e.function !== Access.lockedFunction()).length,
        rawMgr: PerfKit.managerDrill(m, ctx).rows.map((r) => r[0]).filter((x) => !/^\(/.test(x)),
        rawEmp: PerfKit.pendingDrill(m, ctx, 'annual').rows.map((r) => r[0]),
        small: PerfKit.completionBy(m, ctx, 'midyear', ({ e }) => e?.level ?? null).filter((c) => c.n > 0 && c.n < CONFIG.minCell).length
      };
    });
    expect(scope.n).toBeGreaterThan(0);
    expect(scope.n).toBeLessThan(groupN);
    expect(scope.offScope).toBe(0);
    await expect(panel.locator('.tile[data-key="perf_cycle_headcount"] .tile-value')).toHaveText(scope.n.toLocaleString('en-IN'));
    // no peers, no Group benchmark on the asset cut
    const assetCard = panel.locator('[data-perf-slot="by"] .card').first();
    expect(await assetCard.locator('.bar-label').allTextContents()).toEqual(['Vizag']);
    for (const peer of ['Hazira', 'Paradeep', 'Kirandul']) expect(await panel.locator('svg text', { hasText: peer }).count()).toBe(0);
    // small cells: every n < minCell cut shows as withheld, never as a rate
    const lvlCard = panel.locator('[data-perf-slot="by"] .card', { hasText: 'by level' });
    expect(await lvlCard.locator('.bar-value', { hasText: 'withheld' }).count()).toBe(scope.small);

    // manager table on the tab: pseudonyms only
    await expect(panel.locator('.perf-masked')).toBeVisible();
    const mgrCells = await panel.locator('.perf-mgr tbody tr td:first-child').allTextContents();
    expect(mgrCells.length).toBeGreaterThan(0);
    for (const c of mgrCells) expect(c).toMatch(PSEUDO);
    const tabText = await panel.innerText();
    for (const id of scope.rawMgr.slice(0, 20)) expect(tabText).not.toContain(id);

    // drills: pseudonymised Manager / Employee columns, raw IDs never in the modal
    const modal = page.locator('.modal');
    await panel.locator('.tile[data-drill="perf_awaiting_manager"]').click();
    await expect(modal).toContainText('identifiers masked');
    for (const c of await modal.locator('.data-table tbody tr td:first-child').allTextContents()) expect(c).toMatch(/^(EMP-[0-9A-F]{6}|\(.*\))$/);
    let text = await modal.innerText();
    for (const id of scope.rawMgr.slice(0, 20)) expect(text).not.toContain(id);
    await page.keyboard.press('Escape');
    await panel.locator('.tile[data-drill="annual_review_pct"]').click();
    await expect(modal).toContainText('identifiers masked');
    const empCells = await modal.locator('.data-table tbody tr td:first-child').allTextContents();
    expect(empCells.length).toBe(Math.min(200, scope.rawEmp.length));
    for (const c of empCells) expect(c).toMatch(PSEUDO);
    text = await modal.innerText();
    for (const id of scope.rawEmp.slice(0, 20)) expect(text).not.toContain(id);
    await page.keyboard.press('Escape');
  });

  test('personas without Performance cannot reach it; "none" PII (C&B) never gets rows', async ({ page }) => {
    await openMock(page);
    for (const id of ['coe_ta', 'hrops']) {
      await page.evaluate((p) => App.setPersona(p), id);
      await expect(page.locator('#tab-performance'), id).toHaveCount(0);
      await expect(page.locator('#panel-performance'), id).toHaveCount(0);
      const r = await page.evaluate((keys) => keys.map((k) => [Access.level(k), Compute.metric(k).value, Compute.metric(k).restricted]), KEYS);
      for (const [lvl, v, res] of r) { expect(lvl).toBe('hidden'); expect(v).toBeNull(); expect(res).toBe('hidden'); }
    }
    // TA COE: a probe card for these metrics is restricted, with no chart body
    const probe = await page.evaluate(() => {
      App.setPersona('coe_ta');
      const host = document.createElement('div');
      host.innerHTML = Charts.card({ title: 'Probe', infoKey: 'annual_review_pct', body: '<svg class="probe"></svg>' });
      return { restricted: host.firstElementChild.classList.contains('is-restricted'), svg: host.querySelectorAll('svg.probe').length };
    });
    expect(probe).toEqual({ restricted: true, svg: 0 });

    // C&B: no tab, aggregate-only values, no drills, row-level detail withheld
    await page.evaluate(() => App.setPersona('coe_cnb'));
    await expect(page.locator('#tab-performance')).toHaveCount(0);
    const cnb = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      const host = document.createElement('div');
      TabRenderers.performance(host);                  // e.g. a future print/preview surface
      const rawIds = PerfKit.managerDrill(m, ctx).rows.map((r) => r[0]).filter((x) => !/^\(/.test(x)).slice(0, 30);
      return {
        levels: ['annual_review_pct', 'perf_awaiting_manager'].map((k) => Access.level(k)),
        canDrill: ['annual_review_pct', 'perf_awaiting_manager', 'perf_cycle_headcount'].map((k) => Access.canDrill(k)),
        drillMasked: [PerfKit.managerDrill(m, ctx), PerfKit.pendingDrill(m, ctx, 'annual')].map((d) => Access.maskDrill(d)),
        tableMasked: Access.maskTable(PerfKit.MANAGER_COLUMNS, PerfKit.byManager(m, ctx).slice(0, 5).map(PerfKit.managerRow)),
        value: Compute.metric('annual_review_pct').value,
        aggBadges: host.querySelectorAll('.tile .tile-badge').length,
        drillTiles: host.querySelectorAll('.tile[data-drill]').length,
        mgrTables: host.querySelectorAll('.perf-mgr').length,
        withheld: host.querySelector('.perf-withheld')?.textContent || '',
        leaked: rawIds.filter((id) => host.innerHTML.includes(id)).length,
        pseudo: /EMP-[0-9A-F]{6}/.test(host.innerHTML)
      };
    });
    expect(cnb.levels).toEqual(['agg', 'agg']);
    expect(cnb.canDrill).toEqual([false, false, false]);
    expect(cnb.drillMasked).toEqual([null, null]);
    expect(cnb.tableMasked).toBeNull();
    expect(cnb.value).toBeGreaterThan(0);               // aggregate still served
    expect(cnb.aggBadges).toBe(KEYS.length);
    expect(cnb.drillTiles).toBe(0);
    expect(cnb.mgrTables).toBe(0);
    expect(cnb.withheld).toContain('C&B / HR Finance');
    expect(cnb.leaked).toBe(0);
    expect(cnb.pseudo).toBe(false);
  });
});
