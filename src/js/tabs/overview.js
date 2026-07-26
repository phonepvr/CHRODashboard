/* Overview tab — executive summary band (deterministic, rule-based) +
   headline KPI grid + the steel-specific Productivity, Cost & Safety block. */

TabRenderers.overview = (panel) => {
  const entries = REGISTRY.filter((e) => e.tab === 'overview');
  const groups = [...new Set(entries.map((e) => e.group))];
  panel.innerHTML = `
    ${ExecSummary.bandHTML()}
    ${groups.map((g) => `
      <div class="section-head"><h2>${esc(g)}</h2>
        <span class="sub">${g === 'Productivity, Cost & Safety'
          ? 'steel-specific block — see Methodology'
          : esc(CONFIG.periodLabel) + ' · as of ' + esc(CONFIG.asOf)}</span></div>
      <div class="tile-grid">
        ${entries.filter((e) => e.group === g).map((e) => UI.tileHTML(e.key)).join('')}
      </div>`).join('')}
    <div class="section-head"><h2>Trends</h2><span class="sub">full history · selected asset in red, Group in black</span></div>
    <div class="card-grid" id="charts-overview"></div>`;

  const m = Compute.build(), ctx = Compute.ctxNow();
  document.getElementById('charts-overview').innerHTML = [
    Charts.card({
      title: 'Permanent headcount by asset', sub: 'month-end actives · hover for values', infoKey: 'headcount_close',
      body: needData(['employee_master'], () => {
        const { months, series } = ChartData.assetLines(ctx, ChartData.headcountAt(m, ctx));
        return Charts.line({ months, series, yFmt: (v) => fmtInt(v) });
      })
    }),
    Charts.card({
      title: 'Annualised attrition by asset', sub: 'monthly, with target', infoKey: 'attr_annualised',
      body: needData(['exits', 'employee_master'], () => {
        const { months, series } = ChartData.assetLines(ctx, ChartData.attritionAt(m, ctx));
        return Charts.line({ months, series, yFmt: (v) => fmtPct(v, 0), target: Compute.metric('attr_annualised').target?.value ?? null });
      })
    })
  ].join('');
};
