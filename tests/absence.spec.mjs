import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ARTIFACT, FIX, openMock, loadFiles } from './helpers.mjs';

const KEYS = ['absenteeism_pct', 'abs_attendance_pct', 'abs_planned_leave_pct', 'abs_spells_per_emp', 'abs_frequent_count', 'abs_days_lost'];
const num = (s) => Number(String(s).replace(/[^\d.]/g, ''));
const ID_RE = /AMNS-[A-Z]{2}-\d+|EMP-[0-9A-F]{6}/;

function tripwire(page) {
  const net = [];
  page.on('request', (req) => { if (!/^(file|data|about|blob):/.test(req.url())) net.push(req.url()); });
  return net;
}

async function openAs(page, persona, bind = {}) {
  await openMock(page);
  await page.evaluate(([p, b]) => App.setPersona(p, b), [persona, bind]);
}

async function download(page, trigger) {
  const [d] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: d.suggestedFilename(), text: readFileSync(await d.path(), 'utf8') };
}

test.describe('Phase 8 — R9 Absenteeism tab', () => {

  test('mock: tiles compute real numbers that reconcile with the raw rows', async ({ page }) => {
    const net = tripwire(page);
    await openMock(page);
    await page.click('#tab-absence');
    const panel = page.locator('#panel-absence');
    for (const k of KEYS) await expect(panel.locator(`.tile[data-key="${k}"] .tile-value`)).toHaveText(/\d/);
    const r = await page.evaluate((keys) => {
      const v = Object.fromEntries(keys.map((k) => [k, Compute.metric(k).value]));
      // independent recomputation from the parsed dataset (Group, all bands, current period)
      const m = Compute.build(), ctx = Compute.ctxNow();
      const rows = App.state.datasets.get('absence_monthly').rows.filter((r) => r.month >= ctx.startMonth && r.month <= ctx.endMonth);
      const s = (f) => rows.reduce((a, r) => a + (r[f] || 0), 0);
      const by = new Map();
      for (const r of App.state.datasets.get('absence_monthly').rows) {
        if (r.month < ctx.endMonth - 2 || r.month > ctx.endMonth || r.absence_spells == null) continue;
        by.set(r.employee_id, (by.get(r.employee_id) || 0) + r.absence_spells);
      }
      return {
        v, rowCount: rows.length,
        abs: s('unplanned_days') / s('scheduled_days') * 100,
        att: s('days_present') / s('scheduled_days') * 100,
        plan: s('planned_leave_days') / s('scheduled_days') * 100,
        lost: s('unplanned_days'),
        spells: s('absence_spells') / rows.filter((r) => r.absence_spells != null).length * 12,
        freq: [...by.values()].filter((n) => n >= 3).length,
        classes: keys.map((k) => Access.classOf(k)),
        tabs: keys.map((k) => REG_BY_KEY.get(k).tab),
        drill: keys.map((k) => !!REG_BY_KEY.get(k).drill),
        orphans: rows.filter((r) => !m.empById.get(r.employee_id)).length
      };
    }, KEYS);
    expect(r.rowCount).toBeGreaterThan(10000);
    expect(r.orphans).toBeLessThan(r.rowCount * 0.01);       // orphan rows too few to move a decimal
    expect(r.v.absenteeism_pct).toBeCloseTo(r.abs, 1);
    expect(r.v.abs_attendance_pct).toBeCloseTo(r.att, 1);
    expect(r.v.abs_planned_leave_pct).toBeCloseTo(r.plan, 1);
    expect(r.v.abs_spells_per_emp).toBeCloseTo(r.spells, 1);
    expect(Math.abs(r.v.abs_days_lost - r.lost)).toBeLessThan(r.lost * 0.01);
    expect(Math.abs(r.v.abs_frequent_count - r.freq)).toBeLessThanOrEqual(2);
    // plausible, and the three shares reconcile to 100 %
    expect(r.v.absenteeism_pct).toBeGreaterThan(0.5);
    expect(r.v.absenteeism_pct).toBeLessThan(8);
    expect(r.v.abs_attendance_pct + r.v.abs_planned_leave_pct + r.v.absenteeism_pct).toBeCloseTo(100, 0);
    expect(r.v.abs_frequent_count).toBeGreaterThan(0);
    expect(r.classes).toEqual(KEYS.map(() => 'attendance'));
    expect(r.tabs).toEqual(KEYS.map(() => 'absence'));
    // the cohort is a count only: no drill on its tile, and its "i" says so
    expect(r.drill[KEYS.indexOf('abs_frequent_count')]).toBe(false);
    const cohort = panel.locator('.tile[data-key="abs_frequent_count"]');
    await expect(cohort).not.toHaveAttribute('data-drill', /.*/);
    await cohort.locator('.i-btn').click();
    await expect(page.locator('.popover')).toContainText('COUNT ONLY');
    await expect(page.locator('.popover')).toContainText('never a named list');
    await page.keyboard.press('Escape');
    // tile shows the computed value
    await expect(panel.locator('.tile[data-key="abs_days_lost"] .tile-value')).toContainText(Math.round(r.v.abs_days_lost).toLocaleString('en-IN'));
    expect(net).toEqual([]);
  });

  test('charts render: trend by asset, composition, cohort, four dimension cuts, days-lost heat table', async ({ page }) => {
    await openMock(page);
    await page.click('#tab-absence');
    const panel = page.locator('#panel-absence');
    const cards = panel.locator('.card');
    await expect(cards).toHaveCount(9);
    expect(await panel.locator('.card:not([data-access="attendance"])').count()).toBe(0);
    expect(await panel.locator('.card .chart-empty, .card.is-restricted').count()).toBe(0);
    // trend: one direct-labelled line per asset + Group, hover strips carry tooltips
    const trend = cards.filter({ hasText: 'Monthly absenteeism by asset' });
    for (const a of ['Hazira', 'Paradeep', 'Vizag', 'Kirandul', 'Group']) await expect(trend.locator('svg .series-label', { hasText: a })).toHaveCount(1);
    expect(await trend.locator('rect[data-tip]').count()).toBeGreaterThanOrEqual(12);
    // dimension cuts, in CONFIG order where one exists
    const band = cards.filter({ hasText: 'Absenteeism by management band' });
    expect(await band.locator('.bar-label').allTextContents()).toEqual(['SM', 'MM', 'JM', 'Blue Collar']);
    const level = cards.filter({ hasText: 'Absenteeism by level' });
    const levels = await level.locator('.bar-label').allTextContents();
    expect(levels[0]).toBe('M-2');
    expect(levels.length).toBeGreaterThanOrEqual(8);
    await expect(cards.filter({ hasText: 'Absenteeism by business segment' }).locator('.bar-label', { hasText: 'Projects' })).toHaveCount(1);
    expect(await cards.filter({ hasText: 'Absenteeism by function' }).locator('.bar-label').count()).toBeGreaterThanOrEqual(8);
    // exactly one focus (highest) bar per dimension card, all bars direct-labelled
    for (const t of ['function', 'level', 'management band', 'business segment']) {
      const c = cards.filter({ hasText: 'Absenteeism by ' + t });
      expect(await c.locator('rect[fill="var(--red)"]').count(), t).toBe(1);
      for (const v of await c.locator('.bar-value').allTextContents()) expect(v).toMatch(/\d\.\d%/);
    }
    // cohort by asset: the Group bar equals the tile
    const tile = await page.evaluate(() => Compute.metric('abs_frequent_count').value);
    const cohort = cards.filter({ hasText: 'Frequent-absence cohort by asset' });
    await expect(cohort.locator('g[data-setasset="Group"] .bar-value')).toContainText(tile.toLocaleString('en-IN'));
    // heat table: assets + Group × 12 months, every data cell has a tooltip; Group total = days lost over those months
    const heat = panel.locator('table.abs-heat');
    await expect(heat.locator('tbody tr')).toHaveCount(5);
    await expect(heat.locator('thead th')).toHaveCount(1 + 12 + 2);
    await expect(heat.locator('tbody td[data-tip]')).toHaveCount(5 * 12);
    const groupTotal = num(await heat.locator('tbody tr.abs-group td.abs-total').first().textContent());
    const twelve = await page.evaluate(() => Compute.metric('abs_days_lost', { endMonth: AS_OF_MONTH, periodMonths: 12 }).value);
    expect(Math.abs(groupTotal - twelve)).toBeLessThanOrEqual(1);
    await expect(panel.locator('.abs-legend .abs-key')).toHaveCount(5);
    // clicking an asset row head focuses it (cross-filter)
    await heat.locator('tbody th [data-setasset="Paradeep"]').click();
    await expect(page.locator('#sel-asset')).toHaveValue('Paradeep');
    await expect(page.locator('#panel-absence table.abs-heat tbody tr.abs-focus th')).toHaveText('Paradeep');
    const pd = await page.evaluate(() => Compute.metric('absenteeism_pct').value);
    const grp = await page.evaluate(() => Compute.metric('absenteeism_pct', { asset: 'Group' }).value);
    expect(pd).not.toBeCloseTo(grp, 1);
    // tooltips reach the shared tip element
    await page.locator('#panel-absence table.abs-heat tbody td[data-tip]').first().hover();
    await expect(page.locator('#tip')).toContainText('days lost');
  });

  test('segment, band and asset filters change the numbers on the tab', async ({ page }) => {
    await openMock(page);
    await page.click('#tab-absence');
    const lost = page.locator('#panel-absence .tile[data-key="abs_days_lost"] .tile-value');
    const all = num(await lost.textContent());
    await page.selectOption('#sel-seg', 'Projects');
    await expect(page.locator('#scope-chip')).toHaveText('Business: Projects');
    await expect.poll(async () => num(await lost.textContent())).toBeLessThan(all);
    const proj = num(await lost.textContent());
    const r = await page.evaluate(() => ({
      proj: Compute.metric('absenteeism_pct').value,
      ops: Compute.metric('absenteeism_pct', { segment: 'Operations' }).value
    }));
    expect(r.proj).toBeGreaterThan(r.ops);                      // project sites run higher in the mock
    const segBars = await page.locator('#panel-absence .card', { hasText: 'Absenteeism by business segment' }).locator('.bar-label').allTextContents();
    expect(segBars).toEqual(['Projects']);
    await page.selectOption('#sel-seg', 'All');
    await expect(page.locator('#sel-band')).toBeEnabled();      // employee-keyed tab: the grade-band filter applies
    await page.selectOption('#sel-band', 'AM-GM');
    await expect.poll(async () => num(await lost.textContent())).toBeLessThan(all);
    expect(num(await lost.textContent())).not.toBe(proj);
  });

  test('CHRO drill: per-employee day counts only — no reasons; cohort membership is never listed', async ({ page }) => {
    await openMock(page);
    await page.click('#tab-absence');
    await page.click('#panel-absence .tile[data-drill="absenteeism_pct"]');
    const modal = page.locator('.modal');
    await expect(modal).toContainText('counts only, no reasons');
    const heads = await modal.locator('thead th').allTextContents();
    expect(heads).toEqual(['Employee', 'Asset', 'Function', 'Band', 'Months', 'Scheduled days', 'Present', 'Planned leave', 'Unplanned absence']);
    expect(heads.join(' ')).not.toMatch(/reason|sick|medical|diagnos|cohort|spell/i);
    const first = await modal.locator('tbody tr td:first-child').first().textContent();
    expect(first).toMatch(/^AMNS-[A-Z]{2}-\d+$/);
    expect(await modal.locator('tbody tr').count()).toBeLessThanOrEqual(200);
    await page.keyboard.press('Escape');
    // per-person spell counts would be the cohort list: the spell metric drills to aggregates, even for CHRO
    await page.click('#panel-absence .tile[data-drill="abs_spells_per_emp"]');
    await expect(modal).toContainText('spell counts are never shown per employee');
    expect((await modal.locator('thead th').allTextContents())[0]).toBe('Asset');
    expect(await modal.innerText()).not.toMatch(ID_RE);
    await page.keyboard.press('Escape');
    // nothing on the tab itself names a person
    expect(await page.locator('#panel-absence').innerText()).not.toMatch(ID_RE);
  });

  test('masked persona (HR Ops): drills give aggregates only — no identifiers, not even pseudonyms', async ({ page }) => {
    await openAs(page, 'hrops');
    await expect(page.locator('#tab-absence')).toHaveCount(1);
    await page.click('#tab-absence');
    const tile = page.locator('#panel-absence .tile[data-key="absenteeism_pct"]');
    await expect(tile).toHaveAttribute('data-drill', 'absenteeism_pct');
    await tile.click();
    const modal = page.locator('.modal');
    await expect(modal).toContainText('aggregates only');
    await expect(modal).toContainText('individual records withheld');
    const heads = await modal.locator('thead th').allTextContents();
    expect(heads[0]).toBe('Asset');
    expect(heads).not.toContain('Employee');
    const text = await modal.innerText();
    expect(text).not.toMatch(ID_RE);
    const csv = await download(page, () => page.click('[data-drill-csv]'));
    expect(csv.text).not.toMatch(ID_RE);
    expect(csv.text.split(/\r?\n/)[0]).toContain('Asset,Function,Employees');
    await page.keyboard.press('Escape');
    // every tile drill of the tab behaves the same
    for (const k of ['abs_days_lost', 'abs_spells_per_emp']) {
      await page.click(`#panel-absence .tile[data-drill="${k}"]`);
      expect(await page.locator('.modal').innerText()).not.toMatch(ID_RE);
      await page.keyboard.press('Escape');
    }
  });

  test('HRBP (masked, asset + function): own scope only, small cells suppressed, no peers', async ({ page }) => {
    await openAs(page, 'hrbp', { asset: 'Vizag' });
    await page.click('#tab-absence');
    const panel = page.locator('#panel-absence');
    const r = await page.evaluate(() => ({ fn: Access.lockedFunction(), v: Compute.metric('absenteeism_pct').value, g: Compute.metric('absenteeism_pct', { asset: 'Group' }) }));
    expect(r.fn).toBeTruthy();
    expect(r.v).toBeGreaterThan(0);
    expect(r.g.restricted).toBe('scope');                     // no Group benchmark for an HRBP
    await expect(panel.locator('table.abs-heat tbody tr')).toHaveCount(1);
    await expect(panel.locator('table.abs-heat tbody th')).toHaveText('Vizag');
    for (const peer of ['Hazira', 'Paradeep', 'Kirandul']) {
      expect(await panel.locator('svg text', { hasText: peer }).count(), peer).toBe(0);
      expect(await panel.locator(`[data-setasset="${peer}"]`).count()).toBe(0);
    }
    const fnBars = await panel.locator('.card', { hasText: 'Absenteeism by function' }).locator('.bar-label').allTextContents();
    expect(fnBars).toEqual([r.fn]);
    // small bases are withheld rather than drawn
    expect(await panel.locator('.bar-value', { hasText: 'suppressed' }).count()).toBeGreaterThan(0);
    await panel.locator('.tile[data-drill="absenteeism_pct"]').click();
    expect(await page.locator('.modal').innerText()).not.toMatch(ID_RE);
  });

  test('personas that must not see absence: tab never rendered; "none" PII withholds the drill', async ({ page }) => {
    await openMock(page);
    for (const p of ['coe_cnb', 'coe_ta', 'coe_talent']) {
      await page.evaluate((id) => App.setPersona(id), p);
      await expect(page.locator('#tab-absence'), p).toHaveCount(0);
      await expect(page.locator('#panel-absence'), p).toHaveCount(0);
      expect(await page.evaluate(() => Access.canSeeTab('absence'))).toBe(false);
    }
    // C&B: identifiers 'none', attendance aggregate-only → no drill at all, and the drill
    // object itself is withheld by the masking choke point
    const r = await page.evaluate(() => {
      App.setPersona('coe_cnb');
      const d = REG_BY_KEY.get('absenteeism_pct').drill(Compute.build(), Compute.ctxNow());
      return { pii: Access.pii(), level: Access.level('absenteeism_pct'), canDrill: Access.canDrill('absenteeism_pct'), rows: d.rows.length, masked: Access.maskDrill(d) };
    });
    expect(r).toEqual({ pii: 'none', level: 'agg', canDrill: false, rows: 0, masked: null });
    // the absence tab is in the right personas' lists
    const vis = await page.evaluate(() => PERSONAS.filter((p) => Access.tabVisibleFor(p.id, 'absence')).map((p) => p.id));
    expect(vis.sort()).toEqual(['asset_head', 'chro', 'hrbp', 'hrops', 'segment_head']);
  });

  test('without absence_monthly.csv the tab degrades to "needs data" states', async ({ page }) => {
    await page.goto(ARTIFACT);
    await loadFiles(page, [FIX('employee_master.csv')]);
    await page.keyboard.press('Escape');
    await page.click('#tab-absence');
    const panel = page.locator('#panel-absence');
    await expect(panel.locator('.tile.is-empty')).toHaveCount(KEYS.length);
    await expect(panel.locator('.tile.is-empty').first()).toContainText('absence_monthly.csv');
    await expect(panel.locator('.card .chart-empty')).toHaveCount(9);
  });
});
