import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ARTIFACT, loadMock, openMock, confirmMapping } from './helpers.mjs';

// R4 — TA Pipeline tab: requisitions (+ lifecycle) and candidate_pipeline.

function guard(page) {
  const net = [], errors = [];
  page.on('request', (req) => { if (!/^(file|data|about|blob):/.test(req.url())) net.push(req.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return { net, errors };
}

async function loadAs(page, persona, bind = {}) {
  await page.goto(ARTIFACT);
  await page.selectOption('#gate-persona', persona);
  if (bind.asset) await page.selectOption('#gate-persona-asset', bind.asset);
  if (bind.segment) await page.selectOption('#gate-persona-seg', bind.segment);
  await loadMock(page);
}

const tileNum = async (page, key) =>
  Number((await page.locator(`#panel-ta .tile[data-key="${key}"] .tile-value`).innerText()).replace(/[^\d.]/g, ''));

const STRIP = ['ta_reqs_total', 'ta_reqs_open', 'ta_open_pct', 'ta_on_hold', 'ta_dropped', 'ta_tbo', 'ta_aged_180',
  'ta_aged_180_pct', 'ta_joins', 'ta_ttf_median', 'ta_sla_breach', 'ta_offer_accept'];

test.describe('R4 — TA Pipeline tab', () => {

  test('CHRO: KPI strip computes real numbers that reconcile with the raw rows', async ({ page }) => {
    const g = guard(page);
    await openMock(page);
    await page.click('#tab-ta');
    const panel = page.locator('#panel-ta');
    await expect(panel.locator('.section-head h2', { hasText: 'Pipeline snapshot' })).toBeVisible();
    // every registry entry on this tab is a hiring-class tile that renders a value
    const keys = await page.evaluate(() => REGISTRY.filter((e) => e.tab === 'ta').map((e) => [e.key, Access.classOf(e)]));
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const [k, cls] of keys) {
      expect(cls, k).toBe('hiring');
      const tile = panel.locator(`.tile[data-key="${k}"]`);
      await expect(tile, k).toHaveCount(1);
      await expect(tile.locator('.tile-value'), k).toHaveText(/\d/);
      await expect(tile, k).not.toHaveClass(/is-empty|is-restricted/);
    }
    for (const k of STRIP) await expect(panel.locator(`.tile[data-key="${k}"]`)).toBeVisible();

    const v = await page.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, Compute.metric(k).value])), STRIP);
    // independent recount from the parsed rows (Group, all segments)
    const raw = await page.evaluate(() => {
      const rows = App.state.datasets.get('requisitions').rows.filter((r) => r.open_date == null || r.open_date <= AS_OF_DAY);
      const open = rows.filter((r) => r.closed_date == null && r.joining_date == null && r.req_status !== 'Dropped' && r.req_status !== 'Closed');
      return {
        total: rows.length, open: open.length,
        hold: open.filter((r) => r.req_status === 'On Hold').length,
        dropped: rows.filter((r) => r.req_status === 'Dropped').length,
        tbo: open.filter((r) => r.offer_accepted_date != null || r.req_status === 'TBO').length,
        aged: open.filter((r) => AS_OF_DAY - r.open_date > 180).length
      };
    });
    expect(v.ta_reqs_total).toBe(raw.total);
    expect(v.ta_reqs_open).toBe(raw.open);
    expect(v.ta_on_hold).toBe(raw.hold);
    expect(v.ta_dropped).toBe(raw.dropped);
    expect(v.ta_tbo).toBe(raw.tbo);
    expect(v.ta_aged_180).toBe(raw.aged);
    expect(v.ta_open_pct).toBeCloseTo(raw.open / raw.total * 100, 6);
    expect(v.ta_aged_180_pct).toBeCloseTo(raw.aged / raw.open * 100, 6);
    for (const k of ['ta_reqs_open', 'ta_on_hold', 'ta_dropped', 'ta_tbo', 'ta_aged_180', 'ta_joins']) expect(v[k], k).toBeGreaterThan(0);
    expect(v.ta_ttf_median).toBeGreaterThan(0);
    expect(v.ta_ttf_median).toBeLessThanOrEqual(540);
    for (const k of ['ta_sla_breach', 'ta_offer_accept']) { expect(v[k]).toBeGreaterThan(0); expect(v[k]).toBeLessThan(100); }
    // the tiles show those values
    expect(await tileNum(page, 'ta_reqs_total')).toBe(raw.total);
    expect(await tileNum(page, 'ta_aged_180')).toBe(raw.aged);
    // TTF = Joining − Open (D3), stated in the "i"
    await panel.locator('.tile[data-key="ta_ttf_median"] .i-btn').click();
    await expect(page.locator('.popover')).toContainText('Joining Date − Open Date');
    await expect(page.locator('.popover')).toContainText('Hiring & internal mobility');
    await page.keyboard.press('Escape');
    expect(g.errors).toEqual([]);
    expect(g.net).toEqual([]);
  });

  test('CHRO: charts render direct-labelled, the funnel is monotonic, one bottleneck, drills show rows', async ({ page }) => {
    await openMock(page);
    await page.click('#tab-ta');
    const panel = page.locator('#panel-ta');
    const cards = panel.locator('.card');
    expect(await cards.count()).toBeGreaterThanOrEqual(16);
    // every card is persona-classified (hiring) and none is empty in mock mode
    expect(await panel.locator('.card:not([data-access="hiring"])').count()).toBe(0);
    expect(await panel.locator('.chart-empty').count()).toBe(0);
    expect(await panel.locator('.is-restricted').count()).toBe(0);
    for (const t of ['Candidate funnel', 'Stage dwell', 'Time-to-fill distribution', 'Time to fill by level', 'Open requisitions by age',
      'Ageing-reason Pareto', 'Aged-open worklist', 'TBO by days since acceptance', 'Hires by source', 'Source effectiveness',
      'Representation across the funnel', 'Recruiter productivity', 'Requisition drops by reason', 'Candidate drop-outs by reason',
      'Scorecard by asset', 'Scorecard by function']) {
      await expect(panel.locator('.card-title', { hasText: t }).first(), t).toBeVisible();
    }
    // funnel: six stages, never increasing, yields from previous and from start
    const f = await page.evaluate(() => TAKit.funnel(Compute.build(), Compute.ctxNow()).map((s) => s.n));
    expect(f.length).toBe(6);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeLessThanOrEqual(f[i - 1]);
    const funnel = panel.locator('.card', { hasText: 'Candidate funnel' });
    await expect(funnel.locator('svg')).toContainText('of prev');
    await expect(funnel.locator('svg')).toContainText('of start');
    await expect(funnel.locator('svg')).toContainText(f[0].toLocaleString('en-IN'));
    // stage dwell: exactly one bottleneck (red) row, named in the note
    const dwell = panel.locator('.card', { hasText: 'Stage dwell' });
    await expect(dwell.locator('.ta-row.is-focus')).toHaveCount(1);
    await expect(dwell.locator('.chart-note')).toContainText('Bottleneck:');
    // histogram bars carry tooltips; SLA marker present
    const hist = panel.locator('.card', { hasText: 'Time-to-fill distribution' });
    await expect(hist.locator('svg')).toContainText('SLA 90 d');
    expect(await hist.locator('[data-tip]').count()).toBeGreaterThanOrEqual(3);
    // ageing buckets in CONFIG order; the Unknown gender is explicit
    const ageTexts = await panel.locator('.card', { hasText: 'Open requisitions by age' }).locator('.bar-label').allTextContents();
    expect(ageTexts).toEqual(['0–30 d', '31–60 d', '61–90 d', '91–180 d', '181–365 d', '365+ d']);
    await expect(panel.locator('.card', { hasText: 'Representation across the funnel' }).locator('svg')).toContainText('Unknown');
    // scorecard by asset iterates the persona's chart scopes (all four + Group for CHRO)
    const sc = panel.locator('.card', { hasText: 'Scorecard by asset' }).locator('tbody tr');
    await expect(sc).toHaveCount(5);
    // CHRO sees raw recruiter codes in the worklist, and a drill lists the aged rows
    const wl = panel.locator('.card', { hasText: 'Aged-open worklist' });
    await expect(wl.locator('tbody tr').first()).toContainText(/REC-\d\d/);
    const aged = await tileNum(page, 'ta_aged_180');
    await panel.locator('.tile[data-key="ta_aged_180"]').click();
    const modal = page.locator('.modal');
    await expect(modal).toContainText('aged > 180 days');
    await expect(modal.locator('.data-table tbody tr')).toHaveCount(aged);
    await expect(modal.locator('.data-table tbody tr').first()).toContainText(/REC-\d\d/);
    await page.keyboard.press('Escape');
    // an ageing bar drills to the open list
    await panel.locator('.card', { hasText: 'Open requisitions by age' }).locator('[data-drill="ta_reqs_open"]').first().click();
    await expect(modal).toContainText('Open requisitions');
    await page.keyboard.press('Escape');
  });

  test('segment, asset and period filters change the numbers; the band filter does not apply', async ({ page }) => {
    await openMock(page);
    await page.click('#tab-ta');
    await expect(page.locator('#sel-band')).toBeDisabled();
    const all = await tileNum(page, 'ta_reqs_total');
    const allOpen = await tileNum(page, 'ta_reqs_open');
    await page.selectOption('#sel-seg', 'Projects');
    await expect.poll(() => tileNum(page, 'ta_reqs_total')).toBeLessThan(all);
    const proj = await tileNum(page, 'ta_reqs_total');
    expect(proj).toBe(await page.evaluate(() => Compute.metric('ta_reqs_total').value));
    expect(proj).toBe(await page.evaluate(() => App.state.datasets.get('requisitions').rows
      .filter((r) => Compute.segOf(r) === 'Projects' && (r.open_date == null || r.open_date <= AS_OF_DAY)).length));
    expect(await tileNum(page, 'ta_reqs_open')).toBeLessThan(allOpen);
    // candidates follow their requisition's segment
    const f = await page.evaluate(() => TAKit.funnel(Compute.build(), Compute.ctxNow())[0].n);
    const fAll = await page.evaluate(() => TAKit.funnel(Compute.build(), Compute.ctxNow({ segment: 'All' }))[0].n);
    expect(f).toBeLessThan(fAll);
    await page.selectOption('#sel-seg', 'All');
    // asset focus
    await page.selectOption('#sel-asset', 'Paradeep');
    await expect.poll(() => tileNum(page, 'ta_reqs_total')).toBeLessThan(all);
    await expect(page.locator('#panel-ta .card', { hasText: 'Scorecard by asset' }).locator('strong')).toHaveText('Paradeep');
    await page.selectOption('#sel-asset', 'Group');
    // period: delivery tiles move, the snapshot does not
    const joins3 = await tileNum(page, 'ta_joins');
    await page.selectOption('#sel-period', '12');
    await expect.poll(() => tileNum(page, 'ta_joins')).toBeGreaterThan(joins3);
    expect(await tileNum(page, 'ta_reqs_total')).toBe(all);
  });

  test('masked persona (TA COE): recruiter and candidate identifiers are pseudonymised everywhere', async ({ page }) => {
    const g = guard(page);
    await loadAs(page, 'coe_ta');
    await page.click('#tab-ta');
    await expect(page.locator('#tab-ta')).toHaveAttribute('aria-selected', 'true');
    const panel = page.locator('#panel-ta');
    await expect(panel.locator('.tile[data-key="ta_reqs_open"]')).toHaveAttribute('data-drill', 'ta_reqs_open');
    // on-screen row tables: no raw recruiter code survives
    for (const t of ['Aged-open worklist', 'Recruiter productivity', 'Open load by recruiter']) {
      const card = panel.locator('.card', { hasText: t });
      await expect(card, t).toBeVisible();
      expect(await card.innerText(), t).not.toMatch(/REC-\d\d/);
    }
    const wlRec = await panel.locator('.card', { hasText: 'Aged-open worklist' }).locator('tbody tr td:last-child').allTextContents();
    expect(wlRec.length).toBeGreaterThan(0);
    for (const c of wlRec) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    // same pseudonym for the same recruiter in the table and the load chart
    const tblRec = await panel.locator('.card', { hasText: 'Recruiter productivity' }).locator('tbody tr td:first-child').allTextContents();
    const chartRec = await panel.locator('.card', { hasText: 'Open load by recruiter' }).locator('.bar-label').allTextContents();
    expect(chartRec[0]).toBe(tblRec[0]);
    // small restricted cuts use the '<5' rule — and a suppressed bar has no length to give it away
    await expect(panel.locator('.card', { hasText: 'Recruiter productivity' })).toContainText(`<${5}`);
    const supWidths = await panel.locator('.card', { hasText: 'Open load by recruiter' }).locator('.ta-row').evaluateAll((gs) => gs
      .filter((gr) => gr.querySelector('.bar-value').textContent.startsWith('<'))
      .map((gr) => Number(gr.querySelectorAll('rect')[1].getAttribute('width'))));
    expect(supWidths.length).toBeGreaterThan(0);
    for (const w of supWidths) expect(w).toBe(0);
    expect(await panel.locator('.card', { hasText: 'Open load by recruiter' }).locator('[data-tip]').evaluateAll((gs) =>
      gs.filter((gr) => /: [1-4]( |$)/.test(gr.dataset.tip)).length)).toBe(0);
    // candidate-level drill: CAN- and EMP- pseudonyms, raw IDs absent from modal and CSV
    const raw = await page.evaluate(() => REG_BY_KEY.get('ta_offer_accept').drill(Compute.build(), Compute.ctxNow()).rows.map((r) => [r[0], r[8]]));
    expect(raw.length).toBeGreaterThan(0);
    await panel.locator('.tile[data-key="ta_offer_accept"]').click();
    const modal = page.locator('.modal');
    await expect(modal).toContainText('identifiers masked');
    const cand = await modal.locator('.data-table tbody tr td:nth-child(1)').allTextContents();
    const rec = await modal.locator('.data-table tbody tr td:nth-child(9)').allTextContents();
    expect(cand.length).toBe(raw.length);
    for (const c of cand) expect(c).toMatch(/^CAN-[0-9A-F]{6}$/);
    for (const c of rec.filter(Boolean)) expect(c).toMatch(/^EMP-[0-9A-F]{6}$/);
    const text = await modal.innerText();
    for (const [id] of raw.slice(0, 20)) expect(text).not.toContain(id);
    expect(text).not.toMatch(/REC-\d\d/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-drill-csv]')]);
    const csv = readFileSync(await dl.path(), 'utf8');
    for (const [id] of raw.slice(0, 20)) expect(csv).not.toContain(id);
    expect(csv).not.toMatch(/REC-\d\d/);
    expect(csv).toContain(cand[0]);
    await page.keyboard.press('Escape');
    // requisition drill: the recruiter column is pseudonymised too
    await panel.locator('.tile[data-key="ta_tbo"]').click();
    await expect(modal).toContainText('identifiers masked');
    expect(await modal.innerText()).not.toMatch(/REC-\d\d/);
    await page.keyboard.press('Escape');
    expect(g.errors).toEqual([]);
    expect(g.net).toEqual([]);
  });

  test('"none" persona gets no TA row-level detail; personas without the tab never see it', async ({ page }) => {
    await openMock(page);
    // C&B / HR Finance: PII none, hiring aggregate-only, TA tab not in its list
    const r = await page.evaluate(() => {
      App.setPersona('coe_cnb');
      const m = Compute.build(), ctx = Compute.ctxNow();
      const d = REG_BY_KEY.get('ta_reqs_open').drill(m, ctx);
      const rows = TAKit.openReqs(m, ctx).slice(0, 5).map((x) => TAKit.openRow(x, ctx));
      const el = document.createElement('div');
      TabRenderers.ta(el);   // rendered off-screen: the table-level rule still applies
      return {
        tab: Access.canSeeTab('ta'), level: Access.level('ta_reqs_open'), drill: Access.canDrill('ta_reqs_open'),
        maskDrill: Access.maskDrill(d), maskTable: Access.maskTable(TAKit.OPEN_COLS, rows, { ids: ['Recruiter'], names: [] }),
        withheld: el.querySelectorAll('.chart-restricted').length, rec: /REC-\d\d/.test(el.textContent),
        drillAttrs: el.querySelectorAll('[data-drill]').length
      };
    });
    expect(r.tab).toBe(false);
    expect(r.level).toBe('agg');
    expect(r.drill).toBe(false);
    expect(r.maskDrill).toBeNull();
    expect(r.maskTable).toBeNull();
    expect(r.withheld).toBe(3);        // worklist, recruiter table, recruiter load chart
    expect(r.rec).toBe(false);
    expect(r.drillAttrs).toBe(0);
    await expect(page.locator('#tab-ta')).toHaveCount(0);
    await expect(page.locator('#panel-ta')).toHaveCount(0);
    for (const p of ['hrbp', 'coe_talent', 'hrops']) {
      await page.evaluate((id) => App.setPersona(id, id === 'hrbp' ? { asset: 'Vizag' } : {}), p);
      await expect(page.locator('#tab-ta'), p).toHaveCount(0);
      await expect(page.locator('#panel-ta'), p).toHaveCount(0);
    }
  });

  test('asset HR head: own asset + Group benchmark only, peers never on the TA tab', async ({ page }) => {
    await loadAs(page, 'asset_head', { asset: 'Hazira' });
    await page.click('#tab-ta');
    const panel = page.locator('#panel-ta');
    const sc = panel.locator('.card', { hasText: 'Scorecard by asset' }).locator('tbody tr td:first-child');
    await expect(sc).toHaveText(['Hazira', 'Group']);
    const text = await panel.innerText();
    for (const peer of ['Paradeep', 'Vizag', 'Kirandul']) expect(text, peer).not.toContain(peer);
    const hz = await page.evaluate(() => Compute.metric('ta_reqs_total').value);
    expect(await tileNum(page, 'ta_reqs_total')).toBe(hz);
    expect(hz).toBe(await page.evaluate(() => App.state.datasets.get('requisitions').rows
      .filter((r) => r.asset === 'Hazira' && (r.open_date == null || r.open_date <= AS_OF_DAY)).length));
  });

  test('requisitions.csv alone: requisition tiles compute, candidate views ask for candidate_pipeline.csv', async ({ page }) => {
    await page.goto(ARTIFACT);
    const csv = await page.evaluate(() => Mock.toCSVs().get('requisitions'));
    await page.setInputFiles('#file-input', { name: 'requisitions.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await confirmMapping(page);
    await expect(page.locator('#app')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.click('#tab-ta');
    const panel = page.locator('#panel-ta');
    await expect(panel.locator('.tile[data-key="ta_reqs_total"] .tile-value')).toHaveText(/^[\d,]+$/);
    await expect(panel.locator('.tile[data-key="ta_ttf_median"] .tile-value')).toContainText('days');
    await expect(panel.locator('.tile[data-key="ta_offer_accept"]')).toHaveClass(/is-empty/);
    await expect(panel.locator('.tile[data-key="ta_offer_accept"]')).toContainText('candidate_pipeline.csv');
    await expect(panel.locator('.card', { hasText: 'Candidate funnel' })).toContainText('needs candidate_pipeline.csv');
    // source effectiveness falls back to the requisition Hire Source
    await expect(panel.locator('.card', { hasText: 'Source effectiveness' })).toContainText('Hire source');
  });
});
