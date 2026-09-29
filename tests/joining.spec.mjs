import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ARTIFACT, loadMock } from './helpers.mjs';

const KEYS = ['join_hires_ytd', 'join_women_ytd', 'join_women_pct', 'join_lateral_ytd', 'join_campus_ytd', 'join_get_ytd', 'join_hires_12m'];

async function loadMockAs(page, persona = 'chro', bind = {}) {
  await page.goto(ARTIFACT);
  await page.selectOption('#gate-persona', persona);
  if (bind.asset) await page.selectOption('#gate-persona-asset', bind.asset);
  if (bind.segment) await page.selectOption('#gate-persona-seg', bind.segment);
  await loadMock(page);
}

async function openJoining(page) {
  await page.click('#tab-joining');
  await expect(page.locator('#panel-joining .tile[data-key="join_hires_ytd"]')).toBeVisible();
}

const tileValue = (page, key) => page.locator(`#panel-joining .tile[data-key="${key}"] .tile-value`);
const num = (s) => Number(String(s).replace(/[^\d.]/g, ''));
const card = (page, title) => page.locator('#panel-joining .card').filter({ has: page.locator('.card-title', { hasText: title }) });

async function download(page, trigger) {
  const [d] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: d.suggestedFilename(), text: readFileSync(await d.path(), 'utf8') };
}

test.describe('Phase 8 — R2 New Joining tab', () => {

  test('tiles compute fiscal-YTD hires that match an independent recount', async ({ page }) => {
    await loadMockAs(page);
    await openJoining(page);
    const r = await page.evaluate((keys) => {
      const m = Compute.build();
      const s = fyStartMonthIdx(AS_OF_MONTH);
      const from = makeDay(Math.floor(s / 12), s % 12, 1);
      const t12 = monthEndDay(AS_OF_MONTH - 12) + 1;
      const ytd = m.emps.filter((e) => e.doj != null && e.doj >= from && e.doj <= AS_OF_DAY);
      const types = {};
      for (const e of ytd) types[e.hire_type] = (types[e.hire_type] || 0) + 1;
      return {
        fyStartMonth: CONFIG.fyStartMonth, from: fmtDMY(from),
        recount: {
          join_hires_ytd: ytd.length,
          join_women_ytd: ytd.filter((e) => e.gender === 'Female').length,
          join_lateral_ytd: types.Lateral || 0, join_campus_ytd: types.Campus || 0, join_get_ytd: types.GET || 0,
          join_hires_12m: m.emps.filter((e) => e.doj != null && e.doj >= t12 && e.doj <= AS_OF_DAY).length
        },
        rehire: types.Rehire || 0,
        exitedIncluded: ytd.filter((e) => e.__exitDay <= AS_OF_DAY).length,
        values: Object.fromEntries(keys.map((k) => [k, Compute.metric(k).value])),
        classes: keys.map((k) => Access.classOf(k))
      };
    }, KEYS);
    expect(r.fyStartMonth).toBe(4);
    expect(r.from).toBe('01-04-2025');
    for (const [k, v] of Object.entries(r.recount)) expect(r.values[k], k).toBe(v);
    expect(r.values.join_hires_ytd).toBeGreaterThan(50);
    expect(r.values.join_women_ytd).toBeGreaterThan(0);
    expect(r.values.join_women_ytd).toBeLessThan(r.values.join_hires_ytd);
    expect(r.values.join_women_pct).toBeCloseTo(r.values.join_women_ytd / r.values.join_hires_ytd * 100, 6);
    expect(r.values.join_lateral_ytd + r.values.join_campus_ytd + r.values.join_get_ytd + r.rehire).toBe(r.values.join_hires_ytd);
    expect(r.values.join_hires_12m).toBeGreaterThan(r.values.join_hires_ytd);
    expect(r.classes).toEqual(KEYS.map(() => 'hiring'));
    // the tiles show exactly those values (Indian grouping), in one row, with the section window
    for (const k of KEYS.filter((x) => x !== 'join_women_pct')) {
      await expect(tileValue(page, k)).toHaveText(r.values[k].toLocaleString('en-IN'));
    }
    await expect(tileValue(page, 'join_women_pct')).toHaveText(r.values.join_women_pct.toFixed(1) + '%');
    await expect(page.locator('#panel-joining .section-head').first()).toContainText('New joiners — FY 2025–26 YTD');
    await expect(page.locator('#panel-joining .section-head').first()).toContainText('01-04-2025 → 30-06-2025');
    // "i": the exact fiscal definition
    await page.locator('#panel-joining .tile[data-key="join_hires_ytd"] .i-btn').click();
    await expect(page.locator('.popover')).toContainText('CONFIG.fyStartMonth = 4');
    await expect(page.locator('.popover')).toContainText('joiners who have since exited are included');
    await page.keyboard.press('Escape');
    // the grade-band filter applies on this employee-keyed tab
    await expect(page.locator('#sel-band')).toBeEnabled();
    await page.selectOption('#sel-band', 'VP & above');
    const vp = await page.evaluate(() => Compute.metric('join_hires_ytd').value);
    expect(vp).toBeLessThan(r.values.join_hires_ytd);
    await expect(tileValue(page, 'join_hires_ytd')).toHaveText(vp.toLocaleString('en-IN'));
  });

  test('charts render: 13-month trend with point labels, direct-labelled cuts, access on every card', async ({ page }) => {
    await loadMockAs(page);
    await openJoining(page);
    const titles = ['Hiring trend — month on month', 'Hires by gender', 'Hires by company', 'Hires by asset', 'Hires by function plant',
      'Hires by MC member', 'Hires by type of hire', 'Hires by generation', 'Hires by level', 'Hires by management band', 'Hiring details — employee-wise'];
    for (const t of titles) await expect(card(page, t), t).toHaveCount(1);
    for (const t of titles.slice(0, -1)) {
      expect(await card(page, t).locator('svg:not(.lock-ico)').count(), t).toBe(1);
      expect(await card(page, t).locator('.chart-empty').count(), t).toBe(0);
    }
    expect(await page.locator('#panel-joining .card:not([data-access]), #panel-joining .card[data-access="unclassified"]').count()).toBe(0);
    expect(await page.locator('#panel-joining .is-restricted').count()).toBe(0);
    // trend: 13 labelled points; the last 12 are the trailing-12 tile, the fiscal months are the YTD tile
    const trend = card(page, 'Hiring trend — month on month');
    const pts = (await trend.locator('text.jn-pt').allTextContents()).map(num);
    expect(pts.length).toBe(13);
    const v = await page.evaluate(() => ({ ytd: Compute.metric('join_hires_ytd').value, t12: Compute.metric('join_hires_12m').value }));
    expect(pts.slice(1).reduce((a, b) => a + b, 0)).toBe(v.t12);
    expect(pts.slice(-3).reduce((a, b) => a + b, 0)).toBe(v.ytd);     // Apr–Jun = fiscal YTD at a 30-06 as-of
    expect(await trend.locator('rect[data-tip]').count()).toBe(13);
    expect(await trend.locator('rect[data-tip]').last().getAttribute('data-tip')).toMatch(/Jun '25 \(current FY\)\nHires: \d+\nWomen: \d+/);
    await expect(trend.locator('svg')).toContainText('FY start');
    // cuts: every bar is direct-labelled with its count and share; bars sum to the YTD total
    const type = card(page, 'Hires by type of hire');
    expect(await type.locator('.bar-label').allTextContents()).toEqual(['Lateral', 'Campus', 'GET', 'Rehire']);
    const typeVals = (await type.locator('.bar-value').allTextContents()).map((s) => num(s.split(' ')[0]));
    expect(typeVals.reduce((a, b) => a + b, 0)).toBe(v.ytd);
    await expect(type.locator('.bar-value').first()).toContainText('%');
    const lvl = await card(page, 'Hires by level').locator('.bar-label').allTextContents();
    const ladder = await page.evaluate(() => CONFIG.levels);
    expect(lvl).toEqual(ladder.filter((l) => lvl.includes(l)));                // ladder order, senior → junior
    expect(await card(page, 'Hires by management band').locator('.bar-label').allTextContents())
      .toEqual(['Senior management', 'Middle management', 'Junior management', 'Blue collar']);
    const gens = await card(page, 'Hires by generation').locator('.bar-label').allTextContents();
    expect(gens.length).toBeGreaterThan(1);
    expect(['Boomer', 'Gen X', 'Millennial', 'Gen Z'].filter((g) => gens.includes(g))).toEqual(gens);
    const mc = await card(page, 'Hires by MC member').locator('.bar-label').allTextContents();
    for (const l of mc) expect(l).toMatch(/^(MC-\d{2}|\(unmapped\))$/);
    const co = await card(page, 'Hires by company').locator('.bar-label').allTextContents();
    for (const l of co) expect(l).toMatch(/^(Company [A-C]|\(blank\))$/);
    expect(await card(page, 'Hires by function plant').locator('.jn-scroll svg').count()).toBe(1);
    await expect(card(page, 'Hires by gender').locator('svg')).toContainText(`${v.ytd} hires`);
    await expect(card(page, 'Hires by gender').locator('path[data-tip]').first()).toHaveAttribute('data-tip', /^Female: \d+ \(/);
    // the asset cut cross-filters: click Paradeep → every tile recomputes for Paradeep
    const assets = card(page, 'Hires by asset');
    expect(await assets.locator('[data-setasset]').count()).toBe(4);
    await assets.locator('[data-setasset="Paradeep"]').click();
    await expect(page.locator('#sel-asset')).toHaveValue('Paradeep');
    const pd = await page.evaluate(() => Compute.metric('join_hires_ytd').value);
    expect(pd).toBeLessThan(v.ytd);
    await expect(tileValue(page, 'join_hires_ytd')).toHaveText(pd.toLocaleString('en-IN'));
  });

  test('segment filter narrows every hire count on the tab', async ({ page }) => {
    await loadMockAs(page);
    await openJoining(page);
    const all = num(await tileValue(page, 'join_hires_ytd').innerText());
    await page.selectOption('#sel-seg', 'Projects');
    await expect(page.locator('#scope-chip')).toHaveText('Business: Projects');
    const r = await page.evaluate(() => ({
      proj: Compute.metric('join_hires_ytd').value,
      ops: Compute.metric('join_hires_ytd', { segment: 'Operations' }).value,
      segs: new Set(JoinKit.ytd(Compute.build(), Compute.ctxNow()).map((e) => Compute.segOf(e))).size
    }));
    expect(r.proj).toBeGreaterThan(0);
    expect(r.proj).toBeLessThan(all);
    expect(r.proj + r.ops).toBeLessThanOrEqual(all);                 // Unassigned rows count only under All
    expect(r.segs).toBe(1);
    await expect(tileValue(page, 'join_hires_ytd')).toHaveText(r.proj.toLocaleString('en-IN'));
    expect(num(await tileValue(page, 'join_hires_ytd').innerText())).not.toBe(all);
    await expect(card(page, 'Hires by gender').locator('svg')).toContainText(`${r.proj} hires`);
    await expect(card(page, 'Hiring details — employee-wise')).toContainText(`${r.proj} rows`);
  });

  test('row-level detail: identified for CHRO, pseudonymised when masked, withheld for none', async ({ page }) => {
    await loadMockAs(page);
    await openJoining(page);
    const n = await page.evaluate(() => Compute.metric('join_hires_ytd').value);
    // CHRO: tile drill lists every YTD hire with identifiers
    await page.click('#panel-joining .tile[data-drill="join_hires_ytd"]');
    const modal = page.locator('.modal');
    await expect(modal).toContainText(`Hires — FY 2025–26 YTD (${n})`);
    await expect(modal.locator('.data-table tbody tr')).toHaveCount(n);
    await expect(modal.locator('.data-table thead')).toContainText('Name');
    await page.keyboard.press('Escape');
    const table = card(page, 'Hiring details — employee-wise');
    await expect(table.locator('thead th').first()).toHaveText('Employee ID');
    await expect(table.locator('thead')).toContainText('Name');
    await expect(table.locator('tbody tr')).toHaveCount(Math.min(n, 100));
    await expect(table.locator('tbody tr td').first()).toHaveText(/^AMNS-/);
    // the table button opens the full drill (all rows + CSV)
    await table.locator('button[data-drill="join_hires_ytd"]').click();
    await expect(modal.locator('.data-table tbody tr')).toHaveCount(n);
    await page.keyboard.press('Escape');

    // masked persona (TA & Mobility COE): pseudonyms, no names — in the table, the drill and its CSV
    await page.evaluate(() => App.setPersona('coe_ta'));
    await openJoining(page);
    const raw = await page.evaluate(() => {
      const d = REG_BY_KEY.get('join_hires_ytd').drill(Compute.build(), Compute.ctxNow());
      return { ids: d.rows.map((r) => r[0]), names: d.rows.map((r) => r[1]).filter(Boolean) };
    });
    expect(raw.ids.length).toBe(n);
    await expect(table.locator('thead')).not.toContainText('Name');
    await expect(table).toContainText('identifiers masked');
    const cells = await table.locator('tbody tr td:first-child').allTextContents();
    expect(cells.length).toBe(Math.min(n, 100));
    for (const c of cells) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    const panelText = await page.locator('#panel-joining').innerText();
    for (const id of raw.ids.slice(0, 40)) expect(panelText).not.toContain(id);
    for (const nm of raw.names.slice(0, 40)) expect(panelText).not.toContain(nm);
    await page.click('#panel-joining .tile[data-drill="join_lateral_ytd"]');
    await expect(modal).toContainText('identifiers masked');
    for (const c of await modal.locator('.data-table tbody tr td:first-child').allTextContents()) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    const csv = await download(page, () => page.click('[data-drill-csv]'));
    for (const id of raw.ids.slice(0, 40)) expect(csv.text).not.toContain(id);
    expect(csv.text.split(/\r?\n/)[0]).not.toContain('Name');
    await page.keyboard.press('Escape');

    // PII 'none': a persona with full hiring but no identifiers gets no row-level detail anywhere
    await page.evaluate(() => {
      const p = { id: 'test_none', label: 'Test — no identifiers', short: 'Test none', scope: 'all', tabs: ['joining'], levels: { hiring: 'full', core: 'full' }, pii: 'none', who: 'spec only' };
      PERSONAS.push(p);
      PERSONA_BY_ID.set(p.id, p);
      App.setPersona('test_none');
    });
    await openJoining(page);
    await expect(table.locator('.data-table')).toHaveCount(0);
    await expect(table).toContainText('Row-level detail withheld');
    await expect(table).toContainText('identifiers: none');
    await expect(tileValue(page, 'join_hires_ytd')).toHaveText(n.toLocaleString('en-IN'));   // aggregates still shown
    await page.click('#panel-joining .tile[data-drill="join_hires_ytd"]');
    await expect(modal).toContainText('Row-level detail withheld');
    await expect(modal.locator('.data-table')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // and the real 'none' persona (C&B): hiring aggregate-only, drill masked to nothing
    const cnb = await page.evaluate(() => {
      App.setPersona('coe_cnb');
      const d = REG_BY_KEY.get('join_hires_ytd').drill(Compute.build(), Compute.ctxNow());
      const div = document.createElement('div');
      TabRenderers.joining(div);
      return { masked: Access.maskDrill(d), table: Access.maskTable(d.columns, d.rows), canDrill: Access.canDrill('join_hires_ytd'),
        level: Access.level('join_hires_ytd'), rows: div.querySelectorAll('.data-table').length, text: div.textContent };
    });
    expect(cnb).toMatchObject({ masked: null, table: null, canDrill: false, level: 'agg', rows: 0 });
    expect(cnb.text).toContain('Row-level detail withheld');
  });

  test('personas: tab hidden where out of profile; asset head sees own asset only with small cells suppressed', async ({ page }) => {
    await loadMockAs(page, 'hrops');
    await expect(page.locator('#tab-joining')).toHaveCount(0);
    await expect(page.locator('#panel-joining')).toHaveCount(0);
    const vis = await page.evaluate(() => Object.fromEntries(PERSONAS.map((p) => [p.id, Access.tabVisibleFor(p.id, 'joining')])));
    expect(vis).toEqual({ chro: true, asset_head: true, segment_head: true, coe_ta: true, coe_talent: false, coe_cnb: false, hrops: false, hrbp: false });
    for (const id of ['hrbp', 'coe_cnb', 'coe_talent']) {
      await page.evaluate((pid) => App.setPersona(pid, { asset: 'Vizag' }), id);
      await expect(page.locator('#tab-joining'), id).toHaveCount(0);
    }
    expect(await page.evaluate(() => ['hrbp', 'coe_cnb', 'hrops'].map((p) => Access.levelFor(p, 'join_hires_ytd')))).toEqual(['agg', 'agg', 'agg']);

    // Asset HR head (Hazira): own-asset values, peers never drawn, cuts below minCell suppressed
    await page.evaluate(() => App.setPersona('asset_head', { asset: 'Hazira' }));
    await openJoining(page);
    const hz = await page.evaluate(() => ({
      v: Compute.metric('join_hires_ytd').value, g: Compute.metric('join_hires_ytd', { asset: 'Group' }).value, min: CONFIG.minCell
    }));
    expect(hz.v).toBeLessThan(hz.g);
    await expect(tileValue(page, 'join_hires_ytd')).toHaveText(hz.v.toLocaleString('en-IN'));
    await expect(card(page, 'Hires by asset').locator('.bar-label')).toHaveText(['Hazira']);
    expect(await page.locator('#panel-joining [data-setasset]').count()).toBe(0);
    for (const peer of ['Paradeep', 'Vizag', 'Kirandul']) {
      expect(await page.locator('#panel-joining svg text', { hasText: peer }).count(), peer).toBe(0);
    }
    await expect(page.locator('#panel-joining .section-head').nth(1)).toContainText(`cuts below ${hz.min} hires suppressed`);
    const values = await page.locator('#panel-joining .card:not(:has(.jn-trend)) svg .bar-value').allTextContents();
    expect(values.length).toBeGreaterThan(10);
    let suppressed = 0;
    for (const t of values) {
      const lead = t.trim().split(' ')[0];
      if (lead === '—') { expect(t).toContain('suppressed'); suppressed++; } else expect(num(lead)).toBeGreaterThanOrEqual(hz.min);
    }
    expect(suppressed).toBeGreaterThan(0);
    for (const tip of await page.locator('#panel-joining .card svg g[data-tip]').evaluateAll((els) => els.map((e) => e.dataset.tip))) {
      if (/suppressed/.test(tip)) expect(tip).not.toMatch(/: \d+ hires/);
    }
  });
});
