import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openMock, loadFiles, ARTIFACT, FIX } from './helpers.mjs';

// R7 — Managers tab (Manager Demographics / Scope of Manager)
const KEYS = ['line_managers', 'mgr_emp_ratio', 'mgr_same_level', 'mgr_women', 'mgr_women_pct'];
const intOf = (s) => Number(String(s).replace(/[^\d]/g, ''));

async function openManagers(page) {
  await openMock(page);
  await page.click('#tab-managers');
  await expect(page.locator('#panel-managers .mg-toolbar')).toBeVisible();
}

async function download(page, trigger) {
  const [d] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: d.suggestedFilename(), text: readFileSync(await d.path(), 'utf8') };
}

// independent recount straight from the joined rows (no MgrKit)
const recount = () => {
  const m = Compute.build(), ctx = Compute.ctxNow();
  const act = m.emps.filter((e) => e.doj != null && e.doj <= ctx.asOfDay && e.__exitDay > ctx.asOfDay);
  const reps = new Map();
  for (const e of act) {
    if (!e.manager_id || e.manager_id === e.employee_id) continue;
    if (!reps.has(e.manager_id)) reps.set(e.manager_id, []);
    reps.get(e.manager_id).push(e);
  }
  const mgrs = act.filter((e) => reps.has(e.employee_id) && Compute.empMatch(e, ctx));
  const direct = mgrs.reduce((s, e) => s + reps.get(e.employee_id).length, 0);
  const same = mgrs.filter((e) => e.level && reps.get(e.employee_id).some((x) => x.level === e.level)).length;
  const women = mgrs.filter((e) => e.gender === 'Female').length;
  const inBucket = (label) => mgrs.filter((e) => bucketOf(reps.get(e.employee_id).length, CONFIG.scopeBuckets) === label).length;
  return {
    mgrs: mgrs.length, ratio: direct / mgrs.length, same, women, pct: women / mgrs.length * 100,
    buckets: Object.fromEntries(CONFIG.scopeBuckets.map(([l]) => [l, inBucket(l)])),
    rawIds: mgrs.slice(0, 40).map((e) => e.employee_id),
    values: Object.fromEntries(['line_managers', 'mgr_emp_ratio', 'mgr_same_level', 'mgr_women', 'mgr_women_pct'].map((k) => [k, Compute.metric(k).value])),
    shown: Object.fromEntries(['line_managers', 'mgr_same_level', 'mgr_women'].map((k) => [k, fmtInt(Compute.metric(k).value)]))
  };
};

test.describe('Phase 8 — R7 Managers tab', () => {

  test('tiles compute real numbers in mock mode and match an independent recount', async ({ page }) => {
    await openManagers(page);
    const panel = page.locator('#panel-managers');
    for (const k of KEYS) await expect(panel.locator(`.tile[data-key="${k}"] .tile-value`)).toHaveText(/\d/);
    const r = await page.evaluate(recount);
    expect(r.mgrs).toBeGreaterThan(100);
    expect(r.values.line_managers).toBe(r.mgrs);
    expect(r.values.mgr_emp_ratio).toBeCloseTo(r.ratio, 9);
    expect(r.values.mgr_same_level).toBe(r.same);
    expect(r.same).toBeGreaterThan(0);
    expect(r.values.mgr_women).toBe(r.women);
    expect(r.values.mgr_women_pct).toBeCloseTo(r.pct, 9);
    for (const k of ['line_managers', 'mgr_same_level', 'mgr_women']) {
      await expect(panel.locator(`.tile[data-key="${k}"] .tile-value`)).toHaveText(r.shown[k]);
    }
    await expect(panel.locator('.tile[data-key="mgr_emp_ratio"] .tile-value')).toHaveText(r.ratio.toFixed(1));
    // every metric is classified 'org' and its "i" carries the exact formula
    expect(await page.evaluate((ks) => ks.map((k) => Access.classOf(k)), KEYS)).toEqual(KEYS.map(() => 'org'));
    await panel.locator('.tile[data-key="line_managers"] .i-btn').click();
    await expect(page.locator('.popover')).toContainText('referenced as Manager ID');
    await expect(page.locator('.popover')).toContainText('employee_master.csv — Employee ID, Manager ID');
    await page.keyboard.press('Escape');
    // bucket buttons carry the recount
    for (const [label, n] of Object.entries(r.buckets)) {
      await expect(panel.locator(`[data-mg-scope="${label}"] .mg-n`)).toHaveText(n.toLocaleString('en-IN'));
    }
  });

  test('charts render direct-labelled, access-tagged, in CONFIG order, with tooltips', async ({ page }) => {
    await openManagers(page);
    const panel = page.locator('#panel-managers');
    const cards = panel.locator('.card');
    await expect(cards).toHaveCount(11);
    expect(await panel.locator('.card[data-access="org"]').count()).toBe(11);
    expect(await panel.locator('.card .chart-empty').count()).toBe(0);
    expect(await panel.locator('.card svg').count()).toBe(11);
    for (const t of ['Line managers by asset', 'Line managers by band', 'Line managers by level', 'Line managers by function plant',
      'Manager-to-employee ratio by asset', 'Manager-to-employee ratio by band', 'Manager-to-employee ratio by level',
      'Manager-to-employee ratio by function plant', 'Manager level = employee level', 'Line managers by gender', 'Line managers by scope bucket']) {
      await expect(panel.locator('.card-title', { hasText: t }).first()).toBeVisible();
    }
    // per-asset cut: every asset + Group, values sum to Group, cross-filter wired
    const assetCard = panel.locator('.card', { hasText: 'Line managers by asset' });
    const labels = await assetCard.locator('.bar-label').allTextContents();
    expect(labels).toEqual(['Hazira', 'Paradeep', 'Vizag', 'Kirandul', 'Group']);
    const vals = (await assetCard.locator('.bar-value').allTextContents()).map(intOf);
    expect(vals.slice(0, 4).reduce((a, b) => a + b, 0)).toBe(vals[4]);
    expect(await assetCard.locator('[data-setasset="Paradeep"]').count()).toBe(1);
    // the count and ratio charts of a dimension share their rows
    const ratioLabels = await panel.locator('.card', { hasText: 'Manager-to-employee ratio by asset' }).locator('.bar-label').allTextContents();
    expect(ratioLabels).toEqual(labels);
    // level order follows the CONFIG ladder (senior → junior)
    const lv = await panel.locator('.card', { hasText: 'Line managers by level' }).locator('.bar-label').allTextContents();
    const ladder = await page.evaluate(() => CONFIG.levels);
    expect(lv.length).toBeGreaterThan(2);
    expect([...lv].sort((a, b) => ladder.indexOf(a) - ladder.indexOf(b))).toEqual(lv);
    // band order follows CONFIG.mgmtBands
    const bands = await panel.locator('.card', { hasText: 'Line managers by band' }).locator('.bar-label').allTextContents();
    const bandOrder = await page.evaluate(() => CONFIG.mgmtBands.map((b) => CONFIG.mgmtBandLabels[b]));
    expect([...bands].sort((a, b) => bandOrder.indexOf(a) - bandOrder.indexOf(b))).toEqual(bands);
    // hover tooltips on bars and donut segments
    const tip = await assetCard.locator('[data-tip]').first().getAttribute('data-tip');
    expect(tip).toMatch(/Hazira: [\d,]+ line managers/);
    expect(await panel.locator('.card', { hasText: 'Line managers by gender' }).locator('path[data-tip]').count()).toBeGreaterThan(1);
    // ratio charts are direct-labelled with 1-decimal values
    const rv = await panel.locator('.card', { hasText: 'Manager-to-employee ratio by level' }).locator('.bar-value').allTextContents();
    for (const v of rv) expect(v).toMatch(/^\d+\.\d/);
  });

  test('Scope Bucket filter re-scopes charts and table, not the tiles', async ({ page }) => {
    await openManagers(page);
    const panel = page.locator('#panel-managers');
    const r = await page.evaluate(recount);
    const tileBefore = await panel.locator('.tile[data-key="line_managers"] .tile-value').innerText();
    await expect(panel.locator('[data-mg-scope="All"]')).toHaveAttribute('aria-pressed', 'true');
    const btn = panel.locator('[data-mg-scope="6–10"]');
    await btn.click();
    await expect(panel.locator('[data-mg-scope="6–10"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('[data-mg-scope="All"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(panel.locator('[data-mg-scope="6–10"]')).toBeFocused();
    const n = r.buckets['6–10'];
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(r.mgrs);
    await expect(panel.locator('#mg-scope-note')).toContainText(`${n.toLocaleString('en-IN')} of ${r.mgrs.toLocaleString('en-IN')} line managers`);
    // charts: the Group bar is the bucket count; the bucket distribution marks it in red
    const vals = (await panel.locator('.card', { hasText: 'Line managers by asset' }).locator('.bar-value').allTextContents()).map(intOf);
    expect(vals[vals.length - 1]).toBe(n);
    const dist = panel.locator('.card', { hasText: 'Line managers by scope bucket' });
    const focus = dist.locator('g', { has: page.locator('rect[fill="var(--red)"]') });
    await expect(focus.locator('.bar-label')).toHaveText('6–10');
    // table: every row in the bucket
    const buckets = await panel.locator('.mg-table tbody td:last-child').allTextContents();
    expect(buckets.length).toBe(n);
    expect(new Set(buckets)).toEqual(new Set(['6–10']));
    // tiles stay on the full scope
    await expect(panel.locator('.tile[data-key="line_managers"] .tile-value')).toHaveText(tileBefore);
    // keyboard: Enter on another bucket
    await panel.locator('[data-mg-scope="11–20"]').focus();
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-mg-scope="11–20"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await panel.locator('.mg-table tbody tr').count()).toBe(Math.min(500, r.buckets['11–20']));
    // the bucket survives a global filter change and re-render
    await page.selectOption('#sel-asset', 'Vizag');
    await expect(panel.locator('[data-mg-scope="11–20"]')).toHaveAttribute('aria-pressed', 'true');
    const assets = await panel.locator('.mg-table tbody td:nth-child(5)').allTextContents();
    expect(new Set(assets)).toEqual(new Set(['Vizag']));
    await panel.locator('[data-mg-scope="All"]').click();
  });

  test('CHRO drill and table show identifiers; table exports to CSV', async ({ page }) => {
    await openManagers(page);
    const panel = page.locator('#panel-managers');
    const r = await page.evaluate(recount);
    const tile = panel.locator('.tile[data-key="line_managers"]');
    await expect(tile).toHaveAttribute('data-drill', 'line_managers');
    await tile.click();
    const modal = page.locator('.modal');
    await expect(modal).toContainText(`Line managers — manager details (${r.mgrs.toLocaleString('en-IN')})`);
    await expect(modal.locator('.data-table thead')).toContainText('Manager Name');
    expect(await modal.locator('.data-table tbody tr').count()).toBe(r.mgrs);
    await expect(modal.locator('.data-table tbody tr td').first()).toHaveText(/^AMNS-/);
    await page.keyboard.press('Escape');
    // same-level drill lists only managers with a same-level report
    await panel.locator('.tile[data-key="mgr_same_level"]').click();
    await expect(modal).toContainText('Same-level reports');
    expect(await modal.locator('.data-table tbody tr').count()).toBe(r.same);
    await page.keyboard.press('Escape');
    // in-tab table: header, raw IDs, most direct reports first
    await expect(panel.locator('.mg-table thead')).toContainText('Manager ID');
    await expect(panel.locator('.mg-table thead')).toContainText('Scope bucket');
    const dr = (await panel.locator('.mg-table tbody td:nth-child(7)').allTextContents()).map(intOf);
    expect(dr.length).toBe(Math.min(500, r.mgrs));
    for (let i = 1; i < dr.length; i++) expect(dr[i]).toBeLessThanOrEqual(dr[i - 1]);
    const csv = await download(page, () => panel.locator('[data-mg-csv]').click());
    expect(csv.name).toBe('manager-details-all-scope-buckets.csv');
    expect(csv.text.split(/\r?\n/)[0]).toContain('Manager ID,Manager Name,Level,Band,Asset,Function Plant,Direct reports,Scope bucket');
    expect(csv.text).toMatch(/AMNS-/);
  });

  test('masked persona: HRBP with org Full gets pseudonymised rows; an aggregate-only policy gets none', async ({ page }) => {
    await openMock(page);
    const raw = await page.evaluate(() => MgrKit.rows(MgrKit.managers(Compute.build(), Compute.ctxNow())).map((row) => row[0]));
    // simulate a policy holding HRBP (asset + function locked, PII masked) at org 'agg'
    await page.evaluate(() => { PERSONA_BY_ID.get('hrbp').levels.org = 'agg'; App.setPersona('hrbp', { asset: 'Vizag' }); });
    await page.click('#tab-managers');
    const panel = page.locator('#panel-managers');
    await expect(panel.locator('.tile[data-key="line_managers"] .tile-badge')).toHaveText('Aggregate only');
    await expect(panel.locator('.tile[data-key="line_managers"]')).not.toHaveAttribute('data-drill', /.*/);
    await expect(panel.locator('.mg-withheld')).toContainText('aggregates only');
    expect(await panel.locator('.mg-table').count()).toBe(0);
    // scope lock: Vizag + the bound function; no peer assets, no Group (no benchmark)
    const scoped = await page.evaluate(() => {
      const fn = Access.lockedFunction();
      const m = Compute.build();
      const mine = MgrKit.managers(m, Compute.ctxNow());
      return { fn, n: Compute.metric('line_managers').value, ok: mine.every((x) => x.e.asset === 'Vizag' && x.e.function === fn), len: mine.length };
    });
    expect(scoped.ok).toBe(true);
    expect(scoped.len).toBeGreaterThan(0);
    expect(scoped.n).toBe(scoped.len);
    for (const peer of ['Hazira', 'Paradeep', 'Kirandul', 'Group']) {
      expect(await panel.locator('svg text', { hasText: peer }).count(), peer).toBe(0);
      expect(await panel.locator(`[data-setasset="${peer}"]`).count()).toBe(0);
    }
    const text = await panel.innerText();
    for (const id of raw.slice(0, 40)) expect(text).not.toContain(id);
    // a gender category under 5 is withheld: bars with "<5", never a donut inflating the rest
    const genderCut = await page.evaluate(() => MgrKit.cut(MgrKit.managers(Compute.build(), Compute.ctxNow()), 'gender'));
    const gcard = panel.locator('.card', { hasText: 'Line managers by gender' });
    if (genderCut.some((g) => g.mgrs > 0 && g.mgrs < 5)) {
      await expect(gcard).toContainText('Shown as bars');
      expect(await gcard.locator('path[data-tip]').count()).toBe(0);
      await expect(gcard.locator('.bar-value', { hasText: '<5' }).first()).toBeVisible();
    }

    // the shipped policy (HRBP org 'Full'): rows appear, pseudonymised, names dropped
    await page.evaluate(() => { PERSONA_BY_ID.get('hrbp').levels.org = 'full'; App.setPersona('hrbp', { asset: 'Vizag' }); });
    await page.click('#tab-managers');
    await expect(panel.locator('.mg-table')).toBeVisible();
    await expect(panel).toContainText('Identifiers are pseudonymised');
    const heads = await panel.locator('.mg-table thead th').allTextContents();
    expect(heads).toContain('Manager ID');
    expect(heads).not.toContain('Manager Name');
    const ids = await panel.locator('.mg-table tbody td:first-child').allTextContents();
    expect(ids.length).toBe(scoped.len);
    for (const c of ids) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    const t2 = await panel.innerText();
    for (const id of raw.slice(0, 40)) expect(t2).not.toContain(id);
    // the tile drill goes through the same mask
    await panel.locator('.tile[data-key="line_managers"]').click();
    const modal = page.locator('.modal');
    await expect(modal).toContainText('identifiers masked');
    const cells = await modal.locator('.data-table tbody tr td:first-child').allTextContents();
    expect(cells.length).toBe(scoped.len);
    for (const c of cells) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    expect(new Set(cells)).toEqual(new Set(ids));               // stable within the session
    const csv = await download(page, () => page.click('[data-drill-csv]'));
    for (const id of raw.slice(0, 40)) expect(csv.text).not.toContain(id);
    expect(csv.text).not.toContain('Manager Name');
  });

  test('"none" persona and personas without the tab never see manager rows', async ({ page }) => {
    await openMock(page);
    // C&B (PII none), TA COE, Talent COE and HR Ops do not get the Managers tab at all
    for (const p of ['coe_cnb', 'coe_ta', 'coe_talent', 'hrops']) {
      await page.evaluate((id) => App.setPersona(id), p);
      await expect(page.locator('#tab-managers'), p).toHaveCount(0);
      await expect(page.locator('#panel-managers'), p).toHaveCount(0);
    }
    // 'none' withholds the drill even where the class is Full
    const none = await page.evaluate(() => {
      App.setPersona('coe_cnb');
      const d = REG_BY_KEY.get('line_managers').drill(Compute.build(), Compute.ctxNow());
      return { level: Access.level('line_managers'), masked: Access.maskDrill(d) };
    });
    expect(none.level).toBe('full');
    expect(none.masked).toBeNull();
    // simulate C&B being given the tab: counts render, the table and drill are withheld
    await page.evaluate(() => { PERSONA_BY_ID.get('coe_cnb').tabs.push('managers'); App.setPersona('coe_cnb'); });
    await page.click('#tab-managers');
    const panel = page.locator('#panel-managers');
    await expect(panel.locator('.tile[data-key="line_managers"] .tile-value')).toHaveText(/\d/);
    await expect(panel.locator('.mg-withheld')).toContainText('identifiers: none');
    expect(await panel.locator('.mg-table').count()).toBe(0);
    expect(await panel.locator('[data-mg-csv]').count()).toBe(0);
    await panel.locator('.tile[data-key="line_managers"]').click();
    await expect(page.locator('.modal')).toContainText('Row-level detail withheld');
    expect(await page.locator('.modal .data-table').count()).toBe(0);
  });

  test('BYOF without a reporting line: not computable, never a false zero', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(ARTIFACT);
    await loadFiles(page, [FIX('employee_master.csv')]);     // Manager ID column present but blank
    await page.keyboard.press('Escape');                       // load report
    await page.click('#tab-managers');
    const panel = page.locator('#panel-managers');
    await expect(panel.locator('.tile[data-key="line_managers"] .tile-value')).toHaveText('—');
    await expect(panel.locator('.tile[data-key="line_managers"] .tile-quality')).toContainText('Manager ID is blank on every employee row');
    await expect(panel.locator('.empty-note')).toContainText('Manager ID is blank on every row');
    expect(await panel.locator('.card').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('segment filter and segment / asset personas change the numbers', async ({ page }) => {
    await openManagers(page);
    const panel = page.locator('#panel-managers');
    const tile = panel.locator('.tile[data-key="line_managers"] .tile-value');
    const all = intOf(await tile.innerText());
    await page.selectOption('#sel-seg', 'Projects');
    await expect(tile).not.toHaveText(all.toLocaleString('en-IN'));
    const proj = intOf(await tile.innerText());
    expect(proj).toBeGreaterThan(0);
    expect(proj).toBeLessThan(all);
    const check = await page.evaluate(recount);
    expect(check.mgrs).toBe(proj);
    await expect(panel.locator('[data-mg-scope="All"] .mg-n')).toHaveText(proj.toLocaleString('en-IN'));
    await page.selectOption('#sel-seg', 'Operations');
    const ops = intOf(await tile.innerText());
    expect(ops + proj).toBeLessThanOrEqual(all);
    await page.selectOption('#sel-seg', 'All');
    // grade-band filter applies on this tab (employee-keyed)
    await expect(page.locator('#sel-band')).toBeEnabled();
    // segment-locked persona sees its segment's managers
    await page.evaluate(() => App.setPersona('segment_head', { segment: 'Projects' }));
    await page.click('#tab-managers');
    await expect(panel.locator('.tile[data-key="line_managers"] .tile-value')).toHaveText(proj.toLocaleString('en-IN'));
    // small-cell rule on persona-restricted cuts: bucket counts under 5 read "<5"
    const small = await page.evaluate(() => {
      const list = MgrKit.managers(Compute.build(), Compute.ctxNow());
      return CONFIG.scopeBuckets.map(([l]) => [l, list.filter((x) => x.bucket === l).length]).filter(([, n]) => n > 0 && n < CONFIG.minCell);
    });
    expect(small.length).toBeGreaterThan(0);                    // mock: Projects has a 21+ bucket of 1
    const dist = panel.locator('.card', { hasText: 'Line managers by scope bucket' });
    for (const [l] of small) {
      await expect(panel.locator(`[data-mg-scope="${l}"] .mg-n`)).toHaveText('<5');
      const g = dist.locator('g', { has: page.locator('.bar-label', { hasText: new RegExp(`^${l.replace(/[+]/g, '\\+')}$`) }) });
      await expect(g.locator('.bar-value')).toHaveText('<5');
      const tip = await g.getAttribute('data-tip');
      expect(tip).toContain('<5 line managers');
      expect(tip).not.toMatch(/· [\d,]+ direct reports/);
    }
    // asset-locked persona: own asset + Group benchmark only
    await page.evaluate(() => App.setPersona('asset_head', { asset: 'Paradeep' }));
    await page.click('#tab-managers');
    const labels = await panel.locator('.card', { hasText: 'Manager-to-employee ratio by asset' }).locator('.bar-label').allTextContents();
    expect(labels).toEqual(['Paradeep', 'Group']);
    for (const peer of ['Hazira', 'Vizag', 'Kirandul']) expect(await panel.locator('svg text', { hasText: peer }).count(), peer).toBe(0);
  });
});
