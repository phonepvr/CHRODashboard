import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ARTIFACT, FIX, loadMock, loadFiles } from './helpers.mjs';

// R5 — Attrition page additions: fiscal-YTD KPI strip (D6), exit-type toggle,
// annualised rate cuts by dimension, attrition by type, employee-wise details.

async function openAs(page, persona = 'chro', bind = {}) {
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

const num = (s) => Number(String(s).replace(/[^\d.-]/g, ''));
const cutCard = (page, title) => page.locator('#attr-cuts .card', { has: page.locator('.card-title', { hasText: title }) });
const barLabels = (card) => card.locator('svg text.bar-label').allTextContents();
const typeCells = (page) => page.locator('.attr-details tbody tr td:nth-child(9)').allTextContents();

test.describe('R5 — Attrition page: YTD strip, exit-type toggle, rate cuts, details', () => {

  test('KPI strip: separations YTD, FY-start / as-of headcount, absolute attrition (D6), retirements apart', async ({ page }) => {
    await openAs(page);
    await page.click('#tab-attrition');
    const r = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      const fy = fyStartMonthIdx(ctx.endMonth);
      const ytd = m.exits.filter((x) => x.__emp && x.__mi >= fy && x.__mi <= ctx.endMonth && x.__emp.employee_class === 'Permanent');
      const day0 = Compute.fyStartDay(ctx) - 1;
      const open = m.emps.filter((e) => e.employee_class === 'Permanent' && e.doj != null && e.doj <= day0 && e.__exitDay > day0).length;
      const v = (k) => Compute.metric(k).value;
      return {
        sep: v('attr_sep_ytd'), ret: v('attr_retire_ytd'), open: v('attr_hc_fystart'), close: v('attr_hc_asof'),
        abs: v('attr_abs_ytd'), ann: v('attr_ytd'), hc: v('headcount_close'),
        indepSep: ytd.filter((x) => x.exit_type !== 'Retirement').length,
        indepRet: ytd.filter((x) => x.exit_type === 'Retirement').length,
        indepOpen: open, months: ctx.endMonth - fy + 1,
        classes: ['attr_sep_ytd', 'attr_abs_ytd', 'attr_rate_tenure', 'attr_involuntary', 'attr_reason_top'].map((k) => Access.classOf(k))
      };
    });
    expect(r.sep).toBeGreaterThan(50);
    expect(r.sep).toBe(r.indepSep);                        // retirements excluded
    expect(r.ret).toBeGreaterThan(0);
    expect(r.ret).toBe(r.indepRet);                        // …and counted on their own
    expect(r.open).toBe(r.indepOpen);
    expect(r.close).toBe(r.hc);
    expect(r.abs).toBeCloseTo(r.sep / ((r.open + r.close) / 2) * 100, 8);
    expect(r.months).toBeLessThan(12);
    expect(r.ann).toBeGreaterThan(r.abs);                  // annualised > absolute part-way through the year
    expect(r.classes).toEqual(['core', 'core', 'core', 'core', 'core']);
    const tile = (k) => page.locator(`#panel-attrition .attr-strip .tile[data-key="${k}"] .tile-value`);
    await expect(tile('attr_sep_ytd')).toHaveText(r.sep.toLocaleString('en-IN'));
    await expect(tile('attr_retire_ytd')).toHaveText(r.ret.toLocaleString('en-IN'));
    await expect(tile('attr_hc_fystart')).toHaveText(r.open.toLocaleString('en-IN'));
    await expect(tile('attr_hc_asof')).toHaveText(r.close.toLocaleString('en-IN'));
    expect(num(await tile('attr_abs_ytd').innerText())).toBeCloseTo(r.abs, 2);
    expect(num(await tile('attr_ytd').innerText())).toBeCloseTo(r.ann, 1);
    // each KPI key renders exactly once on the page; existing content is kept
    for (const k of ['attr_ytd', 'attr_voluntary', 'attr_annualised', 'attr_regretted', 'senior_exits']) {
      await expect(page.locator(`#panel-attrition .tile[data-key="${k}"]`)).toHaveCount(1);
    }
    for (const t of ['Monthly attrition by asset', 'Total vs voluntary', 'Exits by stated reason', 'Early turnover (≤1 yr) by asset']) {
      await expect(page.locator('#panel-attrition .card', { hasText: t })).toBeVisible();
    }
    // the "i" states the D6 formula
    await page.locator('.tile[data-key="attr_abs_ytd"] .i-btn').click();
    await expect(page.locator('.popover')).toContainText('(headcount at FY start + headcount as-of) ÷ 2');
    await page.keyboard.press('Escape');
  });

  test('rate cuts: every dimension draws in CONFIG order; values are Compute.rateBy; type split adds up', async ({ page }) => {
    await openAs(page);
    await page.click('#tab-attrition');
    const cards = page.locator('#attr-cuts .card');
    await expect(cards).toHaveCount(10);
    for (let i = 0; i < 10; i++) {
      await expect(cards.nth(i).locator('svg')).toHaveCount(1);
      await expect(cards.nth(i)).toHaveAttribute('data-access', 'core');
    }
    const cfg = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      const tenure = Compute.rateBy(m, ctx, (e, day) => (e.doj == null ? null : bucketOf(yearsBetween(e.doj, day), CONFIG.tenureBuckets)));
      return {
        tenure: CONFIG.tenureBuckets.map((b) => b[0]), bands: CONFIG.mgmtBands.map((b) => CONFIG.mgmtBandLabels[b]),
        gens: CONFIG.generations.map((g) => g[0]), levels: CONFIG.levels,
        oneToTwo: tenure.find((r) => r.key === '1–2Y').rate,
        types: ['All', 'Voluntary', 'Involuntary'].map((t) => AttrKit.overall(m, ctx, t).rate),
        attr: Compute.metric('attr_annualised').value, vol: Compute.metric('attr_voluntary').value, inv: Compute.metric('attr_involuntary').value
      };
    });
    expect(await barLabels(cutCard(page, 'Attrition rate by tenure'))).toEqual(cfg.tenure);
    expect(await barLabels(cutCard(page, 'Attrition rate by management band'))).toEqual(cfg.bands);
    const gens = await barLabels(cutCard(page, 'Attrition rate by generation'));
    expect(gens.map((g) => g.replace(' *', ''))).toEqual(cfg.gens.filter((g) => gens.some((x) => x.startsWith(g))));
    const levels = (await barLabels(cutCard(page, 'Attrition rate by level'))).map((l) => l.replace(' *', ''));
    expect(levels).toEqual(cfg.levels.filter((l) => levels.includes(l)));
    expect(levels.length).toBeGreaterThanOrEqual(8);
    expect(await barLabels(cutCard(page, 'Attrition rate by company'))).toEqual(['Company A', 'Company B', 'Company C']);
    expect(await barLabels(cutCard(page, 'Attrition rate by asset'))).toEqual(['Hazira', 'Paradeep', 'Vizag', 'Kirandul', 'Group']);
    expect((await barLabels(cutCard(page, 'function plant'))).length).toBe(12);
    const mc = await barLabels(cutCard(page, 'MC member'));
    expect(mc.slice(0, 3)).toEqual(['MC-01', 'MC-02', 'MC-03']);
    await expect(cutCard(page, 'Attrition rate by gender')).toContainText('Female');
    // the drawn value is the rateBy value; the highest adequate-base bucket is Smart Red
    await expect(cutCard(page, 'Attrition rate by tenure').locator('text.bar-value').nth(2)).toHaveText(cfg.oneToTwo.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
    expect(await cutCard(page, 'Attrition rate by tenure').locator('rect[fill="var(--red)"]').count()).toBe(1);
    // type split: voluntary + involuntary = all; tiles agree with the chart
    expect(cfg.types[1] + cfg.types[2]).toBeCloseTo(cfg.types[0], 8);
    expect(cfg.types[0]).toBeCloseTo(cfg.attr, 8);
    expect(cfg.types[1]).toBeCloseTo(cfg.vol, 8);
    expect(cfg.types[2]).toBeCloseTo(cfg.inv, 8);
    const typeCard = page.locator('#charts-attrition-type .card');
    expect(await barLabels(typeCard)).toEqual(['All types', 'Voluntary', 'Involuntary']);
    await expect(typeCard).toContainText('retirements in the period, counted separately');
    // hover tooltips carry exits and the base
    const tip = await cutCard(page, 'Attrition rate by tenure').locator('g[data-tip]').first().getAttribute('data-tip');
    expect(tip).toMatch(/Exits: \d+ · average headcount: [\d,.]+/);
    // clicking a cut bar opens the aggregate table (all / voluntary / involuntary side by side)
    await cutCard(page, 'Attrition rate by tenure').locator('g[data-drill]').first().click();
    await expect(page.locator('.modal')).toContainText('Attrition by tenure bucket');
    await expect(page.locator('.modal thead')).toContainText('Rate — voluntary');
    await expect(page.locator('.modal tbody tr')).toHaveCount(cfg.tenure.length);
    await page.keyboard.press('Escape');
    // the asset cut cross-filters like every asset chart
    await cutCard(page, 'Attrition rate by asset').locator('[data-setasset="Vizag"]').click();
    await expect(page.locator('#sel-asset')).toHaveValue('Vizag');
    await expect(cutCard(page, 'Attrition rate by asset').locator('g[data-setasset="Vizag"] rect')).toHaveAttribute('fill', 'var(--red)');
  });

  test('exit-type toggle: radio group, keyboard, re-scopes cuts + details only, survives a re-render', async ({ page }) => {
    await openAs(page);
    await page.click('#tab-attrition');
    const group = page.locator('#attr-bar [role="radiogroup"]');
    await expect(group).toHaveAttribute('aria-labelledby', 'attr-type-lbl');
    await expect(group.locator('input[type="radio"]')).toHaveCount(3);
    await expect(page.locator('input[name="attr-type"][value="All"]')).toBeChecked();
    const before = {
      tenure: await cutCard(page, 'Attrition rate by tenure').locator('text.bar-value').allTextContents(),
      sep: await page.locator('.tile[data-key="attr_sep_ytd"] .tile-value').innerText(),
      type: await page.locator('#charts-attrition-type').innerText()
    };
    expect(new Set(await typeCells(page))).toEqual(new Set(['Voluntary', 'Involuntary']));
    // keyboard: focus the group, arrow to Voluntary
    await page.locator('input[name="attr-type"][value="All"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('input[name="attr-type"][value="Voluntary"]')).toBeChecked();
    await expect(page.locator('input[name="attr-type"][value="Voluntary"]')).toBeFocused();
    await expect(page.locator('#attr-cuts [data-attr-type-sub]')).toContainText('Voluntary exits');
    await expect(cutCard(page, 'Attrition rate by tenure')).toContainText('Voluntary exits');
    expect(await cutCard(page, 'Attrition rate by tenure').locator('text.bar-value').allTextContents()).not.toEqual(before.tenure);
    expect(new Set(await typeCells(page))).toEqual(new Set(['Voluntary']));
    // the KPI strip and the type split are not re-scoped
    await expect(page.locator('.tile[data-key="attr_sep_ytd"] .tile-value')).toHaveText(before.sep);
    expect(await page.locator('#charts-attrition-type').innerText()).toBe(before.type);
    // every voluntary bucket rate ≤ the all-types rate
    const ok = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      return AttrKit.DIMS.every((d) => {
        const all = AttrKit.cut(m, ctx, d, 'All'), vol = AttrKit.cut(m, ctx, d, 'Voluntary');
        return vol.every((v) => { const a = all.find((x) => x.key === v.key); return v.rate == null || (a && v.rate <= a.rate + 1e-9); });
      });
    });
    expect(ok).toBe(true);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('input[name="attr-type"][value="Involuntary"]')).toBeChecked();
    expect(new Set(await typeCells(page))).toEqual(new Set(['Involuntary']));
    // a filter change re-renders the tab: the selection is kept
    await page.selectOption('#sel-band', 'AM-GM');
    await expect(page.locator('input[name="attr-type"][value="Involuntary"]')).toBeChecked();
    await expect(page.locator('#attr-cuts [data-attr-type-sub]')).toContainText('Involuntary exits');
    await page.locator('#attr-bar label', { hasText: /^All$/ }).click();
    await expect(page.locator('input[name="attr-type"][value="All"]')).toBeChecked();
    await expect(page.locator('#attr-cuts [data-attr-type-sub]')).toContainText('All exit types');
  });

  test('details + drills: identified for CHRO, pseudonymised for a masked persona, withheld for "none"', async ({ page }) => {
    await openAs(page);
    await page.click('#tab-attrition');
    const heads = page.locator('.attr-details thead th');
    await expect(heads.first()).toHaveText('Employee ID');
    await expect(page.locator('.attr-details thead')).toContainText('Name');
    const rawIds = await page.locator('.attr-details tbody tr td:nth-child(1)').allTextContents();
    expect(rawIds.length).toBe(100);                              // capped on the page
    for (const id of rawIds.slice(0, 10)) expect(id).toMatch(/^AMNS-/);
    await expect(page.locator('.attr-details')).toContainText(/Latest 100 of \d+ separations/);
    await expect(page.locator('#attr-cuts')).not.toContainText('<5 exits');     // CHRO: no small-cell suppression
    await page.click('.tile[data-drill="attr_sep_ytd"]');
    await expect(page.locator('.modal')).toContainText('Separations — fiscal YTD');
    await expect(page.locator('.modal .data-table tbody tr td:nth-child(1)').first()).toHaveText(/^AMNS-/);
    await page.keyboard.press('Escape');

    // masked persona (TA & Mobility COE sees the Attrition tab)
    await page.evaluate(() => App.setPersona('coe_ta'));
    await page.click('#tab-attrition');
    await expect(page.locator('.attr-details thead')).not.toContainText('Name');
    await expect(page.locator('.attr-details')).toContainText('Identifiers pseudonymised for TA & Mobility COE');
    const masked = await page.locator('.attr-details tbody tr td:nth-child(1)').allTextContents();
    expect(masked.length).toBe(100);
    for (const c of masked) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    const pageText = await page.locator('#panel-attrition').innerText();
    for (const id of rawIds.slice(0, 25)) expect(pageText).not.toContain(id);
    const csv = await download(page, () => page.click('[data-attr-csv]'));
    expect(csv.name).toMatch(/^attrition-details/);
    for (const id of rawIds.slice(0, 25)) expect(csv.text).not.toContain(id);
    expect(csv.text).toContain(masked[0]);
    expect(csv.text.split(/\r?\n/)[0]).not.toContain('Name');
    await page.click('.tile[data-drill="attr_sep_ytd"]');
    const modal = page.locator('.modal');
    await expect(modal).toContainText('identifiers masked');
    for (const c of await modal.locator('.data-table tbody tr td:nth-child(1)').allTextContents()) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    await expect(modal.locator('thead')).not.toContainText('Name');
    await page.keyboard.press('Escape');
    // small cells: exits below CONFIG.minCell are suppressed on persona-restricted cuts, never for CHRO
    await expect(page.locator('#attr-cuts')).toContainText('<5 exits');
    await expect(page.locator('#attr-cuts')).toContainText('fewer than 5 exits, suppressed for this persona');

    // "none" persona (C&B): no Attrition tab; person rows withheld at every choke point
    const none = await page.evaluate(() => {
      App.setPersona('coe_cnb');
      const m = Compute.build(), ctx = Compute.ctxNow();
      const d = REG_BY_KEY.get('attr_sep_ytd').drill(m, ctx);
      return {
        tab: Access.canSeeTab('attrition'), rows: d.rows.length, masked: Access.maskDrill(d),
        drill: Access.canDrill('attr_sep_ytd'), table: AttrKit.detailsTable(m, ctx, 'All'),
        html: AttrKit.detailsHTML(m, ctx, 'All'),
        aggKept: Access.maskDrill(REG_BY_KEY.get('attr_rate_tenure').drill(m, ctx)) !== null
      };
    });
    expect(none.tab).toBe(false);
    expect(none.rows).toBeGreaterThan(0);
    expect(none.masked).toBeNull();
    expect(none.drill).toBe(false);
    expect(none.table).toBeNull();
    expect(none.html).toContain('Row-level detail withheld');
    expect(none.html).not.toMatch(/AMNS-|EMP-/);
    expect(none.aggKept).toBe(true);                               // aggregate cut tables carry no identifiers
    await expect(page.locator('#tab-attrition')).toHaveCount(0);
  });

  test('personas without the Attrition tab never render it; asset-locked persona sees own asset + Group only', async ({ page }) => {
    await openAs(page, 'hrops');
    for (const p of ['hrops', 'coe_talent', 'coe_cnb']) {
      await page.evaluate((id) => App.setPersona(id), p);
      await expect(page.locator('#tab-attrition'), p).toHaveCount(0);
      await expect(page.locator('#panel-attrition'), p).toHaveCount(0);
      expect(await page.evaluate(() => Access.canSeeTab('attrition'))).toBe(false);
    }
    await page.evaluate(() => App.setPersona('asset_head', { asset: 'Kirandul' }));
    await page.click('#tab-attrition');
    const assetCard = cutCard(page, 'Attrition rate by asset');
    expect(await barLabels(assetCard)).toEqual(['Kirandul', 'Group']);
    expect(await page.locator('#panel-attrition [data-setasset]').count()).toBe(0);
    for (const peer of ['Hazira', 'Paradeep', 'Vizag']) {
      expect(await page.locator('#panel-attrition svg text', { hasText: peer }).count(), peer).toBe(0);
    }
    const assets = new Set(await page.locator('.attr-details tbody tr td:nth-child(6)').allTextContents());
    expect([...assets]).toEqual(['Kirandul']);
  });

  test('BYOF with legacy files (no Phase 8 columns, no org_units): renders, blanks surfaced, no errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(ARTIFACT);
    await loadFiles(page, [FIX('employee_master.csv'), FIX('exits.csv')]);
    await page.keyboard.press('Escape');
    await page.click('#tab-attrition');
    await expect(page.locator('.tile[data-key="attr_hc_asof"] .tile-value')).toHaveText('12');
    await expect(page.locator('.tile[data-key="attr_sep_ytd"] .tile-value')).toHaveText('0');
    await expect(cutCard(page, 'Attrition rate by MC member')).toContainText('needs exits.csv, employee_master.csv, org_units.csv');
    await expect(cutCard(page, 'function plant')).toContainText('Function plant is not recorded for anyone in scope');
    await expect(cutCard(page, 'Attrition rate by level')).toContainText('(not recorded)');
    await expect(page.locator('.attr-details')).toContainText('No separations of this type');
    await page.locator('input[name="attr-type"][value="Involuntary"]').check();
    await expect(page.locator('#attr-cuts [data-attr-type-sub]')).toContainText('Involuntary exits');
    expect(errors).toEqual([]);
  });

  test('segment filter re-scopes the strip, the cuts and the details', async ({ page }) => {
    await openAs(page);
    await page.click('#tab-attrition');
    const read = async () => ({
      sep: num(await page.locator('.tile[data-key="attr_sep_ytd"] .tile-value').innerText()),
      open: num(await page.locator('.tile[data-key="attr_hc_fystart"] .tile-value').innerText()),
      tenure: await cutCard(page, 'Attrition rate by tenure').locator('text.bar-value').allTextContents(),
      count: await page.locator('.attr-details-count').innerText()
    });
    const all = await read();
    await page.selectOption('#sel-seg', 'Projects');
    await expect(page.locator('#scope-chip')).toHaveText('Business: Projects');
    const proj = await read();
    expect(proj.sep).toBeGreaterThan(0);
    expect(proj.sep).toBeLessThan(all.sep);
    expect(proj.open).toBeLessThan(all.open);
    expect(proj.tenure).not.toEqual(all.tenure);
    expect(proj.count).not.toBe(all.count);
    const expected = await page.evaluate(() => Compute.metric('attr_sep_ytd').value);
    expect(proj.sep).toBe(expected);
    // segment-locked persona: the same figures, locked
    await page.evaluate(() => App.setPersona('segment_head', { segment: 'Projects' }));
    await page.click('#tab-attrition');
    await expect(page.locator('#sel-seg')).toBeDisabled();
    expect(num(await page.locator('.tile[data-key="attr_sep_ytd"] .tile-value').innerText())).toBe(expected);
  });
});
