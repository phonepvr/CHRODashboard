import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ARTIFACT, loadMock, openMock } from './helpers.mjs';

// Overview — Employee demographics (R1 / R1a) and Budget vs actual (R1b).

async function loadMockAs(page, persona = 'chro', bind = {}) {
  await page.goto(ARTIFACT);
  await page.selectOption('#gate-persona', persona);
  if (bind.asset) await page.selectOption('#gate-persona-asset', bind.asset);
  if (bind.segment) await page.selectOption('#gate-persona-seg', bind.segment);
  await loadMock(page);
}

async function download(page, trigger) {
  const [d] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: d.suggestedFilename(), text: readFileSync(await d.path(), 'utf8') };
}

const num = (s) => Number(String(s).replace(/[^\d.\-−]/g, '').replace('−', '-'));
const ofN = (s) => num(String(s).match(/of ([\d,]+)/)[1]);
const DEMO_KEYS = ['demo_hc_asof', 'demo_hc_ly', 'demo_hc_fy_start', 'demo_hc_yoy_pct', 'demo_hc_ytd_pct',
  'demo_women_hc', 'demo_women_pct', 'demo_local_domicile_pct', 'demo_superann_3y'];
const BVA_KEYS = ['bva_budget_hc', 'bva_actual_hc', 'bva_variance', 'bva_variance_pct', 'bva_vacant_positions'];

test.describe('Overview — employee demographics & budget vs actual', () => {

  test('KPI strip computes real numbers that reconcile with an independent count', async ({ page }) => {
    await openMock(page);
    const r = await page.evaluate((keys) => {
      // independent recount straight from the parsed rows (not via Compute)
      const emps = App.state.datasets.get('employee_master').rows;
      const exitDay = new Map();
      for (const x of App.state.datasets.get('exits').rows) {
        if (x.employee_id && x.exit_date != null) exitDay.set(x.employee_id, Math.max(exitDay.get(x.employee_id) ?? -Infinity, x.exit_date));
      }
      const seen = new Set(), uniq = [];
      for (const e of emps) { if (seen.has(e.employee_id)) continue; seen.add(e.employee_id); uniq.push(e); }
      const at = (day) => uniq.filter((e) => e.doj != null && e.doj <= day && !(exitDay.get(e.employee_id) <= day));
      const fyStart = fyStartMonthIdx(AS_OF_MONTH);
      const A = at(AS_OF_DAY), B = at(monthEndDay(AS_OF_MONTH - 12)), C = at(monthEndDay(fyStart - 1));
      return {
        vals: Object.fromEntries(keys.map((k) => [k, Compute.metric(k).value])),
        tiles: Object.fromEntries(keys.map((k) => {
          const e = REG_BY_KEY.get(k);
          return [k, [document.querySelector(`#panel-overview .tile[data-key="${k}"] .tile-value`)?.textContent.trim(),
            UI.fmtMetric(e, Compute.metric(k).value).replace(/<[^>]*>/g, '')]];
        })),
        A: A.length, B: B.length, C: C.length, D: A.filter((e) => e.gender === 'Female').length,
        classes: [...new Set(A.map((e) => e.employee_class))].sort(),
        perm: Compute.metric('headcount_close').value, trainee: Compute.metric('headcount_trainee').value
      };
    }, DEMO_KEYS);
    const v = r.vals;
    expect(v.demo_hc_asof).toBe(r.A);
    expect(v.demo_hc_ly).toBe(r.B);
    expect(v.demo_hc_fy_start).toBe(r.C);
    expect(v.demo_women_hc).toBe(r.D);
    expect(r.classes).toEqual(['Permanent', 'Trainee']);
    expect(v.demo_hc_asof).toBe(r.perm + r.trainee);            // on-roll = permanent + trainee
    expect(v.demo_hc_yoy_pct).toBeCloseTo((r.A - r.B) / r.B * 100, 6);
    expect(v.demo_hc_ytd_pct).toBeCloseTo((r.A - r.C) / r.C * 100, 6);
    expect(v.demo_women_pct).toBeCloseTo(r.D / r.A * 100, 6);
    expect(v.demo_local_domicile_pct).toBeGreaterThan(50);
    expect(v.demo_local_domicile_pct).toBeLessThan(100);
    expect(v.demo_superann_3y).toBeGreaterThan(0);
    expect(v.demo_hc_ly).toBeGreaterThan(0);
    // every tile shows its own formatted value; the formula letter sits in the label
    for (const [k, [shown, want]] of Object.entries(r.tiles)) expect(shown, k).toBe(want);
    await expect(page.locator('.tile[data-key="demo_hc_asof"] .tile-label')).toContainText('(A)');
    await expect(page.locator('.tile[data-key="demo_hc_yoy_pct"] .tile-label')).toContainText('(A−B)/B');
    // the "i" carries the exact algebra
    await page.locator('.tile[data-key="demo_hc_ytd_pct"] .i-btn').click();
    await expect(page.locator('.popover .po-formula')).toContainText('(A − C) ÷ C × 100');
    await page.keyboard.press('Escape');
    // the six sections, with the jump row focusing a section
    for (const h of ['Headline', 'Employee demographics', 'Budget vs actual headcount', 'Productivity, Cost & Safety', 'Trends']) {
      await expect(page.locator('#panel-overview .section-head h2', { hasText: h })).toBeVisible();
    }
    await expect(page.locator('#panel-overview .exec-band')).toBeVisible();
    await page.click('[data-ovd-jump="ovd-sec-bva"]');
    await expect(page.locator('#ovd-sec-bva')).toBeFocused();
  });

  test('demographic charts render, direct-labelled, in ladder order, summing to the on-roll', async ({ page }) => {
    await openMock(page);
    const grid = page.locator('#charts-overview-demog');
    expect(await grid.locator('.card svg').count()).toBe(11);
    // the pre-existing blocks are intact
    expect(await page.locator('#charts-overview svg').count()).toBe(4);
    expect(await page.locator('#charts-overview-demo svg').count()).toBe(3);
    const A = await page.evaluate(() => Compute.metric('demo_hc_asof').value);
    // exact title match (the title text is followed by the "i" button's text)
    const card = (t) => grid.locator('.card', { has: page.locator('.card-title', { hasText: new RegExp(`^${t}i?$`) }) });
    const barValues = async (t) => (await card(t).locator('svg .bar-value').allTextContents()).map((s) => num(s.split(' ')[0]));
    const sum = (a) => a.reduce((s, x) => s + x, 0);
    // 13-month trend: a label on every point, A/B/C tagged, last point = A
    const trend = card('Headcount trend — last 13 months');
    expect(await trend.locator('.ovd-pt').count()).toBe(13);
    const tags = await trend.locator('.ovd-mark').allTextContents();
    expect(tags).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    expect(num(await trend.locator('.ovd-pt').last().textContent())).toBe(A);
    expect(await trend.locator('rect[data-tip]').count()).toBe(13);
    // every headcount cut adds up to the on-roll total
    for (const t of ['Headcount by company', 'Headcount by function', 'Headcount by function plant', 'Headcount by management band', 'Headcount by level', 'Headcount by business segment', 'State-wise domicile']) {
      expect(sum(await barValues(t)), t).toBe(A);
    }
    // level chart follows CONFIG.levels (senior → junior), band chart CONFIG.mgmtBands
    const levels = await card('Headcount by level').locator('svg .bar-label').allTextContents();
    const cfg = await page.evaluate(() => ({ levels: CONFIG.levels, bands: CONFIG.mgmtBands.map((b) => CONFIG.mgmtBandLabels[b]), buckets: CONFIG.superannBuckets.map((b) => b[0]), homes: Object.values(CONFIG.assetHomeState) }));
    expect(levels).toEqual(cfg.levels);
    expect(await card('Headcount by management band').locator('svg .bar-label').allTextContents()).toEqual(cfg.bands);
    // function plant: top 12 + one de-emphasised "Other units (n)" bar
    const plants = await card('Headcount by function plant').locator('svg .bar-label').allTextContents();
    expect(plants.length).toBeLessThanOrEqual(14);
    expect(plants.some((p) => /^Other units \(\d+\)$/.test(p))).toBe(true);
    // asset: one bar per chart scope (4 assets + Group), cross-filter wired
    expect(await card('Headcount by asset').locator('[data-setasset]').count()).toBe(5);
    // superannuation: one column per bucket, equal to the tile
    const sup = card('Superannuation');
    expect(await sup.locator('svg .bar-label').allTextContents()).toEqual(cfg.buckets);
    const supN = await page.evaluate(() => Compute.metric('demo_superann_3y').value);
    expect(sum((await sup.locator('svg .bar-value').allTextContents()).map(num))).toBe(supN);
    // gender donut with count + share labels
    await expect(card('Gender').locator('svg')).toContainText('Female —');
    await expect(card('Gender').locator('.donut-center')).toHaveText(/on roll/);
    // domicile: home states drawn in Smart Red and tagged, local % in the subtitle
    const dom = card('State-wise domicile');
    const red = await dom.locator('rect[fill="var(--red)"]').count();
    expect(red).toBe(cfg.homes.length);
    await expect(dom.locator('.card-sub')).toContainText('local domicile');
    // tooltips on marks
    await card('Headcount by level').locator('g[data-tip] rect').first().hover();
    await expect(page.locator('#tip')).toBeVisible();
    await expect(page.locator('#tip')).toContainText('M-2');
    // phone width: nothing overflows the page horizontally
    await page.setViewportSize({ width: 390, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('budget vs actual matrix: tree, keyboard expand/collapse, totals reconcile, CSV', async ({ page }) => {
    await openMock(page);
    const r = await page.evaluate(() => {
      const rows = App.state.datasets.get('hc_budget').rows;
      const mi = Math.max(...rows.map((x) => x.month).filter((x) => x <= AS_OF_MONTH));
      return {
        budget: rows.filter((x) => x.month === mi).reduce((s, x) => s + x.budget_hc, 0),
        vals: Object.fromEntries(['bva_budget_hc', 'bva_actual_hc', 'bva_variance', 'bva_variance_pct', 'bva_vacant_positions', 'headcount_close'].map((k) => [k, Compute.metric(k).value])),
        vacant: App.state.datasets.get('positions').rows.filter((p) => p.position_status === 'Vacant').length
      };
    });
    expect(r.vals.bva_budget_hc).toBe(r.budget);
    expect(r.vals.bva_actual_hc).toBe(r.vals.headcount_close);
    expect(r.vals.bva_variance).toBe(r.vals.bva_actual_hc - r.vals.bva_budget_hc);
    expect(r.vals.bva_variance_pct).toBeCloseTo(r.vals.bva_variance / r.budget * 100, 6);
    expect(r.vals.bva_vacant_positions).toBe(r.vacant);

    const mx = page.locator('#ovd-bva');
    await expect(mx.locator('.card-title')).toContainText('Asset → Function → Function Plant');
    const top = mx.locator('tbody tr.ovd-l0');
    await expect(top).toHaveCount(4);
    await expect(mx.locator('tbody tr.ovd-l1:visible')).toHaveCount(0);
    // totals row = the tiles
    const tot = mx.locator('tfoot tr td');
    expect(num(await tot.nth(1).textContent())).toBe(r.vals.bva_budget_hc);
    expect(num(await tot.nth(2).textContent())).toBe(r.vals.bva_actual_hc);
    expect(num(await tot.nth(3).textContent())).toBe(r.vals.bva_variance);
    // variance carries status ink + symbol (never colour alone)
    await expect(tot.nth(3)).toHaveClass(r.vals.bva_variance < 0 ? /ovd-under/ : /ovd-over/);
    await expect(tot.nth(3)).toContainText(r.vals.bva_variance < 0 ? '▼' : '▲');
    // keyboard: Enter expands an asset, children appear; ArrowLeft collapses
    const tog = mx.locator('[data-ovd-toggle="ovd-bva-0"]');
    await expect(tog).toHaveAttribute('aria-expanded', 'false');
    await tog.focus();
    await page.keyboard.press('Enter');
    await expect(tog).toHaveAttribute('aria-expanded', 'true');
    await expect(tog).toHaveAttribute('aria-label', /^Collapse /);
    const kids = mx.locator('tr[data-ovd-parent="ovd-bva-0"]');
    const nKids = await kids.count();
    expect(nKids).toBeGreaterThan(3);
    await expect(kids.first()).toBeVisible();
    // a function row's plants sum to the function row; functions sum to the asset
    const cells = async (sel) => (await mx.locator(sel).locator('td').allTextContents()).map(num);
    const asset0 = await cells('#ovd-bva-0');
    let fnBudget = 0;
    for (let i = 0; i < nKids; i++) fnBudget += (await cells(`#ovd-bva-0-${i}`))[1];
    expect(fnBudget).toBe(asset0[1]);
    const fnTog = mx.locator('[data-ovd-toggle="ovd-bva-0-0"]');
    await fnTog.focus();
    await page.keyboard.press('ArrowRight');
    await expect(fnTog).toHaveAttribute('aria-expanded', 'true');
    const plants = mx.locator('tr[data-ovd-parent="ovd-bva-0-0"]');
    expect(await plants.count()).toBeGreaterThan(0);
    let plantActual = 0;
    for (let i = 0; i < await plants.count(); i++) plantActual += (await cells(`#ovd-bva-0-0-${i}`))[2];
    expect(plantActual).toBe((await cells('#ovd-bva-0-0'))[2]);
    // collapsing the asset hides the whole subtree
    await tog.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(tog).toHaveAttribute('aria-expanded', 'false');
    await expect(mx.locator('tbody tr.ovd-l2:visible')).toHaveCount(0);
    await expect(fnTog).toHaveAttribute('aria-expanded', 'false');
    // Expand all / Collapse all
    await mx.locator('[data-ovd-expand-all]').click();
    await expect(mx.locator('[data-ovd-expand-all]')).toHaveText('Collapse all');
    const allRows = await mx.locator('tbody tr').count();
    await expect(mx.locator('tbody tr:visible')).toHaveCount(allRows);
    await expect(mx.locator('[data-ovd-toggle][aria-expanded="false"]')).toHaveCount(0);
    await mx.locator('[data-ovd-expand-all]').click();
    await expect(mx.locator('tbody tr:visible')).toHaveCount(4);
    // CSV of the whole matrix (every level + total)
    const csv = await download(page, () => mx.locator('[data-ovd-bva-csv]').click());
    expect(csv.name).toBe('amns-hr-budget-vs-actual.csv');
    const lines = csv.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Level,Asset,Function,Function Plant,Budget,Actual,Variance,Variance %,Vacant positions');
    expect(lines.length).toBe(1 + allRows + 1);
    expect(lines[lines.length - 1]).toContain(`Total,Total,,,${r.vals.bva_budget_hc},${r.vals.bva_actual_hc},${r.vals.bva_variance}`);
    // the variance tile drills to the same breakdown
    await page.click('.tile[data-drill="bva_variance"]');
    await expect(page.locator('.modal')).toContainText('Budget vs actual headcount');
    await page.keyboard.press('Escape');
  });

  test('employee details: identified for CHRO, paged, filterable, CSV of the rows', async ({ page }) => {
    await openMock(page);
    const card = page.locator('#ovd-details');
    const heads = await card.locator('thead th').allTextContents();
    expect(heads).toEqual(['Employee Code', 'Name', 'Level', 'Band', 'Company', 'Asset', 'Function', 'Function Plant', 'Segment']);
    await expect(card.locator('tbody tr')).toHaveCount(50);
    const A = await page.evaluate(() => Compute.metric('demo_hc_asof').value);
    await expect(card.locator('[data-ovd-count]')).toHaveText(`Rows 1–50 of ${A.toLocaleString('en-IN')}`);
    expect(await card.locator('tbody tr td').first().textContent()).toMatch(/^AMNS-/);
    await expect(card.locator('[data-ovd-prev]')).toBeDisabled();
    await card.locator('[data-ovd-next]').click();
    await expect(card.locator('[data-ovd-count]')).toContainText('Rows 51–100');
    await expect(card.locator('[data-ovd-prev]')).toBeEnabled();
    // filter narrows (e.g. to one plant)
    await card.locator('[data-ovd-q]').fill('Pellet Plant');
    await expect(card.locator('[data-ovd-count]')).toContainText('filtered from');
    const shown = ofN(await card.locator('[data-ovd-count]').textContent());
    expect(shown).toBeLessThan(A);
    for (const t of await card.locator('tbody tr td:nth-child(8)').allTextContents()) expect(t).toBe('Pellet Plant');
    const csv = await download(page, () => card.locator('[data-ovd-csv]').click());
    expect(csv.name).toBe('amns-hr-employee-details.csv');
    const lines = csv.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Employee Code,Name,Level,Band,Company,Asset,Function,Function Plant,Segment');
    expect(lines.length - 1).toBe(shown);
    // the (A) tile drills to the asset × band composition
    await page.click('.tile[data-drill="demo_hc_asof"]');
    await expect(page.locator('.modal')).toContainText('by asset and management band');
    await page.keyboard.press('Escape');
  });

  test('masked persona: pseudonymised details and drill, no names, no raw identifiers', async ({ page }) => {
    await loadMockAs(page, 'coe_ta');
    await page.click('#tab-overview');
    const card = page.locator('#ovd-details');
    const heads = await card.locator('thead th').allTextContents();
    expect(heads).not.toContain('Name');
    expect(heads[0]).toBe('Employee Code');
    await expect(card).toContainText('pseudonymised');
    const codes = await card.locator('tbody tr td:first-child').allTextContents();
    expect(codes.length).toBe(50);
    for (const c of codes) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    const raw = await page.evaluate(() => DemoKit.detailRows(Compute.build(), Compute.ctxNow()).slice(0, 50).map((r) => [r[0], r[1]]));
    const text = await page.locator('#panel-overview').innerText();
    for (const [id] of raw) expect(text).not.toContain(id);
    // searching a real ID finds nothing (the filter runs on masked rows only)
    await card.locator('[data-ovd-q]').fill(raw[0][0]);
    await expect(card.locator('[data-ovd-count]')).toContainText('0 of');
    await card.locator('[data-ovd-q]').fill('');
    const csv = await download(page, () => card.locator('[data-ovd-csv]').click());
    expect(csv.name).toBe('amns-hr-employee-details-coe_ta.csv');
    expect(csv.text.split(/\r?\n/)[0]).not.toContain('Name');
    for (const [id] of raw) expect(csv.text).not.toContain(id);
    // row-level drill (superannuation list) is masked the same way
    await page.click('.tile[data-drill="demo_superann_3y"]');
    const modal = page.locator('.modal');
    await expect(modal).toContainText('identifiers masked');
    expect(await modal.locator('thead th').allTextContents()).not.toContain('Name');
    const ids = await modal.locator('tbody tr td:first-child').allTextContents();
    expect(ids.length).toBeGreaterThan(0);
    for (const c of ids) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    const rawSup = await page.evaluate(() => REG_BY_KEY.get('demo_superann_3y').drill(Compute.build(), Compute.ctxNow()).rows.slice(0, 30).map((r) => r[0]));
    const mtext = await modal.innerText();
    for (const id of rawSup) expect(mtext).not.toContain(id);
    await page.keyboard.press('Escape');
  });

  test('"none" persona gets aggregates only; out-of-profile personas never see the tab', async ({ page }) => {
    await loadMockAs(page, 'coe_cnb');
    await page.click('#tab-overview');
    // core is aggregate-only for C&B: values, no drill, badge
    const a = page.locator('.tile[data-key="demo_hc_asof"]');
    await expect(a.locator('.tile-value')).toHaveText(/^[\d,]+$/);
    await expect(a.locator('.tile-badge')).toHaveText('Aggregate only');
    await expect(a).not.toHaveAttribute('data-drill', /.*/);
    await page.locator('.tile[data-key="demo_superann_3y"]').click();
    await expect(page.locator('.modal')).toHaveCount(0);
    // employee details withheld, no row rendered
    await expect(page.locator('#ovd-details')).toContainText('Row-level detail withheld');
    await expect(page.locator('#ovd-details tbody tr')).toHaveCount(0);
    const r = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      return {
        superDrill: Access.maskDrill(REG_BY_KEY.get('demo_superann_3y').drill(m, ctx)),
        details: Access.maskTable(DemoKit.DETAIL_COLS, DemoKit.detailRows(m, ctx), DemoKit.DETAIL_PII)
      };
    });
    expect(r.superDrill).toBeNull();
    expect(r.details).toBeNull();
    // org is full for C&B: the budget matrix is served and drills
    await expect(page.locator('#ovd-bva tbody tr.ovd-l0')).toHaveCount(4);
    await expect(page.locator('.tile[data-key="bva_variance"]')).toHaveAttribute('data-drill', 'bva_variance');

    // HRBP: org is Full → the budget tiles drill; the matrix holds the own asset only
    await page.evaluate(() => App.setPersona('hrbp', { asset: 'Vizag' }));
    await page.click('#tab-overview');
    await expect(page.locator('.tile[data-key="bva_variance"]')).toHaveAttribute('data-drill', 'bva_variance');
    await expect(page.locator('.tile[data-key="bva_variance"] .tile-badge')).toHaveCount(0);
    await expect(page.locator('#ovd-bva tbody tr.ovd-l0')).toHaveCount(1);
    await expect(page.locator('#ovd-bva tbody tr.ovd-l0')).toContainText('Vizag');

    // Talent & L&D COE and HR Ops do not have the Overview at all
    for (const p of ['coe_talent', 'hrops']) {
      await page.evaluate((id) => App.setPersona(id), p);
      await expect(page.locator('#tab-overview')).toHaveCount(0);
      await expect(page.locator('#panel-overview')).toHaveCount(0);
      await expect(page.locator('#charts-overview-demog')).toHaveCount(0);
      await expect(page.locator('#ovd-bva')).toHaveCount(0);
    }
  });

  test('asset-locked persona: own asset only in every cut and in the matrix', async ({ page }) => {
    await loadMockAs(page, 'asset_head', { asset: 'Paradeep' });
    const grid = page.locator('#charts-overview-demog');
    const assetBars = await grid.locator('.card', { hasText: 'Headcount by asset' }).locator('svg .bar-label').allTextContents();
    expect(assetBars).toEqual(['Paradeep', 'Group']);
    await expect(page.locator('#ovd-bva tbody tr.ovd-l0')).toHaveCount(1);
    await expect(page.locator('#ovd-bva tbody tr.ovd-l0')).toContainText('Paradeep');
    const text = await page.locator('#panel-overview').innerText();
    for (const peer of ['Hazira', 'Vizag', 'Kirandul']) {
      expect(await page.locator(`#panel-overview svg text`, { hasText: peer }).count(), peer).toBe(0);
      expect(await page.locator(`#ovd-bva td`, { hasText: peer }).count(), peer).toBe(0);
      expect(await page.locator(`#ovd-details td`, { hasText: peer }).count(), peer).toBe(0);
    }
    expect(text).toContain('Paradeep');
    // details and the (A) tile agree for the locked scope
    const A = await page.evaluate(() => Compute.metric('demo_hc_asof').value);
    await expect(page.locator('#ovd-details [data-ovd-count]')).toContainText(`of ${A.toLocaleString('en-IN')}`);
  });

  test('segment filter narrows the demographics and the budget matrix', async ({ page }) => {
    await openMock(page);
    const read = async (k) => num(await page.locator(`.tile[data-key="${k}"] .tile-value`).innerText());
    const allA = await read('demo_hc_asof');
    const allBudget = await read('bva_budget_hc');
    const allRows = await page.locator('#ovd-details [data-ovd-count]').textContent();
    await page.selectOption('#sel-seg', 'Projects');
    await expect.poll(() => read('demo_hc_asof')).toBeLessThan(allA);
    const projA = await read('demo_hc_asof');
    const projBudget = await read('bva_budget_hc');
    expect(projBudget).toBeLessThan(allBudget);
    expect(projBudget).toBeGreaterThan(0);
    await expect(page.locator('#ovd-details [data-ovd-count]')).not.toHaveText(allRows);
    await expect(page.locator('#ovd-details [data-ovd-count]')).toContainText(`of ${projA.toLocaleString('en-IN')}`);
    // the segment cut shows only Projects, highlighted
    const seg = page.locator('#charts-overview-demog .card', { hasText: 'Headcount by business segment' });
    expect(await seg.locator('svg .bar-label').allTextContents()).toEqual(['Projects']);
    await expect(seg.locator('rect[fill="var(--red)"]')).toHaveCount(1);
    // every detail row is a Projects row
    for (const t of await page.locator('#ovd-details tbody tr td:nth-child(9)').allTextContents()) expect(t).toBe('Projects');
    // the grade-band filter narrows demographics but not the budget comparison
    await page.selectOption('#sel-seg', 'All');
    await page.selectOption('#sel-band', 'AM-GM');
    await expect.poll(() => read('demo_hc_asof')).toBeLessThan(allA);
    expect(await read('bva_budget_hc')).toBe(allBudget);
  });
});
