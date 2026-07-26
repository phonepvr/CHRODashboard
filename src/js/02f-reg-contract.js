/* Registry — Contract Workforce.
   ONLY attendance [SCRUM] and statutory compliance [Aparajita] apply to this
   population — no talent, L&D or succession metrics, by design. */

defineMetric({
  key: 'contract_hc', label: 'Contract headcount', tab: 'contract',
  group: 'Deployment', unit: '', decimals: 0, direction: null, source: 'SCRUM',
  formulaText: 'Σ Contract Headcount across contractors for the latest month in the period',
  inputs: [{ dataset: 'contract_attendance', columns: ['Contractor', 'Asset', 'Month', 'Contract Headcount'] }],
  compute: (m, ctx) => Compute.contractHeadcount(m, ctx),
  drill: (m, ctx) => {
    const latest = Compute.latestPanelMonth(m.cAtt, ctx);
    if (latest == null) return null;
    const rows = m.cAtt.filter((r) => r.month === latest && Compute.inAsset(ctx, r.asset))
      .sort((a, b) => (b.contract_headcount || 0) - (a.contract_headcount || 0));
    return {
      title: `Contract headcount by contractor — ${monthIdxToLabel(latest)}`,
      columns: ['Contractor', 'Asset', 'Headcount', 'Attendance %'],
      rows: rows.map((r) => [r.contractor, r.asset, fmtInt(r.contract_headcount),
        r.mandays_deployed ? fmtPct(r.mandays_present / r.mandays_deployed * 100, 1) : '—'])
    };
  }
});

defineMetric({
  key: 'contract_attendance_pct', label: 'Daily attendance', tab: 'contract',
  group: 'Deployment', unit: '%', direction: 'higher', source: 'SCRUM',
  formulaText: 'Σ Man-days Present ÷ Σ Man-days Deployed over the period × 100',
  inputs: [{ dataset: 'contract_attendance', columns: ['Contractor', 'Asset', 'Month', 'Man-days Deployed', 'Man-days Present'] }],
  compute: (m, ctx) => Compute.contractAttendancePct(m, ctx),
  spark: (m, ctx) => Compute.monthlySeries(m, ctx, (mi) => {
    const rows = m.cAtt.filter((r) => r.month === mi && Compute.inAsset(ctx, r.asset));
    const dep = rows.reduce((s, r) => s + (r.mandays_deployed || 0), 0);
    return dep ? rows.reduce((s, r) => s + (r.mandays_present || 0), 0) / dep * 100 : null;
  })
});

const COMPLIANCE_TILES = [
  ['c_pf_esi', 'PF/ESI remittance compliance', 'pf_esi_flag', 'PF/ESI Remittance OK Flag',
    'Contractor-months with PF/ESI Remittance OK Flag = Y ÷ contractor-months × 100'],
  ['c_wage', 'Wage payment timeliness', 'wage_flag', 'Wage Payment On-Time Flag',
    'Contractor-months with Wage Payment On-Time Flag = Y ÷ contractor-months × 100'],
  ['c_licence', 'Labour licence validity', 'licence_flag', 'Labour Licence Valid Flag',
    'Contractor-months with a valid labour licence ÷ contractor-months × 100']
];
for (const [key, label, field, column, formula] of COMPLIANCE_TILES) {
  defineMetric({
    key, label, tab: 'contract', group: 'Statutory compliance', unit: '%',
    direction: 'higher', source: 'Aparajita',
    formulaText: formula + '\n(over the selected period)',
    inputs: [{ dataset: 'contract_compliance', columns: ['Contractor', 'Asset', 'Month', column] }],
    compute: (m, ctx) => Compute.complianceShare(m, ctx, field),
    drill: (m, ctx) => {
      const rows = Compute.panelRowsInPeriod(m.cComp, ctx).filter((r) => r[field] === false);
      return {
        title: `${label} — misses in period (${rows.length})`,
        columns: ['Contractor', 'Asset', 'Month'],
        rows: rows.map((r) => [r.contractor, r.asset, monthIdxToLabel(r.month)])
      };
    }
  });
}

defineMetric({
  key: 'c_induction', label: 'Safety induction coverage', tab: 'contract',
  group: 'Statutory compliance', unit: '%', direction: 'higher', source: 'Aparajita',
  formulaText: 'Mean of Safety Induction Coverage % across contractor-months in the period',
  inputs: [{ dataset: 'contract_compliance', columns: ['Contractor', 'Asset', 'Month', 'Safety Induction Coverage %'] }],
  compute: (m, ctx) => Compute.inductionAvg(m, ctx)
});

defineMetric({
  key: 'contract_compliance_idx', label: 'Composite contractor compliance', tab: 'contract',
  group: 'Statutory compliance', unit: '%', direction: 'higher', scorecard: 'HR Operations', source: 'Aparajita',
  formulaText: 'Simple mean of the four indices:\n(PF/ESI % + wage timeliness % + licence validity % + safety induction %) ÷ 4',
  inputs: [{ dataset: 'contract_compliance', columns: ['Contractor', 'Asset', 'Month', 'PF/ESI Remittance OK Flag', 'Wage Payment On-Time Flag', 'Labour Licence Valid Flag', 'Safety Induction Coverage %'] }],
  compute: (m, ctx) => Compute.contractCompositeIdx(m, ctx)
});
