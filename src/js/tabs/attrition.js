/* Attrition tab — registry-driven tiles grouped into sections, plus charts.
   Helpers (renderTilesByGroup, fillSlot, needData) live in tiles-tabs.js. */

TabRenderers.attrition = (panel) => {
  renderTilesByGroup(panel, 'attrition', {
    leadHTML: `<div class="section-head"><h2>Headline</h2>
        <span class="sub">annualised; superannuation excluded</span></div>
      <div class="tile-grid">${UI.tileHTML('attr_annualised')}</div>
      <div class="chart-slot card-grid" id="charts-attrition-headline" style="margin-top:10px"></div>`
  });
  const m = Compute.build(), ctx = Compute.ctxNow();
  fillSlot('attrition', 'headline', [
    Charts.card({
      title: 'Monthly attrition by asset (annualised)', sub: 'selected asset in red · Group in black · direct-labelled', infoKey: 'attr_annualised',
      body: needData(['exits', 'employee_master'], () => {
        const { months, series } = ChartData.assetLines(ctx, ChartData.attritionAt(m, ctx));
        return Charts.line({ months, series, yFmt: (v) => fmtPct(v, 0), target: Compute.metric('attr_annualised').target?.value ?? null });
      })
    }),
    Charts.card({
      title: 'Total vs voluntary attrition', sub: 'monthly annualised — the gap is involuntary/managed exits', infoKey: 'attr_voluntary',
      body: needData(['exits', 'employee_master'], () => {
        const months = ChartData.monthsAxis(ctx);
        return Charts.line({
          months,
          series: [
            { label: 'Total', role: 'group', values: months.map((mi) => Compute.monthAttritionRate(m, ctx, mi)) },
            { label: 'Voluntary', role: 'focus', values: months.map((mi) => Compute.monthAttritionRateWhere(m, ctx, mi, (x) => x.exit_type === 'Voluntary')) }
          ],
          yFmt: (v) => fmtPct(v, 0)
        });
      })
    })
  ].join(''));
  fillSlot('attrition', 'Exit quality', Charts.card({
    title: 'Exits by stated reason', sub: 'period; blank reasons surfaced, not hidden', infoKey: 'attr_regretted',
    body: needData(['exits', 'employee_master'], () => {
      const counts = new Map();
      for (const x of Compute.exitsInPeriod(m, ctx, null)) {
        const k = x.exit_reason || '(blank)';
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9)
        .map(([label, value]) => ({ label, value, role: label === '(blank)' ? 'focus' : undefined, tip: `${label}: ${fmtInt(value)} exits` }));
      return items.length ? Charts.barH({ items, fmt: (v) => fmtInt(v) }) : '<div class="chart-empty">No exits in the selected period.</div>';
    })
  }));
  fillSlot('attrition', 'Early turnover', Charts.card({
    title: 'Early turnover (≤1 yr) by asset', sub: 'click a bar to focus that asset', infoKey: 'attr_early_1y',
    body: needData(['exits', 'employee_master'], () => Charts.barH({
      items: ChartData.assetBars('attr_early_1y', (v) => fmtPct(v, 1)), fmt: (v) => fmtPct(v, 0),
      target: Compute.metric('attr_early_1y').target?.value ?? null
    }))
  }));
};

