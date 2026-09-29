import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openMock as loadMock, loadFiles } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = 'file://' + join(root, 'dist', 'index.html');
const FIX = (f) => join(root, 'tests', 'fixtures', f);

test.describe('Phase 4 — charts & interactivity', () => {

  test('every tab renders its charts with direct labels; funnel and donut draw', async ({ page }) => {
    await loadMock(page);
    // overview trend charts (headcount, attrition, joins-vs-exits, HC vs 12m ago)
    expect(await page.locator('#charts-overview svg').count()).toBe(4);
    await expect(page.locator('#charts-overview .series-label', { hasText: 'Group' }).first()).toBeVisible();
    // workforce demographics: age, tenure, band distributions
    expect(await page.locator('#charts-overview-demo svg').count()).toBe(3);
    // attrition line + reasons + early turnover
    await page.click('#tab-attrition');
    expect(await page.locator('#panel-attrition .card svg').count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator('#panel-attrition .card', { hasText: 'Exits by stated reason' })).toContainText('(blank)');
    // mobility funnel
    await page.click('#tab-mobility');
    await expect(page.locator('#panel-mobility .card', { hasText: 'funnel' })).toBeVisible();
    // lnd donut
    await page.click('#tab-lnd');
    await expect(page.locator('#panel-lnd .donut-center')).toHaveText('person-days');
    // contract charts carry source labels
    await page.click('#tab-contract');
    await expect(page.locator('#panel-contract .card-sub', { hasText: 'SCRUM' }).first()).toBeVisible();
    await expect(page.locator('#panel-contract .card-sub', { hasText: 'Aparajita' }).first()).toBeVisible();
  });

  test('hover tooltip appears over chart marks', async ({ page }) => {
    await loadMock(page);
    const strip = page.locator('#charts-overview svg rect[data-tip]').first();
    await strip.hover();
    const tip = page.locator('#tip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Hazira');
  });

  test('clicking an asset bar cross-filters the whole dashboard', async ({ page }) => {
    await loadMock(page);
    const groupHc = await page.locator('[data-key="headcount_close"] .tile-value').innerText();
    await page.click('#tab-attrition');
    await page.locator('#panel-attrition [data-setasset="Paradeep"]').first().click();
    await expect(page.locator('#sel-asset')).toHaveValue('Paradeep');
    await page.click('#tab-overview');
    const paradeepHc = await page.locator('[data-key="headcount_close"] .tile-value').innerText();
    expect(paradeepHc).not.toBe(groupHc);
    await expect(page.locator('.exec-band').first()).toContainText('Paradeep');
  });

  test('drill-down modal opens from a tile and from keyboard', async ({ page }) => {
    await loadMock(page);
    const tile = page.locator('.tile[data-drill="headcount_close"]');
    await tile.click();
    await expect(page.locator('.modal')).toContainText('Headcount by asset and grade band');
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toHaveCount(0);
    // keyboard: Enter on focused tile
    await tile.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.modal')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('chart drills and cross-filters are keyboard buttons (Tab, then Enter)', async ({ page }) => {
    await loadMock(page);
    await page.click('#tab-attrition');
    const cuts = page.locator('#attr-cuts g[data-drill]');
    expect(await cuts.count()).toBeGreaterThan(20);
    expect(await page.locator('#attr-cuts g[data-drill]:not([tabindex="0"][role="button"][aria-label])').count()).toBe(0);
    // reach a tenure bar from the keyboard alone
    const tenure = page.locator('#attr-cuts g[data-drill="attr_rate_tenure"]').first();
    await page.keyboard.press('Shift+Tab');
    await tenure.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(tenure).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.modal h3')).toContainText('Attrition by tenure bucket');
    await page.keyboard.press('Escape');
    // a focus-an-asset bar: Space focuses the asset and keeps keyboard focus on the mark
    const bar = page.locator('#panel-attrition g[data-setasset="Vizag"][role="button"]').first();
    await bar.focus();
    await page.keyboard.press(' ');
    await expect(page.locator('#sel-asset')).toHaveValue('Vizag');
    await expect(page.locator('#panel-attrition g[data-setasset="Vizag"][role="button"]').first()).toBeFocused();
    // the absenteeism heat table's row heads are real buttons
    await page.selectOption('#sel-asset', 'Group');
    await page.click('#tab-absence');
    const head = page.locator('#panel-absence th button[data-setasset="Paradeep"]');
    await head.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sel-asset')).toHaveValue('Paradeep');
  });

  test('chart text stays legible and inside the chart in narrow cards', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await loadMock(page);
    const tabs = ['overview', 'managers', 'positions', 'joining', 'contract', 'attrition', 'absence', 'movement', 'diversity', 'outlook'];
    for (const t of tabs) {
      await page.click('#tab-' + t);
      const r = await page.evaluate((t) => {
        const out = { min: 99, clipped: [], stacked: [], onBar: [], dim: [] };
        const lum = (c) => { const v = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((x) => { x = +x / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        for (const svg of document.querySelectorAll(`#panel-${t} .card svg[data-chart]`)) {
          const vb = svg.viewBox.baseVal, box = svg.getBoundingClientRect();
          if (!box.width) continue;
          const k = box.width / vb.width;
          const name = svg.closest('.card').querySelector('.card-title').textContent.trim();
          for (const tx of svg.querySelectorAll('text')) {
            out.min = Math.min(out.min, parseFloat(getComputedStyle(tx).fontSize) * k);
            const b = tx.getBoundingClientRect();
            if (tx.classList.contains('bar-value') && b.right > box.right + 1) out.clipped.push(`${name}: ${tx.textContent}`);
          }
          const labs = [...svg.querySelectorAll('text.series-label')];
          const rects = labs.map((x) => x.getBoundingClientRect()).sort((a, b) => a.top - b.top);
          for (let i = 1; i < rects.length; i++) if (rects[i - 1].bottom - rects[i].top > 0.25 * rects[i].height) out.stacked.push(name);
          for (const l of labs) if ((1.05) / (lum(getComputedStyle(l).fill) + 0.05) < 4.5) out.dim.push(`${name}: ${l.textContent}`);
          const tl = [...svg.querySelectorAll('text.ax')].find((x) => x.textContent.startsWith('target '));
          const first = svg.querySelector('g rect');
          if (tl && first) {
            const a = tl.getBoundingClientRect(), c = first.getBoundingClientRect();
            if (c.width > 1 && a.bottom > c.top + 1 && a.top < c.bottom) out.onBar.push(name);
          }
        }
        return out;
      }, t);
      expect(r.min, t).toBeGreaterThanOrEqual(8);
      expect(r.clipped, t).toEqual([]);
      expect(r.stacked, t).toEqual([]);
      expect(r.onBar, t).toEqual([]);
      expect(r.dim, t).toEqual([]);
    }
  });

  test('muted text meets AA: compliance n/a cells, the benchmark tag, the Access Matrix current column', async ({ page }) => {
    await loadMock(page);
    const ratio = async () => page.evaluate(() => {
      const lum = (c) => { const v = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((x) => { x = +x / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const cr = (el) => {
        let bg = 'rgb(255, 255, 255)';
        for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)') { bg = b; break; } }
        const a = lum(getComputedStyle(el).color), b = lum(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      return Math.min(...[...document.querySelectorAll('.ck-heat td.ck-na, .ck-heat td.ck-none, .ck-bench, th.am-current, .am-current .am-sub')].map(cr));
    });
    await page.click('#tab-contract');
    expect(await ratio()).toBeGreaterThanOrEqual(4.5);
    await page.click('#tab-access');
    expect(await ratio()).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => App.setPersona('asset_head'));
    await page.click('#tab-contract');
    expect(await page.locator('.ck-bench').count()).toBeGreaterThan(0);
    expect(await ratio()).toBeGreaterThanOrEqual(4.5);
  });

  test('partial load: charts needing missing datasets show the named empty state', async ({ page }) => {
    await page.goto(ARTIFACT);
    await loadFiles(page, [FIX('employee_master.csv'), FIX('exits.csv')]);
    await page.keyboard.press('Escape');
    await page.click('#tab-contract');
    await expect(page.locator('#panel-contract .chart-empty').first()).toContainText('contract_attendance.csv');
    await page.click('#tab-mobility');
    await expect(page.locator('#panel-mobility .chart-empty').first()).toContainText('requisitions.csv');
  });

  test('search filters tiles on the active tab', async ({ page }) => {
    await loadMock(page);
    const before = await page.locator('#panel-overview .tile:visible').count();
    await page.fill('#search', 'attrition');
    await expect.poll(() => page.locator('#panel-overview .tile:visible').count()).toBeLessThan(before);
    expect(await page.locator('#panel-overview .tile:visible').count()).toBeGreaterThanOrEqual(1);
    await page.fill('#search', '');
  });
});
