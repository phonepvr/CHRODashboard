import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadMock, packPages } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = 'file://' + join(root, 'dist', 'index.html');

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

async function download(page, trigger) {
  const [d] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: d.suggestedFilename(), text: readFileSync(await d.path(), 'utf8') };
}

test.describe('Phase 8 — Core-B: grouped nav, segment filter, personas, access matrix', () => {

  test('nav: grouped tab bar, every tab id renders real content, roving tabindex across groups', async ({ page }) => {
    await loadMockAs(page);
    const ids = await page.evaluate(() => TABS.map((t) => t.id));
    for (const id of ['fieldmap', 'overview', 'scorecard', 'outlook', 'managers', 'positions', 'movement', 'absence',
      'talent', 'performance', 'lnd', 'mobility', 'ta', 'joining', 'attrition', 'diversity', 'contract', 'quality', 'methodology', 'access']) {
      expect(ids).toContain(id);
    }
    await expect(page.locator('#tablist [role="tab"]')).toHaveCount(ids.length);
    for (const g of ['Setup', 'Executive', 'Workforce', 'Talent', 'Acquisition & Retention', 'Operations', 'Governance']) {
      await expect(page.locator('.tabgroup-label', { hasText: g }).first()).toBeVisible();
    }
    // landing stays Overview; Field Mapping is first in the bar
    await expect(page.locator('#tab-overview')).toHaveAttribute('aria-selected', 'true');
    expect(await page.locator('#tablist [role="tab"]').first().getAttribute('id')).toBe('tab-fieldmap');
    // no stub remains: every tab renders its own content for CHRO (no placeholder)
    for (const id of ids) {
      await page.click('#tab-' + id);
      const panel = page.locator('#panel-' + id);
      await expect(panel).toBeVisible();
      expect(await panel.locator('.placeholder-note').count(), id).toBe(0);
      await expect(panel).not.toContainText('This section is being built');
      expect(await panel.locator('.tile, .card, .data-table, .exec-band, .am-table').count(), id).toBeGreaterThan(0);
    }
    await page.click('#tab-positions');
    await expect(page.locator('#panel-positions .section-head h2', { hasText: 'Position inventory' })).toBeVisible();
    // keyboard: arrows cross group boundaries, Home/End jump to the ends
    await page.click('#tab-outlook');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-managers')).toBeFocused();
    await expect(page.locator('#tab-managers')).toHaveAttribute('tabindex', '0');
    await expect(page.locator('#tab-outlook')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#tab-outlook')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('#tab-access')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('#tab-fieldmap')).toBeFocused();
    // attrition + contract renderers still live (moved to their own files)
    await page.click('#tab-attrition');
    await expect(page.locator('#panel-attrition .card', { hasText: 'Total vs voluntary' })).toBeVisible();
    await page.click('#tab-contract');
    await expect(page.locator('#panel-contract .tile[data-key="contract_compliance_idx"]')).toBeVisible();
    // the longer header (scope chip + persona chip) wraps instead of clipping its actions
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.evaluate(() => App.setPersona('segment_head', { segment: 'Operations' }));
    const clipped = await page.evaluate(() => {
      const r = document.querySelector('.app-header').getBoundingClientRect().right;
      return [...document.querySelectorAll('.hdr-actions .btn')].filter((b) => b.getBoundingClientRect().right > r + 0.5).map((b) => b.textContent);
    });
    expect(clipped).toEqual([]);
  });

  test('segment selector: recomputes, shows in header/footer chips and print footers', async ({ page }) => {
    await loadMockAs(page);
    await expect(page.locator('#scope-chip')).toHaveText('Business: All');
    const all = await page.locator('[data-key="headcount_close"] .tile-value').innerText();
    await page.selectOption('#sel-seg', 'Projects');
    await expect(page.locator('#scope-chip')).toHaveText('Business: Projects');
    await expect(page.locator('#ft-scope')).toHaveText('Business: Projects');
    const proj = await page.locator('[data-key="headcount_close"] .tile-value').innerText();
    expect(Number(proj.replace(/,/g, ''))).toBeLessThan(Number(all.replace(/,/g, '')));
    await expect(page.locator('.exec-band').first()).toContainText('Group · Projects');
    // applies on a non-employee tab too (segment filter is global)
    await page.click('#tab-contract');
    await expect(page.locator('#sel-seg')).toBeEnabled();
    await expect.poll(() => page.locator('#print-root .pp-footer').first().textContent(), { timeout: 10_000 })
      .toContain('Business: Projects');
    // the dataset-wide Data Quality tab says it is not narrowed by the filter
    await page.click('#tab-quality');
    await expect(page.locator('#panel-quality')).toContainText('not narrowed to Business: Projects');
  });

  test('CHRO (default) sees everything; every metric is classified; every chart card declares access', async ({ page }) => {
    const net = tripwire(page);
    await loadMockAs(page);
    const r = await page.evaluate(() => ({
      unclassified: REGISTRY.filter((e) => !Access.classOf(e)).map((e) => e.key),
      hidden: REGISTRY.filter((e) => Access.levelFor('chro', e) !== 'full').length,
      tabs: TABS.filter((t) => Access.tabVisibleFor('chro', t.id)).length,
      total: TABS.length
    }));
    expect(r.unclassified).toEqual([]);
    expect(r.hidden).toBe(0);
    expect(r.tabs).toBe(r.total);
    await expect(page.locator('#btn-persona')).toContainText('CHRO (Group)');
    await expect(page.locator('#persona-banner')).toContainText('Persona view — mockup, not a security control');
    for (const t of ['overview', 'talent', 'lnd', 'mobility', 'attrition', 'diversity', 'contract', 'outlook']) {
      await page.click('#tab-' + t);
      expect(await page.locator(`#panel-${t} .is-restricted`).count(), t).toBe(0);
      expect(await page.locator(`#panel-${t} .card:not([data-access]), #panel-${t} .card[data-access="unclassified"]`).count(), t).toBe(0);
    }
    await expect.poll(() => packPages(page), { timeout: 10_000 }).toBe(7);
    expect(net).toEqual([]);
  });

  test('asset_head: locked to its asset, peers never shown, restricted classes are aggregate-only', async ({ page }) => {
    await loadMockAs(page, 'asset_head', { asset: 'Hazira' });
    const sel = page.locator('#sel-asset');
    await expect(sel).toBeDisabled();
    await expect(sel).toHaveValue('Hazira');
    await expect(sel).toHaveAttribute('title', /Locked to Hazira/);
    expect(await sel.locator('option').count()).toBe(1);
    // the admin-only Access Matrix is not rendered at all
    await expect(page.locator('#tab-access')).toHaveCount(0);
    await expect(page.locator('#panel-access')).toHaveCount(0);
    // values are the Hazira values
    const hz = await page.evaluate(() => Compute.metric('headcount_close').value);
    await expect(page.locator('[data-key="headcount_close"] .tile-value')).toHaveText(hz.toLocaleString('en-IN'));
    // cost (and wellbeing): value shown, no drill, badge
    const cost = page.locator('.tile[data-key="cost_per_tonne"]');
    await expect(cost.locator('.tile-badge')).toHaveText('Aggregate only');
    await expect(cost).not.toHaveAttribute('data-drill', /.*/);
    expect(await page.evaluate(() => [Access.level('cost_per_tonne'), Access.level('counselling_sessions'), Access.level('tt_stagnation')]))
      .toEqual(['agg', 'agg', 'full']);
    // peers never appear in charts or cross-filters; Group only as a benchmark
    for (const t of ['overview', 'talent', 'attrition']) {
      await page.click('#tab-' + t);
      for (const peer of ['Paradeep', 'Vizag', 'Kirandul']) {
        expect(await page.locator(`#panel-${t} [data-setasset="${peer}"]`).count()).toBe(0);
        expect(await page.locator(`#panel-${t} svg text`, { hasText: peer }).count(), `${peer} on ${t}`).toBe(0);
      }
    }
    // a tampered filter cannot widen the scope — the compute context re-applies the lock
    const tampered = await page.evaluate(() => {
      App.state.filters.asset = 'Paradeep';
      Compute.invalidate();
      const v = { base: Compute.ctxNow().asset, peer: Compute.metric('headcount_close', { asset: 'Paradeep' }) };
      App.state.filters.asset = 'Hazira';
      return { base: v.base, restricted: v.peer.restricted, value: v.peer.value, group: Compute.metric('headcount_close', { asset: 'Group' }).value };
    });
    expect(tampered.base).toBe('Hazira');
    expect(tampered.restricted).toBe('scope');
    expect(tampered.value).toBeNull();
    expect(tampered.group).toBeGreaterThan(hz);           // Group benchmark allowed
    // print pack: only the own asset
    await expect.poll(() => packPages(page), { timeout: 10_000 }).toBe(3);
    const pack = await page.locator('#print-root').textContent();
    expect(pack).toContain('Hazira — Asset HR head summary');
    expect(pack).not.toContain('Paradeep — Asset HR head summary');
    expect(pack).not.toContain('Group executive summary');
    expect(pack).toContain('Prepared for persona: Asset HR Head · Hazira');
  });

  test('restricted tiles, scorecard rows, charts and popovers show "Restricted" with no value', async ({ page }) => {
    await loadMockAs(page, 'coe_ta');
    // a persona with its own landing tab opens there after the load
    await expect(page.locator('#tab-ta')).toHaveAttribute('aria-selected', 'true');
    await page.click('#tab-overview');
    const tile = page.locator('.tile[data-key="cost_per_tonne"]');
    await expect(tile).toHaveClass(/is-restricted/);
    await expect(tile).toContainText('Restricted for TA & Mobility COE');
    await expect(tile).not.toHaveAttribute('data-drill', /.*/);
    expect(await tile.locator('.spark').count()).toBe(0);
    await tile.locator('.i-btn').click();
    await expect(page.locator('.popover')).toContainText('Manpower cost');         // definition is public
    await expect(page.locator('.popover')).toContainText('Withheld');
    await page.keyboard.press('Escape');
    // tabs outside the persona's list are not rendered
    await expect(page.locator('#tab-talent')).toHaveCount(0);
    await expect(page.locator('#tab-ta')).toHaveCount(1);
    // C&B: core is aggregate-only → value but no drill; talent pools hidden →
    // scorecard rows restricted and out of the means
    await page.evaluate(() => App.setPersona('coe_cnb'));
    const hc = page.locator('.tile[data-key="headcount_close"]');
    await expect(hc.locator('.tile-badge')).toHaveText('Aggregate only');
    await expect(hc.locator('.tile-value')).toHaveText(/^[\d,]+$/);
    await expect(hc).not.toHaveAttribute('data-drill', /.*/);
    await hc.click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await page.click('#tab-scorecard');
    const row = page.locator('tr.sc-restricted[data-key="tt_stagnation"]');
    await expect(row).toContainText('Restricted');
    await expect(page.locator('.sc-cum-label')).toHaveText('Persona-scoped score');
    const tm = page.locator('.sc-table').filter({ hasText: 'TT stagnation' });
    await expect(tm.locator('.sc-total td').last()).toHaveText('—');
    // D8: C&B sees the Scorecard's financial section and the Outlook's cost panel only
    const sc = await page.evaluate(() => Scorecard.compute().functions.map((f) => ({
      fn: f.fn, shown: f.rows.filter((r) => !r.restricted).length, n: f.rows.length })));
    for (const f of sc) {
      if (f.fn === 'Financial Indicators') expect(f.shown, f.fn).toBe(f.n);
      else expect(f.shown, f.fn).toBe(0);
    }
    await expect(page.locator('tr.sc-restricted[data-key="attr_annualised"]')).toContainText('Restricted');
    await page.click('#tab-outlook');
    const panels = page.locator('#panel-outlook .ol-panel');
    const open = page.locator('#panel-outlook .ol-panel:not(.is-restricted)');
    expect(await panels.count()).toBeGreaterThan(1);
    await expect(open).toHaveCount(1);
    await expect(open).toContainText('Manpower cost outlook');
    // HRBP: ops hidden; an asset-grain source is not served at function scope
    await page.evaluate(() => App.setPersona('hrbp', { asset: 'Vizag' }));
    await expect(page.locator('#ctl-fn')).toBeVisible();
    await expect(page.locator('#sel-fn')).toBeDisabled();
    await page.click('#tab-overview');
    await expect(page.locator('.tile[data-key="headcount_contract"]')).toContainText('line-function scope');
    await expect(page.locator('.tile[data-key="ltifr"]')).toHaveClass(/is-restricted/);
    // the summary names the function its figures cover
    const fn = await page.evaluate(() => Access.lockedFunction());
    await expect(page.locator('.exec-band .exec-verdict').first()).toContainText(`Vizag · ${fn}:`);
  });

  test('small cells: gender counts, shares, the gender-by-band and age cuts are withheld below minCell', async ({ page }) => {
    await loadMockAs(page);
    // an HRBP binding whose on-roll women (or men) fall below minCell
    const pick = await page.evaluate(() => {
      for (const asset of CONFIG.assets) {
        for (const fn of Access.functionsAt(asset)) {
          App.setPersona('hrbp', { asset, fn });
          const pop = DemoKit.onRoll(Compute.build(), Compute.ctxNow());
          const f = pop.filter((e) => e.gender === 'Female').length;
          if (f > 0 && f < CONFIG.minCell && pop.length >= 20) return { asset, fn, f, n: pop.length };
        }
      }
      return null;
    });
    expect(pick).toBeTruthy();
    const r = await page.evaluate(() => Object.fromEntries(['demo_women_hc', 'demo_women_pct', 'female_pct'].map((k) => {
      const res = Compute.metric(k);
      return [k, { value: res.value, suppressed: res.suppressed }];
    })));
    expect(r.demo_women_hc).toEqual({ value: null, suppressed: true });
    expect(r.demo_women_pct).toEqual({ value: null, suppressed: true });
    await page.click('#tab-overview');
    await expect(page.locator('.tile[data-key="demo_women_hc"] .tile-value')).toHaveText('<5');
    await expect(page.locator('.tile[data-key="demo_women_pct"] .tile-value')).toContainText('Withheld');
    // the gender donut draws no share once a segment is withheld (it would read 100%)
    const donut = page.locator('.card', { hasText: 'Gender' }).first();
    await expect(donut).toContainText('shares withheld');
    expect(await donut.locator('svg text', { hasText: '%' }).count()).toBe(0);
    // the metrics CSV carries no raw value either
    await page.click('#btn-export');
    const all = await download(page, () => page.click('[data-export-all]'));
    const line = all.text.split(/\r?\n/).find((l) => l.startsWith('demo_women_pct,'));
    expect(line).toContain('Suppressed: a cell below 5');
    expect(all.text.split(/\r?\n/).find((l) => l.startsWith('demo_women_hc,'))).toContain('Suppressed: fewer than 5');
    await page.keyboard.press('Escape');
    // Asset HR Head: female share by grade band and the age distribution suppress too
    await page.evaluate(() => App.setPersona('asset_head', { asset: 'Kirandul' }));
    const cuts = await page.evaluate(() => {
      const m = Compute.build(), ctx = Compute.ctxNow();
      const bands = CONFIG.gradeBands.map((b) => {
        const pop = Compute.actives(m, { ...ctx, band: b }, 'Permanent');
        const f = pop.filter((e) => e.gender === 'Female').length;
        return { label: CONFIG.bandLabels[b], small: Access.suppressed(f) || Access.suppressed(pop.length - f) };
      });
      return { bands };
    });
    expect(cuts.bands.some((b) => b.small)).toBe(true);
    await page.click('#tab-diversity');
    const band = page.locator('#panel-diversity .card', { hasText: 'Female share by grade band' });
    for (const b of cuts.bands.filter((x) => x.small)) {
      await expect(band.locator('g', { hasText: b.label }).locator('.bar-value')).toContainText('withheld');
    }
    // age distribution: a binding with an age bucket below minCell
    const agePick = await page.evaluate(() => {
      const B = [['≤20', 0, 21], ['21–30', 21, 31], ['31–40', 31, 41], ['41–50', 41, 51], ['51–58', 51, 58.0001], ['>58', 58.0001, 200]];
      const binds = [...CONFIG.assets.map((asset) => ['asset_head', { asset }]),
        ...CONFIG.assets.flatMap((asset) => Access.functionsAt(asset).map((fn) => ['hrbp', { asset, fn }]))];
      for (const [id, b] of binds) {
        App.setPersona(id, b);
        const ctx = Compute.ctxNow();
        const perm = Compute.actives(Compute.build(), ctx, 'Permanent').filter((e) => e.dob != null);
        const small = B.filter(([, lo, hi]) => { const n = perm.filter((e) => { const a = yearsBetween(e.dob, ctx.asOfDay); return a >= lo && a < hi; }).length; return n > 0 && n < CONFIG.minCell; });
        if (small.length) return { id, b, small: small.map((x) => x[0]) };
      }
      return null;
    });
    expect(agePick).toBeTruthy();
    await page.click('#tab-overview');
    const age = page.locator('.card', { hasText: 'Age distribution' });
    for (const label of agePick.small) {
      await expect(age.locator('g', { hasText: label }).locator('.bar-value')).toContainText('<5');
    }
    const ageVals = await age.locator('.bar-value').allTextContents();
    expect(ageVals.every((t) => !/^[1-4](\s|$)/.test(t.trim()))).toBe(true);
  });

  test('PII: masked personas get stable pseudonyms in drills and drill CSV; "none" withholds person rows', async ({ page }) => {
    await loadMockAs(page, 'coe_ta');
    await page.click('#tab-mobility');
    const raw = await page.evaluate(() =>
      REG_BY_KEY.get('mobility_ageing').drill(Compute.build(), Compute.ctxNow()).rows.map((r) => r[2]));
    expect(raw.length).toBeGreaterThan(0);
    await page.click('.tile[data-drill="mobility_ageing"]');
    const modal = page.locator('.modal');
    await expect(modal).toContainText('identifiers masked');
    const cells = await modal.locator('.data-table tbody tr td:nth-child(3)').allTextContents();
    expect(cells.length).toBe(raw.length);
    for (const c of cells) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    const text = await modal.innerText();
    for (const id of raw.slice(0, 25)) expect(text).not.toContain(id);
    const csv = await download(page, () => page.click('[data-drill-csv]'));
    for (const id of raw.slice(0, 25)) expect(csv.text).not.toContain(id);
    expect(csv.text).toContain(cells[0]);
    await page.keyboard.press('Escape');
    // stable within the session
    await page.click('.tile[data-drill="mobility_ageing"]');
    expect(await modal.locator('.data-table tbody tr td:nth-child(3)').first().textContent()).toBe(cells[0]);
    await page.keyboard.press('Escape');
    // identified (CHRO) sees the raw IDs; 'none' (C&B) withholds person-level drills
    const r = await page.evaluate(() => {
      const d = REG_BY_KEY.get('mobility_ageing').drill(Compute.build(), Compute.ctxNow());
      const agg = { title: 'x', columns: ['Asset', 'Count'], rows: [['Hazira', '3']] };
      App.setPersona('chro');
      const chro = Access.maskDrill(d);
      App.setPersona('coe_cnb');
      return { chroSame: chro === d, none: Access.maskDrill(d), aggKept: Access.maskDrill(agg) === agg };
    });
    expect(r.chroSame).toBe(true);
    expect(r.none).toBeNull();
    expect(r.aggKept).toBe(true);
  });

  test('exports omit metrics hidden for the persona and carry the persona', async ({ page }) => {
    await loadMockAs(page, 'coe_ta');
    const expected = await page.evaluate(() => ({
      visible: REGISTRY.filter((e) => Access.canSee(e)).length,
      hiddenKeys: REGISTRY.filter((e) => !Access.canSee(e)).map((e) => e.key)
    }));
    expect(expected.hiddenKeys).toContain('tt_stagnation');
    expect(expected.hiddenKeys).toContain('goal_setting_pct');
    expect(expected.hiddenKeys).toContain('cost_per_tonne');
    await page.click('#btn-export');
    const all = await download(page, () => page.click('[data-export-all]'));
    expect(all.name).toBe('amns-hr-all-metrics-coe_ta.csv');
    const lines = all.text.trim().split(/\r?\n/);
    expect(lines[0]).toContain('Business Segment');
    expect(lines[0]).toContain('Access Level');
    expect(lines.length).toBe(expected.visible + 1);
    const keys = lines.slice(1).map((l) => l.split(',')[0]);
    for (const k of expected.hiddenKeys) expect(keys).not.toContain(k);
    expect(keys).toContain('headcount_close');
    expect(keys).toContain('mob_openings');
    expect(all.text).toContain('TA & Mobility COE');
    expect(expected.hiddenKeys).toEqual(expect.arrayContaining(['tt_count', 'ct_count', 'cp_count']));   // talent pools
    // chart PNG export skips restricted cards: their only SVG is the lock icon
    const png = await page.evaluate(() => {
      const panel = document.getElementById('panel-' + App.state.activeTab);
      const before = Exports.exportTabChartsPNG();
      panel.insertAdjacentHTML('beforeend', Charts.card({ title: 'Probe', infoKey: 'tt_stagnation', body: '<svg class="probe"></svg>' }));
      const card = panel.lastElementChild;
      const r = { restricted: card.classList.contains('is-restricted'), chartSvg: card.querySelectorAll('svg:not(.lock-ico)').length, added: Exports.exportTabChartsPNG() - before };
      card.remove();
      return r;
    });
    expect(png).toEqual({ restricted: true, chartSvg: 0, added: 0 });
  });

  test('switching persona re-renders everything and rebuilds the print pack', async ({ page }) => {
    const net = tripwire(page);
    await loadMockAs(page);
    const groupHc = await page.locator('[data-key="headcount_close"] .tile-value').innerText();
    await expect.poll(() => packPages(page), { timeout: 10_000 }).toBe(7);
    // header switcher
    await page.click('#btn-persona');
    await page.check('input[name="pm-persona"][value="asset_head"]');
    await page.selectOption('#pm-asset', 'Paradeep');
    await page.click('[data-persona-apply]');
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(page.locator('#btn-persona')).toContainText('Asset HR Head · Paradeep');
    await expect(page.locator('#persona-banner')).toContainText('Asset HR Head · Paradeep');
    await expect(page.locator('#ft-persona')).toContainText('Asset HR Head · Paradeep');
    await expect(page.locator('#sel-asset')).toHaveValue('Paradeep');
    const pdHc = await page.locator('[data-key="headcount_close"] .tile-value').innerText();
    expect(pdHc).not.toBe(groupHc);
    await expect(page.locator('.exec-band').first()).toContainText('Paradeep');
    await expect(page.locator('#tab-access')).toHaveCount(0);
    await expect.poll(() => packPages(page), { timeout: 10_000 }).toBe(3);
    await expect(page.locator('#print-root .pp-footer').first()).toContainText('Persona: Asset HR Head · Paradeep');
    // a persona without Overview lands on its own landing tab
    await page.evaluate(() => App.setPersona('hrops'));
    await expect(page.locator('#tab-contract')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-overview')).toHaveCount(0);
    // back to CHRO: selector unlocked, Group restored, full pack
    await page.evaluate(() => App.setPersona('chro'));
    await page.click('#tab-overview');
    await expect(page.locator('#sel-asset')).toBeEnabled();
    await expect(page.locator('#sel-asset')).toHaveValue('Group');
    await expect(page.locator('[data-key="headcount_close"] .tile-value')).toHaveText(groupHc);
    await expect.poll(() => packPages(page), { timeout: 10_000 }).toBe(7);
    // the persona survives a reset (shown on the gate), and still nothing on the wire / in storage
    await page.evaluate(() => App.setPersona('segment_head', { segment: 'Operations' }));
    await expect(page.locator('#sel-seg')).toBeDisabled();
    await expect(page.locator('#sel-seg')).toHaveValue('Operations');
    await page.click('#btn-reset');
    await expect(page.locator('#gate-persona')).toHaveValue('segment_head');
    await expect(page.locator('#gate-persona-seg')).toHaveValue('Operations');
    const storage = await page.evaluate(() => ({ l: localStorage.length, s: sessionStorage.length, c: document.cookie }));
    expect(storage).toEqual({ l: 0, s: 0, c: '' });
    expect(net).toEqual([]);
  });

  test('Access Matrix renders from the policy and exports access_matrix.csv', async ({ page }) => {
    await loadMockAs(page);
    await page.click('#tab-access');
    const panel = page.locator('#panel-access');
    await expect(panel).toContainText('Access matrix — persona policy for IT hand-off');
    await expect(panel).toContainText('Mockup — not a security control');
    for (const s of ['server/data-side', 'Row-level security', 'differencing', 'Audit logging', 'SSO group mapping']) {
      await expect(panel).toContainText(s);
    }
    const counts = await page.evaluate(() => ({
      personas: PERSONAS.length, tabs: TABS.length, classes: ACCESS_CLASS_IDS.length, metrics: REGISTRY.length
    }));
    expect(counts.personas).toBe(8);
    const tables = panel.locator('.am-table');
    // tabs × persona, classes × persona: one row per tab / class, one column per persona
    await expect(tables.nth(0).locator('tbody tr')).toHaveCount(counts.tabs);
    await expect(tables.nth(1).locator('tbody tr')).toHaveCount(counts.classes);
    expect(await tables.nth(0).locator('thead th').count()).toBe(2 + counts.personas);
    const csv = await download(page, () => page.click('[data-export-access]'));
    expect(csv.name).toBe('access_matrix.csv');
    const lines = csv.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Record,Persona ID,Persona,Data Scope,PII,Tab ID,Tab,Tab Visible,Access Class,Class Level,Metric Key,Metric,Metric Level,Note');
    expect(lines.length).toBe(1 + counts.personas * (counts.tabs + counts.classes + counts.metrics));
    // the exported levels are exactly what the resolver returns
    const samples = await page.evaluate(() => [['coe_ta', 'tt_stagnation'], ['coe_cnb', 'cost_per_tonne'], ['hrbp', 'ltifr'], ['asset_head', 'lnd_cost_per_emp'], ['hrops', 'contract_hc']]
      .map(([p, k]) => [p, k, Access.levelFor(p, k)]));
    for (const [p, k, lvl] of samples) {
      const line = lines.find((l) => l.startsWith(`metric,${p},`) && l.includes(`,${k},`));
      expect(line, `${p} × ${k}`).toBeTruthy();
      expect(line.endsWith(',' + lvl + ',')).toBe(true);
    }
    // the matrix states what the UI serves: an asset-grain source is Restricted for the
    // function-scoped HRBP (the tile renders restricted), with the reason
    const grain = lines.find((l) => l.startsWith('metric,hrbp,') && l.includes(',headcount_contract,'));
    expect(grain).toContain(',hidden,asset-level source');
    const cnbTabs = lines.filter((l) => l.startsWith('tab,coe_cnb,') && /,(scorecard|outlook),/.test(l));
    expect(cnbTabs.every((l) => /,Y,.*only the/.test(l))).toBe(true);
    // "Preview as" switches persona from the matrix
    await panel.locator('[data-persona="coe_talent"]').click();
    await expect(page.locator('#btn-persona')).toContainText('Talent & L&D COE');
    await expect(page.locator('#tab-talent')).toHaveAttribute('aria-selected', 'true');
  });
});
