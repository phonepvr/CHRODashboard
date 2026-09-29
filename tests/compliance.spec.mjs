import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ARTIFACT, loadMock, openMock, confirmMapping } from './helpers.mjs';

// Phase 8 feature — Contract & Compliance (SSC-derived): statutory register,
// manning mix and contract-labour cost per manday.
const OPS_KEYS = ['contract_onroll_ratio', 'stat_ontime_pct', 'stat_late_items', 'stat_pending_overdue', 'stat_overdue_age_avg'];
const COST_KEYS = ['contract_cost_per_manday', 'contract_cost_total'];
const NEW_KEYS = [...OPS_KEYS, ...COST_KEYS];

async function openAs(page, persona, bind = {}) {
  await page.goto(ARTIFACT);
  await page.selectOption('#gate-persona', persona);
  if (bind.asset) await page.selectOption('#gate-persona-asset', bind.asset);
  if (bind.segment) await page.selectOption('#gate-persona-seg', bind.segment);
  await loadMock(page);
}

const tileValue = (page, key) => page.locator(`#panel-contract .tile[data-key="${key}"] .tile-value`);

test.describe('Phase 8 — Contract & Compliance (statutory register, manning mix, cost per manday)', () => {

  test('mock: new tiles show real numbers that match an independent recomputation', async ({ page }) => {
    await openMock(page);
    await page.click('#tab-contract');
    for (const k of NEW_KEYS) {
      const tile = page.locator(`#panel-contract .tile[data-key="${k}"]`);
      await expect(tile, k).toBeVisible();
      await expect(tile, k).not.toHaveClass(/is-empty|is-restricted/);
      expect(await tileValue(page, k).innerText(), k).not.toBe('—');
    }
    const r = await page.evaluate(() => {
      const st = App.state.datasets.get('statutory_compliance').rows;
      const asOf = AS_OF_DAY, from = monthEndDay(AS_OF_MONTH - 3) + 1;   // 3-month period window
      const counted = st.filter((x) => x.status !== 'Not applicable' && x.due_date >= from && x.due_date <= asOf &&
        (x.status === 'On time' || x.status === 'Late' || (x.status === 'Pending' && x.due_date < asOf)));
      const open = st.filter((x) => x.status === 'Pending' && x.due_date < asOf);
      const ca = App.state.datasets.get('contract_attendance').rows;
      const inP = ca.filter((x) => x.month >= AS_OF_MONTH - 2 && x.month <= AS_OF_MONTH && x.contract_cost != null && x.mandays_present > 0);
      const latest = Math.max(...ca.map((x) => x.month));
      const chc = ca.filter((x) => x.month === latest).reduce((s, x) => s + x.contract_headcount, 0);
      // permanent on-roll at that month end, from the raw files (dedupe by ID, first wins)
      const day = Math.min(asOf, monthEndDay(latest));
      const exitDay = new Map();
      for (const x of App.state.datasets.get('exits').rows) if (x.exit_date != null) exitDay.set(x.employee_id, Math.max(exitDay.get(x.employee_id) ?? -Infinity, x.exit_date));
      const seen = new Set();
      let perm = 0;
      for (const e of App.state.datasets.get('employee_master').rows) {
        if (seen.has(e.employee_id)) continue;
        seen.add(e.employee_id);
        if (e.employee_class === 'Permanent' && e.doj != null && e.doj <= day && !((exitDay.get(e.employee_id) ?? Infinity) <= day)) perm++;
      }
      const v = (k) => Compute.metric(k).value;
      return {
        ontime: [v('stat_ontime_pct'), counted.filter((x) => x.status === 'On time').length / counted.length * 100],
        late: [v('stat_late_items'), counted.filter((x) => x.status === 'Late').length],
        open: [v('stat_pending_overdue'), open.length],
        age: [v('stat_overdue_age_avg'), open.reduce((s, x) => s + (asOf - x.due_date), 0) / open.length],
        cpm: [v('contract_cost_per_manday'), inP.reduce((s, x) => s + x.contract_cost, 0) / inP.reduce((s, x) => s + x.mandays_present, 0)],
        total: [v('contract_cost_total'), inP.reduce((s, x) => s + x.contract_cost, 0)],
        ratio: [v('contract_onroll_ratio'), chc / perm]
      };
    });
    for (const [k, [got, want]] of Object.entries(r)) expect(got, k).toBeCloseTo(want, 6);
    // plausible mock ranges (steel-plant manning mix, ₹/manday)
    expect(r.ontime[0]).toBeGreaterThan(60);
    expect(r.ontime[0]).toBeLessThan(100);
    expect(r.open[0]).toBeGreaterThan(0);
    expect(r.ratio[0]).toBeGreaterThan(1);
    expect(r.cpm[0]).toBeGreaterThan(500);
    expect(r.cpm[0]).toBeLessThan(2000);
    // tile text is the formatted value, source labels come from SCHEMAS
    await expect(tileValue(page, 'stat_pending_overdue')).toHaveText(String(r.open[0]));
    await expect(tileValue(page, 'stat_ontime_pct')).toHaveText(r.ontime[0].toFixed(1) + '%');
    await expect(page.locator('#panel-contract .tile[data-key="stat_ontime_pct"] .tile-src')).toHaveText('[Aparajita]');
    await expect(page.locator('#panel-contract .tile[data-key="contract_cost_per_manday"] .tile-src')).toHaveText('[SCRUM]');
    // the existing contract content is still there
    for (const k of ['contract_hc', 'contract_attendance_pct', 'c_pf_esi', 'c_wage', 'c_licence', 'c_induction', 'contract_compliance_idx']) {
      await expect(page.locator(`#panel-contract .tile[data-key="${k}"]`)).toBeVisible();
    }
    for (const t of ['Daily attendance trend', 'Contract headcount by contractor', 'Compliance indices']) {
      await expect(page.locator('#panel-contract .card-title', { hasText: t })).toBeVisible();
    }
    // section order: deployment → cost → contractor indices → statutory register
    const heads = await page.locator('#panel-contract .section-head h2').allInnerTexts();
    expect(heads).toEqual(['Deployment', 'Contract labour cost', 'Statutory compliance', 'Statutory register']);
  });

  test('charts: status board, trends, ageing and worklist render, direct-labelled, with tooltips', async ({ page }) => {
    await openMock(page);
    await page.click('#tab-contract');
    const panel = page.locator('#panel-contract');
    // every card is classified and nothing is restricted for the CHRO
    expect(await panel.locator('.card:not([data-access]), .card[data-access="unclassified"]').count()).toBe(0);
    expect(await panel.locator('.is-restricted').count()).toBe(0);
    const exp = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      const scopes = Access.chartScopes();
      const items = new Set();
      for (const s of scopes) {
        const c = ChartData.subCtx(ctx, s);
        const from = CompKit.periodFrom(c);
        for (const r of [...CompKit.dueRows(m, c), ...CompKit.overdueRows(m, c),
          ...CompKit.scoped(m, c).filter((x) => x.status === 'Not applicable' && x.due_date >= from && x.due_date <= c.asOfDay)]) items.add(r.compliance_item);
      }
      return { items: items.size, scopes, ontime: Compute.metric('stat_ontime_pct').value, open: Compute.metric('stat_pending_overdue').value };
    });
    const heat = panel.locator('table.ck-heat');
    await expect(heat).toBeVisible();
    await expect(heat.locator('tbody tr[data-ck-item]:not(.ck-total)')).toHaveCount(exp.items);
    expect((await heat.locator('thead th').allTextContents()).map((t) => t.trim())).toEqual(['Compliance item', ...exp.scopes]);
    const groupAll = heat.locator('tr.ck-total td[data-ck-scope="Group"]');
    expect(Number(await groupAll.getAttribute('data-ck-pct'))).toBeCloseTo(exp.ontime, 1);
    // hover tooltip on a board cell
    await heat.locator('td.ck-cell[data-ck-pct]').first().hover();
    await expect(page.locator('#tip')).toBeVisible();
    await expect(page.locator('#tip')).toContainText('On time');
    // trend lines are direct-labelled (asset names + Group at the line ends)
    const trend = panel.locator('.card', { has: page.locator('.card-title', { hasText: 'On-time % by due month' }) });
    await expect(trend.locator('svg polyline').first()).toBeVisible();
    expect(await trend.locator('svg text.series-label').allTextContents()).toEqual(expect.arrayContaining(['Group', 'Hazira', 'Kirandul']));
    for (const t of ['Manning-mix trend', 'Cost per manday trend']) {
      const c = panel.locator('.card', { has: page.locator('.card-title', { hasText: t }) });
      expect(await c.locator('svg text.series-label').allTextContents(), t).toContain('Group');
    }
    // ratio bars: one per chart scope, value-labelled, counts beside
    const ratio = panel.locator('.card', { has: page.locator('.card-title', { hasText: 'Contract-to-on-roll ratio by asset' }) });
    await expect(ratio.locator('svg g[data-tip]')).toHaveCount(exp.scopes.length);
    await expect(ratio.locator('.ck-counts')).toContainText('Contract : on-roll headcount — Hazira');
    // ageing: every TA ageing bucket drawn, counts sum to the open stock
    const ageing = panel.locator('.card', { has: page.locator('.card-title', { hasText: 'Pending past due — ageing' }) });
    const vals = await ageing.locator('svg text.bar-value').allTextContents();
    expect(vals.length).toBe(6);
    expect(vals.reduce((s, v) => s + Number(v), 0)).toBe(exp.open);
    // worklist: oldest first, one row per open item (capped at 40)
    const wl = panel.locator('.ck-worklist tbody tr');
    await expect(wl).toHaveCount(Math.min(40, exp.open));
    const days = (await panel.locator('.ck-worklist tbody tr td:last-child').allInnerTexts()).map(Number);
    expect(days).toEqual([...days].sort((a, b) => b - a));
    // contractor-level cost chart is drawn for the CHRO (full cost access)
    const byCon = panel.locator('.card', { has: page.locator('.card-title', { hasText: 'Cost per manday by contractor' }) });
    expect(await byCon.locator('svg g[data-tip]').count()).toBeGreaterThan(3);
  });

  test('drills: open for the CHRO; HR Ops (masked) sees item-level rows, no people, cost aggregate-only; C&B (none) is withheld', async ({ page }) => {
    await openMock(page);
    await page.click('#tab-contract');
    const open = await page.evaluate(() => Compute.metric('stat_pending_overdue').value);
    await page.click('.tile[data-drill="stat_pending_overdue"]');
    const modal = page.locator('.modal');
    await expect(modal).toContainText('Pending statutory items past due');
    await expect(modal.locator('.data-table tbody tr')).toHaveCount(open);
    await page.keyboard.press('Escape');
    await page.click('.tile[data-drill="stat_ontime_pct"]');
    await expect(modal).toContainText('Statutory items by compliance item');
    await page.keyboard.press('Escape');
    await page.click('.tile[data-drill="contract_onroll_ratio"]');
    await expect(modal.locator('.data-table tbody tr', { hasText: 'Hazira' }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.click('.tile[data-drill="contract_cost_per_manday"]');
    await expect(modal).toContainText('Cost per manday (₹)');
    await expect(modal.locator('.data-table tbody tr').first()).toContainText('CNT-');
    await page.keyboard.press('Escape');

    // HR Ops (pii masked, ops full, cost agg): lands on this tab
    await page.evaluate(() => App.setPersona('hrops'));
    await expect(page.locator('#tab-contract')).toHaveAttribute('aria-selected', 'true');
    await page.click('.tile[data-drill="stat_late_items"]');
    await expect(modal).toContainText('Statutory items completed late');
    await expect(modal).not.toContainText('identifiers masked');   // statutory items identify no one
    expect(await modal.innerText()).not.toMatch(/EMP-[0-9A-F]{6}/);
    await page.keyboard.press('Escape');
    const probe = await page.evaluate((keys) => keys.map((k) => {
      const e = REG_BY_KEY.get(k);
      const d = e.drill(Compute.build(), Compute.ctxNow());
      return { k, same: Access.maskDrill(d) === d, pii: d.columns.filter((c) => PII_ID_COLUMNS.has(c) || PII_NAME_COLUMNS.has(c)) };
    }), ['stat_late_items', 'stat_pending_overdue', 'stat_ontime_pct', 'contract_onroll_ratio']);
    for (const p of probe) { expect(p.pii, p.k).toEqual([]); expect(p.same, p.k).toBe(true); }
    for (const k of COST_KEYS) {
      const t = page.locator(`.tile[data-key="${k}"]`);
      await expect(t.locator('.tile-badge')).toHaveText('Aggregate only');
      await expect(t).not.toHaveAttribute('data-drill', /.*/);
    }
    await expect(page.locator('#panel-contract .card', { hasText: 'Cost per manday by contractor' })).toContainText('row-level commercial detail');
    await expect(page.locator('#panel-contract .ck-worklist tbody tr').first()).toBeVisible();

    // C&B (pii none, ops agg): no tab, no drills; the renderer itself withholds row-level detail
    await page.evaluate(() => App.setPersona('coe_cnb'));
    await expect(page.locator('#tab-contract')).toHaveCount(0);
    const cnb = await page.evaluate((keys) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      TabRenderers.contract(host);
      const out = {
        drill: keys.map((k) => Access.canDrill(k)),
        worklistRows: host.querySelectorAll('.ck-worklist tbody tr').length,
        withheld: [...host.querySelectorAll('.card')].find((c) => c.textContent.includes('Open items past due'))?.textContent.includes('row-level detail'),
        drillAttrs: host.querySelectorAll('.tile[data-drill^="stat_"], .tile[data-drill="contract_onroll_ratio"]').length,
        badge: host.querySelector('.tile[data-key="stat_ontime_pct"] .tile-badge')?.textContent
      };
      host.remove();
      return out;
    }, OPS_KEYS);
    expect(cnb.drill).toEqual(OPS_KEYS.map(() => false));
    expect(cnb.worklistRows).toBe(0);
    expect(cnb.withheld).toBe(true);
    expect(cnb.drillAttrs).toBe(0);
    expect(cnb.badge).toBe('Aggregate only');
  });

  test('personas that must not see it: HRBP (ops + cost hidden), TA COE and Business HR Head (no tab)', async ({ page }) => {
    await openAs(page, 'hrbp', { asset: 'Vizag' });
    await expect(page.locator('#tab-contract')).toHaveCount(0);
    await expect(page.locator('#panel-contract')).toHaveCount(0);
    const hrbp = await page.evaluate((keys) => keys.map((k) => [Access.level(k), Compute.metric(k).restricted, Compute.metric(k).value]), NEW_KEYS);
    for (const [lvl, restricted, value] of hrbp) { expect(lvl).toBe('hidden'); expect(restricted).toBe('hidden'); expect(value).toBeNull(); }
    // exports omit every one of them
    await page.click('#btn-export');
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-all]')]);
    const text = readFileSync(await d.path(), 'utf8');
    for (const k of NEW_KEYS) expect(text).not.toContain(k + ',');
    await page.keyboard.press('Escape');

    await page.evaluate(() => App.setPersona('coe_ta'));
    await expect(page.locator('#tab-contract')).toHaveCount(0);
    expect(await page.evaluate((keys) => keys.map((k) => Access.level(k)), COST_KEYS)).toEqual(['hidden', 'hidden']);
    await page.evaluate(() => App.setPersona('segment_head', { segment: 'Projects' }));
    await expect(page.locator('#tab-contract')).toHaveCount(0);
    expect(await page.evaluate(() => Access.canSeeTab('contract'))).toBe(false);
  });

  test('segment filter narrows the register, the manning mix and the cost', async ({ page }) => {
    await openMock(page);
    await page.click('#tab-contract');
    const before = {
      ontime: await tileValue(page, 'stat_ontime_pct').innerText(),
      ratio: await tileValue(page, 'contract_onroll_ratio').innerText(),
      cost: await tileValue(page, 'contract_cost_per_manday').innerText(),
      rows: await page.locator('table.ck-heat tbody tr:not(.ck-total)').count()
    };
    await page.selectOption('#sel-seg', 'Projects');
    await expect(tileValue(page, 'contract_onroll_ratio')).not.toHaveText(before.ratio);
    expect(await tileValue(page, 'stat_ontime_pct').innerText()).not.toBe(before.ontime);
    expect(await tileValue(page, 'contract_cost_per_manday').innerText()).not.toBe(before.cost);
    const items = await page.locator('table.ck-heat tbody tr:not(.ck-total) th').allInnerTexts();
    expect(items.length).toBeLessThan(before.rows);
    expect(items).toEqual(expect.arrayContaining(['BOCW welfare cess']));
    expect(items).not.toContain('Factory licence renewal');
    // the values are the Projects-only values
    const seg = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      return { seg: ctx.segment, onlyProjects: CompKit.dueRows(m, ctx).every((r) => r.__seg === 'Projects') };
    });
    expect(seg).toEqual({ seg: 'Projects', onlyProjects: true });
  });

  test('asset HR head: own asset + Group benchmark only — peers never appear', async ({ page }) => {
    await openAs(page, 'asset_head', { asset: 'Hazira' });
    await page.click('#tab-contract');
    const panel = page.locator('#panel-contract');
    expect((await panel.locator('table.ck-heat thead th').allTextContents()).map((t) => t.trim())).toEqual(['Compliance item', 'Hazira', 'Group benchmark']);
    for (const peer of ['Paradeep', 'Vizag', 'Kirandul']) {
      expect(await panel.locator('svg text', { hasText: peer }).count(), peer).toBe(0);
      expect(await panel.locator('table.ck-heat', { hasText: peer }).count(), peer).toBe(0);
      expect(await panel.locator(`[data-setasset="${peer}"]`).count(), peer).toBe(0);
      expect(await panel.locator('.ck-worklist', { hasText: peer }).count(), peer).toBe(0);
    }
    const hz = await page.evaluate(() => Compute.metric('stat_pending_overdue').value);
    await expect(panel.locator('.tile[data-key="stat_pending_overdue"] .tile-value')).toHaveText(String(hz));
  });

  test('hand-checked arithmetic on a small BYOF register (due-date basis, stock vs flow, status/date flag)', async ({ page }) => {
    const csv = [
      'Asset,Business Segment,Month,Compliance Item,Due Date,Completed Date,Status',
      'Hazira,Operations,04-2025,PF remittance,15-05-2025,12-05-2025,On time',
      'Hazira,Operations,04-2025,ESIC remittance,15-05-2025,20-05-2025,Late',
      'Hazira,Operations,05-2025,PF remittance,15-06-2025,,Pending',             // 15 days past due
      'Hazira,Operations,05-2025,Boiler inspection certificate,31-05-2025,,Not applicable',
      'Paradeep,Projects,03-2025,BOCW welfare cess,15-04-2025,10-04-2025,On time',
      'Paradeep,Projects,02-2025,BOCW welfare cess,15-03-2025,,Pending',         // 107 days, due before the period
      'Paradeep,Operations,06-2025,PF remittance,15-07-2025,,Pending',            // not yet due
      'Paradeep,Operations,06-2025,Professional tax,31-07-2025,28-06-2025,On time', // due after as-of
      'Vizag,Operations,04-2025,TDS on salaries,07-05-2025,10-05-2025,On time'     // status disagrees with dates
    ].join('\n');
    await page.goto(ARTIFACT);
    await page.setInputFiles('#file-input', [{ name: 'statutory_compliance.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }]);
    await confirmMapping(page);
    await page.keyboard.press('Escape');
    await page.click('#tab-contract');
    const v = await page.evaluate(() => {
      const g = (k, o) => Compute.metric(k, o).value;
      const q = Compute.metric('stat_ontime_pct').quality;
      return {
        ontime: g('stat_ontime_pct'), late: g('stat_late_items'), open: g('stat_pending_overdue'), age: g('stat_overdue_age_avg'),
        hz: g('stat_ontime_pct', { asset: 'Hazira' }), hzOpen: g('stat_pending_overdue', { asset: 'Hazira' }),
        proj: g('stat_ontime_pct', { segment: 'Projects' }), projOpen: g('stat_pending_overdue', { segment: 'Projects' }),
        year: g('stat_ontime_pct', { periodMonths: 12 }), q
      };
    });
    // window 01-04-2025 → 30-06-2025: counted = PF(on time), ESIC(late), PF(pending, past due), BOCW Apr(on time), TDS(on time)
    expect(v.ontime).toBeCloseTo(60, 6);        // 3 ÷ 5
    expect(v.late).toBe(1);
    expect(v.open).toBe(2);                     // stock: 15 d + 107 d
    expect(v.age).toBeCloseTo(61, 6);
    expect(v.hz).toBeCloseTo(100 / 3, 6);
    expect(v.hzOpen).toBe(1);
    expect(v.proj).toBeCloseTo(100, 6);
    expect(v.projOpen).toBe(1);
    expect(v.year).toBeCloseTo(50, 6);          // 12 months pulls the March item in: 3 ÷ 6
    expect(v.q).toContain('1 statutory row carries a Status that disagrees');
    await expect(tileValue(page, 'stat_ontime_pct')).toHaveText('60.0%');
    await expect(page.locator('.tile[data-key="stat_ontime_pct"]')).toHaveClass(/is-alert-quality/);
    await expect(page.locator('table.ck-heat tr[data-ck-item="PF remittance"] td[data-ck-scope="Hazira"]')).toContainText('50%');
    // contract files absent: those tiles and charts name the missing file
    await expect(page.locator('.tile[data-key="contract_cost_per_manday"]')).toContainText('contract_attendance.csv');
    await expect(page.locator('#panel-contract .chart-empty').first()).toContainText('contract_attendance.csv');
  });
});
