/* Registry — metrics that exist primarily for the CHRO Scorecard
   (Talent Acquisition timing + Performance & Rewards promotion discipline). */

defineMetric({
  key: 'time_to_fill_median', label: 'Median time to fill', tab: 'talent',
  group: 'Hiring', unit: 'd', decimals: 0, direction: 'lower', scorecard: 'Talent Acquisition',
  formulaText: 'Median of (Joining Date − Open Date) in days over requisitions filled in the period\n(Closed Date when Joining Date is blank — D3), as the TA tab’s “Median time to fill”',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Joining Date', 'Closed Date', 'Req Status'] }],
  caveat: 'The scorecard row and the TA tab tile share one definition (D3), so their target verdicts agree. Not stated from fewer than five filled requisitions.',
  compute: (m, ctx) => REG_BY_KEY.get('ta_ttf_median').compute(m, ctx),
  quality: (m, ctx) => REG_BY_KEY.get('ta_ttf_median').quality(m, ctx)
});

defineMetric({
  key: 'promo_coverage_2y', label: 'Promoted in last 2 yrs (AM+ bands)', tab: 'talent', access: 'perf',
  group: 'Hiring', unit: '%', direction: 'higher', scorecard: 'Performance & Rewards',
  formulaText: 'Active AM–GM and VP+ employees with a Last Promotion Date within 2 years\n÷ those with tenure ≥2 years × 100',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Grade Band', 'Last Promotion Date', 'Date of Joining'] }],
  caveat: 'Below-AM promotions are usually grade-progressions handled separately; excluded here.',
  compute: (m, ctx) => {
    const pop = Compute.actives(m, ctx, 'Permanent').filter((e) =>
      e.grade_band !== 'Below AM' && e.doj != null && yearsBetween(e.doj, ctx.asOfDay) >= 2);
    if (!pop.length) return null;
    return pop.filter((e) => e.last_promotion != null && yearsBetween(e.last_promotion, ctx.asOfDay) <= 2).length / pop.length * 100;
  }
});

defineMetric({
  key: 'promo_recency_median', label: 'Median years since promotion (AM+)', tab: 'talent', access: 'perf',
  group: 'Hiring', unit: '', decimals: 1, direction: 'lower', scorecard: 'Performance & Rewards',
  formulaText: 'Median of (as-of − Last Promotion Date) in years, for AM–GM and VP+\nemployees who have ever been promoted',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Grade Band', 'Last Promotion Date'] }],
  compute: (m, ctx) => {
    const pop = Compute.actives(m, ctx, 'Permanent')
      .filter((e) => e.grade_band !== 'Below AM' && e.last_promotion != null);
    if (!pop.length) return null;
    return median(pop.map((e) => yearsBetween(e.last_promotion, ctx.asOfDay)));
  }
});
