import { test, expect } from '@playwright/test';
import { ARTIFACT, loadMock } from './helpers.mjs';

// R3 — Movement tab: tiles, charts, flow heat-tables, employee history lookup,
// details table; persona + PII rules; segment filter; mock realism.

async function loadMockAs(page, persona = 'chro', bind = {}) {
  await page.goto(ARTIFACT);
  await page.selectOption('#gate-persona', persona);
  if (bind.asset) await page.selectOption('#gate-persona-asset', bind.asset);
  if (bind.segment) await page.selectOption('#gate-persona-seg', bind.segment);
  await loadMock(page);
}

const COUNT_KEYS = ['mv_promotions', 'mv_transfer_location', 'mv_transfer_function', 'mv_transfer_company', 'mv_redesignation', 'mv_segment_change'];
const ALL_KEYS = ['mv_total', ...COUNT_KEYS, 'mv_promotion_rate', 'mv_internal_rate'];
const num = (s) => Number(String(s).replace(/[,%\s]/g, ''));

test.describe('Phase 8 — R3 Movement tab', () => {

  test('mock movements are realistic: one-rung promotions, entities follow sites, unbroken chains', async ({ page }) => {
    await loadMockAs(page);
    const r = await page.evaluate(() => {
      const m = Compute.build();
      const mv = m.movements, L = CONFIG.levels;
      const promos = mv.filter((x) => x.movement_type === 'Promotion');
      const byEmp = MoveKit.idx(m).byEmp;
      let chainBreaks = 0, latestMismatch = 0;
      for (const [id, list] of byEmp) {
        for (let i = 1; i < list.length; i++) {
          const a = list[i - 1].r, b = list[i].r;
          if (a.to_level !== b.from_level || a.to_asset !== b.from_asset || a.to_company !== b.from_company) chainBreaks++;
        }
        const e = m.empById.get(id), last = list[list.length - 1].r;
        if (e && (last.to_level !== e.level || last.to_asset !== e.asset || last.to_function !== e.function)) latestMismatch++;
      }
      return {
        total: mv.length, promos: promos.length,
        notOneRung: promos.filter((x) => L.indexOf(x.from_level) !== L.indexOf(x.to_level) + 1).length,
        sameLevelPromos: promos.filter((x) => x.from_level === x.to_level).length,
        companyB: mv.filter((x) => (x.from_company === 'Company B') !== (x.from_asset === 'Kirandul') || (x.to_company === 'Company B') !== (x.to_asset === 'Kirandul')).length,
        companyC: mv.filter((x) => (x.from_company === 'Company C' && x.from_asset !== 'Hazira') || (x.to_company === 'Company C' && x.to_asset !== 'Hazira')).length,
        locCrossEntity: mv.filter((x) => x.movement_type === 'Transfer – Location' && (x.from_company !== x.to_company || x.from_asset === x.to_asset)).length,
        coNoChange: mv.filter((x) => x.movement_type === 'Transfer – Company' && x.from_company === x.to_company).length,
        types: [...new Set(mv.map((x) => x.movement_type))].sort(),
        chainBreaks, latestMismatch
      };
    });
    expect(r.total).toBeGreaterThan(3000);
    expect(r.promos).toBeGreaterThan(1000);
    expect(r.sameLevelPromos).toBe(0);
    expect(r.notOneRung).toBe(0);
    expect(r.companyB).toBe(0);
    expect(r.companyC).toBe(0);
    expect(r.locCrossEntity).toBe(0);
    expect(r.coNoChange).toBe(0);
    expect(r.types).toEqual(['Promotion', 'Re-designation', 'Segment Change', 'Transfer – Company', 'Transfer – Function', 'Transfer – Location']);
    expect(r.chainBreaks).toBe(0);
    expect(r.latestMismatch).toBe(0);
  });

  test('tiles compute real numbers; charts and heat-tables render direct-labelled with tooltips', async ({ page }) => {
    await loadMockAs(page);
    await page.click('#tab-movement');
    const panel = page.locator('#panel-movement');
    for (const k of ALL_KEYS) await expect(panel.locator(`.tile[data-key="${k}"]`)).toBeVisible();
    const vals = await page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, Compute.metric(k).value])), ALL_KEYS);
    for (const k of ALL_KEYS) {
      expect(vals[k], k).not.toBeNull();
      expect(vals[k], k).toBeGreaterThan(0);
    }
    // the six types partition all movements
    expect(COUNT_KEYS.reduce((s, k) => s + vals[k], 0)).toBe(vals.mv_total);
    for (const k of ['mv_total', 'mv_promotions', 'mv_transfer_company']) {
      expect(num(await panel.locator(`.tile[data-key="${k}"] .tile-value`).innerText())).toBe(vals[k]);
    }
    const shownRate = await panel.locator('.tile[data-key="mv_promotion_rate"] .tile-value').innerText();
    expect(shownRate).toMatch(/^\d+\.\d%$/);
    expect(Math.abs(num(shownRate) - vals.mv_promotion_rate)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(vals.mv_promotion_rate).toBeGreaterThan(1);
    expect(vals.mv_promotion_rate).toBeLessThan(15);
    expect(await panel.locator('.tile .spark').count()).toBe(ALL_KEYS.length);
    // every chart card declares its class; nothing unclassified or restricted for CHRO
    expect(await panel.locator('.card[data-access="unclassified"], .card:not([data-access])').count()).toBe(0);
    expect(await panel.locator('.is-restricted').count()).toBe(0);
    // trend: one direct-labelled line per movement type, hover strips
    const trend = panel.locator('.card', { hasText: 'Movements by type — monthly' });
    for (const lbl of ['Promotion', 'Location', 'Function', 'Company', 'Re-designation', 'Segment']) {
      await expect(trend.locator('svg text.series-label', { hasText: lbl }).first()).toBeVisible();
    }
    expect(await trend.locator('rect[data-tip]').count()).toBeGreaterThan(20);
    // asset → asset heat-table: all four assets, empty diagonal, In total = Out total
    const flow = panel.locator('#mv-flow-asset');
    for (const a of ['Hazira', 'Paradeep', 'Vizag', 'Kirandul']) await expect(flow.locator('thead th', { hasText: a })).toHaveCount(1);
    await expect(flow.locator('td.mv-diag')).toHaveCount(4);
    const sums = await flow.evaluate((t) => {
      const outs = [...t.querySelectorAll('tbody td.mv-tot')].map((c) => +c.textContent.replace(/,/g, ''));
      const ins = [...t.querySelectorAll('tfoot td.mv-tot')].map((c) => +c.textContent.replace(/,/g, ''));
      const cells = [...t.querySelectorAll('tbody td[class^="mv-h"]')].map((c) => +(c.textContent.replace(/,/g, '') || 0));
      return { out: outs.reduce((a, b) => a + b, 0), inAll: ins.slice(0, -1).reduce((a, b) => a + b, 0), grand: ins[ins.length - 1], cells: cells.reduce((a, b) => a + b, 0), tips: t.querySelectorAll('td[data-tip]').length };
    });
    expect(sums.grand).toBeGreaterThan(0);
    expect(sums.out).toBe(sums.grand);
    expect(sums.inAll).toBe(sums.grand);
    expect(sums.cells).toBe(sums.grand);
    expect(sums.tips).toBeGreaterThan(12);
    // level flow: promotions sit left of the diagonal (to a more senior level)
    const lv = await page.evaluate(() => {
      const t = document.getElementById('mv-flow-level');
      const cols = [...t.querySelectorAll('thead th')].slice(1, -1).map((h) => h.textContent);
      let left = 0, right = 0;
      [...t.querySelectorAll('tbody tr')].forEach((tr, i) => {
        [...tr.querySelectorAll('td[class^="mv-h"], td.mv-diag')].forEach((td, j) => {
          const v = +(td.textContent.replace(/,/g, '') || 0);
          if (j < i) left += v; else if (j > i) right += v;
        });
      });
      return { cols, left, right };
    });
    expect(lv.cols[0]).toBe('M-2');
    expect(lv.left).toBeGreaterThan(0);
    expect(lv.right).toBe(0);
    // promotions by band / level: bars with values and hover tips
    const promo = panel.locator('.card', { hasText: 'Promotions by management band and level' });
    await expect(promo.locator('svg')).toHaveCount(2);
    await expect(promo.locator('svg text.bar-label', { hasText: 'Blue collar' })).toHaveCount(1);
    await expect(promo.locator('svg text.bar-label', { hasText: 'M-9' })).toHaveCount(1);
    expect(await promo.locator('g[data-tip]').count()).toBeGreaterThan(5);
    await expect(promo.locator('svg text.bar-value').first()).toContainText('p.a.');
    // the "i" on a tile opens the exact formula
    await panel.locator('.tile[data-key="mv_promotion_rate"] .i-btn').click();
    await expect(page.locator('.popover')).toContainText('÷ average permanent headcount');
    await expect(page.locator('.popover')).toContainText('Performance & recognition');
    await page.keyboard.press('Escape');
  });

  test('segment and grade-band filters change the movement numbers', async ({ page }) => {
    await loadMockAs(page);
    await page.click('#tab-movement');
    const tile = page.locator('#panel-movement .tile[data-key="mv_promotions"] .tile-value');
    const all = num(await tile.innerText());
    await page.selectOption('#sel-seg', 'Projects');
    await expect.poll(async () => num(await tile.innerText())).toBeLessThan(all);
    const proj = num(await tile.innerText());
    expect(proj).toBe(await page.evaluate(() => Compute.metric('mv_promotions').value));
    expect(proj).toBeGreaterThan(0);
    // a segment change counts for both segments (From and To side)
    const seg = await page.evaluate(() => ({
      ops: Compute.metric('mv_segment_change', { segment: 'Operations' }).value,
      proj: Compute.metric('mv_segment_change', { segment: 'Projects' }).value,
      all: Compute.metric('mv_segment_change', { segment: 'All' }).value
    }));
    expect(seg.ops).toBe(seg.all);
    expect(seg.proj).toBe(seg.all);
    await page.selectOption('#sel-seg', 'All');
    await expect(page.locator('#sel-band')).toBeEnabled();
    await page.selectOption('#sel-band', 'AM-GM');
    await expect.poll(async () => num(await tile.innerText())).toBeLessThan(all);
  });

  test('CHRO drill lists identified rows; employee history lookup shows join → moves → last promotion → exit', async ({ page }) => {
    await loadMockAs(page);
    await page.click('#tab-movement');
    await page.click('#panel-movement .tile[data-drill="mv_promotions"]');
    const modal = page.locator('.modal');
    await expect(modal).toContainText('Promotions in period');
    await expect(modal.locator('thead th', { hasText: 'Name' })).toHaveCount(1);
    await expect(modal.locator('tbody tr td:first-child').first()).toHaveText(/^AMNS-[A-Z]{2}-\d{5}$/);
    await page.keyboard.press('Escape');
    // an exited employee with ≥2 movements including a promotion
    const pick = await page.evaluate(() => {
      const m = Compute.build();
      for (const [id, list] of MoveKit.idx(m).byEmp) {
        const e = m.empById.get(id);
        if (e && e.__exit && e.__exit.exit_type !== 'Retirement' && list.length >= 2 && list.some((x) => x.type === 'Promotion')) {
          return { id, name: e.name, moves: list.length, exitType: e.__exit.exit_type };
        }
      }
      return null;
    });
    expect(pick).not.toBeNull();
    // opens with an example already drawn
    await expect(page.locator('#mv-timeline .mv-ev').first()).toBeVisible();
    await page.fill('#mv-emp-input', pick.id.toLowerCase());
    await page.press('#mv-emp-input', 'Enter');
    const tl = page.locator('#mv-timeline');
    await expect(tl.locator('[data-mv-id]')).toHaveText(pick.id);
    await expect(tl).toContainText(pick.name);
    await expect(tl.locator('.mv-ev-join')).toHaveCount(1);
    await expect(tl.locator('.mv-ev[data-type]')).toHaveCount(pick.moves);
    await expect(tl.locator('.mv-ev.is-last-promo')).toHaveCount(1);
    await expect(tl.locator('.mv-ev-exit')).toContainText(pick.exitType);
    await expect(tl.locator('.mv-ev-now')).toHaveCount(0);
    await expect(tl.locator('.mv-tl-status')).toHaveText('Exited');
    // chronological: joining first, exit last, dates ascending
    const dates = await tl.locator('.mv-ev .mv-date').allTextContents();
    const days = dates.map((d) => { const [dd, mm, yy] = d.trim().slice(0, 10).split('-').map(Number); return Date.UTC(yy, mm - 1, dd); });
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    await expect(tl.locator('.mv-ev').first()).toHaveClass(/mv-ev-join/);
    await expect(tl.locator('.mv-ev').last()).toHaveClass(/mv-ev-exit/);
    // an unknown ID resolves to nothing
    await page.fill('#mv-emp-input', 'NOT-AN-ID');
    await page.click('#mv-emp-go');
    await expect(tl.locator('[data-mv-notfound]')).toBeVisible();
    // identified details table shows raw IDs and names
    await expect(page.locator('#mv-details thead th', { hasText: 'Name' })).toHaveCount(1);
    await expect(page.locator('#mv-details tbody tr td:first-child').first()).toHaveText(/^AMNS-/);
  });

  test('masked persona (HR Ops): pseudonymised drills, table and list-picked timeline; promotion rate hidden', async ({ page }) => {
    await loadMockAs(page, 'hrops');
    await page.click('#tab-movement');
    const panel = page.locator('#panel-movement');
    await expect(panel.locator('.tile[data-key="mv_promotions"] .tile-value')).toHaveText(/^[\d,]+$/);
    // promotion rate is Performance-class: restricted, no value, no drill
    const rate = panel.locator('.tile[data-key="mv_promotion_rate"]');
    await expect(rate).toHaveClass(/is-restricted/);
    await expect(rate).toContainText('Restricted for HR Ops & IR');
    await expect(rate).not.toHaveAttribute('data-drill', /.*/);
    expect(await page.evaluate(() => Compute.metric('mv_promotion_rate').value)).toBeNull();
    await expect(panel.locator('.card', { hasText: 'Promotions by management band and level' }).locator('svg text.bar-value', { hasText: 'p.a.' })).toHaveCount(0);
    // raw IDs never reach the DOM of the tab
    expect(await panel.evaluate((p) => /AMNS-/.test(p.innerHTML))).toBe(false);
    // drill: pseudonyms, names dropped, CSV-safe
    const raw = await page.evaluate(() => REG_BY_KEY.get('mv_promotions').drill(Compute.build(), Compute.ctxNow()).rows.map((r) => r[0]));
    expect(raw.length).toBeGreaterThan(0);
    await panel.locator('.tile[data-drill="mv_promotions"]').click();
    const modal = page.locator('.modal');
    await expect(modal).toContainText('identifiers masked');
    await expect(modal.locator('thead th', { hasText: 'Name' })).toHaveCount(0);
    const cells = await modal.locator('tbody tr td:first-child').allTextContents();
    expect(cells.length).toBe(raw.length);
    for (const c of cells) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    const text = await modal.innerText();
    for (const id of raw.slice(0, 25)) expect(text).not.toContain(id);
    await page.keyboard.press('Escape');
    // details table pseudonymised the same way
    await expect(page.locator('#mv-details thead th', { hasText: 'Name' })).toHaveCount(0);
    await expect(page.locator('#mv-details tbody tr td:first-child').first()).toHaveText(/^EMP-[0-9A-F]{6}$/);
    // lookup: no free-text ID box, a pseudonymised pick list whose values are indices
    await expect(page.locator('#mv-emp-input')).toHaveCount(0);
    const sel = page.locator('#mv-emp-select');
    await expect(sel).toBeVisible();
    const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })));
    expect(opts.length).toBeGreaterThan(10);
    for (const o of opts.slice(1)) {
      expect(o.v).toMatch(/^\d+$/);
      expect(o.t).toMatch(/^EMP-[0-9A-F]{6} · /);
    }
    await sel.selectOption('3');
    const tl = page.locator('#mv-timeline');
    await expect(tl.locator('[data-mv-id]')).toHaveText(opts[4].t.split(' · ')[0]);
    await expect(tl.locator('.mv-ev-join')).toHaveCount(1);
    expect(await tl.locator('.mv-ev[data-type]').count()).toBeGreaterThan(0);
    await expect(tl).toContainText('pseudonymised');
    // small cells read "<5" for a persona-restricted view where CHRO sees the number
    const small = await page.evaluate(() => {
      const f = MoveKit.flow(Compute.build(), Compute.ctxNow(), { fromKey: (x) => x.r.from_level, toKey: (x) => x.r.to_level, months: 12, order: CONFIG.levels });
      for (const a of f.axis) for (const b of f.axis) { const n = f.get(a, b); if (n > 0 && n < CONFIG.minCell) return { a, b, n, col: f.axis.indexOf(b) }; }
      return null;
    });
    expect(small).not.toBeNull();
    const row = page.locator('#mv-flow-level tbody tr', { has: page.locator('th', { hasText: new RegExp(`^${small.a}$`) }) });
    await expect(row.locator('td').nth(small.col)).toHaveText('<5');
  });

  test('personas without the tab never see it; a "none" persona gets the lookup disabled and rows withheld', async ({ page }) => {
    await loadMockAs(page, 'coe_ta');
    await expect(page.locator('#tab-movement')).toHaveCount(0);
    await expect(page.locator('#panel-movement')).toHaveCount(0);
    const vis = await page.evaluate(() => PERSONAS.filter((p) => Access.tabVisibleFor(p.id, 'movement')).map((p) => p.id).sort());
    expect(vis).toEqual(['asset_head', 'chro', 'coe_talent', 'hrops', 'segment_head']);
    // HRBP: no tab either; org is Full as shipped, so probe the aggregate-only path with a patched policy
    await page.evaluate(() => App.setPersona('hrbp', { asset: 'Vizag' }));
    await expect(page.locator('#tab-movement')).toHaveCount(0);
    expect(await page.evaluate(() => [Access.level('mv_total'), Access.level('mv_promotion_rate')])).toEqual(['full', 'full']);
    await page.evaluate(() => { PERSONA_BY_ID.get('hrbp').levels.org = 'agg'; App.setPersona('hrbp', { asset: 'Vizag' }); });
    expect(await page.evaluate(() => [Access.level('mv_total'), Access.level('mv_promotion_rate')])).toEqual(['agg', 'full']);
    const agg = await page.evaluate(() => {
      const el = document.createElement('section');
      TabRenderers.movement(el);
      return {
        disabled: el.querySelector('#mv-emp-input')?.disabled, why: el.querySelector('#mv-history-withheld')?.textContent || '',
        details: !!el.querySelector('#mv-details-withheld'), badge: el.querySelector('.tile[data-key="mv_total"] .tile-badge')?.textContent,
        ids: /AMNS-|EMP-[0-9A-F]{6}/.test(el.innerHTML)
      };
    });
    expect(agg).toEqual({ disabled: true, why: expect.stringContaining('aggregate-only'), details: true, badge: 'Aggregate only', ids: false });
    // C&B (PII none): render the tab into a probe to prove the row-level rule
    await page.evaluate(() => App.setPersona('coe_cnb'));
    await expect(page.locator('#tab-movement')).toHaveCount(0);
    await page.evaluate(() => {
      const el = document.createElement('section');
      el.id = 'mv-probe';
      document.getElementById('tab-panels').appendChild(el);
      TabRenderers.movement(el);
    });
    const probe = page.locator('#mv-probe');
    await expect(probe.locator('#mv-emp-input')).toBeDisabled();
    await expect(probe.locator('#mv-emp-go')).toBeDisabled();
    await expect(probe.locator('#mv-history-withheld')).toContainText('aggregates only (identifiers: none)');
    await expect(probe.locator('#mv-details-withheld')).toBeVisible();
    await expect(probe.locator('#mv-timeline')).toHaveCount(0);
    expect(await probe.evaluate((p) => /AMNS-|EMP-[0-9A-F]{6}/.test(p.innerHTML))).toBe(false);
    await probe.locator('.tile[data-drill="mv_promotions"]').click();
    await expect(page.locator('.modal')).toContainText('Row-level detail withheld');
    await page.keyboard.press('Escape');
    // promotion rate is aggregate-only for C&B (perf = agg): value, but no drill
    const rate = probe.locator('.tile[data-key="mv_promotion_rate"]');
    await expect(rate.locator('.tile-badge')).toHaveText('Aggregate only');
    await expect(rate).not.toHaveAttribute('data-drill', /.*/);
    await page.evaluate(() => document.getElementById('mv-probe').remove());
  });

  test('asset-locked persona: own asset + pooled "Other assets" only; lookup resolves own-asset employees only', async ({ page }) => {
    await loadMockAs(page, 'asset_head', { asset: 'Hazira' });
    await page.click('#tab-movement');
    const flow = page.locator('#mv-flow-asset');
    await expect(flow.locator('thead th', { hasText: 'Hazira' })).toHaveCount(1);
    await expect(flow.locator('thead th', { hasText: 'Other assets' })).toHaveCount(1);
    for (const peer of ['Paradeep', 'Vizag', 'Kirandul']) {
      expect(await flow.locator('th', { hasText: peer }).count(), peer).toBe(0);
      expect(await page.locator('#panel-movement svg text', { hasText: peer }).count(), peer).toBe(0);
    }
    // Hazira values; Group benchmark allowed, peers refused
    const r = await page.evaluate(() => ({
      hz: Compute.metric('mv_promotions').value,
      group: Compute.metric('mv_promotions', { asset: 'Group' }).value,
      peer: Compute.metric('mv_promotions', { asset: 'Paradeep' }).restricted,
      peerId: [...Compute.build().empById.values()].find((e) => e.asset === 'Paradeep').employee_id,
      ownId: [...Compute.build().empById.values()].find((e) => e.asset === 'Hazira').employee_id
    }));
    expect(r.group).toBeGreaterThan(r.hz);
    expect(r.peer).toBe('scope');
    await expect(page.locator('#panel-movement .tile[data-key="mv_promotions"] .tile-value')).toHaveText(r.hz.toLocaleString('en-IN'));
    await page.fill('#mv-emp-input', r.peerId);
    await page.press('#mv-emp-input', 'Enter');
    await expect(page.locator('#mv-timeline [data-mv-notfound]')).toBeVisible();
    await page.fill('#mv-emp-input', r.ownId);
    await page.press('#mv-emp-input', 'Enter');
    await expect(page.locator('#mv-timeline [data-mv-id]')).toHaveText(r.ownId);
  });
});
