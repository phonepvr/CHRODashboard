/* Contract & Compliance tab — contract workforce deployment [SCRUM] and
   statutory compliance [Aparajita]. Helpers live in tiles-tabs.js. */

TabRenderers.contract = (panel) => {
  renderTilesByGroup(panel, 'contract', {
    leadHTML: `<div class="empty-note" style="margin-bottom:10px">
      <strong>Separate population.</strong> Only deployment/attendance
      <span class="tile-src">[SCRUM]</span> and statutory compliance
      <span class="tile-src">[Aparajita]</span> apply to the contract workforce —
      talent, L&amp;D and succession metrics deliberately do not. The grade-band
      filter does not apply here.</div>`
  });
  const m = Compute.build(), ctx = Compute.ctxNow();
  fillSlot('contract', 'Deployment', [
    Charts.card({
      title: 'Daily attendance trend', sub: '[SCRUM] man-days present ÷ deployed, monthly', infoKey: 'contract_attendance_pct',
      body: needData(['contract_attendance'], () => {
        const { months, series } = ChartData.assetLines(ctx, (asset, mi) => {
          const c = ChartData.subCtx(ctx, asset);
          const rows = m.cAtt.filter((r) => r.month === mi && Compute.panelMatch(c, r));
          const dep = rows.reduce((s, r) => s + (r.mandays_deployed || 0), 0);
          return dep ? rows.reduce((s, r) => s + (r.mandays_present || 0), 0) / dep * 100 : null;
        });
        return Charts.line({ months, series, yFmt: (v) => fmtPct(v, 0), target: Compute.metric('contract_attendance_pct').target?.value ?? null });
      })
    }),
    Charts.card({
      title: 'Contract headcount by contractor', sub: '[SCRUM] latest month, top 10', infoKey: 'contract_hc',
      body: needData(['contract_attendance'], () => {
        const latest = Compute.latestPanelMonth(m.cAtt, ctx);
        if (latest == null) return '<div class="chart-empty">No contractor rows in the period.</div>';
        const rows = m.cAtt.filter((r) => r.month === latest && Compute.panelMatch(ctx, r))
          .sort((a, b) => (b.contract_headcount || 0) - (a.contract_headcount || 0)).slice(0, 10);
        return Charts.barH({
          items: rows.map((r) => ({
            label: r.contractor, value: r.contract_headcount, sub: r.asset,
            tip: `${r.contractor} @ ${r.asset}: ${fmtInt(r.contract_headcount)} workers\nAttendance ${r.mandays_deployed ? fmtPct(r.mandays_present / r.mandays_deployed * 100, 1) : '—'}`
          })), fmt: (v) => fmtInt(v)
        });
      })
    })
  ].join(''));
  fillSlot('contract', 'Statutory compliance', Charts.card({
    title: 'Compliance indices', sub: '[Aparajita] period averages vs the composite bar', infoKey: 'contract_compliance_idx',
    body: needData(['contract_compliance'], () => Charts.barH({
      items: [
        ['PF/ESI remittance', 'c_pf_esi'], ['Wage timeliness', 'c_wage'],
        ['Licence validity', 'c_licence'], ['Safety induction', 'c_induction'],
        ['Composite', 'contract_compliance_idx']
      ].map(([label, key]) => {
        const v = Compute.metric(key).value;
        return { label, value: v, role: label === 'Composite' ? 'focus' : undefined, tip: `${label}: ${v == null ? '—' : fmtPct(v, 1)}` };
      }),
      fmt: (v) => fmtPct(v, 1),
      target: Compute.metric('contract_compliance_idx').target?.value ?? null
    }))
  }));
};
