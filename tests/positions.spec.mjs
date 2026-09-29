import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ARTIFACT, loadMock } from './helpers.mjs';

/* R8 — Positions & Budget tab: tiles reconcile with positions.csv, charts render
   and are direct-labelled, drills mask / withhold by persona, the tab is absent
   for personas without it, and the business-segment filter narrows the numbers. */

function tripwire(page) {
  const net = [];
  page.on('request', (req) => {
    const u = req.url();
    if (!/^(file|data|about|blob):/.test(u)) net.push(u);
  });
  return net;
}

async function loadMockAs(page, persona = 'chro', bind = {}) {
  await page.goto(ARTIFACT);
  await page.selectOption('#gate-persona', persona);
  if (bind.asset) await page.selectOption('#gate-persona-asset', bind.asset);
  if (bind.segment) await page.selectOption('#gate-persona-seg', bind.segment);
  await loadMock(page);
}

async function openTab(page) {
  await page.click('#tab-positions');
  await expect(page.locator('#panel-positions .section-head h2', { hasText: 'Position inventory' })).toBeVisible();
}

const tile = (page, key) => page.locator(`#panel-positions .tile[data-key="${key}"]`);
const tileNum = async (page, key) => Number((await tile(page, key).locator('.tile-value').innerText()).replace(/[^\d.]/g, ''));
const card = (page, title) => page.locator('#panel-positions .card', { has: page.locator('.card-title', { hasText: title }) });

async function openDrill(page, key) {
  await tile(page, key).click({ position: { x: 20, y: 40 } });
  await expect(page.locator('.modal')).toBeVisible();
  return page.locator('.modal');
}
async function closeModal(page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
}

const CHART_CARDS = ['Vacancy rate by asset', 'Vacancy rate by function', 'Vacancy rate by level', 'Vacancy ageing',
  'Vacancies by requisition cover', 'HC budget vs filled positions by asset', 'HC budget vs filled positions by function'];

test.describe('Phase 8 — R8 Positions & Budget', () => {

  test('tiles compute real numbers that reconcile with the loaded positions.csv', async ({ page }) => {
    const net = tripwire(page);
    await loadMockAs(page);
    await openTab(page);
    const panel = page.locator('#panel-positions');
    await expect(panel).not.toContainText('This section is being built');
    // independent recount from the raw rows (CHRO, Group, Business: All)
    const raw = await page.evaluate(() => {
      const rows = App.state.datasets.get('positions').rows;
      const n = (s) => rows.filter((r) => r.position_status === s).length;
      const asOf = parseDMY(CONFIG.asOf);
      const vac = rows.filter((r) => r.position_status === 'Vacant');
      const reqs = new Map(App.state.datasets.get('requisitions').rows.map((r) => [r.requisition_id, r]));
      const open = (id) => { const q = reqs.get(id); return !!q && q.closed_date == null && q.req_status !== 'Dropped' && q.req_status !== 'Closed'; };
      const ids = new Set(rows.map((r) => r.position_id));
      const emps = App.state.datasets.get('employee_master').rows;
      const exits = new Map(App.state.datasets.get('exits').rows.map((x) => [x.employee_id, x.exit_date]));
      const seen = new Set();
      const unpositioned = emps.filter((e) => {
        if (seen.has(e.employee_id)) return false;
        seen.add(e.employee_id);
        const gone = exits.has(e.employee_id) && exits.get(e.employee_id) <= asOf;
        return e.employee_class === 'Permanent' && e.doj != null && e.doj <= asOf && !gone && (!e.position_id || !ids.has(e.position_id));
      }).length;
      const bud = App.state.datasets.get('hc_budget').rows;
      const last = Math.max(...bud.map((b) => b.month));
      const budget = bud.filter((b) => b.month === last).reduce((s, b) => s + b.budget_hc, 0);
      return {
        total: rows.length, filled: n('Filled'), vacant: n('Vacant'), held: n('Frozen') + n('On Hold'),
        aged: vac.filter((r) => r.vacant_since != null && asOf - r.vacant_since > 90).length,
        noReq: vac.filter((r) => !open(r.requisition_id)).length,
        cp: vac.filter((r) => r.cp_flag).length,
        budUnfilled: rows.filter((r) => r.budgeted_flag && (r.position_status === 'Vacant' || r.position_status === 'On Hold')).length,
        unpositioned, budget
      };
    });
    expect(raw.total).toBeGreaterThan(1000);
    expect(raw.vacant).toBeGreaterThan(50);
    expect(raw.total).toBe(raw.filled + raw.vacant + raw.held);
    expect(await tileNum(page, 'pb_positions_total')).toBe(raw.total);
    expect(await tileNum(page, 'pb_filled')).toBe(raw.filled);
    expect(await tileNum(page, 'pb_vacant')).toBe(raw.vacant);
    expect(await tileNum(page, 'pb_frozen_hold')).toBe(raw.held);
    await expect(tile(page, 'pb_vacancy_pct').locator('.tile-value')).toHaveText(
      (raw.vacant / (raw.filled + raw.vacant) * 100).toFixed(1) + '%');
    expect(await tileNum(page, 'pb_vacant_90d')).toBe(raw.aged);
    expect(await tileNum(page, 'pb_vacant_no_req')).toBe(raw.noReq);
    expect(raw.noReq).toBeLessThan(raw.vacant);          // some vacancies are covered by open requisitions
    expect(await tileNum(page, 'pb_cp_vacant')).toBe(raw.cp);
    expect(await tileNum(page, 'pb_budgeted_unfilled')).toBe(raw.budUnfilled);
    await expect(tile(page, 'pb_budget_fill_pct').locator('.tile-value')).toHaveText((raw.filled / raw.budget * 100).toFixed(1) + '%');
    expect(raw.unpositioned).toBeGreaterThan(0);          // seeded data-quality gap
    expect(await tileNum(page, 'pb_no_position_id')).toBe(raw.unpositioned);
    // every metric on the tab is classified 'org' and defined in the registry
    const reg = await page.evaluate(() => REGISTRY.filter((e) => e.tab === 'positions').map((e) => [e.key, Access.classOf(e)]));
    expect(reg.length).toBe(11);
    for (const [key, cls] of reg) expect(cls, key).toBe('org');
    // the "i" reveals the exact formula
    await tile(page, 'pb_vacancy_pct').locator('.i-btn').click();
    await expect(page.locator('.popover')).toContainText('Vacant positions ÷ (Filled + Vacant positions) × 100');
    await page.keyboard.press('Escape');
    // metrics-on-this-tab CSV carries the tab's keys
    await page.click('#btn-export');
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-tab]')]);
    expect(d.suggestedFilename()).toBe('amns-hr-positions-metrics.csv');
    const csv = readFileSync(await d.path(), 'utf8');
    for (const [key] of reg) expect(csv).toContain(key);
    expect(net).toEqual([]);
  });

  test('charts render direct-labelled with hover tips; the register filters, sorts and downloads', async ({ page }) => {
    await loadMockAs(page);
    await openTab(page);
    for (const t of CHART_CARDS) {
      const c = card(page, t);
      await expect(c, t).toHaveCount(1);
      await expect(c).toHaveAttribute('data-access', 'org');
      expect(await c.locator('svg:not(.lock-ico)').count(), t).toBe(1);
      expect(await c.locator('[data-tip]').count(), t).toBeGreaterThan(1);
      expect(await c.locator('text.bar-value').count(), t).toBeGreaterThan(1);   // values printed on the marks
    }
    expect(await page.locator('#panel-positions .is-restricted').count()).toBe(0);
    // per-asset cuts: every asset + Group, labels in CONFIG order
    const assetLabels = await card(page, 'Vacancy rate by asset').locator('text.bar-label').allTextContents();
    expect(assetLabels).toEqual(['Hazira', 'Paradeep', 'Vizag', 'Kirandul', 'Group']);
    const levels = await card(page, 'Vacancy rate by level').locator('text.bar-label').allTextContents();
    const order = await page.evaluate(() => CONFIG.levels);
    expect(levels).toEqual(order.filter((l) => levels.includes(l)));
    const buckets = await card(page, 'Vacancy ageing').locator('text.bar-label').allTextContents();
    expect(buckets.slice(0, 6)).toEqual(['0–30 days', '31–60 days', '61–90 days', '91–180 days', '181–365 days', '365+ days']);
    await expect(card(page, 'HC budget vs filled positions by asset')).toContainText('Group: HC budget');
    // cross-filter: clicking a bar focuses that asset
    await card(page, 'Vacancy rate by asset').locator('[data-setasset="Vizag"]').click();
    await expect(page.locator('#sel-asset')).toHaveValue('Vizag');
    const vz = await tileNum(page, 'pb_positions_total');
    await page.selectOption('#sel-asset', 'Group');
    expect(await tileNum(page, 'pb_positions_total')).toBeGreaterThan(vz);

    // register: default Vacant view, most urgent (oldest) first, no incumbent column
    const reg = page.locator('#pos-register');
    const vacant = await tileNum(page, 'pb_vacant');
    await expect(reg.locator('[data-pos-view="Vacant"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(reg.locator('.pos-count')).toContainText(`of ${vacant.toLocaleString('en-IN')} vacant positions`);
    await expect(reg.locator('thead th')).toHaveCount(11);
    expect(await reg.locator('thead th').allInnerTexts()).not.toContain('INCUMBENT');
    const days = (await reg.locator('tbody tr td:nth-child(10)').allInnerTexts()).map((s) => Number(s.replace(/\D/g, '')));
    expect(days.length).toBe(Math.min(100, vacant));
    expect(days).toEqual([...days].sort((a, b) => b - a));
    expect(await reg.locator('tbody .pos-aged').count()).toBeGreaterThan(0);
    // Filled view adds the Incumbent column (identified for CHRO)
    await reg.locator('[data-pos-view="Filled"]').click();
    await expect(reg.locator('thead th').last()).toHaveText(/incumbent/i);
    const inc = await reg.locator('tbody tr td:last-child').allInnerTexts();
    expect(inc.length).toBe(100);
    expect(inc.every((v) => /^AMNS-/.test(v) || v === '(blank)')).toBe(true);
    // the filter narrows on position attributes
    const before = await reg.locator('.pos-count').innerText();
    await reg.locator('#pos-q').fill('Steel Making');
    await expect(reg.locator('.pos-count')).not.toHaveText(before);
    const plants = await reg.locator('tbody tr td:nth-child(4)').allInnerTexts();
    const titles = await reg.locator('tbody tr td:nth-child(2)').allInnerTexts();
    expect(plants.every((p, i) => p.includes('Steel Making') || titles[i].includes('Steel Making'))).toBe(true);
    // the filter never matches incumbent IDs (no probing a person through the register)
    await reg.locator('#pos-q').fill(inc[0]);
    await expect(reg).toContainText('No filled positions match');
    await reg.locator('#pos-q').fill('');
    // CSV of the current view — every row, not just the 100 shown
    await reg.locator('[data-pos-view="Vacant"]').click();
    const [d] = await Promise.all([page.waitForEvent('download'), reg.locator('[data-pos-csv]').click()]);
    expect(d.suggestedFilename()).toBe('positions-vacant.csv');
    const lines = readFileSync(await d.path(), 'utf8').trim().split(/\r?\n/);
    expect(lines[0]).toBe('Position,Title,Asset,Function Plant,Level,Status,Budgeted,Critical,Vacant since,Days vacant,Requisition');
    expect(lines.length).toBe(vacant + 1);
  });

  test('drills: CHRO sees rows; a masked persona gets pseudonyms; a no-PII persona is withheld incumbent rows', async ({ page }) => {
    await loadMockAs(page);
    await openTab(page);
    // CHRO — position lists and identified incumbents
    let modal = await openDrill(page, 'pb_vacant');
    const vacant = await tileNum(page, 'pb_vacant');
    await expect(modal.locator('h3')).toContainText(`Vacant positions (${vacant.toLocaleString('en-IN')})`);
    expect(await modal.locator('tbody tr').count()).toBe(Math.min(500, vacant));
    await closeModal(page);
    modal = await openDrill(page, 'pb_filled');
    expect(await modal.locator('thead th').allInnerTexts()).toContain('INCUMBENT');
    await expect(modal.locator('tbody')).toContainText('AMNS-');
    await closeModal(page);
    modal = await openDrill(page, 'pb_positions_total');       // aggregate: asset × status
    await expect(modal.locator('tbody tr').last()).toContainText('Total (scope)');
    await closeModal(page);
    modal = await openDrill(page, 'pb_budget_fill_pct');
    await expect(modal.locator('h3')).toContainText('budget month');
    await closeModal(page);

    // TA & Mobility COE — identifiers masked
    await page.evaluate(() => App.setPersona('coe_ta'));
    await openTab(page);
    modal = await openDrill(page, 'pb_filled');
    await expect(modal.locator('h3')).toContainText('identifiers masked');
    await expect(modal.locator('tbody')).toContainText('EMP-');
    await expect(modal.locator('tbody')).not.toContainText('AMNS-');
    await closeModal(page);
    modal = await openDrill(page, 'pb_no_position_id');
    const heads = await modal.locator('thead th').allInnerTexts();
    expect(heads).not.toContain('NAME');
    await expect(modal.locator('tbody')).toContainText('EMP-');
    await expect(modal.locator('tbody')).not.toContainText('AMNS-');
    await closeModal(page);
    const reg = page.locator('#pos-register');
    await reg.locator('[data-pos-view="Filled"]').click();
    await expect(reg.locator('.pos-count')).toContainText('incumbent IDs pseudonymised');
    const inc = await reg.locator('tbody tr td:last-child').allInnerTexts();
    expect(inc.length).toBe(100);
    expect(inc.every((v) => /^EMP-[0-9A-F]{6}$/.test(v) || v === '(blank)')).toBe(true);
    await expect(reg.locator('tbody')).not.toContainText('AMNS-');
    // All view: vacancies first, then filled rows — the CSV carries every row, masked
    await reg.locator('[data-pos-view="All"]').click();
    await expect(reg.locator('.pos-count')).toContainText('incumbent IDs pseudonymised');
    const [d] = await Promise.all([page.waitForEvent('download'), reg.locator('[data-pos-csv]').click()]);
    const text = readFileSync(await d.path(), 'utf8');
    expect(text).toContain('EMP-');
    expect(text).not.toContain('AMNS-');

    // C&B / HR Finance — PII none: incumbent lists withheld, position-only lists shown
    await page.evaluate(() => App.setPersona('coe_cnb'));
    await openTab(page);
    modal = await openDrill(page, 'pb_filled');
    await expect(modal.locator('h3')).toHaveText('Row-level detail withheld');
    expect(await modal.locator('tbody tr').count()).toBe(0);
    await closeModal(page);
    modal = await openDrill(page, 'pb_no_position_id');
    await expect(modal.locator('h3')).toHaveText('Row-level detail withheld');
    await closeModal(page);
    modal = await openDrill(page, 'pb_vacant_90d');                // positions only — names no one
    expect(await modal.locator('tbody tr').count()).toBe(await tileNum(page, 'pb_vacant_90d'));
    await closeModal(page);
    const reg2 = page.locator('#pos-register');
    // the chosen view persists across re-renders (it was left on All above) — withheld here
    await expect(reg2.locator('[data-pos-view="All"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(reg2).toContainText('Incumbent-level rows are withheld');
    await reg2.locator('[data-pos-view="Held"]').click();
    expect(await reg2.locator('tbody tr').count()).toBeGreaterThan(0);
    await reg2.locator('[data-pos-view="Filled"]').click();
    await expect(reg2).toContainText('Incumbent-level rows are withheld');
    expect(await reg2.locator('tbody tr').count()).toBe(0);
    await expect(reg2.locator('[data-pos-csv]')).toBeDisabled();
    await reg2.locator('[data-pos-view="Vacant"]').click();
    expect(await reg2.locator('tbody tr').count()).toBeGreaterThan(0);
    await expect(reg2.locator('[data-pos-csv]')).toBeEnabled();
  });

  test('personas without the tab never render it; locked scopes hide peer assets', async ({ page }) => {
    await loadMockAs(page);
    const levels = await page.evaluate(() => ({
      hrbp: Access.levelFor('hrbp', 'pb_vacant'), talent: Access.tabVisibleFor('coe_talent', 'positions'),
      hrops: Access.tabVisibleFor('hrops', 'positions'), hrbpTab: Access.tabVisibleFor('hrbp', 'positions')
    }));
    expect(levels).toEqual({ hrbp: 'full', talent: false, hrops: false, hrbpTab: false });
    for (const [id, bind] of [['hrbp', { asset: 'Hazira' }], ['hrops', {}], ['coe_talent', {}]]) {
      await page.evaluate(([p, b]) => App.setPersona(p, b), [id, bind]);
      await expect(page.locator('#tab-positions'), id).toHaveCount(0);
      await expect(page.locator('#panel-positions'), id).toHaveCount(0);
    }
    // Asset HR Head (Hazira): own asset + Group benchmark only; no peers anywhere on the tab
    await page.evaluate(() => App.setPersona('asset_head', { asset: 'Hazira' }));
    await openTab(page);
    const labels = await card(page, 'Vacancy rate by asset').locator('text.bar-label').allTextContents();
    expect(labels).toEqual(['Hazira', 'Group (benchmark)']);
    const budgetLabels = await card(page, 'HC budget vs filled positions by asset').locator('text.bar-label').allTextContents();
    expect(budgetLabels).toEqual(['Hazira']);
    const panelText = await page.locator('#panel-positions').innerText();
    for (const peer of ['Paradeep', 'Vizag', 'Kirandul']) expect(panelText).not.toContain(peer);
    const hz = await tileNum(page, 'pb_positions_total');
    await page.evaluate(() => App.setPersona('chro'));
    await openTab(page);
    expect(await tileNum(page, 'pb_positions_total')).toBeGreaterThan(hz);
  });

  test('the business-segment filter narrows every position figure', async ({ page }) => {
    await loadMockAs(page);
    await openTab(page);
    const all = await tileNum(page, 'pb_positions_total');
    const allVac = await tileNum(page, 'pb_vacant');
    const allFill = await tile(page, 'pb_budget_fill_pct').locator('.tile-value').innerText();
    const expected = await page.evaluate(() => {
      const m = Compute.build();
      return m.positionRows.filter((r) => Compute.segOf(r) === 'Operations').length;
    });
    await page.selectOption('#sel-seg', 'Operations');
    await expect(page.locator('#scope-chip')).toHaveText('Business: Operations');
    const ops = await tileNum(page, 'pb_positions_total');
    expect(ops).toBe(expected);
    expect(ops).toBeLessThan(all);
    expect(await tileNum(page, 'pb_vacant')).toBeLessThan(allVac);
    expect(await tile(page, 'pb_budget_fill_pct').locator('.tile-value').innerText()).not.toBe(allFill);
    await page.selectOption('#sel-seg', 'Projects');
    const proj = await tileNum(page, 'pb_positions_total');
    // Operations + Projects < All: unmapped plants resolve to 'Unassigned' and count only under All
    expect(ops + proj).toBeLessThanOrEqual(all);
    expect(proj).toBeGreaterThan(0);
    // a segment-locked persona computes the same numbers as the filter
    await page.evaluate(() => App.setPersona('segment_head', { segment: 'Projects' }));
    await openTab(page);
    expect(await tileNum(page, 'pb_positions_total')).toBe(proj);
  });
});
