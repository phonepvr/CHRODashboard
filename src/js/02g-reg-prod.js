/* Registry — Productivity, Cost & Safety.
   Steel-specific block added for AM/NS; flagged in the Methodology tab as an
   addition beyond a classic HR MIS structure. */

defineMetric({
  key: 'tonnes_per_emp', label: 'Crude steel per employee (annualised)', tab: 'overview',
  group: 'Productivity, Cost & Safety', unit: 't', decimals: 0, direction: 'higher', scorecard: 'Financial Indicators',
  formulaText: 'Σ Crude Steel Tonnes in period ÷ average total workforce\n× (12 ÷ months in period)\nTotal workforce = permanent + trainees + contract',
  inputs: [{ dataset: 'production_safety', columns: ['Asset', 'Month', 'Crude Steel Tonnes'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Date of Joining'] },
           { dataset: 'contract_attendance', columns: ['Asset', 'Month', 'Contract Headcount'] }],
  caveat: 'Mining assets report no crude steel; at Group level their workforce still counts in the base.',
  compute: (m, ctx) => {
    const tonnes = Compute.prodSum(m, ctx, 'tonnes');
    if (tonnes == null) return null;
    const onRoll = Compute.avgHeadcount(m, ctx, null);
    const contract = Compute.contractHeadcount(m, ctx) || 0;
    const base = (onRoll || 0) + contract;
    if (!base) return null;
    return tonnes / base * (12 / ctx.periodMonths);
  }
});

defineMetric({
  key: 'cost_per_tonne', label: 'Manpower cost per tonne', tab: 'overview',
  group: 'Productivity, Cost & Safety', unit: '₹', decimals: 0, direction: 'lower', scorecard: 'Financial Indicators',
  formulaText: 'Σ Employee Cost in period ÷ Σ Crude Steel Tonnes in period',
  inputs: [{ dataset: 'production_safety', columns: ['Asset', 'Month', 'Employee Cost', 'Crude Steel Tonnes'] }],
  caveat: 'Employee cost of the on-roll workforce only; contractor charges sit in conversion cost.',
  compute: (m, ctx) => {
    const tonnes = Compute.prodSum(m, ctx, 'tonnes');
    const cost = Compute.prodSum(m, ctx, 'employee_cost');
    if (!tonnes || cost == null) return null;
    return cost / tonnes;
  }
});

defineMetric({
  key: 'ecost_pct_revenue', label: 'Employee cost as % of revenue', tab: 'overview',
  group: 'Productivity, Cost & Safety', unit: '%', decimals: 2, direction: 'lower', scorecard: 'Financial Indicators',
  formulaText: 'Σ Employee Cost in period ÷ Σ Revenue in period × 100',
  inputs: [{ dataset: 'production_safety', columns: ['Asset', 'Month', 'Employee Cost', 'Revenue'] }],
  compute: (m, ctx) => {
    const rev = Compute.prodSum(m, ctx, 'revenue');
    const cost = Compute.prodSum(m, ctx, 'employee_cost');
    if (!rev || cost == null) return null;
    return cost / rev * 100;
  }
});

defineMetric({
  key: 'ltifr', label: 'LTIFR (per 1,000,000 man-hours)', tab: 'overview',
  group: 'Productivity, Cost & Safety', unit: '', decimals: 2, direction: 'lower', scorecard: 'HR Operations',
  formulaText: '(Lost-time injuries in period × 1,000,000) ÷ man-hours worked in period\nBase: one million man-hours',
  inputs: [{ dataset: 'production_safety', columns: ['Asset', 'Month', 'Lost-Time Injuries', 'Man-hours Worked'] }],
  caveat: 'Man-hours include the contract workforce.',
  compute: (m, ctx) => {
    const hrs = Compute.prodSum(m, ctx, 'man_hours');
    const lti = Compute.prodSum(m, ctx, 'lti');
    if (!hrs || lti == null) return null;
    return lti * 1e6 / hrs;
  },
  spark: (m, ctx) => Compute.monthlySeries(m, ctx, (mi) => {
    const rows = m.prod.filter((r) => r.month === mi && Compute.inAsset(ctx, r.asset));
    const hrs = rows.reduce((s, r) => s + (r.man_hours || 0), 0);
    const lti = rows.reduce((s, r) => s + (r.lti || 0), 0);
    return hrs ? lti * 1e6 / hrs : null;
  })
});

defineMetric({
  key: 'ir_mandays', label: 'Man-days lost to IR', tab: 'overview',
  group: 'Productivity, Cost & Safety', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Σ Man-days Lost to IR over the period',
  inputs: [{ dataset: 'production_safety', columns: ['Asset', 'Month', 'Man-days Lost to IR'] }],
  compute: (m, ctx) => Compute.prodSum(m, ctx, 'ir_days')
});
